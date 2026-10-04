#!/usr/bin/env node
/**
 * Generate golden conformance fixtures from the reference Python MMA.
 *
 * For each corpus entry:
 *   1. runs `mma.py -II -f out.mid <song>` to produce the reference MIDI;
 *   2. runs `test/tools/mma_dump.py -n --out state.json <song>` for the
 *      internal state (tracks, patterns, bar pointers, packed mtrks);
 *   3. parses the .mid with spessasynth_core and normalizes the events.
 *
 * Fixtures are committed so the test suite needs only Node; re-run with
 * `npm run test:regen` when the Python baseline changes.
 *
 * Usage: npx tsx scripts/gen-fixtures.ts [--write|--check] [entry...]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BasicMIDI } from 'spessasynth_core';
import { normalizeBasicMIDI } from '../test/helpers/midiNormalize';

const here = dirname(fileURLToPath(import.meta.url));
const tsDir = resolve(here, '..');
const mmaRepo = resolve(tsDir, '..');
const fixturesDir = join(tsDir, 'test', 'fixtures', 'golden');

import { CORPUS, type CorpusEntry } from '../test/fixtures/corpus';

export interface GoldenFixture {
  name: string;
  file: string;
  pythonState: unknown;
  midiEvents: unknown;
}

function run(args: string[], cwd: string): string {
  return execFileSync(args[0]!, args.slice(1), {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function generate(entry: CorpusEntry): GoldenFixture {
  const tmp = mkdtempSync(join(tmpdir(), 'mma-fixture-'));
  const runCwd = entry.cwd ? resolve(mmaRepo, entry.cwd) : mmaRepo;
  try {
    const songText = readFileSync(resolve(mmaRepo, entry.file), 'utf-8');
    const songPath = join(tmp, 'song.mma');
    writeFileSync(songPath, (entry.prelude ? entry.prelude + '\n' : '') + songText);

    // -xNOCREDIT keeps the fixtures deterministic: without it the meta
    // track embeds the temporary input filename.
    const midPath = join(tmp, 'out.mid');
    run(
      ['python3', join(mmaRepo, 'mma.py'), '-II', '-xNOCREDIT', ...(entry.args ?? []), '-f', midPath, songPath],
      runCwd,
    );

    const statePath = join(tmp, 'state.json');
    run(['python3', join(tsDir, 'test', 'tools', 'mma_dump.py'), '-n', '--out', statePath, songPath], runCwd);
    const pythonState = JSON.parse(readFileSync(statePath, 'utf-8'));

    const buf = readFileSync(midPath);
    const midi = BasicMIDI.fromArrayBuffer(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    );
    const midiEvents = normalizeBasicMIDI(midi);

    return { name: entry.name, file: entry.file, pythonState, midiEvents };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--check') ? 'check' : 'write';
  const names = argv.filter((a) => !a.startsWith('--'));
  const entries = CORPUS.filter((e) => names.length === 0 || names.includes(e.name));

  let failures = 0;
  const skipped: string[] = [];
  for (const entry of entries) {
    let fixture: GoldenFixture;
    try {
      fixture = generate(entry);
    } catch (e) {
      // e.g. songs with no musical data: the Python CLI refuses to write
      // a meta-only MIDI ("No data created"), so they cannot be compared.
      skipped.push(entry.name);
      console.error(`skipped ${entry.name}: ${(e as Error).message.split('\n')[0]}`);
      continue;
    }
    const outPath = join(fixturesDir, `${entry.name}.json`);
    if (mode === 'write') {
      writeFileSync(outPath, JSON.stringify(fixture));
      console.log(`wrote ${outPath} (${(fixture.midiEvents as unknown[]).length} events)`);
    } else {
      const existing = existsSync(outPath) ? readFileSync(outPath, 'utf-8') : '';
      if (JSON.stringify(fixture) !== existing) {
        console.error(`fixture drift: ${outPath}`);
        failures++;
      }
    }
  }
  if (skipped.length) console.error(`\nSkipped: ${skipped.join(', ')}`);
  if (failures > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

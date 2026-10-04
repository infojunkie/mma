#!/usr/bin/env node
/**
 * Conformance report: run the TypeScript façade over the golden corpus
 * and report event-stream differences against the Python reference.
 *
 * This is a development aid (the committed tests cover the entries that
 * must pass); it is how later milestones measure progress on the larger
 * corpus.
 *
 * Usage: npx tsx scripts/check-conformance.ts [fixture...]
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BasicMIDI } from 'spessasynth_core';
import { MMA } from '../src/api/MMA';
import { MemoryResources } from '../src/io/MMAResources';
import { loadM1Resources, loadLibraryResources } from '../test/helpers/resources';
import { decodeMMAText } from '../src/io/decodeText';
import { diffEvents, normalizeBasicMIDI } from '../test/helpers/midiNormalize';
import { CORPUS } from '../test/fixtures/corpus';

const here = dirname(fileURLToPath(import.meta.url));
const tsDir = resolve(here, '..');
const mmaRepo = resolve(tsDir, '..');

async function main(): Promise<void> {
  const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const entries = CORPUS.filter((e) => names.length === 0 || names.includes(e.name));

  for (const entry of entries) {
    const resources = entry.resources === 'm1' ? loadM1Resources() : loadLibraryResources();
    const sourceRaw = decodeMMAText(readFileSync(resolve(mmaRepo, entry.file)));
    const golden = JSON.parse(readFileSync(join(tsDir, 'test/fixtures/golden', `${entry.name}.json`), 'utf-8')) as {
      midiEvents: import('../test/helpers/midiNormalize').NormalizedEvent[];
    };
    const source = entry.prelude ? `${entry.prelude}\n${sourceRaw}` : sourceRaw;

    const realLog = console.log;
    console.log = () => {};
    try {
      const result = await new MMA({ resources }).toMIDI(source, { noCredit: true });
      console.log = realLog;
      const actual = normalizeBasicMIDI(BasicMIDI.fromArrayBuffer(result.bytes));
      const diff = diffEvents(golden.midiEvents, actual);
      if (!diff) {
        console.log(`PASS ${entry.name}: ${actual.length} events`);
      } else {
        const expected = golden.midiEvents.length;
        console.log(`DIFF ${entry.name}: python ${expected} events, ts ${actual.length} events`);
        console.log(diff.split('\n').map((l) => '    ' + l).join('\n'));
      }
    } catch (e) {
      console.log = realLog;
      console.log(`ERROR ${entry.name}: ${(e as Error).message}`);
    }
  }
}

void main();

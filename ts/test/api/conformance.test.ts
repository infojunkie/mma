/**
 * Golden conformance gate: every corpus entry must produce the same
 * normalized MIDI event stream as the reference Python MMA.
 *
 * Fixtures live in test/fixtures/golden/<name>.json (regenerate with
 * `npx tsx scripts/gen-fixtures.ts --write`).  They were produced with
 * -xNOCREDIT, hence noCredit: true here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BasicMIDI } from 'spessasynth_core';
import { MMA } from '../../src/api/MMA';
import { decodeMMAText } from '../../src/io/decodeText';
import { CORPUS, type CorpusEntry } from '../fixtures/corpus';
import { diffEvents, normalizeBasicMIDI, type NormalizedEvent } from '../helpers/midiNormalize';
import { loadGolden, loadLibraryResources, loadM1Resources } from '../helpers/resources';

const mmaRepo = fileURLToPath(new URL('../../..', import.meta.url));

function resourcesFor(entry: CorpusEntry) {
  return entry.resources === 'm1' ? loadM1Resources() : loadLibraryResources();
}

function songText(entry: CorpusEntry): string {
  // path.resolve handles corpus paths that climb to the parent repo
  // ('../test/data/...'); new URL() cannot with the trailing-slash base.
  const text = decodeMMAText(readFileSync(resolve(mmaRepo, entry.file)));
  // The prelude is part of the corpus contract: fixtures were generated
  // from (prelude + song), and it pins randomness on both sides.
  return entry.prelude ? `${entry.prelude}\n${text}` : text;
}

describe('golden conformance (Python MMA event streams)', () => {
  for (const entry of CORPUS) {
    it(`${entry.name} is event-identical`, async () => {
      const golden = loadGolden(entry.name);
      const mma = new MMA({ resources: resourcesFor(entry), plugins: entry.plugins });
      // The source carries the corpus file name: MIDIINC resolves imported
      // .mid names against the directory of the current file, which is how
      // the Python run (cwd = the song's directory) finds them.
      const result = await mma.toMIDI(
        { name: entry.file, text: songText(entry) },
        { noCredit: true, maxBars: 500 },
      );

      const actual = normalizeBasicMIDI(BasicMIDI.fromArrayBuffer(result.bytes));
      const diff = diffEvents(golden.midiEvents as NormalizedEvent[], actual, {
        ignoreKinds: entry.ignoreKinds ?? [],
      });
      expect(diff, diff ?? '').toBeNull();
    });
  }
});

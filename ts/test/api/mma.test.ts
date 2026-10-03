/**
 * Integration tests for the MMA façade.
 *
 * The MIDI conformance tests compare normalized event streams against
 * fixtures generated from the reference Python MMA (see
 * scripts/gen-fixtures.ts).  Fixtures were generated with -xNOCREDIT, so
 * the TS runs pass noCredit: true.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BasicMIDI } from 'spessasynth_core';
import { MMA } from '../../src/api/MMA';
import { MMAError } from '../../src/engine/Errors';
import { MemoryResources } from '../../src/io/MMAResources';
import { diffEvents, normalizeBasicMIDI } from '../helpers/midiNormalize';
import { loadGolden, loadM1Resources } from '../helpers/resources';

const m1Text = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/m1/${name}`, import.meta.url)), 'utf-8');

async function renderAndCompare(name: string, source: string, resources: MemoryResources): Promise<void> {
  const golden = loadGolden(name);
  const mma = new MMA({ resources });
  const result = await mma.toMIDI(source, { noCredit: true });

  const parsed = BasicMIDI.fromArrayBuffer(result.bytes);
  const actual = normalizeBasicMIDI(parsed);
  const diff = diffEvents(golden.midiEvents, actual, { ignoreKinds: ['trackName'] });
  expect(diff, diff ?? '').toBeNull();
}

describe('MMA.parse', () => {
  it('returns a JSON-serializable song model', async () => {
    const mma = new MMA({ resources: loadM1Resources() });
    const result = await mma.parse(m1Text('basic.mma'));

    expect(result.model.barCount).toBe(4);
    expect(result.model.settings.seqSize).toBe(1);
    expect(result.model.settings.timeSignature).toBe('4/4');
    expect(result.model.settings.keySignature).toBe('C Major');
    expect(result.model.tempoChanges[0]).toEqual({ tick: 0, tempo: 120 });
    expect(result.model.bars).toHaveLength(4);
    expect(result.model.bars[0]).toMatchObject({ barNum: 1, startTick: 0, endTick: 767 });

    const names = result.model.tracks.map((t) => t.name).sort();
    expect(names).toEqual(['BASS', 'CHORD', 'DRUM']);
    expect(result.model.tracks.find((t) => t.name === 'CHORD')!.vtype).toBe('CHORD');

    // The model must survive JSON round-tripping (it is the public API).
    expect(JSON.parse(JSON.stringify(result.model))).toEqual(result.model);
  });

  it('collects warnings with file and line', async () => {
    const mma = new MMA({ resources: loadM1Resources() });
    const result = await mma.parse(
      ['Time 4', 'DefChord M (0,4,7,12) (0,2,4,5,7,9,11)', 'C'].join('\n'),
    );
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]!.message).toMatch(/Redefining chordtype 'M'/);
    expect(result.warnings[0]!.line).toBeGreaterThan(0);
  });

  it('throws MMAError with the source line for bad input', async () => {
    const mma = new MMA({ resources: loadM1Resources() });
    await expect(mma.parse(['Time 4', 'XyzNotACommand'].join('\n'))).rejects.toThrow(MMAError);
    try {
      await mma.parse(['Time 4', 'C', 'NoSuchChord'].join('\n'));
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as MMAError;
      expect(err.line).toBeGreaterThan(0);
      expect(err.file).toContain('source.mma');
    }
  });

  it('honours maxBars', async () => {
    const mma = new MMA({ resources: loadM1Resources() });
    const song = ['Time 4', 'C * 10'].join('\n');
    await expect(mma.parse(song, { maxBars: 4 })).rejects.toThrow(/Maxbar setting is 4/);
    const ok = await mma.parse(song, { maxBars: 10 });
    expect(ok.model.barCount).toBe(10);
  });

  it('honours -T muteTracks (only the listed tracks are generated)', async () => {
    const mma = new MMA({ resources: loadM1Resources() });
    const result = await mma.parse(m1Text('basic.mma'), { muteTracks: ['BASS'] });
    const channel = (name: string) => result.model.tracks.find((t) => t.name === name)!.channel;
    expect(channel('BASS')).toBeGreaterThan(0);
    expect(channel('CHORD')).toBe(0); // muted (not listed)
    expect(channel('DRUM')).toBe(10); // drums keep their fixed channel (Python does the same)
  });
});

describe('MMA.toMIDI', () => {
  it('matches Python for m1-basic (event stream)', async () => {
    await renderAndCompare('m1-basic', m1Text('basic.mma'), loadM1Resources());
  });

  it('matches Python for m1-groove (Use + Groove from library)', async () => {
    await renderAndCompare('m1-groove', m1Text('groove-test.mma'), loadM1Resources());
  });

  it('returns a re-parseable Standard MIDI File at PPQ 192', async () => {
    const mma = new MMA({ resources: loadM1Resources() });
    const result = await mma.toMIDI(m1Text('basic.mma'), { noCredit: true });
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    const parsed = BasicMIDI.fromArrayBuffer(result.bytes);
    expect(parsed.timeDivision).toBe(192);
  });

  it('format 0 merges all channels into one track', async () => {
    const mma = new MMA({ resources: loadM1Resources() });
    const result = await mma.toMIDI(m1Text('basic.mma'), { noCredit: true, format: 0 });
    const parsed = BasicMIDI.fromArrayBuffer(result.bytes);
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.format).toBe(0);
    // Note-ons from all three source channels must be present.  MMA
    // writes note-offs as 0x9n with velocity 0, so filter on velocity.
    const channels = new Set<number>();
    for (const ev of parsed.tracks[0]!.events) {
      if ((ev.statusByte & 0xf0) === 0x90 && (ev.data[1] ?? 0) > 0) {
        channels.add(ev.statusByte & 0x0f);
      }
    }
    expect([...channels].sort((a, b) => a - b)).toEqual([9, 14, 15]);
  });

  it('adds DURATION text and the run tempo like the Python CLI', async () => {
    const mma = new MMA({ resources: loadM1Resources() });
    const result = await mma.toMIDI(m1Text('basic.mma'), { noCredit: true });
    const durations = result.model.midiText.filter((t) => t.kind === 'text' && t.text.startsWith('DURATION'));
    expect(durations).toHaveLength(1);
    expect(durations[0]!.text).toBe('DURATION: 8'); // 4 bars at 120 bpm
  });

  it('reports barOrder when requested (-L)', async () => {
    const mma = new MMA({ resources: loadM1Resources() });
    // MMA bar labels are the leading numeric labels on chord lines.
    const song = ['Time 4', '1 C', '2 F'].join('\n');
    const result = await mma.toMIDI(song, { noCredit: true, barOrder: true });
    expect(result.barOrder).toEqual(['1', '2']);
  });

  it('supports deterministic output via seed', async () => {
    const song = ['Time 4', 'Begin Chord', 'RSkip 50', 'End', 'C * 4'].join('\n');
    const a = await new MMA({ resources: loadM1Resources() }).toMIDI(song, { noCredit: true, seed: 7 });
    const b = await new MMA({ resources: loadM1Resources() }).toMIDI(song, { noCredit: true, seed: 7 });
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });
});

describe('MMA instance independence', () => {
  it('runs two façades concurrently without state leaking', async () => {
    const mmaA = new MMA({ resources: loadM1Resources() });
    const mmaB = new MMA({ resources: loadM1Resources() });

    const [a1, b1] = await Promise.all([
      mmaA.toMIDI(m1Text('basic.mma'), { noCredit: true }),
      mmaB.toMIDI(m1Text('groove-test.mma'), { noCredit: true }),
    ]);
    const a2 = await mmaA.toMIDI(m1Text('basic.mma'), { noCredit: true });
    const b2 = await mmaB.toMIDI(m1Text('groove-test.mma'), { noCredit: true });

    expect(Buffer.from(a1.bytes).equals(Buffer.from(a2.bytes))).toBe(true);
    expect(Buffer.from(b1.bytes).equals(Buffer.from(b2.bytes))).toBe(true);
    expect(a1.model.settings.tempo).toBe(120);
    expect(b1.model.settings.tempo).toBe(100);
    expect(a1.model.settings.keySignature).toBe('C Major');
    expect(b1.model.settings.keySignature).toBe('F Major');
  });
});

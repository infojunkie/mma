/**
 * Golden tests for the MIDI directive cluster (midifuncs.py, midinote.py,
 * mdefine.py).  The fixture (test/fixtures/python/midi.json) is produced
 * by test/tools/gen_midi_fixtures.py: each small song is rendered by the
 * reference Python MMA and its packed meta/channel tracks are dumped as
 * tick -> hex-event lists.  Here the same songs run through the TS
 * parser and the in-memory MIDIDocument must match event for event.
 *
 * The second half renders full .mid files so the writer's MidiSplit
 * structure (one channel expanded into per-pitch tracks) is verified
 * against Python too.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BasicMIDI, MIDIMessageTypes } from 'spessasynth_core';
import { MMA } from '../../src/api/MMA';
import { MemoryResources } from '../../src/io/MMAResources';
import type { MIDIDocument } from '../../src/midi/MIDIDocument';

interface MidiFixture {
  source: string;
  tickOffset: number;
  /** channel -> tick -> hex events (non-empty channels only). */
  mtrks: Record<string, Record<string, string[]>>;
  tracks: Record<string, { vtype: string; channel: number }>;
}

interface MidiFileFixture {
  source: string;
  /** base64 of the .mid written by the reference Python MMA. */
  midi: string;
}

const fixtures: { songs: Record<string, MidiFixture>; midiFiles: Record<string, MidiFileFixture> } =
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/python/midi.json', import.meta.url)), 'utf-8'),
  );

/** Dump a MIDIDocument in the fixture's shape; events sorted per tick. */
function hexdumpMtrks(doc: MIDIDocument): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  for (const [ch, tr] of [...doc.tracks.entries()].sort((a, b) => a[0] - b[0])) {
    const events: Record<string, string[]> = {};
    for (const tick of tr.offsets()) {
      const evs = tr.miditrk.get(tick)!;
      if (evs.length) events[String(tick)] = evs.map((e) => Buffer.from(e).toString('hex')).sort();
    }
    if (Object.keys(events).length) out[String(ch)] = events;
  }
  return out;
}

function sortFixture(mtrks: MidiFixture['mtrks']): MidiFixture['mtrks'] {
  return Object.fromEntries(
    Object.entries(mtrks).map(([ch, evs]) => [
      ch,
      Object.fromEntries(Object.entries(evs).map(([tick, list]) => [tick, [...list].sort()])),
    ]),
  );
}

function parseMidi(bytes: ArrayBuffer | Uint8Array): BasicMIDI {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return BasicMIDI.fromArrayBuffer(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
}

/** Track layout with per-track events (order-insensitive within a track). */
function trackSummary(midi: BasicMIDI): Array<{ name: string; events: string[] }> {
  return midi.tracks
    .map((t) => ({
      name: t.name,
      events: t.events
        .filter(
          (e) =>
            e.statusByte !== MIDIMessageTypes.endOfTrack &&
            e.statusByte !== MIDIMessageTypes.midiPort,
        )
        .map((e) => `${e.ticks}:${e.statusByte}:${Array.from(e.data).join(',')}`)
        .sort(),
    }))
    .filter((t) => t.events.length > 0);
}

describe('MIDI directives (Python MMA as oracle)', () => {
  for (const [name, fx] of Object.entries(fixtures.songs)) {
    it(`${name} matches the Python mtrks dump`, async () => {
      const mma = new MMA({ resources: new MemoryResources() });
      // toMIDI (not parse) so the DURATION text the writer appends is in
      // the document, matching what the Python CLI dumped.
      await mma.toMIDI(fx.source, { noCredit: true });

      expect(hexdumpMtrks(mma.context.mtrks)).toEqual(sortFixture(fx.mtrks));
      expect(mma.context.tickOffset).toBe(fx.tickOffset);

      for (const [tname, expected] of Object.entries(fx.tracks)) {
        const tr = mma.context.tnames.get(tname);
        expect(tr, `track ${tname}`).toBeDefined();
        expect(tr!.vtype).toBe(expected.vtype);
        expect(tr!.channel).toBe(expected.channel);
      }
    });
  }

  for (const [name, fx] of Object.entries(fixtures.midiFiles)) {
    it(`${name} .mid track structure matches Python`, async () => {
      const mma = new MMA({ resources: new MemoryResources() });
      const result = await mma.toMIDI(fx.source, { noCredit: true });

      const expected = trackSummary(parseMidi(Buffer.from(fx.midi, 'base64')));
      const actual = trackSummary(parseMidi(result.bytes));
      expect(actual).toEqual(expected);
    });
  }
});

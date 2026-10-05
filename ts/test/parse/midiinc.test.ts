/**
 * Golden tests for the MidiInc (MIDI file import) port (MMA/midiIn.py and
 * MMA/readmidi.py).  The fixture (test/fixtures/python/midiinc.json) is
 * produced by test/tools/gen_midiinc_fixtures.py:
 *
 *   - MidiData dumps: real .mid files plus one synthetic file, read with
 *     several reader-option variants (ignorePC, octaveAdjust,
 *     velocityAdjust and adjustBeats) exactly like midiIn.midiinc() sets
 *     them.  Here the TS MidiData reader must produce the same per-channel
 *     event lists, text/lyric events and file properties.
 *   - songs: small MidiInc songs rendered by the reference Python MMA and
 *     dumped as tick -> hex events; the same sources must produce an
 *     identical in-memory MIDIDocument here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MMA } from '../../src/api/MMA';
import { MidiData } from '../../src/midi/MidiData';
import { MemoryResources, type MMAResources } from '../../src/io/MMAResources';
import { loadLibraryResources } from '../helpers/resources';
import type { MIDIDocument } from '../../src/midi/MIDIDocument';

const mmaRepo = fileURLToPath(new URL('../../..', import.meta.url));

interface VariantOptions {
  ignorePC: boolean;
  octave: number;
  velocity: number;
  adjust?: number;
}

/** readmidi stores notes as [tick, status, note, vel] and every other
 * channel event as [tick, status, [data...]]. */
type FixtureEvent = Array<number | number[]>;

interface MidiDataDump {
  MidiFormat: number;
  numTracks: number;
  beatDivision: number;
  firstNote: number;
  events: Record<string, FixtureEvent[]>;
  textEvents: Array<[number, string]>;
  lyricEvents: Array<[number, string]>;
}

interface MidiFileFixture {
  path: string;
  variants: Record<string, { options: VariantOptions; data: MidiDataDump }>;
}

interface SongFixture {
  source: string;
  tickOffset: number;
  mtrks: Record<string, Record<string, string[]>>;
  tracks: Record<string, { vtype: string; channel: number }>;
}

interface MidiIncFixtures {
  midiFiles: Record<string, MidiFileFixture>;
  synthetic: Record<string, MidiFileFixture & { base64: string }>;
  songs: Record<string, SongFixture>;
}

const fixtures: MidiIncFixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/python/midiinc.json', import.meta.url)), 'utf-8'),
) as MidiIncFixtures;

/** Dump a MidiData in the fixture's (readmidi) shape. */
function dumpMidiData(md: MidiData): MidiDataDump {
  const events: Record<string, FixtureEvent[]> = {};
  for (let ch = 0; ch < md.events.length; ch++) {
    const evs = md.events[ch]!;
    if (!evs.length) continue;
    events[String(ch)] = evs.map((e) =>
      e.status === 0x80 || e.status === 0x90
        ? [e.tick, e.status, e.data[0]!, e.data[1]!]
        : [e.tick, e.status, e.data],
    );
  }
  return {
    MidiFormat: md.MidiFormat,
    numTracks: md.numTracks,
    beatDivision: md.beatDivision,
    firstNote: md.firstNote,
    events,
    textEvents: md.textEvents,
    lyricEvents: md.lyricEvents,
  };
}

function readVariant(md: MidiData, options: VariantOptions, bytes: Uint8Array): MidiDataDump {
  md.ignorePC = options.ignorePC;
  md.octaveAdjust = options.octave;
  md.velocityAdjust = options.velocity;
  md.readFile(bytes);
  if (options.adjust) md.adjustBeats(options.adjust);
  return dumpMidiData(md);
}

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

function sortFixture(mtrks: SongFixture['mtrks']): SongFixture['mtrks'] {
  const out: SongFixture['mtrks'] = {};
  for (const [ch, evs] of Object.entries(mtrks)) {
    if (!Object.keys(evs).length) continue;
    out[ch] = Object.fromEntries(
      Object.entries(evs).map(([tick, list]) => [tick, [...list].sort()]),
    );
  }
  return out;
}

describe('MidiData reader (Python readmidi.py as oracle)', () => {
  for (const [name, fx] of Object.entries(fixtures.midiFiles)) {
    for (const [variant, v] of Object.entries(fx.variants)) {
      it(`${name} [${variant}] matches the Python MidiData dump`, () => {
        const bytes = readFileSync(resolve(mmaRepo, fx.path));
        expect(readVariant(new MidiData(), v.options, bytes)).toEqual(v.data);
      });
    }
  }

  for (const [name, fx] of Object.entries(fixtures.synthetic)) {
    for (const [variant, v] of Object.entries(fx.variants)) {
      it(`${name} [${variant}] (synthetic meta/PC file) matches Python`, () => {
        const bytes = Buffer.from(fx.base64, 'base64');
        expect(readVariant(new MidiData(), v.options, bytes)).toEqual(v.data);
      });
    }
  }

  it('rejects SMF format 2 like readmidi (clean error, not a TypeError)', () => {
    // MThd (format 2, 1 track, 96 ticks/beat) + an empty MTrk.
    const bytes = new Uint8Array([
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 2, 0, 1, 0, 96,
      0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 4, 0, 0xff, 0x2f, 0,
    ]);
    expect(() => new MidiData().readFile(bytes)).toThrow(/format 2 not recognized/);
  });
});

describe('MidiInc songs (Python MMA as oracle)', () => {
  for (const [name, fx] of Object.entries(fixtures.songs)) {
    it(`${name} matches the Python mtrks dump`, async () => {
      const resources = loadLibraryResources();
      for (const sfx of Object.values(fixtures.synthetic)) {
        resources.setBinary(sfx.path, Buffer.from(sfx.base64, 'base64'));
      }
      const mma = new MMA({ resources });
      const quiet = console.log;
      console.log = () => {};
      try {
        await mma.toMIDI(
          { name: `ts/test/fixtures/midiinc/${name}.mma`, text: fx.source },
          { noCredit: true, maxBars: 500 },
        );
      } finally {
        console.log = quiet;
      }

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

  it('validates its options like the Python original', async () => {
    const mma = new MMA({ resources: loadLibraryResources() });
    const run = (line: string) =>
      mma.toMIDI({ name: 'song.mma', text: `Time 4\n${line}\nC\n` }, { noCredit: true });

    await expect(run('MidiInc File=egs/midi-inc/rec1.mid Solo=1 Octave=5')).rejects.toThrow(
      /Octave/,
    );
    await expect(run('MidiInc File=egs/midi-inc/rec1.mid Solo=1 Transpose=25')).rejects.toThrow(
      /Transpose/,
    );
    await expect(run('MidiInc File=egs/midi-inc/rec1.mid Solo=1 Stretch=0')).rejects.toThrow(
      /Stretch/,
    );
    await expect(run('MidiInc File=egs/midi-inc/rec1.mid Solo=Riff')).rejects.toThrow(
      /channel for import/,
    );
    await expect(
      run('MidiInc File=egs/midi-inc/rec1.mid Solo=1 Start=5 End=2'),
    ).rejects.toThrow(/Range invalid/);
    await expect(run('MidiInc File=egs/midi-inc/rec1.mid Drum=1,Riff')).rejects.toThrow(
      /Riff only works/,
    );
    await expect(run('MidiInc nope')).rejects.toThrow(/Expecting cmd=opt pairs/);
    await expect(run('MidiInc File=does-not-exist.mid Solo=1')).rejects.toThrow(
      /Unable to open MIDI file/,
    );
  });

  it('reports a clear error when the loader has no binary support', async () => {
    const textOnly: MMAResources = {
      load: async (id: string): Promise<string> => {
        throw new Error(`Resource not found: '${id}'`);
      },
      list: async () => [],
      exists: async () => false,
    };
    const mma = new MMA({ resources: textOnly });
    await expect(
      mma.toMIDI(
        { name: 'song.mma', text: 'Time 4\nMidiInc File=missing.mid Solo=1\nC\n' },
        { noCredit: true },
      ),
    ).rejects.toThrow(/cannot load binary/);
  });
});

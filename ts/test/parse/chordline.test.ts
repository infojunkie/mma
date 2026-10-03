import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MMAContext } from '../../src/engine/Context';
import { MMAError } from '../../src/engine/Errors';
import { CTable } from '../../src/model/CTable';
import { parseChordLine, setChordTabs } from '../../src/parse/ChordLineParser';

interface ChordDump {
  tonic: string | null;
  chordType: string | null;
  rootNote: number | null;
  noteListLen: number;
  noteList: number[];
  bnoteList: number[];
  scaleList: number[];
}

interface CTableDump {
  name: string | null;
  chStart: number;
  chEnd: number;
  chordZ: boolean;
  arpeggioZ: boolean;
  walkZ: boolean;
  drumZ: boolean;
  bassZ: boolean;
  scaleZ: boolean;
  ariaZ: boolean;
  plectrumZ: boolean;
  chord: ChordDump;
}

interface Case {
  lines: string[][];
  bars: CTableDump[][];
  error: string | null;
}

const fixtures: { cases: Case[] } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/python/chordlines.json', import.meta.url)), 'utf-8'),
);

function dump(c: CTable): CTableDump {
  const ch = c.chord!;
  return {
    name: c.name,
    chStart: c.chStart,
    chEnd: c.chEnd,
    chordZ: c.chordZ,
    arpeggioZ: c.arpeggioZ,
    walkZ: c.walkZ,
    drumZ: c.drumZ,
    bassZ: c.bassZ,
    scaleZ: c.scaleZ,
    ariaZ: c.ariaZ,
    plectrumZ: c.plectrumZ,
    chord: {
      tonic: ch.tonic,
      chordType: ch.chordType,
      // The Python CTable has no rootNote for 'z' chords (attribute absent);
      // the TS ChordNotes initialises it to 0.
      rootNote: ch.tonic === null ? null : ch.rootNote,
      noteListLen: ch.noteListLen,
      noteList: ch.noteList,
      bnoteList: ch.bnoteList,
      scaleList: ch.scaleList,
    },
  };
}

function norm(s: string): string {
  return s.split(/\s+/).join(' ').trim();
}

describe('parseChordLine (Python fixture)', () => {
  for (const c of fixtures.cases) {
    const label = c.lines.map((l) => l.join(' ')).join(' | ');

    if (c.error !== null) {
      it(`${label} -> error`, () => {
        const ctx = new MMAContext({ seed: 1 });
        setChordTabs(ctx, [1, 2, 3, 4]);
        ctx.lastChord = null;
        let caught: MMAError | null = null;
        try {
          for (const line of c.lines) parseChordLine(ctx, [...line]);
        } catch (e) {
          caught = e as MMAError;
        }
        expect(caught).not.toBeNull();
        expect(norm(caught!.message)).toBe(norm(c.error!));
      });
    } else {
      it(`${label} -> ${c.bars.map((b) => b.map((x) => x.name).join(',')).join(' ; ')}`, () => {
        const ctx = new MMAContext({ seed: 1 });
        setChordTabs(ctx, [1, 2, 3, 4]);
        ctx.lastChord = null;
        const bars: CTableDump[][] = [];
        for (const line of c.lines) {
          bars.push(parseChordLine(ctx, [...line]).map(dump));
        }
        expect(bars).toEqual(c.bars);
      });
    }
  }
});

describe('parseChordLine extras', () => {
  it('keeps the last chord across bars', () => {
    const ctx = new MMAContext({ seed: 1 });
    setChordTabs(ctx, [1, 2, 3, 4]);
    parseChordLine(ctx, ['C']);
    const bars = parseChordLine(ctx, ['/', 'G']);
    expect(bars.map((b) => b.name)).toEqual(['C', 'G']);
    expect(ctx.lastChord).toBe('G');
  });

  it('mutes the listed tracks with the z shortcut list', () => {
    const ctx = new MMAContext({ seed: 1 });
    setChordTabs(ctx, [1, 2, 3, 4]);
    const [bar] = parseChordLine(ctx, ['CzBD']);
    expect(bar!.bassZ).toBe(true);
    expect(bar!.drumZ).toBe(true);
    expect(bar!.chordZ).toBe(false);
  });

  it('z! mutes every track and keeps the z name', () => {
    const ctx = new MMAContext({ seed: 1 });
    setChordTabs(ctx, [1, 2, 3, 4]);
    const [bar] = parseChordLine(ctx, ['z!']);
    expect(bar!.name).toBe('z!');
    expect([bar!.chordZ, bar!.bassZ, bar!.arpeggioZ, bar!.walkZ, bar!.drumZ, bar!.scaleZ, bar!.ariaZ, bar!.plectrumZ]).toEqual([
      true, true, true, true, true, true, true, true,
    ]);
  });
});

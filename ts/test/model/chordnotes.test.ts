/**
 * ChordNotes behaviour that other suites exercise only indirectly.
 *
 * The expected values below were produced by the reference Python
 * implementation (MMA/chords.py ChordNotes(<name>).noteList), so a
 * mismatch here is a real divergence.
 */
import { describe, expect, it } from 'vitest';
import { ChordNotes, createChordAdjust } from '../../src/model/ChordNotes';
import { createChordList } from '../../src/model/chordTable';
import { Reporter } from '../../src/engine/Errors';

function notes(name: string): number[] {
  const env = {
    chordList: createChordList(),
    cdAdjust: createChordAdjust(),
    keyName: () => ['C', false] as [string, boolean],
    keyNoteValue: () => 0,
    rep: new Reporter(),
  };
  return new ChordNotes(env, name).noteList;
}

describe('ChordNotes octave prefixes (+/-)', () => {
  // Regression: the leading +/- octave adjustment was parsed but never
  // applied to the note list (found via a mid2seq egs song where a `-D`
  // chord tracked an octave too high).
  const cases: Record<string, number[]> = {
    D: [2, 6, 9],
    '-D': [-10, -6, -3],
    '+D': [14, 18, 21],
    '--D': [-22, -18, -15],
    '-+D': [2, 6, 9],
    '+-D': [2, 6, 9],
    '++D': [26, 30, 33],
    '-G': [-17, -13, -10],
    '-Eb': [-9, -5, -2],
    '-C': [-12, -8, -5],
    '+C': [12, 16, 19],
    '-Cm7': [-12, -9, -5, -2],
    '+G7': [7, 11, 14, 17],
  };

  for (const [name, expected] of Object.entries(cases)) {
    it(`${name} -> ${expected.join(',')}`, () => {
      expect(notes(name)).toEqual(expected);
    });
  }
});

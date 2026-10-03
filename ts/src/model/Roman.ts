/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/roman.py - Roman numeral chords to standard notation.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { Reporter } from '../engine/Errors';

const majTable: Record<string, string[]> = {
  C: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  'C#': ['C#', 'D#', 'E#', 'F#', 'G#', 'A#', 'C'],
  D: ['D', 'E', 'F#', 'G', 'A', 'B', 'C#'],
  Db: ['Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb', 'C'],
  'D#': ['D#', 'F', 'G', 'G#', 'A#', 'C', 'D'],
  Eb: ['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D'],
  E: ['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#'],
  F: ['F', 'G', 'A', 'Bb', 'C', 'D', 'E'],
  'F#': ['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'F'],
  Gb: ['Gb', 'Ab', 'Bb', 'B', 'Db', 'Eb', 'F'],
  G: ['G', 'A', 'B', 'C', 'D', 'E', 'F#'],
  'G#': ['G#', 'A#', 'C', 'C#', 'D#', 'F', 'G'],
  Ab: ['Ab', 'Bb', 'C', 'Db', 'Eb', 'F', 'G'],
  A: ['A', 'B', 'C#', 'D', 'E', 'F#', 'G#'],
  'A#': ['A#', 'C', 'D', 'D#', 'F', 'G', 'A'],
  Bb: ['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A'],
  B: ['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A#'],
};

const minTable: Record<string, string[]> = {
  C: ['C', 'D', 'Eb', 'F', 'G', 'Ab', 'Bb'],
  'C#': ['C#', 'D#', 'E', 'F#', 'G#', 'A', 'B'],
  Db: ['Db', 'Eb', 'E', 'Gb', 'Ab', 'A', 'B'],
  D: ['D', 'E', 'F', 'G', 'A', 'Bb', 'C'],
  'D#': ['D#', 'F', 'F#', 'G#', 'A#', 'B', 'C#'],
  Eb: ['Eb', 'F', 'Gb', 'Ab', 'Bb', 'B', 'Db'],
  E: ['E', 'F#', 'G', 'A', 'B', 'C', 'D'],
  F: ['F', 'G', 'Ab', 'Bb', 'C', 'Db', 'Eb'],
  'F#': ['F#', 'G#', 'A', 'B', 'C#', 'D', 'E'],
  Gb: ['Gb', 'Ab', 'A', 'B', 'Db', 'D', 'E'],
  G: ['G', 'A', 'A#', 'C', 'D', 'D#', 'F'],
  'G#': ['G#', 'A#', 'B', 'C#', 'D#', 'E', 'F#'],
  Ab: ['Ab', 'Bb', 'B', 'Db', 'Eb', 'E', 'Gb'],
  A: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  'A#': ['A#', 'C', 'C#', 'D#', 'F', 'F#', 'G#'],
  Bb: ['Bb', 'C', 'Db', 'Eb', 'F', 'Gb', 'Ab'],
  B: ['B', 'C#', 'D', 'E', 'F#', 'G', 'A'],
};

const uroman: Record<string, number> = { I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6 };
const lroman: Record<string, number> = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };
const arabic: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6 };

const doubleflat: Record<string, string> = {
  Cbb: 'Bb', Dbb: 'C', Ebb: 'D', Fbb: 'Eb', Gbb: 'F', Abb: 'G', Bbb: 'A',
};

const doublesharp: Record<string, string> = {
  'C##': 'D', 'D##': 'E', 'E##': 'F#', 'F##': 'G', '#': 'A', 'A##': 'B', 'B##': 'C#',
};

const convertable: Record<string, string> = {
  ['m°']: 'dim3', m0: 'dim3', mo: 'dim3', mO: 'dim3',
  ['m°7']: 'dim7', m07: 'dim7', mo7: 'dim7', mO7: 'dim7',
  ['mø7']: 'm7b5', 'm-07': 'm7b5', 'm-o7': 'm7b5', 'm-O7': 'm7b5',
};

/** Convert a roman or arabic numeral to a value 0..6. */
export function rvalue(rep: Reporter, s: string): number {
  if (s in uroman) return uroman[s]!;
  if (s in lroman) return lroman[s]!;
  if (s in arabic) return arabic[s]!;
  if (/^\d/.test(s)) rep.error(`Unknown Arabic value '${s}'. Use 1 to 7.`);
  rep.error(`Unknown Roman numeral '${s}'. Use 'I' to 'VII' in all u/l case.`);
}

/** Convert a roman numeral (e.g. "IVm7") to a standard chord name. */
export function convert(rep: Reporter, sym: string, keysig: string, minor: boolean): string {
  let chars = [...sym];
  let rm = '';
  while (chars.length && ['I', 'V', 'i', 'v'].includes(chars[0]!)) {
    rm += chars.shift()!;
  }
  let rest = chars.join('');

  const isminor = rm[0] === rm[0]!.toLowerCase();
  const offset = rvalue(rep, rm);

  let pitch = (minor ? minTable[keysig] : majTable[keysig])![offset]!;

  if (rest.startsWith('b') || rest.startsWith('#')) {
    pitch += rest[0]!;
    rest = rest.slice(1);
    if (pitch.endsWith('#b') || pitch.endsWith('b#')) pitch = pitch.slice(0, -2);
    else if (pitch.endsWith('##')) pitch = doublesharp[pitch] ?? pitch;
    else if (pitch.endsWith('bb')) pitch = doubleflat[pitch] ?? pitch;
  }

  if (isminor && !rest.startsWith('m')) rest = 'm' + rest;
  if (rest in convertable) rest = convertable[rest]!;

  return pitch + rest;
}

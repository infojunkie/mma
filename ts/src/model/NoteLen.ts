/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/notelen.py - note duration strings to MIDI ticks.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { Reporter } from '../engine/Errors';
import { stoi } from '../util/Common';

export const BperQ = 192; // gbl.BperQ - statically 192 in MMA

/** Mutable per-run table; swing.py sets '81'/'82'. */
export type NoteLenTable = Record<string, number | null>;

export function createNoteLenTable(): NoteLenTable {
  return {
    '0': 1, // special: 0 == 1 midi tick
    '1': BperQ * 4, // whole note
    '2': BperQ * 2, // 1/2
    '23': Math.floor((BperQ * 4) / 3), // 1/2 triplet
    '4': BperQ, // 1/4
    '43': Math.floor((BperQ * 2) / 3), // 1/4 triplet
    '8': Math.floor(BperQ / 2), // 1/8
    '81': null, // short 1/8, set by swing skew
    '82': null, // long 1/8, set by swing skew
    '16': Math.floor(BperQ / 4), // 1/16
    '32': Math.floor(BperQ / 8), // 1/32
    '64': Math.floor(BperQ / 16), // 1/64
    '6': Math.floor(BperQ / 6), // 1/16 note triplet
    '3': Math.floor(BperQ / 3), // 1/8 note triplet
    '5': Math.floor(BperQ / 5), // 1/8 note quintuplet
  };
}

/**
 * Convert a note string to a MIDI tick length.
 * Notes: 1=whole, 4=quarter; dotted (4.) and double dotted (4..);
 * combined (1+4, 4+8, 1-4, 1-0); tuplets (4:3); explicit ticks (120T).
 */
export function getNoteLen(rep: Reporter, table: NoteLenTable, n: string): number {
  let s = n;
  if (s.endsWith('T') || s.endsWith('t')) {
    s = s.slice(0, -1);
    if (!s) rep.error('Specifying a note length in MIDI Ticks requires a value');
    let ticks = stoi(rep, s);
    if (ticks === 0) ticks = 1;
    if (ticks < 1) rep.error('MIDI note length cannot be negative.');
    return ticks;
  }

  s = s.replace(/-/g, '+-').replace(/\+\+-/g, '+-');

  let length = 0;
  for (let a of s.split('+')) {
    let dot = 0;
    if (a.endsWith('..')) {
      dot = 2;
      a = a.slice(0, -2);
    } else if (a.endsWith('.')) {
      dot = 1;
      a = a.slice(0, -1);
    }

    let mult = 1;
    if (a.startsWith('-')) {
      mult = -1;
      a = a.slice(1);
    }

    let i: number | null | undefined;
    if (a.includes(':')) i = getTupleValue(rep, table, a);
    else i = table[a];

    if (i === null || i === undefined || Number.isNaN(i)) {
      rep.error(`Unknown note duration ${n}`);
    }
    i *= mult;

    if (dot === 2) i += i / 2 + i / 4;
    else if (dot === 1) i += i / 2;
    length += i;
  }
  return Math.trunc(length);
}

/** Tuplet value from a note 'xx:yy' (e.g. 4:3). */
export function getTupleValue(rep: Reporter, table: NoteLenTable, a: string): number {
  const [ddRaw, nn] = a.split(':') as [string, string];
  if (!['1', '2', '4', '8', '16', '32', '64'].includes(nn)) {
    rep.error(`Illegal duration value for tuplet. Must be a note (1,2,4...), not ${nn}.`);
  }
  const noteLen = table[nn];
  if (noteLen === null || noteLen === undefined) rep.error(`Unknown note duration ${a}`);
  const dd = stoi(rep, ddRaw);
  if (dd < 1 || dd > 128) rep.error(`The count value for the tuplet '${a}' is out of range.`);
  return Math.floor(noteLen / dd);
}

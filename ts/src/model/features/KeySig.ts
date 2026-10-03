/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the KeySig class in MMA/keysig.py.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../../engine/Context';
import { stoi } from '../../util/Common';

export const MAJ_KEYS: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
};

export const MIN_KEYS: Record<string, number> = {
  A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7,
  D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6, Ab: -7,
};

export const NOTE_VALUES: Record<string, number> = {
  'B#': 0, C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4,
  Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8,
  A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
};

export class KeySig {
  kSig = 0;
  kName: [string, number] = ['C', 0]; // [name, minor]
  accList: Record<string, number> = {};
  keyNoteValue = NOTE_VALUES['C']!;

  constructor(private ctx: MMAContext) {
    this.setAccList();
  }

  create(ln: string[]): void {
    const ctx = this.ctx;
    let mi = 0;

    if (ln.length < 1 || ln.length > 2) ctx.rep.error('KeySig: Needs 1 or 2 arguments.');

    if (ln.length === 2) {
      const l = ln[1]!.slice(0, 3).toUpperCase();
      if (l === 'MIN') mi = 1;
      else if (l === 'MAJ') mi = 0;
      else ctx.rep.error(`KeySig: 2nd arg must be 'Major' or 'Minor', not '${ln[1]}'`);
    }

    this.kName[1] = mi;

    let kname = ln[0]![0]!.toUpperCase();
    if (ln[0]!.length > 1) kname += ln[0]!.slice(1);

    let midikey: number;
    if ('ABCDEFG'.includes(kname[0]!)) {
      if (kname.length === 2 && kname[1] === '&') kname = kname[0] + 'b';
      if (mi && kname in MIN_KEYS) {
        this.kSig = midikey = MIN_KEYS[kname]!;
      } else if (!mi && kname in MAJ_KEYS) {
        this.kSig = midikey = MAJ_KEYS[kname]!;
      } else {
        const t = mi ? 'minor' : 'major';
        return ctx.rep.error(`KeySigs: keysignature '${kname} ${t}' is unknown/impossible.`);
      }
      this.kName[0] = kname;
    } else if ('01234567'.includes(kname[0]!)) {
      const c = parseInt(kname[0]!, 10);
      if (kname === '0') kname = '0#';
      if (kname.length < 2) ctx.rep.error('KeySig: numerical keysig needs sharp/flat indicator.');
      const f = kname[1]!.toUpperCase();
      if (!['B', '&', '#'].includes(f)) {
        ctx.rep.error(`KeySig: 2nd char in KeySig must be 'b' or '#', not '${f}'`);
      }
      this.kSig = midikey = c;
      if (f === 'B' || f === '&') {
        this.kSig = -this.kSig;
        midikey = -midikey;
      }
      const z = mi ? MIN_KEYS : MAJ_KEYS;
      for (const a of Object.keys(z)) {
        if (z[a] === this.kSig) {
          this.kName[0] = a;
          break;
        }
      }
    } else {
      return ctx.rep.error(`KeySig: unknown keysignature '${ln[0]}'.`);
    }

    if (midikey < 0) midikey = 256 + midikey;
    ctx.mtrks.meta().addKeySig(ctx.tickOffset, midikey, mi);

    this.setAccList();
    this.keyNoteValue = NOTE_VALUES[this.kName[0]]!;

    for (const t of ctx.tnames.values()) {
      if (t.vtype === 'ARIA') (t as { restart?: () => void }).restart?.();
    }
    ctx.rep.dPrint(`KeySig: ${this.getKeysig()}`);
  }

  getKeysig(): string {
    return `${this.kName[0]} ${this.kName[1] ? 'Minor' : 'Major'}`;
  }

  setAccList(): void {
    const acc: Record<string, number> = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0 };
    const ks = this.kSig;
    if (ks < 0) {
      for (let a = 0; a < Math.abs(ks); a++) acc[['b', 'e', 'a', 'd', 'g', 'c', 'f'][a]!] = -1;
    } else {
      for (let a = 0; a < ks; a++) acc[['f', 'c', 'g', 'd', 'a', 'e', 'b'][a]!] = 1;
    }
    this.accList = acc;
  }
}

/** Port of getTranspose (interval/semitone transposition). */
export function getTranspose(ctx: MMAContext, input: string[], err: string): number {
  let ln = [...input];
  if (ln.length === 1 && (ln[0]!.match(/-/g) ?? []).length === 2) ln = ln[0]!.split('-');

  if (ln.length === 1) {
    const value = stoi(ctx.rep, ln[0]!, `${err}: Argument must be an integer, not '${ln[0]}'`);
    if (value < -12 || value > 12) ctx.rep.error(`${err}: ${value} out-of-range; must be -12..12`);
    return value;
  }

  if (ln.length === 3) {
    const names = ['UNISON', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'OCTAVE'];
    const num2text: Record<string, string> = { '1': 'UNISON', '2': 'SECOND', '3': 'THIRD', '4': 'FOURTH', '5': 'FIFTH', '6': 'SIXTH', '7': 'SEVENTH', '8': 'OCTAVE' };
    const intervals: Record<string, number> = {
      'PERFECT UNISON': 0, 'AUGMENTED UNISON': 1,
      'MINOR SECOND': 1, 'MAJOR SECOND': 2,
      'MINOR THIRD': 3, 'MAJOR THIRD': 4, 'PERFECT FOURTH': 5,
      'AUGMENTED FOURTH': 6, 'DIMINISHED FIFTH': 6, 'PERFECT FIFTH': 7,
      'AUGMENTED FIFTH': 8, 'MINOR SIXTH': 8, 'MAJOR SIXTH': 9,
      'MINOR SEVENTH': 10, 'MAJOR SEVENTH': 11, 'PERFECT OCTAVE': 12,
    };
    const getAbrev = (i: string, tb: string[]): string => {
      const up = i.toUpperCase();
      let mcount = 0;
      let match = '';
      for (const f of tb) {
        if (f.startsWith(up)) {
          mcount += 1;
          match = f;
        }
      }
      if (mcount > 1) ctx.rep.error(`${err}: '${i}' is not a unique abreviation.`);
      if (mcount < 1) ctx.rep.error(`${err}: '${i}' is unregonized for interval notation.`);
      return match;
    };

    const dir = ln[0]!.toUpperCase();
    let base: number;
    if (['UP', 'U', 'DOWN', 'D'].includes(dir)) {
      // direction words; interval name and degree follow
      const inter = getAbrev(ln[1]!, ['PERFECT', 'MAJOR', 'MINOR', 'AUGMENTED', 'DIMINISHED']);
      let degreeText = ln[2]!;
      if (/^[1-8]$/.test(degreeText)) degreeText = num2text[degreeText]!;
      else degreeText = getAbrev(degreeText, names);
      const key = `${inter} ${degreeText}`;
      base = intervals[key] ?? ctx.rep.error(`${err}: '${ln.join(' ')}' is not a valid interval.`);
      const sign = dir.startsWith('U') ? 1 : -1;
      return sign * base;
    }
    ctx.rep.error(`${err}: Expecting semitone value or 'Up/Down interval degree'.`);
  }

  return ctx.rep.error(`${err}: Expecting 1 or 3 arguments, not ${ln.length}.`);
}

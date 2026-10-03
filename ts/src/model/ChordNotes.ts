/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the ChordNotes class in MMA/chords.py.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { Reporter } from '../engine/Errors';
import { stoi } from '../util/Common';
import { convert as romanConvert } from './Roman';
import type { ChordDef } from './chordTable';

export interface ChordEnv {
  chordList: Map<string, ChordDef>;
  /** Mutable tonic adjustment table (ChordAdjust command). */
  cdAdjust: Record<string, number>;
  /** Key signature state: [keysig name, minor]. */
  keyName(): [string, boolean];
  /** Key signature note value (keysig.keyNoteValue). */
  keyNoteValue(): number;
  rep: Reporter;
  /** Suppresses repeated slash-chord warnings. */
  slashPrinted?: Set<string>;
}

/** Table of chord adjustment factors; C is the midpoint. */
export function createChordAdjust(): Record<string, number> {
  return {
    Gb: -6, G: -5, 'G#': -4, Ab: -4, A: -3, 'A#': -2, Bb: -2,
    B: -1, Cb: -1, 'B#': 0, C: 0, 'C#': 1, Db: 1, D: 2,
    'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6,
  };
}

/** C..B note names indexed by pitch class. */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export class ChordNotes {
  name = '';
  tonic: string | null = null;
  chordType: string | null = null;
  noteList: number[] = [];
  bnoteList: number[] = [];
  scaleList: number[] = [];
  rootNote = 0;
  barre = 0;
  noteListLen = 0;

  constructor(
    private env: ChordEnv,
    name: string,
  ) {
    const rep: Reporter = env.rep;
    if (name === 'z') {
      this.tonic = null;
      this.chordType = null;
      this.noteListLen = 0;
      this.noteList = [];
      this.bnoteList = [];
      return;
    }

    const startingName = name;
    let slash: string | null = null;
    let polychord: string | null = null;
    let inversion = 0;
    let barre = 0;
    let octave = 0;
    let wmessage = '';

    if (name.includes('|')) {
      if (name.split('|').length > 2) rep.error("Polychord marker '|' can only be used once.");
      const parts = name.split('|') as [string, string];
      name = parts[0];
      polychord = parts[1];
    }

    if (name.includes('/') && name.includes('>')) {
      rep.error('You cannot use both an inversion and a slash in the same chord');
    }

    if (name.includes(':')) {
      const i = name.indexOf(':');
      const barreStr = name.slice(i + 1);
      name = name.slice(0, i);
      barre = stoi(rep, barreStr, "Expecting integer after ':'");
      if (barre < -127 || barre > 127) {
        rep.error('Chord barres limited to -127 to 127 (more than about +/-20 is silly)');
      }
    }

    if (name.includes('>')) {
      const i = name.indexOf('>');
      const invStr = name.slice(i + 1);
      name = name.slice(0, i);
      inversion = stoi(rep, invStr, "Expecting integer after '>'");
      if (inversion < -5 || inversion > 5) {
        rep.error('Chord inversions limited to -5 to 5 (more seems silly)');
      }
    }

    while (name[0] === '-' || name[0] === '+') {
      if (name[0] === '-') octave -= 12;
      else octave += 12;
      if (Math.abs(octave) > 96) rep.error(`Too many octave adjustments in '${startingName}'.`);
      name = name.slice(1);
    }

    name = name.replace(/&/g, 'b');
    this.name = name;

    if (!name) rep.error(`Empty chord name generated from '${startingName}'.`);

    if (name.indexOf('/') > 0) {
      const i = name.indexOf('/');
      slash = name.slice(i + 1);
      name = name.slice(0, i);
    }

    if (['I', 'V', 'i', 'v'].includes(name[0]!)) {
      const [keysig, minor] = env.keyName();
      name = romanConvert(rep, name, keysig, minor);
    }

    let tonic: string;
    let ctype: string;
    if (name[1] === '#' || name[1] === 'b') {
      tonic = name.slice(0, 2);
      ctype = name.slice(2);
    } else {
      tonic = name.slice(0, 1);
      ctype = name.slice(1);
    }
    if (!ctype) ctype = 'M';

    const def = env.chordList.get(ctype);
    const adj = env.cdAdjust[tonic];
    if (!def || adj === undefined) rep.error(`Illegal/Unknown chord name: '${name}'`);

    this.noteList = def.notes.map((x) => x + adj);
    this.bnoteList = [...this.noteList];
    this.scaleList = def.scale.map((x) => x + adj);
    this.chordType = ctype;
    this.tonic = tonic;
    this.rootNote = this.noteList[0]!;
    this.barre = barre;
    this.noteListLen = this.noteList.length;

    if (inversion) {
      this.invert(inversion);
      this.bnoteList = [...this.noteList];
    }

    if (slash) {
      let slashNote = slash;
      if (['I', 'i', 'V', 'v'].includes(slashNote[0]!) || /^\d/.test(slashNote[0]!)) {
        const n = romanSlashValue(rep, slashNote);
        const idx = this.scaleList[n]! % 12;
        slashNote = NOTE_NAMES[idx]!;
      }
      const r = env.cdAdjust[slashNote];
      if (r === undefined) rep.error(`The note '${slashNote}' in the slash chord is unknown`);

      let cRoted = false;
      let s = [...this.noteList];
      for (const oct of [0, 12, 24]) {
        if (s.includes(r + oct)) {
          const rot = s.indexOf(r + oct);
          for (let i = 0; i < rot; i++) s.push(s.shift()! + 12);
          if (s[0]! >= 12) s = s.map((v) => v - 12);
          this.noteList = s;
          this.bnoteList = [...s];
          this.rootNote = this.noteList[0]!;
          cRoted = true;
          break;
        }
      }

      let sRoted = false;
      let sc = [...this.scaleList];
      for (const oct of [0, 12, 24]) {
        if (sc.includes(r + oct)) {
          const rot = sc.indexOf(r + oct);
          for (let i = 0; i < rot; i++) sc.push(sc.shift()! + 12);
          if (sc[0]! >= 12) sc = sc.map((v) => v - 12);
          this.scaleList = sc;
          sRoted = true;
          break;
        }
      }

      if (!cRoted && !sRoted) {
        wmessage = `The slash chord note '${slashNote}' not in chord or scale '${name}'`;
        const t = `${name}/${slashNote}`;
        const printed = env.slashPrinted ?? (env.slashPrinted = new Set());
        if (!printed.has(t)) {
          const note = r % 12;
          const ll: string[] = [];
          for (const [c, cdef] of env.chordList) {
            if (c.charCodeAt(0) > 128) continue;
            const cadj = env.cdAdjust[this.tonic!]!;
            if (cdef.notes.some((x) => (x % 12) + cadj === note)) ll.push(`${this.tonic}${c}`);
          }
          if (ll.length) wmessage += `\nChords with '${slashNote}': ${ll.sort().join(' ')}`;
          printed.add(t);
        }
        rep.warning(wmessage);
      }
    }

    if (polychord) {
      const ctable = new ChordNotes(env, polychord);
      this.noteList = [...new Set([...this.noteList, ...ctable.noteList])].sort((a, b) => a - b);
      if (this.noteList.length > 8) {
        const i = this.noteList.length;
        this.noteList = this.noteList.slice(0, 8);
        rep.warning(`Polychord ${name}|${polychord} has been truncated from ${i} to 8 notes.`);
      }
      this.noteListLen = this.noteList.length;
      this.bnoteList = [...this.noteList];
    }
  }

  /** Restore notes to the original, undoing mangling. */
  reset(): void {
    this.noteList = [...this.bnoteList];
    this.noteListLen = this.noteList.length;
  }

  /** Invert a chord by rotating the lowest/highest notes by octaves. */
  invert(n: number): void {
    if (!n) return;
    const c = [...this.noteList];
    while (n > 0) {
      n -= 1;
      c[c.indexOf(Math.min(...c))] += 12;
    }
    while (n < 0) {
      n += 1;
      c[c.indexOf(Math.max(...c))] -= 12;
    }
    this.noteList = c;
  }

  /** Compress a chord to one octave. */
  compress(): void {
    const mx = Math.min(...this.bnoteList) + 12;
    this.noteList = this.noteList.map((n) => (n > mx ? n - 12 : n));
  }

  /** Limit the number of notes in a chord (Drop/Force options). */
  limit(v: number, mode: number, force: boolean): void {
    if (mode && (v < this.noteListLen || force)) {
      const target = this.scaleList[mode - 1];
      if (target !== undefined) {
        const i = this.noteList.indexOf(target);
        if (i >= 0) this.noteList.splice(i, 1);
        this.noteListLen = this.noteList.length;
      }
    }
    if (v < this.noteListLen) {
      this.noteList = this.noteList.slice(0, v);
      this.noteListLen = this.noteList.length;
    }
  }

  /** Rotate chord notes until the tonic is close to the key signature value. */
  keycenter(): void {
    const key = this.env.keyNoteValue();
    const notes = this.noteList;
    let nbelow = 0;
    let nabove = 0;
    for (const n of notes) {
      if (n < key) nbelow += 1;
      else if (n > key) nabove += 1;
    }
    if (nbelow > nabove) {
      for (let a = 0; a < nbelow - nabove - 1; a++) notes[a] += 12;
    } else if (nbelow < nabove) {
      for (let a = 1; a < nabove - nbelow; a++) notes[notes.length - a] -= 12;
    }
  }

  /** Like keycenter(), but leaves 9ths/11ths untouched. */
  key2center(): void {
    const orig = [...this.noteList];
    const saved: number[] = [];
    this.noteList = [];
    const root = orig[0]!;
    for (const n of orig) {
      if (n >= root + 12) saved.push(n);
      else this.noteList.push(n);
    }
    this.keycenter();
    this.noteList.push(...saved);
  }

  /** Move notes close to, but above, the key root note. */
  rootkey(): void {
    const key = this.env.keyNoteValue();
    const out: number[] = [];
    for (let n of this.noteList) {
      while (n < 0) n += 12;
      while (n > 12) n -= 12;
      out.push(n - 12 >= key ? n - 12 : n);
    }
    this.noteList = out;
  }

  /** Move chord notes to minimise the distance from the previous chord. */
  center1(lastChord: number[] | null): void {
    if (!lastChord || lastChord.length === 0) return;

    const minDistToLast = (x: number, last: number[]): number => {
      let dist = 99;
      for (const j of last) {
        if (Math.abs(x - j) < Math.abs(dist)) dist = x - j;
      }
      return dist;
    };
    const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

    const ch = this.noteList;
    for (let i = 0; i < ch.length; i++) {
      let oldDist = minDistToLast(ch[i]!, lastChord);
      while (Math.abs(minDistToLast(ch[i]! - sign(oldDist) * 12, lastChord)) < Math.abs(oldDist)) {
        ch[i] -= 12 * sign(oldDist);
        oldDist = minDistToLast(ch[i]!, lastChord);
      }
    }
  }

  center2(centerNote: number, noteRange: number): void {
    const ch = this.noteList;
    for (let i = 0; i < ch.length; i++) {
      const dist = ch[i]! - centerNote;
      if (dist < -noteRange) ch[i] = ch[i]! + 12 * (Math.floor(Math.abs(dist) / 12) + 1);
      if (dist > noteRange) ch[i] = ch[i]! - 12 * (Math.floor(Math.abs(dist) / 12) + 1);
    }
  }

  drop2(): void {
    if (this.noteList.length >= 2) this.noteList[this.noteList.length - 2]! -= 12;
  }

  drop2key(): void {
    this.drop2();
    this.keycenter();
  }

  drop3(): void {
    if (this.noteList.length >= 3) this.noteList[this.noteList.length - 3]! -= 12;
  }

  drop3key(): void {
    this.drop3();
    this.keycenter();
  }

  drop23(): void {
    this.drop2();
    this.drop3();
  }

  drop23key(): void {
    this.drop23();
    this.keycenter();
  }
}

function romanSlashValue(rep: Reporter, s: string): number {
  // MMA/roman.rvalue for the slash position (single numeral).
  const u: Record<string, number> = { I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6 };
  const l: Record<string, number> = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };
  const a: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6 };
  if (s in u) return u[s]!;
  if (s in l) return l[s]!;
  if (s in a) return a[s]!;
  return rep.error(`Unknown Roman numeral '${s}'. Use 'I' to 'VII' in all u/l case.`);
}

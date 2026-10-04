/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/harmony.py: chord-derived harmony notes added by a pattern
 * track to each note it plays.  The track call sites live in
 * tracks/BassTrack.ts (and WALK/ARPEGGIO/SCALE); the HARMONY /
 * HARMONYONLY / HARMONYVOLUME setters are BaseTrack methods.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 *
 * Original Python module by Bob van der Poel <bob@mellowood.ca>.
 */

import type { MMAContext } from '../../engine/Context';
import { stoi } from '../../util/Common';

/** Half-step values for symbolic interval names (harmony.py halfSteps). */
export const halfSteps: Record<string, number> = {
  UNI: 0,
  MIN2: 1,
  MAJ2: 2,
  DIM3: 2,
  MIN3: 3,
  AUG2: 3,
  MAJ3: 4,
  DIM4: 4,
  PER4: 5,
  AUG3: 5,
  AUG4: 6,
  DIM5: 6,
  PER5: 7,
  DIM6: 7,
  MIN6: 8,
  AUG5: 8,
  MAJ6: 9,
  DIM7: 9,
  MIN7: 10,
  AUG6: 10,
  MAJ7: 11,
  DIM8: 11,
  OCT: 12,
  AUG7: 12,
};

/** Long interval-name prefixes, replaced by their 3-letter form. */
export const sNames = ['MINOR', 'MAJOR', 'DIMINISHED', 'PERFECT', 'AUGMENTED', 'OCTAVE', 'UNISON'];

/** Long ordinal names, replaced by their digit. */
export const dNames: Array<[string, string]> = [
  ['SECOND', '2'],
  ['THIRD', '3'],
  ['FOURTH', '4'],
  ['FIFTH', '5'],
  ['SIXTH', '6'],
  ['SEVENTH', '7'],
];

/**
 * Determine a harmony note for a note based on the chord (harmony.py
 * gethnote).  The chord is transposed by octaves so that its highest note
 * is at or below the note; the result is the chord note just below it
 * (the root itself when the note is the chord root).
 */
export function gethnote(note: number, chord: number[]): number {
  let ch = [...chord];

  // If 1st note in chord is > basenote then we know all notes in chord are
  // above the basenote.  Lower the chord.
  while (ch[ch.length - 1]! > note) ch = ch.map((x) => x - 12);
  // Ensure the highest note in the chord is in octave range.
  while (ch[ch.length - 1]! + 12 < note) ch = ch.map((x) => x + 12);

  // Get a note from the chord which is less than the current note.  If the
  // note is the chord's root we actually return the root note; we do have
  // to return something.
  let h = ch[0]!;
  for (const i of ch) {
    if (i >= note) break;
    h = i;
  }
  return h;
}

/**
 * Return the number of half steps for an interval harmony (harmony.py
 * intervalHarmony).  Syntax is `[octave]:interval`, octave -4..+4 and
 * optional; the interval is a half-step count or a symbolic name.
 */
export function intervalHarmony(ctx: MMAContext, harmName: string): number {
  const sep = harmName.indexOf(':');
  const octaveStr = harmName.slice(0, sep);
  let name = harmName.slice(sep + 1);

  let octave: number;
  if (octaveStr) {
    octave = stoi(ctx.rep, octaveStr, 'Harmony: octave expecting integer');
    if (octave < -4 || octave > 4) {
      ctx.rep.error(`Harmony: Octave ${octave} is too large. Use -4 to 4`);
    }
  } else {
    octave = 0;
  }

  let halfs: number;
  if (/^\d+$/.test(name)) {
    halfs = stoi(ctx.rep, name, 'Harmony: Unexpected error in number of half steps.');
  } else {
    // Convert full names to our abbreviations; this permits a wide range
    // of input names and a fairly short lookup table.
    for (const a of sNames) name = name.split(a).join(a.slice(0, 3));
    for (const [a, b] of dNames) name = name.split(a).join(b);

    const hs = halfSteps[name];
    if (hs === undefined) ctx.rep.error(`Interval harmony ${harmName} is unknown.`);
    halfs = hs;
  }

  return octave * 12 + halfs;
}

/**
 * Get the harmony note(s) for the given chord (harmony.py harmonize).
 *
 * `hmode` may concatenate several harmony types with '+'; an alternative
 * list separated by ',' picks one entry with the shared RNG.  The note
 * list is de-duplicated with Python's `list(set(hnotes))` semantics,
 * including its deterministic iteration order for small ints, because the
 * notes are added to the track in that order.
 */
export function harmonize(ctx: MMAContext, hmode: string, note: number, chord: number[]): number[] {
  // Python returns None for an empty chord (the caller then raises a
  // TypeError while building the harmony list); no chord data can reach
  // this point through CTable, so return an empty list instead.
  if (!chord.length) return [];

  const hnotes: number[] = [];
  const ch = [...chord].sort((a, b) => a - b);

  for (let tp of hmode.split('+')) {
    // If harmonies are concatenated with commas we need to randomly
    // select one of them.
    if (tp.includes(',')) tp = ctx.rng.choice(tp.split(','));

    if (tp === '2' || tp === '2BELOW') {
      hnotes.push(gethnote(note, ch));
    } else if (tp === '28Below') {
      // Python compares the mixed-case literal, but HARMONY settings are
      // upper-cased; '28BELOW' therefore falls through to the error below
      // (reproduced bug, see harmony.py).
      hnotes.push(gethnote(note, ch) - 12);
    } else if (tp === '2ABOVE') {
      hnotes.push(gethnote(note, ch) + 12);
    } else if (tp === '28ABOVE') {
      hnotes.push(gethnote(note, ch) + 24);
    } else if (tp === '3' || tp === '3BELOW' || tp === '38BELOW') {
      let a = gethnote(note, ch);
      let b = gethnote(a, ch);
      if (tp === '38BELOW') {
        a -= 12;
        b -= 12;
      }
      hnotes.push(a, b);
    } else if (tp === '3ABOVE' || tp === '38ABOVE') {
      let a = gethnote(note, ch);
      let b = gethnote(a, ch);
      if (tp === '38ABOVE') {
        a += 24;
        b += 24;
      }
      hnotes.push(a + 12, b + 12);
    } else if (tp === 'OPEN' || tp === 'OPENBELOW' || tp === 'OPEN8BELOW') {
      // Python has a dead `if tp == 'OPEN8ABOVE': a -= 12` in this block
      // (the branch cannot contain that value), so OPEN8BELOW behaves
      // exactly like OPEN.
      const a = gethnote(note, ch);
      hnotes.push(gethnote(a, ch));
    } else if (tp === 'OPENABOVE') {
      const a = gethnote(note, ch);
      hnotes.push(gethnote(a, ch) + 12);
    } else if (tp === 'OPEN8ABOVE') {
      const a = gethnote(note, ch);
      hnotes.push(gethnote(a, ch) + 24);
    } else if (tp === '8' || tp === '8BELOW') {
      hnotes.push(note - 12);
    } else if (tp === '8ABOVE') {
      hnotes.push(note + 12);
    } else if (tp === '16' || tp === '16BELOW') {
      hnotes.push(note - 2 * 12);
    } else if (tp === '16ABOVE') {
      hnotes.push(note + 2 * 12);
    } else if (tp === '24' || tp === '24BELOW') {
      hnotes.push(note - 3 * 12);
    } else if (tp === '24ABOVE') {
      hnotes.push(note + 3 * 12);
    } else if (tp === 'TOP') {
      hnotes.push(ch[ch.length - 1]!);
    } else if (tp === 'TOPABOVE' || tp === 'TOP8ABOVE' || tp === 'TOP16ABOVE') {
      let h = ch[ch.length - 1]!;
      while (h <= note) h += 12;
      if (tp === 'TOP8ABOVE') h += 12;
      else if (tp === 'TOP16ABOVE') h += 24;
      hnotes.push(h);
    } else if (tp === 'TOPBELOW' || tp === 'TOP8BELOW' || tp === 'TOP16BELOW') {
      let h = ch[ch.length - 1]!;
      while (h >= note) h -= 12;
      if (tp === 'TOP8BELOW') h -= 12;
      else if (tp === 'TOP16BELOW') h -= 24;
      hnotes.push(h);
    } else if (tp === 'ROOT') {
      hnotes.push(note + ch[0]!);
    } else if (tp === 'ROOTABOVE' || tp === 'ROOT8ABOVE' || tp === 'ROOT16ABOVE') {
      let h = ch[0]!;
      while (h <= note) h += 12;
      if (tp === 'ROOT8ABOVE') h += 12;
      else if (tp === 'ROOT16ABOVE') h += 24;
      hnotes.push(h);
    } else if (tp === 'ROOTBELOW' || tp === 'ROOT8BELOW' || tp === 'ROOT16BELOW') {
      let h = ch[0]!;
      while (h >= note) h -= 12;
      if (tp === 'ROOT8BELOW') h -= 12;
      else if (tp === 'ROOT16BELOW') h -= 24;
      hnotes.push(h);
    } else if (tp.includes(':')) {
      hnotes.push(note + intervalHarmony(ctx, tp));
    } else if (tp === 'NONE') {
      continue;
    } else {
      ctx.rep.error(`Unknown harmony type '${tp}'`);
    }
  }

  // Strip out duplicate notes from the harmony list, reproducing Python's
  // `list(set(hnotes))` (see pySetOrder).
  return pySetOrder(hnotes);
}

/**
 * Return the integer keys of a CPython set in iteration order, i.e. the
 * exact result of Python's `list(set(hnotes))`.
 *
 * This is a faithful emulation of the integer-keyed path of
 * Objects/setobject.c in CPython 3.10 (the version used as the oracle):
 * table of PySet_MINSIZE=8 entries, LINEAR_PROBES=9 linear probes per
 * perturb step, PERTURB_SHIFT=5, hash(n) == n except hash(-1) == -2, and
 * the `fill*5 < mask*3` growth rule (resize to used*4, rounded up to a
 * power of two, rehashing slot by slot with set_insert_clean()).
 */
function pySetOrder(values: number[]): number[] {
  const MINSIZE = 8;
  const LINEAR_PROBES = 9;
  const PERTURB_SHIFT = 5n;
  const U64 = 0xffffffffffffffffn;

  let size = MINSIZE;
  let mask = MINSIZE - 1;
  let table: Array<number | null> = new Array<number | null>(size).fill(null);
  let fill = 0;
  let used = 0;

  const uhash = (v: number): bigint => (v === -1 ? -2n : BigInt(v)) & U64;

  function insertClean(t: Array<number | null>, m: number, key: number): void {
    const hash = uhash(key);
    const maskB = BigInt(m);
    let i = Number(hash & maskB);
    let perturb = hash;
    for (;;) {
      let entry = i;
      // set_insert_clean(): probe the entry, then up to LINEAR_PROBES
      // following entries.
      let probes = i + LINEAR_PROBES <= m ? LINEAR_PROBES : 0;
      do {
        if (t[entry] === null) {
          t[entry] = key;
          return;
        }
        entry++;
      } while (probes-- !== 0);
      perturb >>= PERTURB_SHIFT;
      i = Number((BigInt(i) * 5n + 1n + perturb) & maskB);
    }
  }

  function resize(): void {
    // set_table_resize(): newsize is the smallest power of two > minused.
    const minused = used > 50000 ? used * 2 : used * 4;
    let newsize = MINSIZE;
    while (newsize <= minused) newsize <<= 1;
    if (newsize === MINSIZE) return; // no dummy entries in this emulation
    const old = table;
    const oldsize = size;
    table = new Array<number | null>(newsize).fill(null);
    size = newsize;
    mask = newsize - 1;
    for (let s = 0; s < oldsize; s++) {
      const k = old[s];
      if (k !== null) insertClean(table, mask, k);
    }
  }

  function addOne(key: number): void {
    const hash = uhash(key);
    const maskB = BigInt(mask);
    let i = Number(hash & maskB);
    let perturb = hash;
    for (;;) {
      let entry = i;
      // set_add_entry(): `probes = (i + LINEAR_PROBES <= mask) ? LINEAR_PROBES : 0`
      // and a do/while, so up to 10 slots are scanned per perturb step.
      let probes = i + LINEAR_PROBES <= mask ? LINEAR_PROBES : 0;
      do {
        if (table[entry] === null) {
          table[entry] = key;
          fill++;
          used++;
          // found_unused: grow when fill*5 >= mask*3.
          if (fill * 5 >= mask * 3) resize();
          return;
        }
        if (table[entry] === key) return; // duplicate: found_active
        entry++;
      } while (probes-- !== 0);
      perturb >>= PERTURB_SHIFT;
      i = Number((BigInt(i) * 5n + 1n + perturb) & maskB);
    }
  }

  for (const key of values) addOne(key);
  return table.filter((k): k is number => k !== null);
}

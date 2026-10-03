/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/chordtable.py: the built-in chord table, one entry per
 * MMA chord type.  Each entry holds the notes and the seven-note scale
 * as semitone offsets from the chord root, plus an English description.
 * Base chords are followed by the common synonym aliases (real copies,
 * as in Python, so redefining one never affects another).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

/** One built-in chord definition. */
export interface ChordDef {
  /** Semitone offsets from the root, e.g. M -> [0, 4, 7]. */
  notes: number[];
  /** Seven scale degrees (semitone offsets) used by bass/scale patterns. */
  scale: number[];
  /** English documentation string ('' when the Python table has none). */
  description: string;
}

/** [notes, scale, description] as stored in the Python table. */
type ChordTuple = readonly [readonly number[], readonly number[], string];

/** Base chords from chordtable.py, in source order. */
const BASE_CHORDS: Readonly<Record<string, ChordTuple>> = {
  "M": [[0, 4, 7], [0, 2, 4, 5, 7, 9, 11], "Major triad. This is the default and is used in  the absence of any other chord type specification."],
  "(b5)": [[0, 4, 6], [0, 2, 4, 5, 6, 9, 11], "Major triad with flat 5th. MMA notatation requires the () around the name."],
  "add9": [[0, 4, 7, 14], [0, 2, 4, 5, 7, 9, 14], "Major chord plus 9th (no 7th.)"],
  "addb9": [[0, 4, 7, 13], [0, 2, 4, 5, 7, 9, 13], "Major chord plus flat 9th (no 7th.)"],
  "add#9": [[0, 4, 7, 15], [0, 2, 4, 5, 7, 9, 15], "Major chord plus sharp 9th (no 7th.)"],
  "m": [[0, 3, 7], [0, 2, 3, 5, 7, 8, 10], "Minor triad."],
  "mb5": [[0, 3, 6], [0, 2, 3, 5, 6, 8, 10], "Minor triad with flat 5th (aka dim)."],
  "m#5": [[0, 3, 8], [0, 2, 3, 5, 8, 8, 10], "Minor triad with augmented 5th."],
  "m6": [[0, 3, 7, 9], [0, 2, 3, 5, 7, 9, 10], "Minor 6th (flat 3rd plus a 6th)."],
  "m6(add9)": [[0, 3, 7, 14, 21], [0, 2, 3, 5, 7, 9, 10], "Minor 6th with added 9th. This is sometimes notated as a slash chord in the form ``m6/9''."],
  "m7": [[0, 3, 7, 10], [0, 2, 3, 5, 7, 8, 10], "Minor 7th (flat 3rd plus dominant 7th)."],
  "m7#5": [[0, 4, 8, 10], [0, 2, 4, 5, 8, 9, 10], "Minor 7th with sharp 5th."],
  "mM7": [[0, 3, 7, 11], [0, 2, 3, 5, 7, 8, 11], "Minor Triad plus Major 7th. You will also see this printed as ``m(maj7)'', ``m+7'', ``min(maj7)'' and ``min$\\sharp$7'' (which \\mma\\ accepts); as well as the \\mma\\ \\emph{invalid} forms: ``-($\\Delta$7)'', and ``min$\\natural$7''."],
  "m+7b9": [[0, 3, 8, 10, 13], [0, 1, 3, 5, 8, 8, 10], "Augmented minor 7 plus flat 9th."],
  "m+7#9": [[0, 3, 8, 10, 15], [0, 3, 3, 5, 8, 8, 10], "Augmented minor 7 plus sharp 9th."],
  "mM7(add9)": [[0, 3, 7, 11, 14], [0, 2, 3, 5, 7, 8, 11], "Minor Triad plus Major 7th and 9th."],
  "m7b5": [[0, 3, 6, 10], [0, 2, 3, 5, 6, 8, 10], "Minor 7th, flat 5 (aka 1/2 diminished). "],
  "m7b9": [[0, 3, 7, 10, 13], [0, 1, 3, 5, 7, 8, 10], "Minor 7th with added flat 9th."],
  "m7#9": [[0, 3, 7, 10, 15], [0, 3, 3, 5, 7, 8, 10], "Minor 7th with added sharp 9th."],
  "mb9": [[0, 3, 7, 13], [0, 2, 3, 5, 7, 9, 13], "Minor chord plus flat 9th (no 7th.)"],
  "7": [[0, 4, 7, 10], [0, 2, 4, 5, 7, 9, 10], "7th."],
  "7(6)": [[0, 4, 7, 9, 10], [0, 2, 4, 5, 7, 9, 10], "7th with added 6th."],
  "7b5": [[0, 4, 6, 10], [0, 2, 4, 5, 6, 9, 10], "7th, flat 5."],
  "dim7": [[0, 3, 6, 9], [0, 2, 3, 5, 6, 8, 9], "Diminished seventh."],
  "dim7(addM7)": [[0, 3, 6, 9, 11], [0, 2, 3, 5, 6, 9, 11], "Diminished triad with added Major 7th."],
  "dim(b13)": [[0, 3, 6, 9, 8], [0, 2, 3, 5, 6, 8, 9], "Diminished seventh, added flat 13th."],
  "aug": [[0, 4, 8], [0, 2, 4, 5, 8, 9, 11], "Augmented triad."],
  "6": [[0, 4, 7, 9], [0, 2, 4, 5, 7, 9, 11], "Major triad with added 6th."],
  "6(add9)": [[0, 4, 7, 14, 21], [0, 2, 4, 5, 7, 9, 11], "6th with added 9th. This is sometimes notated as a slash chord in the form ``6/9''. MMA voices the 6th an octave higher."],
  "M7": [[0, 4, 7, 11], [0, 2, 4, 5, 7, 9, 11], "Major 7th."],
  "M7#5": [[0, 4, 8, 11], [0, 2, 4, 5, 8, 9, 11], "Major 7th with sharp 5th."],
  "M7b5": [[0, 4, 6, 11], [0, 2, 4, 5, 6, 9, 11], "Major 7th with a flat 5th."],
  "M7(add6)": [[0, 4, 7, 9, 11], [0, 2, 4, 5, 6, 9, 11], "Major 7th with a 6th."],
  "9": [[0, 4, 7, 10, 14], [0, 2, 4, 5, 7, 9, 10], "7th plus 9th."],
  "9b5": [[0, 4, 6, 10, 14], [0, 2, 4, 5, 6, 9, 10], "7th plus 9th with flat 5th."],
  "m9": [[0, 3, 7, 10, 14], [0, 2, 3, 5, 7, 8, 10], "Minor triad plus 7th and 9th."],
  "m7b5b9": [[0, 3, 6, 10, 13], [0, 1, 3, 5, 6, 8, 10], "Minor 7th with flat 5th and flat 9th."],
  "m9b5": [[0, 3, 6, 10, 14], [0, 2, 3, 5, 6, 8, 10], "Minor triad, flat 5, plus 7th and 9th."],
  "m(sus9)": [[0, 3, 7, 14], [0, 2, 3, 5, 7, 8, 14], "Minor triad plus 9th (no 7th)."],
  "M9": [[0, 4, 7, 11, 14], [0, 2, 4, 5, 7, 9, 11], "Major 7th plus 9th."],
  "M9#11": [[0, 4, 7, 11, 14, 18], [0, 2, 4, 6, 7, 9, 11], "Major 9th plus sharp 11th."],
  "7b9": [[0, 4, 7, 10, 13], [0, 1, 4, 5, 7, 9, 10], "7th with flat 9th."],
  "7b9b13": [[0, 4, 7, 10, 13, 20], [0, 1, 4, 5, 7, 9, 10], "7th with flat 9th and flat 13th."],
  "7#9": [[0, 4, 7, 10, 15], [0, 3, 4, 5, 7, 9, 10], "7th with sharp 9th."],
  "7#9b13": [[0, 4, 7, 10, 15, 20], [0, 3, 4, 5, 7, 8, 10], "7th with sharp 9th and flat 13th."],
  "7b5(add13)": [[0, 4, 6, 10, 21], [0, 2, 4, 5, 6, 9, 10], "7th with flat 5 and 13th."],
  "7(add13)": [[0, 4, 7, 10, 21], [0, 2, 4, 5, 7, 9, 10], "7th with added 13th."],
  "7b5b9": [[0, 4, 6, 10, 13], [0, 1, 4, 5, 6, 9, 10], "7th with flat 5th and flat 9th."],
  "7b5#9": [[0, 4, 6, 10, 15], [0, 3, 4, 5, 6, 9, 10], "7th with flat 5th and sharp 9th."],
  "7#5#9": [[0, 4, 8, 10, 15], [0, 3, 4, 5, 8, 9, 10], "7th with sharp 5th and sharp 9th."],
  "aug7": [[0, 4, 8, 10], [0, 2, 4, 5, 8, 9, 10], "An augmented chord (raised 5th) with a dominant 7th."],
  "aug7b9": [[0, 4, 8, 10, 13], [0, 1, 4, 5, 8, 9, 10], "An augmented chord (raised 5th) with a dominant 7th and flat 9th."],
  "aug7#9": [[0, 4, 8, 10, 15], [0, 3, 4, 5, 8, 9, 10], "An augmented chord (raised 5th) with a dominant 7th and sharp 9th."],
  "aug9M7": [[0, 4, 8, 11, 14], [0, 2, 4, 5, 8, 9, 11], "An augmented chord (raised 5th) with a major 7th and 9th."],
  "+7b9#11": [[0, 4, 8, 10, 13, 18], [0, 1, 4, 6, 7, 9, 10], "Augmented 7th with flat 9th and sharp 11th."],
  "m+7b9#11": [[0, 3, 8, 10, 13, 18], [0, 1, 3, 6, 8, 9, 10], "Augmented minor 7th with flat 9th and sharp 11th."],
  "11": [[0, 0, 7, 10, 14, 17], [0, 2, 4, 5, 7, 9, 10], "9th chord plus 11th (3rd not voiced)."],
  "11+": [[0, 0, 8, 10, 14, 17], [0, 2, 4, 5, 8, 9, 10], "Augmented 11th (sharp 5)."],
  "m11": [[0, 3, 7, 10, 14, 17], [0, 2, 3, 5, 7, 8, 10], "9th with minor 3rd,  plus 11th."],
  "M11": [[0, 4, 7, 11, 14, 17], [0, 2, 4, 5, 7, 8, 11], "Major 9th plus 11th."],
  "m7(add11)": [[0, 3, 7, 10, 17], [0, 2, 3, 5, 7, 8, 10], "Minor 7th  plus 11th."],
  "m9#11": [[0, 3, 7, 10, 14, 18], [0, 2, 3, 6, 7, 9, 10], "Minor 7th plus 9th and sharp 11th."],
  "m7b9#11": [[0, 3, 7, 10, 13, 18], [0, 1, 3, 6, 7, 9, 10], "Minor 7th plus flat 9th and sharp 11th."],
  "m7(add13)": [[0, 3, 7, 10, 21], [0, 2, 3, 5, 7, 9, 10], "Minor 7th  plus 13th."],
  "11b9": [[0, 4, 7, 10, 13, 17], [0, 1, 4, 5, 7, 9, 10], "7th chord plus flat 9th and 11th."],
  "9#5": [[0, 4, 8, 10, 14], [0, 2, 4, 5, 8, 9, 10], "7th plus 9th with sharp 5th (same as aug9)."],
  "9b6": [[0, 4, 8, 14], [0, 2, 4, 5, 8, 11, 14], "9th with flat 6 (no 5th or 7th)."],
  "9#11": [[0, 4, 7, 10, 14, 18], [0, 2, 4, 6, 7, 9, 10], "7th plus 9th and sharp 11th."],
  "7#9#11": [[0, 4, 7, 10, 15, 18], [0, 3, 4, 6, 7, 9, 10], "7th plus sharp 9th and sharp 11th."],
  "7b9#11": [[0, 4, 7, 10, 13, 18], [0, 1, 4, 6, 7, 9, 10], "7th plus flat 9th and sharp 11th."],
  "7#11": [[0, 4, 7, 10, 18], [0, 2, 4, 6, 7, 9, 10], "7th plus sharp 11th (9th omitted)."],
  "M7#11": [[0, 4, 7, 11, 18], [0, 2, 4, 6, 7, 9, 11], "Major 7th plus sharp 11th (9th omitted)."],
  "m11b5": [[0, 3, 6, 10, 14, 17], [0, 2, 3, 5, 6, 9, 10], "Minor 7th with flat 5th plus 11th."],
  "sus4": [[0, 5, 7], [0, 2, 5, 5, 7, 9, 11], "Suspended 4th, major triad with the 3rd raised half tone."],
  "msus4": [[0, 3, 5, 7], [0, 2, 3, 5, 7, 8, 10], "Minor suspended 4th, minor triad plus 4th."],
  "m7sus4": [[0, 3, 5, 7, 10], [0, 2, 3, 5, 7, 8, 10], "Minor suspended 4th, minor triad plus 4th and dominant 7th."],
  "sus(addb9)": [[0, 5, 7, 13], [0, 2, 5, 5, 7, 9, 11], "Suspended 4th, major triad with the 3rd raised half tone plus flat 9th."],
  "sus(add9)": [[0, 5, 7, 14], [0, 2, 5, 5, 7, 9, 11], "Suspended 4th, major triad with the 3rd raised half tone plus 9th."],
  "sus(add#9)": [[0, 5, 7, 15], [0, 2, 5, 5, 7, 9, 11], "Suspended 4th, major triad with the 3rd raised half tone plus sharp 9th."],
  "7sus": [[0, 5, 7, 10], [0, 2, 5, 5, 7, 9, 10], "7th with suspended 4th, dominant 7th with 3rd raised half tone."],
  "7susb9": [[0, 5, 7, 10, 13], [0, 1, 5, 5, 7, 9, 10], "7th with suspended 4th and flat 9th."],
  "sus2": [[0, 2, 7], [0, 2, 2, 5, 7, 9, 11], "Suspended 2nd, major triad with the major 2nd above the root substituted for 3rd."],
  "7sus2": [[0, 2, 7, 10], [0, 2, 2, 5, 7, 9, 10], "A sus2 with dominant 7th added."],
  "sus9": [[0, 5, 7, 10, 14], [0, 2, 5, 5, 7, 9, 10], "7sus plus 9th."],
  "13sus": [[0, 5, 7, 10, 14, 21], [0, 2, 5, 5, 7, 9, 10], "7sus, plus 9th and 13th"],
  "13susb9": [[0, 5, 7, 10, 13, 21], [0, 1, 5, 5, 7, 9, 10], "7sus, plus flat 9th and 13th"],
  "13": [[0, 4, 7, 10, 21], [0, 2, 4, 5, 7, 9, 10], "7th (including 5th) plus 13th (the 9th and 11th are not voiced)."],
  "7b13": [[0, 4, 7, 10, 20], [0, 2, 4, 5, 7, 9, 10], "7th (including 5th) plus flat 13th (the 9th and 11th are not voiced)."],
  "13b5": [[0, 4, 6, 10, 20], [0, 2, 4, 5, 6, 9, 10], "7th with flat 5th,  plus 13th (the 9th and 11th are not voiced)."],
  "13#9": [[0, 4, 7, 10, 15, 21], [0, 3, 4, 5, 7, 9, 10], "7th (including 5th) plus 13th and sharp 9th (11th not voiced)."],
  "13b9": [[0, 4, 7, 10, 13, 21], [0, 1, 4, 5, 7, 9, 10], "7th (including 5th) plus 13th and flat 9th (11th not voiced)."],
  "M#11": [[0, 4, 7, 11, 18], [0, 2, 4, 6, 7, 9, 11], "Major triad plus sharp 11th."],
  "M13": [[0, 4, 7, 11, 21], [0, 2, 4, 5, 7, 9, 11], "Major 7th (including 5th) plus 13th (9th and  11th not voiced)."],
  "m13": [[0, 3, 7, 10, 21], [0, 2, 3, 5, 7, 9, 10], "Minor 7th (including 5th) plus 13th (9th and 11th not voiced)."],
  "13#11": [[0, 4, 7, 10, 18, 21], [0, 2, 4, 6, 7, 9, 10], "7th plus sharp 11th and 13th (9th not voiced)."],
  "M13#11": [[0, 4, 7, 11, 18, 21], [0, 2, 4, 6, 7, 9, 11], "Major 7th plus sharp 11th and 13th (9th not voiced)."],
  "5": [[0, 0, 7, 7], [0, 2, 4, 5, 7, 9, 11], "Altered Fifth or Power Chord; root and 5th only."],
  "omit3add9": [[0, 0, 7, 14], [0, 2, 4, 5, 7, 9, 10], "Triad: root, 5th and 9th."],
  "7omit3": [[0, 0, 7, 10], [0, 2, 4, 5, 7, 9, 10], "7th with unvoiced 3rd."],
  "m7omit5": [[0, 3, 10], [0, 2, 3, 5, 7, 9, 10], "Minor 7th with unvoiced 5th."],
};

/**
 * Common synonyms added to the table.  Each alias copies the notes and
 * scale of its target chord; a non-empty doc string overrides the
 * target's description.
 */
const ALIASES: ReadonlyArray<readonly [string, string, string]> = [
  ["11#5", "11+", ""],
  ["aug9", "9#5", ""],
  ["9+", "9#5", "Recommended notation is \"+9\" or \"9\\#5\""],
  ["+9", "9#5", ""],
  ["+9M7", "aug9M7", ""],
  ["+M7", "M7#5", ""],
  ["m(add9)", "m(sus9)", ""],
  ["(add9)", "add9", ""],
  ["(addb9)", "addb9", ""],
  ["(add#9)", "add#9", ""],
  ["69", "6(add9)", ""],
  ["m69", "m6(add9)", ""],
  ["m(b5)", "mb5", ""],
  ["m7(b9)", "m7b9", ""],
  ["m7(#9)", "m7#9", ""],
  ["9+5", "9#5", ""],
  ["m+5", "m#5", ""],
  ["m+", "m#5", ""],
  ["M6", "6", ""],
  ["m7-5", "m7b5", ""],
  ["m7(omit5)", "m7omit5", ""],
  ["+", "aug", ""],
  ["+7", "aug7", ""],
  ["+7#9", "aug7#9", ""],
  ["+7b9", "aug7b9", ""],
  ["7(omit3)", "7omit3", ""],
  ["(#5)", "aug", ""],
  ["7#5b9", "aug7b9", ""],
  ["7b9#5", "aug7b9", ""],
  ["7-9", "7b9", ""],
  ["7+9", "7#9", "Confusing, not recommended."],
  ["maj7", "M7", ""],
  ["M7-5", "M7b5", ""],
  ["M7+5", "M7#5", "Recommended notation is +M7."],
  ["M7(add13)", "13b9", ""],
  ["7alt", "7b5b9", "Uses a 7th flat 5, flat 9. Probably not correct, but works (mostly)."],
  ["7sus4", "7sus", ""],
  ["13sus4", "13sus", ""],
  ["7+", "aug7", "An augmented (sharp 5) 7th. Recommended notation is \"+7\""],
  ["7#5", "aug7", "Recommended notation is \"+7\""],
  ["7+5", "aug7", "Recommented notation is \"+7\""],
  ["7-5", "7b5", ""],
  ["sus", "sus4", ""],
  ["maj9", "M9", ""],
  ["maj13", "M13", ""],
  ["m(maj7)", "mM7", ""],
  ["m+7", "mM7", ""],
  ["min(maj7)", "mM7", ""],
  ["min#7", "mM7", ""],
  ["m#7", "mM7", ""],
  ["msus", "msus4", ""],
  ["m7sus", "m7sus4", ""],
  ["dim", "dim7", "A dim7, not a triad!"],
  ["°", "dim7", "A dim7 using a degree symbol"],
  ["°3", "mb5", "A dim3 (triad) using a degree symbol"],
  ["°(addM7)", "dim7(addM7)", "dim7(addM7) using degree symbol"],
  ["ø", "m7b5", "Half-diminished using slashed degree symbol"],
  ["9sus", "sus9", ""],
  ["9-5", "9b5", ""],
  ["dim3", "mb5", "Diminished triad (non-standard notation)."],
  ["omit3(add9)", "omit3add9", ""],
  ["9sus4", "sus9", ""],
  ["7b9sus", "7susb9", ""],
];

/** Build the final table: base chords first, then the aliases (copies). */
function buildChordTable(): Record<string, ChordDef> {
  const table: Record<string, ChordDef> = {};

  const add = (name: string, tuple: ChordTuple, description: string): void => {
    table[name] = {
      notes: [...tuple[0]],
      scale: [...tuple[1]],
      description: description || tuple[2],
    };
  };

  for (const [name, tuple] of Object.entries(BASE_CHORDS)) {
    add(name, tuple, '');
  }
  for (const [alias, target, doc] of ALIASES) {
    const tuple = BASE_CHORDS[target];
    if (tuple === undefined) {
      throw new Error(`Unknown chord alias target '${target}'`);
    }
    add(alias, tuple, doc);
  }
  return table;
}

/** Recursively freeze the table, its entries and their note/scale arrays. */
function deepFreeze(table: Record<string, ChordDef>): Record<string, ChordDef> {
  for (const def of Object.values(table)) {
    Object.freeze(def.notes);
    Object.freeze(def.scale);
    Object.freeze(def);
  }
  return Object.freeze(table);
}

/** Immutable built-in chord table, one entry per MMA chord type. */
export const CHORD_TABLE: Record<string, ChordDef> = deepFreeze(buildChordTable());

/**
 * Fresh mutable copy (MMA's `DefChord` adds/overrides entries at
 * runtime).  Every entry is copied deeply enough that mutating the
 * returned notes/scale arrays or descriptions never affects
 * CHORD_TABLE.
 */
export function createChordList(): Map<string, ChordDef> {
  const list = new Map<string, ChordDef>();
  for (const [name, def] of Object.entries(CHORD_TABLE)) {
    list.set(name, {
      notes: [...def.notes],
      scale: [...def.scale],
      description: def.description,
    });
  }
  return list;
}

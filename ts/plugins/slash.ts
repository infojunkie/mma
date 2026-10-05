/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Slash plugin: defines an extended slash chord whose bass note is not
 * in the chord's scale.  Port of the Python plugin used by the
 * musicxml-midi converter (`src/plugins/slash/plugin.py`).
 *
 * `@Slash Dm/F` defines the chord type `m<-9`; the converter then writes
 * the slash chord as the chord name `Dm<-9` (the `<interval` suffix is
 * the bass note's interval relative to the chord root).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { IMMAPlugin } from '../src/plugin/IMMAPlugin';

/** Semitone value of a note name (the Python plugin's noteValues table). */
const noteValues: Record<string, number> = {
  Gb: -6,
  G: -5,
  'G#': -4, Ab: -4,
  A: -3,
  'A#': -2, Bb: -2,
  B: -1, Cb: -1,
  'B#': 0, C: 0,
  'C#': 1, Db: 1,
  D: 2,
  'D#': 3, Eb: 3,
  E: 4, Fb: 4,
  'E#': 5, F: 5,
  'F#': 6,
};

/** Python's `%` (result takes the divisor's sign; here the divisor is -12). */
function pyMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

export const slashPlugin: IMMAPlugin = {
  name: 'Slash',
  description: 'Define an extended slash chord.',
  author: 'Karim Ratib <karim.ratib@gmail.com> (https://github.com/infojunkie)',
  synopsis: '@Slash Chord/Bass',
  help: () =>
    '@Slash Chord/Bass\n' +
    '  Defines an extended slash chord whose bass note is not in the chord scale.',

  run(args, pctx) {
    const ctx = pctx.context;
    if (!args.length) ctx.error('@Slash: expecting a chord name.');

    const name = args[0]!;
    const slash = name.indexOf('/');
    if (slash <= 0) return; // Python ignores names without a slash

    const chordName = name.slice(0, slash);
    const bass = name.slice(slash + 1);

    const bassValue = noteValues[bass];
    if (bassValue === undefined) ctx.error(`@Slash: unknown bass note '${bass}'.`);

    // Parse the original chord without the bass.
    const chord = pctx.chord(chordName);
    if (chord.tonic === null || chord.chordType === null) return;
    const tonicValue = noteValues[chord.tonic];
    if (tonicValue === undefined) ctx.error(`@Slash: unknown chord tonic '${chord.tonic}'.`);

    // Interval between the slash note and the root.
    const interval = pyMod(bassValue - tonicValue, -12);

    // Define a new chord with syntax "type<bass" to denote the slash chord.
    const chordType = chord.chordType === 'M' ? '' : chord.chordType;
    const newName = `${chordType}<${interval}`;

    const def = pctx.chordList.get(chord.chordType);
    if (!def) {
      ctx.error(`@Slash: chord type '${chord.chordType}' is not in the chord table.`);
      return;
    }

    const notes = [...def.notes];
    const scale = [...def.scale];
    notes[0] = interval;
    scale[0] = interval;

    if (!pctx.chordList.has(newName)) {
      console.log(`Defining new chord ${newName}`);
      pctx.pushCommands([`DefChord ${newName} (${notes.join(',')}) (${scale.join(',')})`]);
    }
  },
};

export default slashPlugin;

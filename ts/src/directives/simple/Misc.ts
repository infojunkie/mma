/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Simple directives that mostly set context state: RNDSEED, PRINT,
 * MIDIFILE, CHORDADJUST, DEFCHORD, TRANSPOSE, ERROR, GOTO and EOF
 * (parse.py and the modules it delegates to).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import { createChordAdjust } from '../../model/ChordNotes';
import { getTranspose } from '../../model/features/KeySig';
import { opt2pair, pextract, stoi } from '../../util/Common';
import { calcVolume } from './Volume';

/** Port of parse.rndseed (RNDSEED). */
export function rndseed(ctx: MMAContext, ln: string[]): void {
  if (!ln.length) {
    // Python random.seed() with no argument reseeds unpredictably.
    ctx.rng.seed(Math.floor(Math.random() * 0x7fffffff));
  } else if (ln.length > 1) {
    ctx.error('RNDSEED: requires 0 or 1 arguments');
  } else {
    ctx.rng.seed(stoi(ctx.rep, ln[0]!));
  }
}

/** Port of parse.lnPrint (PRINT). */
export function lnPrint(_ctx: MMAContext, ln: string[]): void {
  console.log(ln.join(' '));
}

/** Port of midifuncs.setMidiFileType (MIDIFILE). */
export function midiFile(ctx: MMAContext, ln: string[]): void {
  if (!ln.length) ctx.error('USE: MidiFile [SMF=0/1] [RUNNING=0/1]');

  for (const l of ln) {
    const eq = l.indexOf('=');
    if (eq < 0) ctx.error(`Each arg must contain an '=', not '${l}'`);
    const mode = l.slice(0, eq).toUpperCase();
    const val = l.slice(eq + 1);

    if (mode === 'SMF') {
      if (val === '0') ctx.midiFileType = 0;
      else if (val === '1') ctx.midiFileType = 1;
      else ctx.error('Use: MIDIFile SMF=0/1');
    } else if (mode === 'RUNNING') {
      if (val === '0') ctx.runningStatus = 0;
      else if (val === '1') ctx.runningStatus = 1;
      else ctx.error('Use: MIDIFile RUNNING=0/1');
    } else {
      ctx.error('Use: MIDIFile [SMF=0/1] [RUNNING=0/1]');
    }
  }

  ctx.dPrint(`MIDIFile: SMF=${ctx.midiFileType} RUNNING=${ctx.runningStatus ? 'ON' : 'OFF'}`);
}

/** Port of chords.chordAdjust (CHORDADJUST). */
export function chordAdjust(ctx: MMAContext, input: string[]): void {
  const [args, pairs] = opt2pair(input);

  if (!args.length && !pairs.length) ctx.error('ChordAdjust: Needs at least one argument.');

  for (const a of args) {
    if (a.toUpperCase() === 'RESET') {
      Object.assign(ctx.cdAdjust, createChordAdjust());
    } else {
      ctx.error(`ChordAdjust: ${a} is not a valid argument.`);
    }
  }

  const orig = createChordAdjust();
  for (const { option: p, value: octaveRaw } of pairs) {
    const octave = stoi(ctx.rep, octaveRaw, `ChordAdjust: expecting integer (-1, 0 or 1), not '${octaveRaw}'`);
    if (octave !== -1 && octave !== 0 && octave !== 1) {
      ctx.error(`ChordAdjust: '${octave}' is not a valid octave. Use 1, 0 or -1`);
    }
    for (const pitch of p.toUpperCase().split(',')) {
      if (!(pitch in ctx.cdAdjust)) {
        ctx.error(
          `ChordAdjust: '${pitch}' is not a valid pitch. Chord names must be ` +
            "A..G and can be grouped in a list with ','s.",
        );
      }
      ctx.cdAdjust[pitch] = orig[pitch]! + octave * 12;
    }
  }
}

/** Port of chords.defChord (DEFCHORD). */
export function defChord(ctx: MMAContext, input: string[]): void {
  const emsg = 'DefChord needs NAME (NOTES) (SCALE)';

  if (!input.length) ctx.error(emsg);
  const ln = [...input];
  const name = ln.shift()!;

  if (ctx.chordList.has(name)) ctx.warning(`Redefining chordtype '${name}'`);
  if (name.includes('/')) ctx.error('A slash in not permitted in chord type name');
  if (name.includes('>')) ctx.error("A '>' in not permitted in chord type name");

  const [rest, subs] = pextract(ln.join(''), '(', ')');
  if (rest || subs.length !== 2) ctx.error(emsg);

  const notes = subs[0]!.split(',');
  if (notes.length < 2 || notes.length > 8) {
    ctx.error(`There must be 2..8 notes in a chord, not '${notes.length}'`);
  }
  const noteValues: number[] = [];
  for (const v of notes) {
    const n = stoi(ctx.rep, v, `Note offsets in chord must be integers, not '${v}'`);
    if (n < -12 || n > 24) ctx.error(`Note offsets in chord must be -12..24, not '${n}'`);
    noteValues.push(n);
  }

  const scale = subs[1]!.split(',');
  if (scale.length !== 7) {
    ctx.error(`There must be 7 offsets in chord scale, not '${scale.length}'`);
  }
  const scaleValues: number[] = [];
  for (const v of scale) {
    const n = stoi(ctx.rep, v, `Scale offsets in chord must be integers, not '${v}'`);
    if (n < -12 || n > 24) ctx.error(`Scale offsets in chord must be -12..24, not '${n}'`);
    scaleValues.push(n);
  }

  ctx.chordList.set(name, { notes: noteValues, scale: scaleValues, description: 'User Defined' });
  ctx.dPrint(`ChordType '${name}', ${noteValues} ${scaleValues} User Defined`);
}

/** Port of keysig.transpose (TRANSPOSE). */
export function transpose(ctx: MMAContext, input: string[]): void {
  let ln = [...input];
  if (ln.length && ln[0]!.toUpperCase() === 'ADD') {
    ln = ln.slice(1);
    ctx.transpose += getTranspose(ctx, ln, 'Transpose');
    if (ctx.transpose < -12 || ctx.transpose > 12) {
      ctx.error(`Transose: Add option results in setting of '${ctx.transpose}', must be -12 to 12.`);
    }
  } else {
    ctx.transpose = getTranspose(ctx, ln, 'Transpose');
  }
  ctx.dPrint(`Set Transpose to ${ctx.transpose}`);
}

/** Port of parse.forceError (ERROR). */
export function forceError(ctx: MMAContext, ln: string[]): void {
  const args = ln.length ? ln : ['Unspecified cause.'];
  ctx.error('User error: ' + args.join(' '));
}

/** Port of parse.eof (EOF) - stop reading the current file. */
export function eof(ctx: MMAContext, _ln: string[]): void {
  ctx.inpath!.toEof();
}

/** Port of parse.goto (GOTO). */
export function goto(ctx: MMAContext, ln: string[]): void {
  if (ln.length !== 1) ctx.error('Usage: GOTO Label');
  ctx.inpath!.goto(ln[0]!.toUpperCase());
}

// ---------------------------------------------------------------------------
// Documentation directives (docs.py)
//
// `Begin Doc ... End` turns every enclosed line into a `Doc <text>` command,
// so these must at least be no-ops for library files to parse.  While
// gbl.createDocs == 0 (normal parsing), Python's docNote/docVars return
// immediately; docAuthor just records a string.  The -Dxl/-Dxh/-Dgh/-Dbo
// dump modes that consume this data are planned for M4/M5.
// ---------------------------------------------------------------------------

/** Port of docs.docNote (DOC). */
export function docNote(_ctx: MMAContext, _ln: string[]): void {
  // no-op unless a documentation dump run is active (M4)
}

/** Port of docs.docAuthor (AUTHOR). */
export function docAuthor(_ctx: MMAContext, _ln: string[]): void {
  // recorded for documentation dumps only (M4)
}

/** Port of docs.docVars (DOCVAR). */
export function docVars(_ctx: MMAContext, _ln: string[]): void {
  // no-op unless a documentation dump run is active (M4)
}

/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/parseCL.py: chord-data line parsing.  Determines the
 * start/end position of every chord in a bar, handles the continuation
 * chords ('/' and '-'), the '@beat' placement notation and the 'z'
 * tacet/mute shortcuts, and builds the ChordNotes for each entry.
 *
 * The Python module used the globals lastChord and chordTabs; here they
 * live on the MMAContext (ctx.lastChord / ctx.chordTabs).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../engine/Context';
import { CTable } from '../model/CTable';
import { ChordNotes, type ChordEnv } from '../model/ChordNotes';
import { stof } from '../util/Common';
import { formatFloat } from '../engine/PyValue';

/** Track names permitted in the 'z' mute shortcut. */
export const muteTrackNames = 'CBAWDSRP';
export const muteTrackNamesNoDrum = muteTrackNames.replace('D', '');

/** Build the ChordEnv adapter over the context (chords.py module state). */
export function chordEnv(ctx: MMAContext): ChordEnv {
  return {
    chordList: ctx.chordList,
    cdAdjust: ctx.cdAdjust,
    keyName: () => [ctx.keySig.kName[0], ctx.keySig.kName[1] === 1],
    keyNoteValue: () => ctx.keySig.keyNoteValue,
    rep: ctx.rep,
  };
}

/**
 * Port of parseCL.setChordTabs: tab positions are given in beats (1-based)
 * and stored as ticks.  Called on every TIME change.
 */
export function setChordTabs(ctx: MMAContext, l: number[]): void {
  ctx.chordTabs = l.map((x) => Math.trunc((x - 1) * ctx.BperQ));
}

/**
 * Port of parseCL.parseChordLine.  Returns one CTable per chord in the
 * line; throws through ctx.error on malformed input.
 */
export function parseChordLine(ctx: MMAContext, l: string[]): CTable[] {
  const ctable: CTable[] = [];
  const quarter = ctx.BperQ;
  const endTime = quarter * ctx.QperBar;

  let p = 0; // points to tab 0, 1, ... in ctx.chordTabs

  for (const ll of l) {
    let ch: string;
    let beat: number;

    if (ll.includes('@')) {
      const at = ll.indexOf('@');
      ch = ll.slice(0, at);
      const beatStr = ll.slice(at + 1);
      const beatVal = stof(ctx.rep, beatStr, `Expecting a value after the @ in '${ll}'`);

      if (beatVal < 1) ctx.error(`Beat after @ must be 1 or greater, not '${formatFloat(beatVal)}'.`);
      if (beatVal >= ctx.QperBar + 1) {
        // QperBar is an int in Python's message (str, not float formatting).
        ctx.error(`Beat after @ must be less than ${String(ctx.QperBar + 1)}, not '${formatFloat(beatVal)}'.`);
      }

      beat = Math.trunc((beatVal - 1) * quarter);

      // set p to the next spot in chordTabs[] after this beat
      for (p = 0; p < ctx.chordTabs.length; p++) {
        if (ctx.chordTabs[p]! > beat) break;
      }
      if (p >= ctx.chordTabs.length) p = ctx.chordTabs.length - 1;
    } else {
      ch = ll;
      if (p > ctx.chordTabs.length - 1) {
        ctx.error(
          `Too many chords specified in line. Max is ${ctx.chordTabs.length}. ` +
            'For more chords use @ notation or change TIME TABS.',
        );
      }
      beat = ctx.chordTabs[p]!;
      p += 1;
    }

    // handle continuation chords; Python's `ch in '-/'` also matches ''
    if (ch === '-' || ch === '/' || ch === '') {
      if (!ctable.length) {
        if (ctx.lastChord) {
          ch = ctx.lastChord;
        } else {
          ctx.error("No previous chord for '/' or '-' at line start");
        }
      } else {
        continue; // '/' elsewhere just bumps the beat counter
      }
    }

    if (ctable.length) {
      const last = ctable[ctable.length - 1]!;
      if (last.name === ch) continue; // skip duplicate chords
      if (last.chStart >= beat) ctx.error('Chord positions out of order');
    } else if (beat !== 0) {
      ctx.error(`The first chord must be at beat 1, not ${formatFloat(beat / quarter + 1)}.`);
    }

    const ctab = new CTable();
    ctab.name = ch;
    ctab.chStart = beat;
    ctab.lastchord = null;
    // Python stores the *name* here despite the CTable declaration; keep
    // the runtime shape identical to parseCL.py.
    if (ctable.length) {
      ctab.lastchord = ctable[ctable.length - 1]!.name as unknown as typeof ctab.lastchord;
    } else {
      ctab.lastchord = ctx.lastChord as unknown as typeof ctab.lastchord;
    }

    // The 'z' mute shortcut: work out which tracks to mute.
    if (ch.includes('z')) {
      if ((ch.match(/z/g) ?? []).length > 1) {
        ctx.error(`Only one 'z' is permitted in the mute shortcut. '${ch}' is illegal.`);
      }

      if (ctx.lastChord && ctx.lastChord.includes('z')) {
        ctx.lastChord = ctx.lastChord.split('z')[0]!;
      }

      const zi = ch.indexOf('z');
      let c = ch.slice(0, zi);
      let r = ch.slice(zi + 1);

      if (!c) {
        c = 'z'; // dummy chord name to keep chordnotes() happy

        if (r === '!') {
          r = muteTrackNames;
        } else if (!r) {
          r = muteTrackNamesNoDrum;
        } else if (ctx.lastChord) {
          c = ctx.lastChord;
          if (c.includes('z')) c = c.split('z')[0]!;
        } else {
          ctx.error(`Unable to find a chord for '${ch}'. Try specifing the chord name.`);
        }
      } else {
        // illegal CHORD + 'z' or 'z!' forms
        if (r === '!') {
          ctx.error(`'${ch}' is illegal. 'z!' mutes all tracks so you can't include the chord.`);
        } else if (!r) {
          ctx.error(`'${ch}' is illegal. This notation is a shortcut,  You must specify tracks if you use a chord.`);
        }
      }

      ch = c;

      // A throwaway '-', indicating "these are the tracks to mute", is
      // permitted for compatibility with the '+' option.
      if (r.includes('-')) {
        if ((r.match(/-/g) ?? []).length > 1 || r.includes('+') || r[0] !== '-') {
          ctx.error("Track mute: Use of a '-' must be at start of line and cannot be used with '+' option.");
        }
        r = r.slice(1);
      }

      if (r.includes('+')) {
        if ((r.match(/\+/g) ?? []).length > 1 || r[0] !== '+') {
          ctx.error('Track mute: Only 1 + permitted. Must be first character.');
        }
        for (const a of r.slice(1)) {
          if (!muteTrackNames.includes(a)) {
            ctx.error(`Track mute: track name '${a}' not in permitted list '${muteTrackNames}'.`);
          }
        }
        r = r.slice(1);
        if (!r.includes('C')) ctab.chordZ = true;
        if (!r.includes('B')) ctab.bassZ = true;
        if (!r.includes('A')) ctab.arpeggioZ = true;
        if (!r.includes('W')) ctab.walkZ = true;
        if (!r.includes('D')) ctab.drumZ = true;
        if (!r.includes('S')) ctab.scaleZ = true;
        if (!r.includes('R')) ctab.ariaZ = true;
        if (!r.includes('P')) ctab.plectrumZ = true;
      } else {
        // mute only the tracks in the list ('-' or no option, the default)
        for (const v of r) {
          if (v === 'C') ctab.chordZ = true;
          else if (v === 'B') ctab.bassZ = true;
          else if (v === 'A') ctab.arpeggioZ = true;
          else if (v === 'W') ctab.walkZ = true;
          else if (v === 'D') ctab.drumZ = true;
          else if (v === 'S') ctab.scaleZ = true;
          else if (v === 'R') ctab.ariaZ = true;
          else if (v === 'P') ctab.plectrumZ = true;
          else {
            ctx.error(`Track mute: track name '${v}' not in permitted list '${muteTrackNames}'.`);
          }
        }
      }
    }

    ctab.chord = new ChordNotes(chordEnv(ctx), ch);
    ctable.push(ctab);
  }

  // Check that all chords are in range.
  const last = ctable[ctable.length - 1]!;
  if (last.chStart >= endTime) {
    ctx.error(
      `Maximum offset for chord '${last.name}' must be less than ${formatFloat(endTime / quarter + 1)}, ` +
        `not '${formatFloat(last.chStart / quarter + 1)}'.`,
    );
  }

  // Fix up the pointers.
  for (let i = 0; i < ctable.length - 1; i++) {
    ctable[i]!.chEnd = ctable[i + 1]!.chStart;
  }
  last.chEnd = endTime;
  ctx.lastChord = last.name;

  return ctable;
}

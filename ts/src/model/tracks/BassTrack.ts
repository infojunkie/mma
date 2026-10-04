/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/patBass.py - the BASS pattern track.  Harmony is provided
 * by model/features/Harmony.ts (MMA/harmony.py).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../../engine/Context';
import type { CTable } from '../CTable';
import { BassEvent, type Pattern } from '../PatternEvent';
import { getNoteLen } from '../NoteLen';
import { stoi } from '../../util/Common';
import { doOrnament } from '../features/Ornament';
import { trackHooks } from './hooks';
import { BaseTrack } from './BaseTrack';

export class BassTrack extends BaseTrack {
  constructor(ctx: MMAContext, name: string) {
    super(ctx, name, 'BASS');
  }

  /**
   * Parse a bass pattern group: start, length, note, volume.
   * The note is n[n][# S & b][+ -] (0-based scale offset, accidental,
   * octave modifiers).
   */
  override getPgroup(ev: string[]): BassEvent {
    if (ev.length !== 4) {
      this.ctx.rep.error(
        `There must be n groups of 4 in a pattern definition, not <${ev.join(' ')}>`,
      );
    }

    const a = new BassEvent();
    a.offset = this.setBarOffset(ev[0]!);
    a.duration = getNoteLen(this.ctx.rep, this.ctx.noteLenTable, ev[1]!);
    a.addoctave = 0;

    // Parse the offset (field 3): move leading +/- to the end (leading
    // +/- is an option).
    let offset = ev[2]!;
    while (offset[0] === '-' || offset[0] === '+') {
      offset = offset.slice(1) + offset[0]!;
    }

    // Grab the digit(s) for the offset into the scale (base 1).
    let point = 0;
    while (point < offset.length && /[0-9]/.test(offset[point]!)) point += 1;
    let n = stoi(this.ctx.rep, offset.slice(0, point), `Note offset in Bass must be greater that 0`);
    if (n < 1) {
      this.ctx.rep.error(`Note offset in Bass must be greater that 0, not '${n}'.`);
    }
    while (n > 7) {
      n -= 7;
      a.addoctave += 12;
    }
    a.noteoffset = n - 1;

    // Grab the accidental (#, S or &, B, b) - no double sharp/flat.
    const emsg = offset.slice(point);
    const c = offset.slice(point, point + 1);
    if (c === '#' || c === 'S') {
      a.accidental = 1;
      point += 1;
    } else if (c === 'B' || c === '&') {
      a.accidental = -1;
      point += 1;
    } else {
      a.accidental = 0;
    }

    // Trailing octave modifiers.
    for (const ch of offset.slice(point)) {
      if (ch === '+') a.addoctave += 12;
      else if (ch === '-') a.addoctave -= 12;
      else {
        this.ctx.rep.error(`Only '- + # b &' are permitted after a noteoffset, not '${emsg}'`);
      }
    }

    // And, finally, the volume.
    a.vol = stoi(this.ctx.rep, ev[3]!, 'Note volume in Bass definition not int');

    return a;
  }

  override restart(): void {
    this.ssvoice = -1;
  }

  /** Do the bass bar. Called from bar(). */
  override trackBar(pattern: Pattern, ctable: CTable[]): void {
    const sc = this.seq;

    for (const p0 of pattern) {
      const p = p0 as BassEvent;
      const ct = this.getChordInPos(p.offset, ctable)!;

      if (ct.bassZ) continue;

      const note = ct.chord!.scaleList[p.noteoffset]! + p.addoctave + p.accidental;

      let notelist: Array<[number, number]>;
      if (!this.harmonyOnly[sc]) notelist = [[note, p.vol]];
      else notelist = [];

      let harmlist: Array<[number, number]>;
      if (this.harmony[sc]) {
        const h = trackHooks.harmonize(
          this.ctx,
          this.harmony[sc] as string,
          note,
          ct.chord!.noteList,
        );
        harmlist = h.map((n) => [n, p.vol * this.harmonyVolume[sc]!]);
      } else {
        harmlist = [];
      }

      let offset = p.offset;
      if (this.ornaments.type) {
        offset = doOrnament(
          this.ctx,
          this,
          notelist,
          this.getChordInPos(offset, ctable)!.chord!.scaleList,
          p,
        );
        notelist = [];
      }

      this.sendChord(notelist.concat(harmlist), p.duration, offset);
    }
  }
}

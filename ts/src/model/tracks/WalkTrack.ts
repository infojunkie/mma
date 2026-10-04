/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/patWalk.py - the WALK (walking bass) pattern track.
 * Harmony is provided by model/features/Harmony.ts (MMA/harmony.py).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../../engine/Context';
import type { CTable } from '../CTable';
import { SingleVolEvent, type Pattern } from '../PatternEvent';
import { getNoteLen } from '../NoteLen';
import { stoi } from '../../util/Common';
import { doOrnament } from '../features/Ornament';
import { trackHooks } from './hooks';
import { BaseTrack } from './BaseTrack';

export class WalkTrack extends BaseTrack {
  walkChoice = 0;

  constructor(ctx: MMAContext, name: string) {
    super(ctx, name, 'WALK');
  }

  /** Parse a walking bass pattern group: start, length, volume. */
  override getPgroup(ev: string[]): SingleVolEvent {
    if (ev.length !== 3) {
      this.ctx.rep.error(
        `There must be at exactly 3 items in each group in a Walking Bass definition, not <${ev.join(' ')}>`,
      );
    }

    const a = new SingleVolEvent();
    a.offset = this.setBarOffset(ev[0]!);
    a.duration = getNoteLen(this.ctx.rep, this.ctx.noteLenTable, ev[1]!);
    a.vol = stoi(this.ctx.rep, ev[2]!, 'Type error in Walking Bass definition');

    return a;
  }

  override restart(): void {
    this.ssvoice = -1;
    this.walkChoice = 0;
  }

  /** Do a walking bass bar. Called from bar(). */
  override trackBar(pattern: Pattern, ctable: CTable[]): void {
    const sc = this.seq;
    const dir = this.direction[sc]!;

    for (const p0 of pattern) {
      const p = p0 as SingleVolEvent;
      const tb = this.getChordInPos(p.offset, ctable)!;

      if (tb.walkZ) continue;

      // Create a note list from the current scale.  We do this for each
      // beat, but it's pretty fast.  The note list is simply notes 0..5 of
      // the scale PLUS notes 1..4 reversed.  So, a C major chord would
      // result in the note list (0,2,4,5,7,9,7,5,4,2).  We never use
      // scale notes past this point.  So in a C chord we are using notes
      // C, D, E, F, G and A.  This is one reason we ignore the RANGE
      // setting ... there would be a big gap between the 'A' and the next
      // 'C'.
      //
      // Note that we deliberately skip the 7th.  Too often the chord is a
      // Major but the melody note will be the dom. 7th and the M7 will
      // sound off.  So, just err on the side of caution.
      //
      // If DIR is UP or DOWN we don't append the 2nd half of the scale.
      // If DIR is DOWN we reverse the order as well.

      let wNotes = tb.chord!.scaleList.slice(0, 6);

      if (dir !== 'UP' && dir !== 'DOWN') {
        const b = tb.chord!.scaleList.slice(1, 5);
        b.reverse();
        wNotes = wNotes.concat(b);
      }

      if (dir === 'DOWN') wNotes.reverse();

      // Ensure that the offset is in range.
      if (this.walkChoice >= wNotes.length || this.walkChoice < 0) this.walkChoice = 0;

      // Even with a walking bass it's nice to have the chord root on beat
      // 1 ... not all the time, but most.  This bit of code ensures that
      // more than 50% of beat ones will have the root.
      if (p.offset === 0 && this.ctx.rng.choice([0, 1])) this.walkChoice = 0;

      const note = wNotes[this.walkChoice]!;

      // Adjust offset for NEXT TIME.  If the direction is up/down we just
      // increment the pointer.  If we have direction set to RANDOM then we
      // select either -1, 0 or 1 with equal chance for moving up, down or
      // not-at-all.  With BOTH we have a preference to move up.
      if (dir === 'UP' || dir === 'DOWN') {
        this.walkChoice += 1;
      } else if (dir === 'RANDOM') {
        this.walkChoice += this.ctx.rng.choice([0, 1, -1]);
      } else {
        // BOTH
        this.walkChoice += this.ctx.rng.choice([-1, 0, 0, 2, 2, 1, 1, 1, 1, 1, 1, 1]);
      }

      let notelist: Array<[number, number]>;
      if (!this.harmonyOnly[sc]) {
        notelist = [[note, p.vol]];
      } else {
        notelist = [];
      }

      let harmlist: Array<[number, number]>;
      if (this.harmony[sc]) {
        const ch = this.getChordInPos(p.offset, ctable)!.chord!.noteList;
        const h = trackHooks.harmonize(this.ctx, this.harmony[sc] as string, note, ch);
        const vol = p.vol * this.harmonyVolume[sc]!;
        harmlist = h.map((n) => [n, vol]);
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

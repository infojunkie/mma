/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/patArpeggio.py - the ARPEGGIO pattern track.  Harmony is
 * provided by model/features/Harmony.ts (MMA/harmony.py).
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

export class ArpeggioTrack extends BaseTrack {
  /** Current index into the stacked chord; -1 means "not started". */
  arpOffset = -1;
  arpDirection = 1;
  /**
   * Python declares lastRange/lastDirection as class attributes (999) and
   * restart() assigns to *locals* of the same name (it omits `self.`), so
   * a restart does not reset them.  Reproduced as-is.
   */
  lastRange = 999;
  /** 999 (the Python class default) or the last direction string used. */
  lastDirection: number | string = 999;

  constructor(ctx: MMAContext, name: string) {
    super(ctx, name, 'ARPEGGIO');
  }

  /** Parse an arpeggio pattern group: start, length, volume. */
  override getPgroup(ev: string[]): SingleVolEvent {
    if (ev.length !== 3) {
      this.ctx.rep.error(
        `There must be exactly 3 items in each group for apreggio define, not '${ev.join(' ')}'`,
      );
    }

    const a = new SingleVolEvent();
    a.offset = this.setBarOffset(ev[0]!);
    a.duration = getNoteLen(this.ctx.rep, this.ctx.noteLenTable, ev[1]!);
    a.vol = stoi(this.ctx.rep, ev[2]!, 'Type error in Arpeggio definition');

    return a;
  }

  override restart(): void {
    this.ssvoice = -1;
    this.arpOffset = -1;
    this.arpDirection = 1;
    // Python sets lastRange/lastDirection here without `self.`; see above.
  }

  /** Do an arpeggio bar. Called from bar(). */
  override trackBar(pattern: Pattern, ctable: CTable[]): void {
    const sc = this.seq;

    const direct = this.direction[sc]!;
    if (direct !== this.lastDirection) {
      this.arpOffset = -1;
      this.arpDirection = 1;
      this.lastDirection = direct;
    }

    const crange = this.chordRange[sc]!;
    if (crange !== this.lastRange) {
      this.arpOffset = -1;
      this.arpDirection = 1;
      this.lastRange = crange;
    }

    for (const p0 of pattern) {
      const p = p0 as SingleVolEvent;
      const tb = this.getChordInPos(p.offset, ctable)!;

      if (tb.arpeggioZ) continue;

      if (direct === 'DOWN') this.arpDirection = -1;

      if (this.chordLimit[0]) {
        tb.chord!.limit(this.chordLimit[0], this.chordLimit[1], this.chordLimit[2]);
      }

      if (this.compress[sc]) tb.chord!.compress();

      if (this.invert[sc]!.length) {
        tb.chord!.invert(this.ctx.rng.randrange(this.invert[sc]![0]!, this.invert[sc]![1]! + 1));
      }

      // The chord is recreated for every pattern event.  Python notes this
      // could be optimized but is left as-is so LIMIT/COMPRESS/INVERT are
      // applied per bar.
      let octave = 0; // octave adjuster
      const ourChord: number[] = [];

      // For the range, stack up copies of the chord.
      for (let l = 0; l < Math.trunc(crange); l++) {
        for (const x of tb.chord!.noteList) ourChord.push(x + octave);
        octave += 12;
      }

      // Fractional range, add a partial chord.
      const fr = crange - Math.trunc(crange);
      if (fr) {
        let n = Math.trunc(tb.chord!.noteListLen * fr);
        if (n < 2) n = 2; // important, min of 2 notes in arp.
        for (const x of tb.chord!.noteList.slice(0, n)) ourChord.push(x + octave);
      }

      if (direct === 'BOTH') {
        if (this.arpOffset < 0) {
          this.arpOffset = 1;
          this.arpDirection = 1;
        } else if (this.arpOffset >= ourChord.length) {
          this.arpOffset = ourChord.length - 2;
          this.arpDirection = -1;
        }
      } else if (direct === 'UP') {
        if (this.arpOffset >= ourChord.length || this.arpOffset < 0) {
          this.arpOffset = 0;
          this.arpDirection = 1;
        }
      } else if (direct === 'DOWN') {
        if (this.arpOffset < 0 || this.arpOffset >= ourChord.length) {
          this.arpOffset = ourChord.length - 1;
          this.arpDirection = -1;
        }
      }

      let note: number;
      if (direct === 'RANDOM') {
        note = this.ctx.rng.choice(ourChord);
      } else {
        note = ourChord[this.arpOffset]!;
      }

      this.arpOffset += this.arpDirection;

      let notelist: Array<[number, number]>;
      if (!this.harmonyOnly[sc]) {
        notelist = [[note, p.vol]];
      } else {
        notelist = [];
      }

      let harmlist: Array<[number, number]>;
      if (this.harmony[sc]) {
        const h = trackHooks.harmonize(this.ctx, this.harmony[sc] as string, note, ourChord);
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

      tb.chord!.reset(); // important, other tracks share the chord object
    }
  }
}

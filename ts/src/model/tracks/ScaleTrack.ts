/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/patScale.py - the SCALE pattern track (runs up/down a
 * chord's scale, chord or chromatic notes).  Harmony is provided by
 * model/features/Harmony.ts (MMA/harmony.py).
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
import { lnExpand, stoi } from '../../util/Common';
import { doOrnament } from '../features/Ornament';
import { trackHooks } from './hooks';
import { BaseTrack } from './BaseTrack';

export class ScaleTrack extends BaseTrack {
  lastNote = -1;
  /**
   * Python's Scale.lastChord holds the "tonic + chordType" signature of
   * the last chord used; PC.clearSequence() also sets self.lastChord
   * (shared with the CHORD track's voicing state), but ScaleTrack keeps
   * its own field so the base `lastChord: number[]` stays CHORD-only.
   */
  scaleLastChord: string | null = null;
  lastStype: string | null = null;
  /** Python class default is 1; it is then compared with/assigned direction strings. */
  lastDirect: number | string = 1;
  lastRange = 0;
  sOffset = 0;
  notes: number[] | null = null;
  dirfact = 1;

  constructor(ctx: MMAContext, name: string) {
    super(ctx, name, 'SCALE');
  }

  /**
   * Python's PC.clearSequence() resets self.lastChord (used by this class
   * for its chord signature) to []; the null sentinel below has the same
   * "never equals a real chord" effect.
   */
  override clearSequence(): void {
    super.clearSequence();
    this.scaleLastChord = null;
  }

  /** Set scale type. */
  override setScaletype(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} ScaleType`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: string[] = [];

    for (const n0 of ln) {
      const n = n0.toUpperCase();
      if (!['CHROMATIC', 'SCALE', 'AUTO', 'CHORD'].includes(n)) {
        this.ctx.rep.error(
          `${this.name} Scaletype: Only Chromatic, Scale, Auto and Chord are valid, not '${n}'`,
        );
      }
      tmp.push(n);
    }

    this.scaleType = this.ctx.seqBump(tmp);
    this.ctx.dPrint(`Set ${this.name} ScaleType to: ${this.scaleType.join(' ')}`);
  }

  /**
   * Python's PC.setDirection() resets the two Scale-specific fields after
   * updating the direction list; do the same in addition to the base.
   */
  override setDirection(ln: string[]): void {
    super.setDirection(ln);
    this.scaleLastChord = null;
    this.lastNote = -1;
  }

  override restart(): void {
    this.ssvoice = -1;
    this.lastNote = -1;
    this.scaleLastChord = null;
    this.lastStype = null;
    this.lastDirect = 1;
    this.lastRange = 0;
    this.sOffset = 0;
    this.notes = null;
    this.dirfact = 1;
  }

  /** Parse a scale pattern group: start, length, volume. */
  override getPgroup(ev: string[]): SingleVolEvent {
    if (ev.length !== 3) {
      this.ctx.rep.error(
        `There must be at exactly 3 items in each group in a Scale definition, not <${ev.join(' ')}>.`,
      );
    }

    const a = new SingleVolEvent();
    a.offset = this.setBarOffset(ev[0]!);
    a.duration = getNoteLen(this.ctx.rep, this.ctx.noteLenTable, ev[1]!);
    a.vol = stoi(this.ctx.rep, ev[2]!, 'Type error in Scale definition');

    return a;
  }

  /** Do a scale bar. Called from bar(). */
  override trackBar(pattern: Pattern, ctable: CTable[]): void {
    const sc = this.seq;
    const direct = this.direction[sc]!;

    // If the range or direction has changed, we just start with a new scale.
    const t = this.chordRange[sc]!;
    if (t !== this.lastRange) {
      this.lastRange = t;
      this.scaleLastChord = null;
    }

    if (this.lastDirect !== direct) {
      this.lastDirect = direct;
      this.scaleLastChord = null;
    }

    for (const p0 of pattern) {
      const p = p0 as SingleVolEvent;
      const tb = this.getChordInPos(p.offset, ctable)!;

      if (tb.scaleZ) continue;

      const thisChord = `${tb.chord!.tonic}${tb.chord!.chordType}`;
      const stype = this.scaleType[sc]!;

      if (thisChord !== this.scaleLastChord || stype !== this.lastStype) {
        this.scaleLastChord = thisChord;
        this.lastStype = stype;

        let notelist: number[];
        if (stype === 'CHROMATIC') {
          notelist = [];
          for (let x = 0; x < 12; x++) notelist.push(tb.chord!.rootNote + x);
        } else if (stype === 'CHORD') {
          notelist = [...tb.chord!.noteList];
        } else {
          // AUTO and SCALE use the chord's scale list.
          notelist = [...tb.chord!.scaleList];
        }

        // Get the current scale and append enough copies together for the
        // RANGE setting.  If Range is 0 or 1 we end up with a single copy.
        let ln = this.chordRange[sc]!; // RANGE 1..x (def. == 1)

        let o = 0;
        this.notes = [];

        while (ln >= 1) {
          for (const a of notelist) this.notes.push(a + o);
          o += 12;
          ln -= 1;
        }

        if (ln > 0 && ln < 1) {
          // For fractional scale lengths.
          ln = Math.trunc(notelist.length * ln);
          if (ln < 2) ln = 2; // important, must be at least 2 notes in a scale
          for (const a of notelist.slice(0, ln)) this.notes.push(a + o);
        }

        if (direct === 'DOWN') {
          this.dirfact = -1;
          if (this.lastNote === -1) this.sOffset = this.notes.length - 1;
        } else {
          this.sOffset = 0;
          this.dirfact = 1;
        }

        if (this.lastNote > -1) {
          const idx = this.notes.indexOf(this.lastNote);
          if (idx >= 0) {
            this.sOffset = idx;
          } else {
            this.sOffset = this.notes.length - 1;
            for (let i = 0; i < this.notes.length; i++) {
              if (this.notes[i]! > this.lastNote) {
                this.sOffset = i;
                break;
              }
            }
          }
        }
      }

      // Keep offset into note list in range.  It is only past the end of
      // the list if BOTH or UP, and only before the start if DOWN or BOTH.
      const notes = this.notes!;

      if (this.sOffset >= notes.length) {
        if (direct === 'BOTH') {
          this.dirfact = -1;
          this.sOffset = notes.length - 2;
        } else {
          // UP
          this.sOffset = 0;
        }
      } else if (this.sOffset < 0) {
        if (direct === 'BOTH') {
          this.dirfact = 1;
          this.sOffset = 1;
        } else {
          // DOWN
          this.sOffset = notes.length - 1;
        }
      }

      let note: number;
      if (direct === 'RANDOM') {
        note = this.ctx.rng.choice(notes);
      } else {
        note = notes[this.sOffset]!;
        this.sOffset += this.dirfact;
      }

      this.lastNote = note;

      let nlist: Array<[number, number]>;
      if (!this.harmonyOnly[sc]) {
        nlist = [[note, p.vol]];
      } else {
        nlist = [];
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
          nlist,
          this.getChordInPos(offset, ctable)!.chord!.scaleList,
          p,
        );
        nlist = [];
      }

      this.sendChord(nlist.concat(harmlist), p.duration, offset);
    }
  }
}

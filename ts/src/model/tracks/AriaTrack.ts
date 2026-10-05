/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/patAria.py - the ARIA (auto-melody) pattern track.  The
 * track walks a per-chord note list (scale/chord/chromatic/key) with a
 * direction pointer; deplete mode removes notes once played.  Harmony is
 * provided by model/features/Harmony.ts (MMA/harmony.py).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 *
 * Original Python module by Bob van der Poel <bob@mellowood.ca>.
 */

import type { MMAContext } from '../../engine/Context';
import type { CTable } from '../CTable';
import { ChordNotes } from '../ChordNotes';
import { SingleVolEvent, type Pattern } from '../PatternEvent';
import { getNoteLen } from '../NoteLen';
import { lnExpand, stoi } from '../../util/Common';
import { trackHooks } from './hooks';
import { BaseTrack } from './BaseTrack';
import { chordEnv } from '../../parse/ChordLineParser';

/** One direction entry: a fixed integer or an 'R'/'RR' string. */
type AriaDirection = number | string;

export class AriaTrack extends BaseTrack {
  notes: number[] = [];
  selectDir: AriaDirection[] = [1];
  noteptr = 0;
  dirptr = 0;
  /** Python's Aria.lastChord is a "tonic+type" string, not the PC list. */
  ariaLastChord: string | null = null;
  deplete: number[] = [0];

  constructor(ctx: MMAContext, name: string) {
    super(ctx, name, 'ARIA');
    // The field initializers above run after super() (whose clearSequence
    // calls setSeqSize), so re-expand the deplete list with the defaults
    // now in place - Python's class attributes make it available earlier.
    this.setSeqSize();
  }

  /** Expand the existing pattern list (and the deplete list). */
  override setSeqSize(): void {
    this.deplete = this.ctx.seqBump(this.deplete ?? [0]);
    super.setSeqSize();
  }

  /** Grooves are not saved/restored for aria tracks.  But, seqsize is honored! */
  override restoreGroove(_gname: string): void {
    this.setSeqSize();
  }

  /** No save done for grooves. */
  override saveGroove(_gname: string): void {
    /* no save done for grooves */
  }

  /** Get group for aria pattern: start, length, velocity. */
  override getPgroup(ev: string[]): SingleVolEvent {
    if (ev.length !== 3) {
      this.ctx.rep.error(
        `${this.name}: There must be n groups of 3 in a pattern definition, not <${ev.join(' ')}>`,
      );
    }

    const a = new SingleVolEvent();
    a.offset = this.setBarOffset(ev[0]!);
    a.duration = getNoteLen(this.ctx.rep, this.ctx.noteLenTable, ev[1]!);
    a.vol = stoi(this.ctx.rep, ev[2]!, 'Note volume in Aria definition not int');

    return a;
  }

  /** Set scale type. */
  override setScaletype(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} ScaleType`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: string[] = [];
    const dlpt: number[] = [];

    for (const n0 of ln) {
      let n = n0.toUpperCase();
      if (n.endsWith('-')) {
        dlpt.push(1);
        n = n.slice(0, -1);
      } else {
        dlpt.push(0);
      }

      if (!['CHROMATIC', 'SCALE', 'AUTO', 'CHORD', 'KEY'].includes(n)) {
        this.ctx.rep.error(
          `${this.name} ScaleType: Only Chromatic, Scale (Auto) Chord and Key are valid.`,
        );
      }
      tmp.push(n);
    }

    this.scaleType = this.ctx.seqBump(tmp);
    this.deplete = this.ctx.seqBump(dlpt);
    this.restart();

    this.ctx.dPrint(`Set ${this.name} ScaleType: ${this.scaleType.join(' ')}`);
  }

  /**
   * Set direction for melody creation.  This replaces the pattern
   * function of the same name: the command name is shared but the
   * function is different, using its own storage (selectDir).
   */
  override setDirection(ln: string[]): void {
    if (!ln.length) {
      this.ctx.rep.error(`${this.name} Direction: There must be at least one value.`);
    }

    this.selectDir = [];
    for (const a0 of ln) {
      const a = a0.toUpperCase();
      if (a.length > 0 && /^R+$/.test(a)) {
        // is direction 'r', 'rr', 'rrr', etc.
        if (a.length > 4) {
          this.ctx.rep.error(
            `${this.name} Direction: too much randomness(Maximum of 4 r's, got ${a.length}).`,
          );
        }
        this.selectDir.push(a);
      } else {
        // not random, has to be an integer -4 ... 4
        const v = stoi(
          this.ctx.rep,
          a0,
          "Expecting integer value or 'r', 'rr', 'rrr' or 'rrrr'.",
        );
        if (v < -4 || v > 4) {
          this.ctx.rep.error(
            `${this.name} Direction: args must be 'r' or -4 to 4, not '${v}'`,
          );
        }
        this.selectDir.push(v);
      }
    }

    this.restart();

    this.ctx.dPrint(`Set ${this.name} Direction: ${this.selectDir.map((x) => String(x)).join(' ')}`);
  }

  override restart(): void {
    this.ssvoice = -1;
    this.notes = [];
  }

  /** Do the aria bar.  Called from self.bar(). */
  override trackBar(pattern: Pattern, ctable: CTable[]): void {
    const sc = this.seq;

    for (const p0 of pattern) {
      const p = p0 as SingleVolEvent;
      const ct = this.getChordInPos(p.offset, ctable)!;

      if (ct.ariaZ) continue;

      const thisChord = `${ct.chord!.tonic}${ct.chord!.chordType}`;
      const stype = this.scaleType[sc]!;
      let chrange = this.chordRange[sc]!;

      // Generate notelist if nesc.  Note that in the keysig, scale and
      // range funcs restart() is called ... self.notes is reset.
      let notelist: number[] | null = null;

      if (stype === 'CHORD' && (!this.notes.length || this.ariaLastChord !== thisChord)) {
        notelist = ct.chord!.noteList;
        this.notes = [];
      } else if (
        stype === 'CHROMATIC' &&
        (!this.notes.length || this.ariaLastChord !== thisChord)
      ) {
        notelist = [];
        for (let x = 0; x < 12; x++) notelist.push(ct.chord!.rootNote + x);
        this.notes = [];
      } else if (stype === 'KEY' && !this.notes.length) {
        const k = this.ctx.keySig.getKeysig();
        const parts = k.split(/\s+/);
        let ch = parts[0]!;
        if ((parts[1] ?? '').toLowerCase() === 'minor') ch += 'm';
        notelist = [...new ChordNotes(chordEnv(this.ctx), ch).scaleList];
      } else if (
        (stype === 'SCALE' || stype === 'AUTO') &&
        (!this.notes.length || this.ariaLastChord !== thisChord)
      ) {
        notelist = [...ct.chord!.scaleList];
        this.notes = [];
      }

      this.ariaLastChord = thisChord;

      // we have the base list of notes (scale, chord, etc) and now we
      // make it the right length & octave.
      if (!this.notes.length && notelist) {
        let o = 0;
        while (chrange >= 1) {
          for (const a of notelist) this.notes.push(a + o);
          o += 12;
          chrange -= 1;
        }

        if (chrange > 0 && chrange < 1) {
          // for fractional scale lengths
          chrange = Math.trunc(notelist.length * chrange);
          if (chrange < 2) {
            // important, must be at least 2 notes in a scale
            chrange = 2;
          }
          for (const a of notelist.slice(0, chrange)) this.notes.push(a + o);
        }
      }

      // grab a note from the list
      if (this.dirptr >= this.selectDir.length) this.dirptr = 0;

      // the direction ptr is either an int(-4..4) or a string 'r', 'rr', ...
      let a = this.selectDir[this.dirptr]!;

      if (typeof a === 'number') {
        this.noteptr += a;
      } else {
        const n = a.length;
        const range: number[] = [];
        for (let x = -n; x <= n; x++) range.push(x);
        a = this.ctx.rng.choice(range);
        this.noteptr += a;
      }

      if (this.noteptr >= this.notes.length) {
        if (a > 0) this.noteptr = 0;
        else this.noteptr = this.notes.length - 1;
      } else if (this.noteptr < 0) {
        if (a < 0) this.noteptr = this.notes.length - 1;
        else this.noteptr = 0;
      }

      const note = this.notes[this.noteptr]!;

      // delete note just selected if that's the mode
      if (this.deplete[sc]) {
        const i = this.notes.indexOf(note);
        if (i >= 0) this.notes.splice(i, 1);
      }
      this.dirptr += 1;

      // output
      let outList: Array<[number, number]>;
      if (!this.harmonyOnly[sc]) {
        outList = [[note, p.vol]];
      } else {
        outList = [];
      }

      let harmlist: Array<[number, number]>;
      if (this.harmony[sc]) {
        const h = trackHooks.harmonize(
          this.ctx,
          this.harmony[sc] as string,
          note,
          ct.chord!.noteList,
        );
        const vol = p.vol * this.harmonyVolume[sc]!;
        harmlist = h.map((n) => [n, vol]);
      } else {
        harmlist = [];
      }

      this.sendChord(outList.concat(harmlist), p.duration, p.offset);
    }
  }
}

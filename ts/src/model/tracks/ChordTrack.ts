/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/patChord.py - the CHORD pattern track, including the
 * Voicing options.  Ornamentation is not part of M1 (see
 * features/Ornament.ts); everything else is a direct port.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../../engine/Context';
import type { CTable } from '../CTable';
import type { ChordNotes } from '../ChordNotes';
import { ChordEvent, type Pattern } from '../PatternEvent';
import { getNoteLen } from '../NoteLen';
import { opt2pair, stoi, lnExpand } from '../../util/Common';
import { doOrnament } from '../features/Ornament';
import { BaseTrack, type GrooveData } from './BaseTrack';
import { Voicing } from './Voicing';

interface ChordGrooveData extends GrooveData {
  VMODE: Voicing;
}

export class ChordTrack extends BaseTrack {
  /** Used for tracking the direction of strummed chords. */
  sortDirection = 0;

  constructor(ctx: MMAContext, name: string) {
    super(ctx, name, 'CHORD');
  }

  /** Save special/local variables for the groove. */
  override saveGroove(gname: string): void {
    super.saveGroove(gname); // create storage first
    const g = this.grooves.get(gname) as ChordGrooveData;
    g.VMODE = this.voicing!.clone();
  }

  /** Restore special/local variables for the groove. */
  override restoreGroove(gname: string): void {
    const g = this.grooves.get(gname) as ChordGrooveData | undefined;
    if (g) this.voicing = g.VMODE;
    super.restoreGroove(gname);
  }

  override clearSequence(): void {
    super.clearSequence();
    this.voicing = new Voicing();
    // .direction was set in PC.clear.. we're changing to our default.
    this.direction = this.ctx.seqBump(['UP']);
  }

  /** Set the Voicing Mode options; only valid for CHORDs. */
  override setVoicing(ln: string[]): void {
    const [notopt, options] = opt2pair(ln, true);

    if (notopt.length) {
      this.ctx.rep.error('Voicing: Each Voicing option must be a OPT=VALUE pair.');
    }

    for (const { option: mode, value: valIn } of options) {
      let val: string | null = valIn;
      if (mode === 'MODE') {
        const valid = [
          '-', 'OPTIMAL', 'NONE', 'ROOT', 'COMPRESSED', 'INVERT', 'KEY', 'KEY2',
          'ROOTKEY', 'DROP2', 'DROP2KEY', 'DROP3', 'DROP3KEY', 'DROP23', 'DROP23KEY',
        ];
        if (!valid.includes(val)) {
          this.ctx.rep.error(`Valid Voicing Modes are: ${valid.join(' ')}`);
        }
        if (['-', 'NONE', 'ROOT'].includes(val)) val = null;

        // Warn if invert/compress were previously set.
        if (val && (this.invert.some((x) => x.length) || this.compress.some((x) => x))) {
          this.ctx.rep.warning('Setting both VoicingMode and Invert/Compress is not a good idea');
        }

        // When we set a voicing mode always reset this, forcing the
        // voicing code to restart its rotations.
        this.lastChord = [];
        this.voicing!.mode = val;
      } else if (mode === 'RANGE') {
        const v = stoi(this.ctx.rep, val, `VOICING RANGE ${this.name}: Arg must be a value`);
        if (v < 1 || v > 30) {
          this.ctx.rep.error(`Voicing Range: Arg out-of-range; must be 1 to 30, not '${v}'.`);
        }
        this.voicing!.range = v;
      } else if (mode === 'CENTER') {
        const v = stoi(this.ctx.rep, val, `Argument for ${this.name} VOICING CENTER must be a value.`);
        if (v < 1 || v > 12) {
          this.ctx.rep.error(`VOICING CENTER: arg out-of-range; must be 1 to 12, not '${v}'.`);
        }
        this.voicing!.center = v;
      } else if (mode === 'RMOVE') {
        const v = stoi(this.ctx.rep, val, `Argument for ${this.name} VOICING RANDOM must be a value`);
        if (v < 0 || v > 100) {
          this.ctx.rep.error(`VOICING RANDOM: arg must be 0 to 100, not ${v}`);
        }
        this.voicing!.random = v;
        this.voicing!.bcount = 0;
      } else if (mode === 'MOVE') {
        const v = stoi(this.ctx.rep, val, `Argument for ${this.name} VOICING MOVE  must be a value`);
        if (v < 0) this.ctx.rep.error(`VOICING MOVE: bar count must >= 0, not ${v}`);
        if (v > 20) this.ctx.rep.warning(`VOICING MOVE: bar count '${v}' is quite large`);
        this.voicing!.bcount = v;
        this.voicing!.random = 0;
      } else if (mode === 'DIR') {
        const v = stoi(this.ctx.rep, val, `Argument for ${this.name} VOICING DIR must be a value`);
        if (![1, 0, -1].includes(v)) {
          this.ctx.rep.error(`VOICING MOVE: Dir must be -1, 0 or 1, not '${v}'.`);
        }
        this.voicing!.dir = v;
      } else {
        this.ctx.rep.error(`Voicing does not have a '${mode}' option`);
      }
    }

    const v = this.voicing!;
    this.ctx.dPrint(
      `Set ${this.name} Voicing MODE=${v.mode} RANGE=${v.range} CENTER=${v.center} ` +
        `RMOVE=${v.random} MOVE=${v.bcount} DIR=${v.dir} `,
    );
  }

  /** Set/unset root duplication; only for CHORDs. */
  override setDupRoot(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} DupRoot`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: number[][] = [];
    for (const n of ln) {
      const ll: number[] = [];
      for (const v0 of n.split(',')) {
        const v = stoi(this.ctx.rep, v0, `${this.name} DupRoot: Argument must be a value, not '${v0}'.`);
        if (v < -9 || v > 9) {
          this.ctx.rep.error(`${this.name} DupRoot: '${v}' out-of-range; must be -9 to 9.`);
        }
        if (v) ll.push(v * 12);
      }
      tmp.push(ll);
    }
    this.dupRoot = this.ctx.seqBump(tmp);
    this.ctx.dPrint(`${this.name} DupRoot set to: ${this.getDupRootSetting()}`);
  }

  /** Convert the nested dupRoot list to a display string. */
  getDupRootSetting(): string {
    let ret = '';
    for (let l of this.dupRoot) {
      if (!l.length) l = [0];
      ret += `${l.map((x) => Math.floor(x / 12)).join(',')}  `;
    }
    return ret.trim();
  }

  /**
   * Parse a chord pattern group:
   * start, length, volume [, volume ...] (volumes repeat the last value).
   */
  override getPgroup(ev: string[]): ChordEvent {
    if (ev.length < 3) {
      this.ctx.rep.error(
        `There must be at least 3 items in each group of a chord pattern definition, not <${ev.join(' ')}>`,
      );
    }

    const a = new ChordEvent();
    a.offset = this.setBarOffset(ev[0]!);
    a.duration = getNoteLen(this.ctx.rep, this.ctx.noteLenTable, ev[1]!);

    const vv = ev.slice(2);
    if (vv.length > 8) {
      this.ctx.rep.error(`Only 8 volumes are permitted in Chord definition, not ${vv.length}`);
    }

    a.vol = new Array(8).fill(0);
    let last = 0;
    for (let i = 0; i < vv.length; i++) {
      last = stoi(this.ctx.rep, vv[i]!, 'Expecting integer in volume list for Chord definition');
      a.vol[i] = last;
    }
    for (let i = vv.length; i < 8; i++) a.vol[i] = last; // force remaining volumes

    return a;
  }

  override restart(): void {
    this.ssvoice = -1;
    this.lastChord = [];
  }

  /** Mangle chord notes for the voicing options. */
  chordVoicing(chord: ChordNotes, vMove: number): number {
    const vmode = this.voicing!.mode;

    if (vmode === 'OPTIMAL') {
      // Optimal voicing algorithm by Alain Brenzikofer.

      // Initialize with a voicing around centerNote.
      chord.center1(this.lastChord);

      // Adjust range and center.
      if (!(this.voicing!.bcount || this.voicing!.random)) {
        chord.center2(this.voicing!.center, Math.floor(this.voicing!.range / 2));
      } else if (this.lastChord.length) {
        // Move voicing.
        if (this.arraysDiffer(this.lastChord, chord.noteList) && vMove) {
          chord.center2(this.voicing!.center, Math.floor(this.voicing!.range / 2));
          vMove = 0;

          // Update voicingCenter.
          let sum = 0;
          for (const n of chord.noteList) sum += n;
          let c = Math.floor(sum / chord.noteListLen);

          // If using random voicing move it's possible to get way off the
          // selected octave; keep the centerpoint in a tight range.
          if (this.voicing!.random) {
            if (c < -4) c = 0;
            else if (c > 4) c = 4;
          }
          this.voicing!.center = c;
        }
      }
    } else if (vmode === 'KEY') {
      chord.keycenter();
    } else if (vmode === 'KEY2') {
      chord.key2center();
    } else if (vmode === 'ROOTKEY') {
      chord.rootkey();
    } else if (vmode === 'COMPRESSED') {
      chord.compress();
    } else if (vmode === 'INVERT') {
      if (chord.rootNote < -2) chord.invert(1);
      else if (chord.rootNote > 2) chord.invert(-1);
      chord.compress();
    } else if (vmode === 'DROP2') {
      chord.drop2();
    } else if (vmode === 'DROP2KEY') {
      chord.drop2key();
    } else if (vmode === 'DROP3') {
      chord.drop3();
    } else if (vmode === 'DROP3KEY') {
      chord.drop3key();
    } else if (vmode === 'DROP23') {
      chord.drop23();
    } else if (vmode === 'DROP23KEY') {
      chord.drop23key();
    }

    this.lastChord = [...chord.noteList];

    return vMove;
  }

  private arraysDiffer(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
    return false;
  }

  /** Do a chord bar. Called from bar(). */
  override trackBar(pattern: Pattern, ctable: CTable[]): void {
    const sc = this.seq;

    // Set voicing move ONCE at the top of each bar; the voicing code resets
    // vmove to 0 the first time it's used, so only one movement per bar.
    let vmove = 0;
    if (this.voicing!.random) {
      if (this.ctx.rng.randrange(100) <= this.voicing!.random) {
        vmove = this.ctx.rng.choice([-1, 1]);
      }
    } else if (this.voicing!.bcount && this.voicing!.dir) {
      vmove = this.voicing!.dir;
    }

    for (const p of pattern) {
      const ce = p as ChordEvent;
      const tb = this.getChordInPos(ce.offset, ctable)!;

      if (tb.chordZ) continue;

      const dupRoot = this.dupRoot[sc]!;

      const vmode = this.voicing!.mode;
      const vols = ce.vol.slice(0, tb.chord!.noteListLen);

      // Limit the chord notes; works even with a VOICINGMODE.
      if (this.chordLimit[0]) {
        tb.chord!.limit(this.chordLimit[0], this.chordLimit[1], this.chordLimit[2]);
      }

      // Compress into a single octave (before octave/transpose/invert);
      // ignored if a VOICINGMODE is active.
      if (this.compress[sc] && !vmode) tb.chord!.compress();

      // Do the voicing stuff.
      if (vmode) vmove = this.chordVoicing(tb.chord!, vmove);

      // Invert.
      if (this.invert[sc]!.length) {
        tb.chord!.invert(this.ctx.rng.randrange(this.invert[sc]![0]!, this.invert[sc]![1]! + 1));
      }

      // Cut the volume of one note to reduce dissonance when two adjacent
      // notes are separated by a single tone.
      const nl = tb.chord!.noteList;
      const l = nl.length;
      for (let j = 0; j < l - 1; j++) {
        const r = nl[j]!;
        for (let i = j + 1; i < l; i++) {
          if (
            [r - 1, r + 1, r - 13, r + 13].includes(nl[i]!) &&
            vols[i]! >= vols[0]!
          ) {
            vols[j] = Math.floor(vols[i]! / 2);
            break;
          }
        }
      }

      const loo: Array<[number, number]> = nl.map((n, i) => [n, vols[i]!]);

      // DupRoot adds additional root tones in different octaves.
      if (dupRoot.length) {
        const v = vols.filter((x) => x > 0);
        if (v.length) {
          const dvol = Math.trunc(Math.floor(v.reduce((s, x) => s + x, 0) / v.length) * this.harmonyVolume[sc]!);
          const root = tb.chord!.rootNote; // true root of chord
          for (const nn of dupRoot) loo.push([nn + root, dvol]);
        }
      }

      // For strum we need to know the direction; saved for the next loop.
      const sd = this.direction[sc]!;
      if (sd === 'BOTH') {
        if (this.sortDirection) this.sortDirection = 0;
        else this.sortDirection = 1;
      } else if (sd === 'DOWN') {
        this.sortDirection = 1;
      } else if (sd === 'RANDOM') {
        this.sortDirection = this.ctx.rng.randint(0, 1);
      } else {
        this.sortDirection = 0;
      }

      if (this.getStrum(sc)) {
        loo.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
        if (this.sortDirection) loo.reverse();
      }

      // Ornamentation applies to the top note only; step through the notes
      // to find a sounding note.
      let offset = ce.offset;
      if (this.ornaments.type) {
        for (;;) {
          const lo = loo.pop();
          if (!lo) break;
          if (lo[1]) {
            offset = doOrnament(this.ctx, this, [lo], this.getChordInPos(ce.offset, ctable)!.chord!.scaleList, ce);
            break;
          } else if (!loo.length) {
            break;
          }
        }
      }

      // Handle a non-ornamented chord or the remainder of an ornamented one.
      this.sendChord(loo, ce.duration, offset);

      tb.chord!.reset(); // important: other tracks share the chord object
    }

    // Adjust the voicingMove counter at the end of the bar.
    if (this.voicing!.bcount) this.voicing!.bcount -= 1;
  }
}

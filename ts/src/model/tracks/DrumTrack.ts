/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/patDrum.py - the DRUM pattern track (always MIDI channel
 * 10, tone list per sequence slot).
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
import { drumToValue, instToValue } from '../../midi/voices';
import { BaseTrack, type GrooveData } from './BaseTrack';

interface DrumGrooveData extends GrooveData {
  TONES: number[];
}

export class DrumTrack extends BaseTrack {
  constructor(ctx: MMAContext, name: string) {
    super(ctx, name, 'DRUM'); // clearSequence() sets toneList
    this.setChannel(['10']);
    if (!ctx.mtrks.track(this.channel).trackname) {
      ctx.mtrks.track(this.channel).addTrkName(0, 'Drum');
    }
  }

  /** Save special/local variables for the groove. */
  override saveGroove(gname: string): void {
    super.saveGroove(gname); // do this 1st. Creates storage.
    const g = this.grooves.get(gname) as DrumGrooveData;
    g.TONES = [...this.toneList];
  }

  /** Restore special/local variables for the groove. */
  override restoreGroove(gname: string): void {
    const g = this.grooves.get(gname) as DrumGrooveData | undefined;
    if (g) this.toneList = g.TONES;
    super.restoreGroove(gname);
  }

  override setSeqSize(): void {
    this.toneList = this.ctx.seqBump(this.toneList);
    super.setSeqSize();
  }

  override clearSequence(): void {
    // toneList must be valid before PC.clearSequence() calls setSeqSize().
    this.toneList = this.ctx.seqBump([38]);
    super.clearSequence();
  }

  /**
   * Set the tone list.  Only valid for DRUMs; ln[] is not necessarily the
   * right length.
   */
  override setTone(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} Tone`, this.ctx.seqSize, this.ctx.inAllGrooves);
    if (!ln.length) this.ctx.rep.error(`Expecting argument for ${this.name} TONE.`);
    const tmp: number[] = [];

    for (const n of ln) {
      const v = drumToValue(n);

      if (v < 0) {
        // Python's hint checks instToValue() here (a quirk); reproduced.
        const emsg = instToValue(n) >= 0 && /^[A-Za-z]/.test(n) ? `(Note: ${n} is a valid TONE name.)` : '';
        this.ctx.rep.error(`Drum Tone '${n}' not defined. ${emsg}`);
      }

      // Python applies the TONETR table keyed by tone value; the TS
      // Translator (ctx.dtable) is keyed by name, so a TONETR port must
      // store name -> value entries.  M2: TONETR itself is not ported.
      const tr = this.ctx.dtable.get(n);
      tmp.push(typeof tr === 'number' ? tr : v);
    }

    this.toneList = this.ctx.seqBump(tmp);
  }

  override restart(): void {
    this.ssvoice = -1;
  }

  /** Parse a drum pattern group: start, length, volume. */
  override getPgroup(ev: string[]): SingleVolEvent {
    if (ev.length !== 3) {
      this.ctx.rep.error(
        `There must be at exactly 3 items in each group of a drum define, not <${ev.join(' ')}>`,
      );
    }

    const a = new SingleVolEvent();
    a.offset = this.setBarOffset(ev[0]!);
    a.duration = getNoteLen(this.ctx.rep, this.ctx.noteLenTable, ev[1]!);
    a.vol = stoi(this.ctx.rep, ev[2]!, 'Type error in Drum volume');

    return a;
  }

  /** Do a drum bar. Called from bar(). */
  override trackBar(pattern: Pattern, ctable: CTable[]): void {
    const sc = this.seq;

    for (const p of pattern) {
      const tb = this.getChordInPos(p.offset, ctable)!;
      if (tb.drumZ) continue;

      this.sendNote(
        p.offset,
        this.getDur(p.duration),
        this.toneList[sc]!,
        this.adjustVolume(p.vol as number, p.offset),
      );
    }
  }
}

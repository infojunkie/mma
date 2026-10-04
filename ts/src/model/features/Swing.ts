/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the swing-mode state and timing adjustment in MMA/swing.py.
 * The module-global settings become a SwingState object held in
 * ctx.swingMode (null means "not configured", equivalent to mode == 0).
 * Swing-mode pattern adjustment happens at Define time, exactly as in
 * Python, so this module is needed by BaseTrack.defPatRiff().
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../../engine/Context';
import type { NoteLenTable } from '../NoteLen';
import type { PatternEvent } from '../PatternEvent';

/** Port of the tuple returned by MMA/swing.py gsettings(). */
export interface SwingSnapshot {
  mode: number;
  skew: string | null;
  accent1: number;
  accent2: number;
  delay1: number;
  delay2: number;
  len81: number | null;
  len82: number | null;
  noteValue: number;
}

export class SwingState {
  mode = 0;
  skew: string | null = null;
  accent1 = 1;
  accent2 = 1;
  delay1 = 0;
  delay2 = 0;
  noteValue = 8;

  /** Port of swing.gsettings(); noteLenTable 81/82 live in the context. */
  gsettings(table: NoteLenTable): SwingSnapshot {
    return {
      mode: this.mode,
      skew: this.skew,
      accent1: this.accent1,
      accent2: this.accent2,
      delay1: this.delay1,
      delay2: this.delay2,
      len81: table['81'] ?? null,
      len82: table['82'] ?? null,
      noteValue: this.noteValue,
    };
  }

  /** Port of swing.grestore(). */
  grestore(s: SwingSnapshot, table: NoteLenTable): void {
    this.mode = s.mode;
    this.skew = s.skew;
    this.accent1 = s.accent1;
    this.accent2 = s.accent2;
    this.delay1 = s.delay1;
    this.delay2 = s.delay2;
    table['81'] = s.len81;
    table['82'] = s.len82;
    this.noteValue = s.noteValue;
  }
}

/** The active swing state, or null when SwingMode has never been set. */
export function getSwing(ctx: MMAContext): SwingState | null {
  return ctx.swingMode instanceof SwingState ? ctx.swingMode : null;
}

/** The active swing state, created on first use (never null). */
export function swingState(ctx: MMAContext): SwingState {
  const cur = ctx.swingMode;
  if (cur instanceof SwingState) return cur;
  const s = new SwingState();
  ctx.swingMode = s;
  return s;
}

/** Port of swing.getBeats(). Returns [len8, len81, len82, onBeats, offBeats]. */
function getBeats(ctx: MMAContext, sw: SwingState): [number, number, number, number[], number[]] {
  const table = ctx.noteLenTable;
  let len8 = table['8']!;
  let len81 = table['81'];
  let len82 = table['82'];
  if (len81 === null || len82 === null) {
    ctx.rep.error('SwingMode: the swing note lengths (81/82) have not been set.');
  }

  let rng = Math.trunc(ctx.QperBar);
  let cnt = ctx.BperQ;

  if (sw.noteValue === 16) {
    len8 /= 2;
    len81! /= 2;
    len82! /= 2;
    rng *= 2;
    cnt /= 2;
  }

  const onBeats: number[] = [];
  const offBeats: number[] = [];
  for (let x = 0; x < rng; x++) {
    onBeats.push(x * cnt);
    offBeats.push(x * cnt + len8);
  }
  return [len8, len81!, len82!, onBeats, offBeats];
}

/** Port of swing.pattern(): adjust a pattern list for swing timing. */
export function swingPattern(ctx: MMAContext, sw: SwingState, plist: PatternEvent[], vtype: string): PatternEvent[] {
  const [len8, len81, len82, onBeats, offBeats] = getBeats(ctx, sw);

  for (const p of plist) {
    if (p.duration === len8 || (vtype === 'DRUM' && p.duration === 1)) {
      if (onBeats.includes(p.offset)) {
        if (p.duration === len8) {
          p.duration = len81;
          const adj = sw.accent1;
          if (Array.isArray(p.vol)) p.vol = p.vol.map((x) => x * adj);
          else if (p.vol !== undefined) p.vol = p.vol * adj;
          p.offset += sw.delay1;
        }
      } else if (offBeats.includes(p.offset)) {
        if (p.duration === len8) {
          p.duration = len82;
          const adj = sw.accent2;
          if (Array.isArray(p.vol)) p.vol = p.vol.map((x) => x * adj);
          else if (p.vol !== undefined) p.vol = p.vol * adj;
        }
        const i = offBeats.indexOf(p.offset);
        p.offset = onBeats[i]! + len81 + sw.delay2;
      }
    }
  }
  return plist;
}

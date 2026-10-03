/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/debug.py: the DEBUG directive and the flag state used by
 * the $_DEBUG / $_LASTDEBUG system variables.  Python kept the flags in
 * module globals; the state lives here and is owned by a Parser run.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import { opt2pair } from '../../util/Common';

export class DebugState {
  debug = false;
  showFilenames = false;
  pshow = false;
  seqshow = false;
  showrun = false;
  noWarn = false;
  showExpand = false;
  rmShow = false;
  plecShow = false;
  gvShow = false;
  chshow = false;
  noOutput = false;

  // "last set" copies, used by $_LASTDEBUG
  Ldebug = false;
  LshowFilenames = false;
  Lpshow = false;
  Lseqshow = false;
  Lshowrun = false;
  LnoWarn = false;
  LshowExpand = false;
  LrmShow = false;
  LplecShow = false;
  LgvShow = false;
  Lchshow = false;
  LnoOutput = false;

  constructor(private ctx: MMAContext) {
    const d = ctx.debug;
    this.debug = d.debug ?? false;
    this.showFilenames = d.showFilenames ?? false;
    this.pshow = d.pshow ?? false;
    this.seqshow = d.seqshow ?? false;
    this.showrun = d.showrun ?? false;
    this.showExpand = d.showExpand ?? false;
    this.rmShow = d.rmShow ?? false;
    this.debug = d.debug ?? false;
    this.apply();
  }

  /** Mirror the flags onto the context/reporter. */
  apply(): void {
    const ctx = this.ctx;
    ctx.debug.debug = this.debug;
    ctx.debug.showFilenames = this.showFilenames;
    ctx.debug.pshow = this.pshow;
    ctx.debug.seqshow = this.seqshow;
    ctx.debug.showrun = this.showrun;
    ctx.debug.showExpand = this.showExpand;
    ctx.debug.rmShow = this.rmShow;
    ctx.rep.debugEnabled = this.debug;
    ctx.rep.warningsEnabled = !this.noWarn;
  }

  flags(last: boolean): string {
    const v = last
      ? [
          this.Ldebug,
          this.LshowFilenames,
          this.Lpshow,
          this.Lseqshow,
          this.Lshowrun,
          this.LnoWarn,
          this.LshowExpand,
          this.LrmShow,
          this.LplecShow,
          this.LgvShow,
        ]
      : [
          this.debug,
          this.showFilenames,
          this.pshow,
          this.seqshow,
          this.showrun,
          this.noWarn,
          this.showExpand,
          this.rmShow,
          this.plecShow,
          this.gvShow,
        ];
    const b = (x: boolean): number => (x ? 1 : 0);
    return (
      `Debug=${b(v[0]!)}  Filenames=${b(v[1]!)} Patterns=${b(v[2]!)} ` +
      `Sequence=${b(v[3]!)} Runtime=${b(v[4]!)} Warnings=${b(!v[5]!)} Expand=${b(v[6]!)} ` +
      `Roman=${b(v[7]!)} Plectrum=${b(v[8]!)} Groove=${b(v[9]!)}`
    );
  }
}

const MSG =
  'Debug: Use MODE=On/Off where MODE is one or more of ' +
  'DEBUG, FILENAMES, PATTERNS, SEQUENCE, GROOVE, ' +
  'RUNTIME, WARNINGS, EXPAND, ROMAN or PLECTRUM.';

/** Port of debug.setDebug. */
export function setDebug(ctx: MMAContext, state: DebugState, ln: string[]): void {
  if (!ln.length) ctx.error(MSG);

  // save current flags
  state.Ldebug = state.debug;
  state.LshowFilenames = state.showFilenames;
  state.Lpshow = state.pshow;
  state.Lseqshow = state.seqshow;
  state.Lshowrun = state.showrun;
  state.LnoWarn = state.noWarn;
  state.LnoOutput = state.noOutput;
  state.LshowExpand = state.showExpand;
  state.Lchshow = state.chshow;
  state.LplecShow = state.plecShow;
  state.LrmShow = state.rmShow;
  state.LgvShow = state.gvShow;

  const [rest, opts] = opt2pair(ln, true);
  if (rest.length) ctx.error('Each debug option must be a opt=value pair.');

  for (const { option: cmd, value: valRaw } of opts) {
    let val: number;
    if (valRaw === 'ON' || valRaw === '1') val = 1;
    else if (valRaw === 'OFF' || valRaw === '0') val = 0;
    else return ctx.error(`Debug: ${cmd} needs ON, 1, OFF, or 0 arg.`);

    switch (cmd) {
      case 'DEBUG':
        state.debug = val === 1;
        if (state.debug) ctx.dPrint(`Debug=${val}.`);
        break;
      case 'FILENAMES':
        state.showFilenames = val === 1;
        if (state.debug) ctx.dPrint(`ShowFilenames=${val}.`);
        break;
      case 'PATTERNS':
        state.pshow = val === 1;
        if (state.debug) ctx.dPrint(`Pattern display=${val}.`);
        break;
      case 'SEQUENCE':
        state.seqshow = val === 1;
        if (state.debug) ctx.dPrint(`Sequence display=${val}.`);
        break;
      case 'RUNTIME':
        state.showrun = val === 1;
        if (state.debug) ctx.dPrint(`Runtime display=${val}.`);
        break;
      case 'WARNINGS':
        state.noWarn = val !== 1;
        if (state.debug) ctx.dPrint(`Warning display=${val}`);
        break;
      case 'EXPAND':
        state.showExpand = val === 1;
        if (state.debug) ctx.dPrint(`Expand display=${val}.`);
        break;
      case 'ROMAN':
        state.rmShow = val === 1;
        if (state.debug) ctx.dPrint(`Roman numeral chords/slash display=${val}`);
        break;
      case 'GROOVE':
        state.gvShow = val === 1;
        if (state.debug) ctx.dPrint(`Groove re-define display=${val}`);
        break;
      case 'PLECTRUM':
        state.plecShow = val === 1;
        if (state.debug) ctx.dPrint(`Plectrum display=${val}`);
        break;
      default:
        return ctx.error(MSG);
    }
  }

  state.apply();
}

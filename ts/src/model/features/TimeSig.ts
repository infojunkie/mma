/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the TimeSig class in MMA/timesig.py.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../../engine/Context';
import { stoi } from '../../util/Common';

const DENOMS: Record<string, number> = { '1': 0, '2': 1, '4': 2, '8': 3, '16': 4, '32': 5, '64': 6, '128': 7 };
const DENOM_NAMES = ['1', '2', '4', '8', '16', '32', '64', '128'];

export class TimeSig {
  lastsig: [number | null, number | null] = [null, null];

  constructor(private ctx: MMAContext) {}

  create(nn: number, dd: number): void {
    if (this.lastsig[0] === nn && this.lastsig[1] === dd) return;
    const cc = 48;
    const bb = 8;
    this.ctx.mtrks.meta().addTimeSig(this.ctx.tickOffset, nn, dd, cc, bb);
    this.lastsig = [nn, dd];
  }

  setSig(ln: string[]): void {
    let args = [...ln];
    if (args.length === 1) {
      const a = args[0]!.toUpperCase();
      if (a === 'COMMON') args = ['4', '4'];
      else if (a === 'CUT') args = ['2', '2'];
      else if (args[0]!.includes('/')) args = args[0]!.split('/', 2);
    }
    if (args.length !== 2) this.ctx.rep.error("TimeSig: Usage (numerator denominator) or ('cut' or 'common')");

    const nn = stoi(this.ctx.rep, args[0]!);
    if (nn < 1 || nn > 126) this.ctx.rep.error('Timesig: Numerator must be 1..126');

    const dd = DENOMS[args[1]!];
    if (dd === undefined) {
      this.ctx.rep.error(`Timesig: Denominator must be 1, 2, 4, 8, 16, 32, 64 or 128ot '${args[1]}'.`);
    }
    this.create(nn, dd);
  }

  get(): [number | null, number | null] {
    return this.lastsig;
  }

  getAscii(): string {
    if (!this.lastsig[0]) return 'Not Set';
    return `${this.lastsig[0]}/${DENOM_NAMES[this.lastsig[1]!]}`;
  }
}

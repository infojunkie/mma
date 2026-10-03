/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/volume.py - volume table and calculation.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { Reporter } from '../../engine/Errors';
import { stof } from '../../util/Common';

export function createVols(): Record<string, number> {
  return {
    OFF: 0.0, PPPP: 0.05, PPP: 0.1, PP: 0.25, P: 0.4, MP: 0.7,
    M: 1.0, MF: 1.1, F: 1.3, FF: 1.6, FFF: 1.8, FFFF: 2.0,
  };
}

/** Per-run volume state (port of the module globals in volume.py). */
export class VolumeState {
  vols = createVols();
  volume = 1.0; // vols['M']
  nextVolume: number | null = null;
  lastVolume = 1.0;
  futureVol: number[] = [];
  vTRatio = 0.6;
  vMRatio = 0.4;

  constructor(private rep: Reporter) {}

  /** Port of volume.calcVolume: mnemonic or numeric (+/-/%) adjustment. */
  calcVolume(newVal: string, old: number): number {
    // Python compiles this pattern with re.IGNORECASE.
    const m = /^(?:([-+])?([\d.]+)(%)?)$|^(?:([OFPM]+))$/i.exec(newVal);
    if (!m) this.rep.error(`Unknown volume '${newVal}'`);

    if (m[4]) {
      const mn = m[4]!.toUpperCase();
      if (!(mn in this.vols)) this.rep.error(`Unknown volume mnemonic '${mn}'`);
      return this.vols[mn]!;
    }

    const val = m[2]!;
    const pre = m[1];
    const post = m[3];

    if (pre && !post) {
      this.rep.warning(`Please use '${pre}${val}%' if you want to ${pre === '+' ? 'in' : 'de'}crease the volume`);
    }

    let v = stof(this.rep, val, `Volume expecting value, not '${val}'`) / 100;
    if (pre === '+') v = old * (1 + v);
    else if (pre === '-') v = old * (1 - v);
    else if (post === '%') v = old * v;
    return v;
  }
}

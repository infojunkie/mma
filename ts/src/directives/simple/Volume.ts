/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the global volume commands in MMA/volume.py: VOLUME,
 * ADJUSTVOLUME, CRESC, DECRESC and SWELL.  The per-track volume
 * commands live in src/directives/track/.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import { opt2pair, stof, stoi } from '../../util/Common';

/** Volume calculation shared by the track and global commands. */
export function calcVolume(ctx: MMAContext, newVal: string, old: number): number {
  // Python's calcVolumeRePat is case-insensitive; VolumeState.calcVolume
  // matches the mnemonic group in upper case only, so normalise here.
  const v = /^[ofpmOFPM]+$/.test(newVal) ? newVal.toUpperCase() : newVal;
  return ctx.volume.calcVolume(v, old);
}

/** Port of volume.setVolume (global VOLUME). */
export function setVolume(ctx: MMAContext, ln: string[]): void {
  if (ln.length !== 1) ctx.error('Use: Volume DYNAMIC');
  ctx.volume.volume = calcVolume(ctx, ln[0]!, ctx.volume.volume);
  ctx.volume.futureVol = [];
  ctx.dPrint(`Volume: ${100 * ctx.volume.volume}%`);
}

/** Port of volume.adjvolume (ADJUSTVOLUME). */
export function adjVolume(ctx: MMAContext, input: string[]): void {
  if (!input.length) ctx.error('Use: AdjustVolume DYN=RATIO [..]');

  const [notopt, opts] = opt2pair(input, true);

  if (notopt.length) ctx.error('ADJUSTVOLUME: Expecting DYNAMIC=RATIO pairs');

  for (const { option: v, value: rRaw } of opts) {
    if (v === 'RATIO') {
      const r = stof(ctx.rep, rRaw);
      if (r < 0 || r > 100) ctx.error('ADJUSTVOLUME RATIO: value must be 0 to 100');
      ctx.volume.vTRatio = r / 100;
      ctx.volume.vMRatio = 1 - ctx.volume.vTRatio;
    } else if (v in ctx.volume.vols) {
      ctx.volume.vols[v] = calcVolume(ctx, rRaw, ctx.volume.vols[v]!);
    } else {
      ctx.error(`ADJUSTVOLUME DYNAMIC: '${v}' for AdjustVolume is unknown`);
    }
  }

  ctx.dPrint(`Volume Ratio: ${ctx.volume.vTRatio * 100}% Track / ${ctx.volume.vMRatio * 100}% Master`);
  ctx.dPrint(
    `Volume table: ${Object.keys(ctx.volume.vols)
      .sort()
      .map((a) => `${a}=${Math.trunc(ctx.volume.vols[a]! * 100)}`)
      .join(' ')}`,
  );
}

/** Port of volume.fvolume - the volume list builder for (de)crescendi. */
export function fvolume(ctx: MMAContext, dir: number, startvol: number, ln: string[]): number[] {
  let destvol = calcVolume(ctx, ln[0]!, startvol);

  let bcount = stoi(ctx.rep, ln[1]!, `Type error in bar count for (De)Cresc, '${ln[1]}'`);
  if (bcount <= 0) ctx.error('Bar count for (De)Cresc must be postive');

  if (dir > 0 && destvol < startvol) ctx.warning('Cresc volume less than current setting');
  else if (dir < 0 && destvol > startvol) ctx.warning('Decresc volume greater than current setting');
  else if (destvol === startvol) ctx.warning('(De)Cresc volume equal to current setting');

  if (bcount > 1) bcount -= 1;
  const step = (destvol - startvol) / bcount;
  const volList = [startvol];
  let cur = startvol;
  for (let a = 0; a < bcount - 1; a++) {
    cur += step;
    volList.push(cur);
  }
  volList.push(destvol);
  return volList;
}

/** Port of volume.setCresc / setDecresc. */
export function setCrescendo(ctx: MMAContext, dir: number, input: string[]): void {
  ctx.volume.lastVolume = ctx.volume.volume;
  let ln = [...input];

  if (ln.length !== 2 && ln.length !== 3) {
    ctx.error('Usage: (De)Cresc [start-Dynamic] final-Dynamic bar-count');
  }
  if (ln.length === 3) {
    setVolume(ctx, [ln[0]!]);
    ln = ln.slice(1);
  }

  ctx.volume.futureVol = fvolume(ctx, dir, ctx.volume.volume, ln);
  ctx.dPrint(`Set (De)Cresc to: ${ctx.volume.futureVol.map((a) => Math.trunc(a * 100)).join(' ')}`);
}

/** Port of volume.setSwell. */
export function setSwell(ctx: MMAContext, input: string[]): void {
  ctx.volume.lastVolume = ctx.volume.volume;
  let ln = [...input];

  if (ln.length === 3) {
    setVolume(ctx, [ln[0]!]);
    ln = ln.slice(1);
  }
  if (ln.length !== 2) ctx.error('Swell expecting 2 or 3 args.');

  let count = stoi(ctx.rep, ln[1]!);
  if (count < 2) ctx.error('Swell bar count must be 2 or greater.');

  let c: number;
  let offset: number;
  if (count % 2) {
    c = (count + 1) / 2;
    offset = 1;
  } else {
    c = count / 2;
    offset = 0;
  }

  const first = fvolume(ctx, 0, ctx.volume.volume, [ln[0]!, String(c)]);
  const second = fvolume(ctx, 0, first[first.length - 1]!, [String(Math.trunc(ctx.volume.volume * 100)), String(c)]);
  ctx.volume.futureVol = first.concat(second.slice(offset));

  ctx.dPrint(`Set Swell to: ${ctx.volume.futureVol.map((a) => Math.trunc(a * 100)).join(' ')}`);
}

/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the ornament defaults in MMA/ornament.py.  Every track keeps an
 * ornaments record created by `default()`; the default type is null, which
 * disables ornamentation, so the full doOrnament() implementation is not
 * needed for ordinary songs and is left as an explicit M2 stub.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../../engine/Context';
import type { PatternEvent } from '../PatternEvent';

export interface Ornaments {
  type: string | null;
  chromatic: boolean;
  duration: number;
  pad: [number, number];
  place: string;
  volume: number;
  beats: number[];
  bars: number[];
  rskip: number;
  rvolume: [number, number];
  count: number;
  offset: number;
}

/** Port of MMA/ornament.py default(). */
export function defaultOrnaments(): Ornaments {
  return {
    type: null,
    chromatic: false,
    duration: 0.2,
    pad: [0.1, 0.1],
    place: 'ABOVE',
    volume: 0.75,
    beats: [],
    bars: [],
    rskip: 0,
    rvolume: [0, 0],
    count: 5,
    offset: 0,
  };
}

/**
 * M2 stub: MMA/ornament.py doOrnament() is not ported.  Only reachable
 * after the ORNAMENT directive sets a type, which requires the
 * (unported) parser command.
 */
export function doOrnament(
  ctx: MMAContext,
  _track: unknown,
  _nlist: Array<[number, number]>,
  _scale: number[],
  _p: PatternEvent,
): number {
  return ctx.rep.error(
    'M2: ORNAMENT playback is not ported to TypeScript yet (MMA/ornament.py doOrnament).',
  );
}

/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the PLECTRUM-only track commands in MMA/parse.py
 * (trackPlectrumTuning/Capo/FretNoise/Shape).  Python dispatched these
 * through `try: track.setPlectrumX() except AttributeError: warning(...)`;
 * here the class check is explicit.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import type { TrackApi } from '../../parse/TrackApi';
import { PlectrumTrack } from '../../model/tracks/PlectrumTrack';

function ignored(ctx: MMAContext, track: TrackApi, cmd: string, ln: string[]): void {
  ctx.warning(`${cmd}: not permitted in ${track.vtype} tracks. Arg '${ln.join(' ')}' ignored.`);
}

/** Define the number of strings and tuning for the instrument. */
export function trackPlectrumTuning(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) {
    ctx.error(`Use: ${track.name} Tuning string1 string2 string3 [stringN ...]`);
  }
  if (!(track instanceof PlectrumTrack)) {
    ignored(ctx, track, 'TUNING', ln);
    return;
  }
  track.setPlectrumTuning(ln);
}

/** Define the position of the capo (negative numbers are allowed). */
export function trackPlectrumCapo(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length || ln.length !== 1) {
    ctx.error(`Use: ${track.name} Capo N`);
  }
  if (!(track instanceof PlectrumTrack)) {
    ignored(ctx, track, 'CAPO', ln);
    return;
  }
  track.setPlectrumCapo(ln[0]!);
}

/** Define fret noise options. */
export function trackPlectrumFretNoise(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!(track instanceof PlectrumTrack)) {
    ignored(ctx, track, 'FRETNOISE', ln);
    return;
  }
  track.setPlectrumFretNoise(ln);
}

/** Define a chord shape for a stringed instrument. */
export function trackPlectrumShape(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!(track instanceof PlectrumTrack)) {
    ignored(ctx, track, 'SHAPE', ln);
    return;
  }
  track.setPlectrumShape(ln);
}

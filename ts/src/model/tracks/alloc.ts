/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/alloc.py - track allocation by base name.  The track name
 * may be just a type (BASS) or type-name (BASS-FOO); the class is chosen
 * by the part before the first '-'.
 *
 * M1 ported BASS, CHORD and DRUM; M2 adds ARPEGGIO, SCALE, WALK, MELODY
 * and SOLO.  The remaining base names are registered with stub classes
 * that raise a descriptive M2 error, so a future milestone (or plugin)
 * can replace them via registerTrackClass() without touching this table.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../../engine/Context';
import { BaseTrack } from './BaseTrack';
import { trackHooks } from './hooks';
import { ArpeggioTrack } from './ArpeggioTrack';
import { BassTrack } from './BassTrack';
import { ChordTrack } from './ChordTrack';
import { DrumTrack } from './DrumTrack';
import { Melody } from './MelodyTrack';
import { ScaleTrack } from './ScaleTrack';
import { Solo } from './SoloTrack';
import { WalkTrack } from './WalkTrack';

export type TrackCtor = new (ctx: MMAContext, name: string) => BaseTrack;

/** M2 stub track: constructs enough to fail with a clear message. */
function unportedTrack(vtype: string, source: string): TrackCtor {
  return class extends BaseTrack {
    constructor(ctx: MMAContext, name: string) {
      super(ctx, name, vtype);
      ctx.rep.error(`M2: the ${vtype} track class is not ported to TypeScript yet (MMA/${source}).`);
    }
  };
}

/**
 * Base name -> track class.  Mirrors MMA/alloc.py trkClasses; MELODY,
 * SOLO, ARIA and PLECTRUM are still M2 stubs.
 */
export const trackClasses: Record<string, TrackCtor> = {
  BASS: BassTrack,
  CHORD: ChordTrack,
  DRUM: DrumTrack,
  ARPEGGIO: ArpeggioTrack,
  SCALE: ScaleTrack,
  WALK: WalkTrack,
  MELODY: Melody,
  SOLO: Solo,
  ARIA: unportedTrack('ARIA', 'patAria.py'),
  PLECTRUM: unportedTrack('PLECTRUM', 'patPlectrum.py'),
};

/** Register (or replace) the class used for a track base name. */
export function registerTrackClass(vtype: string, ctor: TrackCtor): void {
  trackClasses[vtype.toUpperCase()] = ctor;
}

/**
 * Check the existence of a track and create it if possible.
 *
 * If `err` is set, errors out when the track cannot be created; otherwise
 * it silently returns undefined.
 */
export function trackAlloc(ctx: MMAContext, name: string, err = false): BaseTrack | undefined {
  const existing = ctx.tnames.get(name);
  if (existing) return existing;

  // Get the trackname: either a type, or type-name.
  const dash = name.indexOf('-');
  const base = dash >= 0 ? name.slice(0, dash) : name;

  const ctor = trackClasses[base];
  if (!ctor) {
    if (err) {
      ctx.rep.error(`There is no track class '${base}' for trackname '${name}'`);
    }
    return undefined;
  }

  const newtk = new ctor(ctx, name);
  ctx.tnames.set(name, newtk);

  // Update current grooves to reflect the new track.
  for (const slot of ctx.grooves.glist.keys()) newtk.saveGroove(slot);

  ctx.dPrint(`Creating new track ${name}`);

  return newtk;
}

// Wire setChShare (BaseTrack) back into this allocator without an import
// cycle (see hooks.ts).
trackHooks.trackAlloc = trackAlloc;

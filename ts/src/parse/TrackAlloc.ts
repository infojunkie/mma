/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/alloc.py for the parse layer: track allocation by base
 * name.  The track modules register their concrete classes here at
 * import time (src/model/tracks/index.ts), which keeps the parse layer
 * free of direct imports of the concrete track classes.  The table is
 * immutable configuration shared by all MMA contexts; per-run state
 * (ctx.tnames) stays on the context.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../engine/Context';
import type { BaseTrack } from '../model/tracks/BaseTrack';
import type { TrackApi } from './TrackApi';

export type TrackFactory = (ctx: MMAContext, name: string) => unknown;

const trackTypes = new Map<string, TrackFactory>();

/** Register a concrete track class under its MMA type name (BASS, CHORD...). */
export function registerTrackType(base: string, factory: TrackFactory): void {
  trackTypes.set(base.toUpperCase(), factory);
}

export function hasTrackType(base: string): boolean {
  return trackTypes.has(base.toUpperCase());
}

/**
 * Check the existence of a track and create it if possible.  With
 * err=false an unknown name silently returns so the parser can fall
 * through to chord-data handling; with err=true it is an error
 * (alloc.trackAlloc semantics).
 */
export function trackAlloc(ctx: MMAContext, name: string, err = false): BaseTrack | undefined {
  const existing = ctx.tnames.get(name);
  if (existing) return existing;

  const dash = name.indexOf('-');
  const base = dash >= 0 ? name.slice(0, dash) : name;

  const factory = trackTypes.get(base.toUpperCase());
  if (!factory) {
    if (err) ctx.error(`There is no track class '${base}' for trackname '${name}'`);
    return undefined;
  }

  const track = factory(ctx, name) as BaseTrack;
  ctx.tnames.set(name, track);

  // Update current grooves to reflect the new track.
  for (const slot of ctx.grooves.glist.keys()) {
    (track as unknown as TrackApi).saveGroove(slot);
  }

  ctx.dPrint(`Creating new track ${name}`);
  return track;
}

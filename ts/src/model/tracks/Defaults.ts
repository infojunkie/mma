/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Per-run track defaults.  Python keeps `pat.defaultDrum` /
 * `pat.defaultVoice` (set by the TWEAKS directive) and
 * `patPlectrum.plectrumReset` in module globals; module globals would
 * leak between runs in the browser, so the values live in a table keyed
 * by the owning MMAContext (one entry per run).  All values are 0/false
 * until a TWEAKS command changes them.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';

export interface TrackDefaults {
  /** MMA/pat.py defaultVoice: default voice for non-drum tracks. */
  defaultVoice: number;
  /** MMA/pat.py defaultDrum (a.k.a. defaultTone): default drumkit. */
  defaultDrum: number;
  /** MMA/patPlectrum.py plectrumReset: stop strings on groove change. */
  plectrumReset: boolean;
}

const table = new WeakMap<MMAContext, TrackDefaults>();

/** The mutable per-run track defaults for `ctx` (created on first use). */
export function trackDefaults(ctx: MMAContext): TrackDefaults {
  let d = table.get(ctx);
  if (!d) {
    d = { defaultVoice: 0, defaultDrum: 0, plectrumReset: false };
    table.set(ctx, d);
  }
  return d;
}

/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Hooks into modules that are not part of the M1 track port.  The track
 * engine (pat.py) touches several other MMA subsystems; where the port of
 * that subsystem does not exist yet the call is routed through this table
 * so the parser (or a later milestone) can wire the real implementation
 * without changing BaseTrack.
 *
 * Every default below either replicates the Python behaviour in the
 * "feature not configured" state or raises an explicit M2 error - nothing
 * is silently invented.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../../engine/Context';
import type { CTable } from '../CTable';
import type { BaseTrack } from './BaseTrack';

/**
 * One entry of an MDEFINE sequence: [bar offset (in beats), packed
 * controller bytes].  Port of the data stored by MMA/mdefine.py.
 */
export type MidiSeqItem = [number, number[]];
export type MidiSeqDef = MidiSeqItem[];

/** Runtime state of MMA/truncate.py; all-zero means "not active". */
export interface TruncateState {
  length: number;
  side: number;
}

export interface TrackHooks {
  /**
   * Port of MMA/parse.parseChordLine(): used when a track has its own
   * CHORDS data.  M2: parseCL.py is not ported yet.
   */
  parseChordLine(ctx: MMAContext, line: string[]): CTable[];
  /**
   * Port of MMA/midifuncs.doChannelInit().  With no channel-init data
   * queued (always the case until the MIDI directive port lands) this is
   * a no-op, exactly like Python.
   */
  doChannelInit(ctx: MMAContext, channel: number, name: string): void;
  /** Port of MMA/mdefine.Mdefine.get().  M2: mdefine.py not ported. */
  mdefGet(ctx: MMAContext, name: string): MidiSeqDef;
  /** Port of MMA/rpitch.doRpitch().  M2: rpitch.py not ported. */
  doRpitch(ctx: MMAContext, track: BaseTrack, offset: number, note: number): number;
  /** Port of MMA/harmony.harmonize().  M2: harmony.py not ported. */
  harmonize(ctx: MMAContext, interval: number, note: number, chord: number[]): number[];
  /** Port of MMA/truncate.py's module state. */
  truncate: TruncateState;
  /**
   * Port of MMA/alloc.trackAlloc().  Wired by tracks/alloc.ts at import
   * time to avoid a BaseTrack <-> alloc module cycle (setChShare needs
   * to be able to allocate the shared track).
   */
  trackAlloc(ctx: MMAContext, name: string, err: boolean): BaseTrack | undefined;
}

export const trackHooks: TrackHooks = {
  parseChordLine: (ctx, _line) =>
    ctx.rep.error(
      'M2: track-specific CHORDS are not ported to TypeScript yet (MMA/parseCL.py parseChordLine).',
    ),
  doChannelInit: () => {
    /* no channel-init data can exist until the MIDI directive port lands */
  },
  mdefGet: (ctx, name) =>
    ctx.rep.error(
      `M2: MIDIDEF patterns are not ported to TypeScript yet ` +
        `(MMA/mdefine.py; requested '${name}').`,
    ),
  doRpitch: (ctx, _track, _offset, _note) =>
    ctx.rep.error('M2: RPitch is not ported to TypeScript yet (MMA/rpitch.py doRpitch).'),
  harmonize: (ctx, _interval, _note, _chord) =>
    ctx.rep.error('M2: HARMONY is not ported to TypeScript yet (MMA/harmony.py harmonize).'),
  truncate: { length: 0, side: 0 },
  trackAlloc: (ctx) =>
    ctx.rep.error('Internal: the track allocator has not been wired (import model/tracks/alloc).'),
};

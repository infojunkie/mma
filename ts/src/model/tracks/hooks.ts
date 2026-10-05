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
import { harmonize } from '../features/Harmony';
import { mdefGet } from '../features/MDefine';
import { doRpitch } from '../features/Rpitch';
import type { BaseTrack } from './BaseTrack';

/**
 * One entry of an MDEFINE sequence: [bar offset (in beats), packed
 * controller bytes].  Port of the data stored by MMA/mdefine.py.
 */
export type MidiSeqItem = [number, number[]];
export type MidiSeqDef = MidiSeqItem[];

/**
 * Runtime state of MMA/truncate.py; length 0 means "not active".
 * Python's None values are represented by length 0 / count null.
 */
export interface TruncateState {
  length: number;
  side: number;
  count: number | null;
}

export interface TrackHooks {
  /**
   * Port of MMA/parse.parseChordLine(): used when a track has its own
   * CHORDS data.  M2: parseCL.py is not ported yet.
   */
  parseChordLine(ctx: MMAContext, line: string[]): CTable[];
  /**
   * Port of MMA/midifuncs.doChannelInit(): the Parser replaces this with
   * a runner that replays ChannelInit-queued commands through its track
   * table.  The default is a no-op (nothing can be queued without a
   * parser).
   */
  doChannelInit(ctx: MMAContext, channel: number, name: string): void;
  /** Port of MMA/mdefine.Mdefine.get(). */
  mdefGet(ctx: MMAContext, name: string): MidiSeqDef;
  /** Port of MMA/rpitch.doRpitch(). */
  doRpitch(ctx: MMAContext, track: BaseTrack, offset: number, note: number): number;
  /** Port of MMA/harmony.harmonize(): chord-derived harmony notes. */
  harmonize(ctx: MMAContext, hmode: string, note: number, chord: number[]): number[];
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
  mdefGet: (ctx, name) => mdefGet(ctx, name),
  doRpitch: (ctx, track, offset, note) => doRpitch(ctx, track, offset, note),
  harmonize: (ctx, hmode, note, chord) => harmonize(ctx, hmode, note, chord),
  truncate: { length: 0, side: 0, count: null },
  trackAlloc: (ctx) =>
    ctx.rep.error('Internal: the track allocator has not been wired (import model/tracks/alloc).'),
};

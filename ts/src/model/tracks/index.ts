/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Track engine public surface: the PC base class (BaseTrack), the
 * M1 ported tracks (BASS, CHORD, DRUM) and the allocator (MMA/alloc.py).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

export {
  BaseTrack,
  defaultDrum,
  defaultVoice,
  getIncDec,
  getIncDecValue,
  getRndPair,
  titleCase,
  type GrooveData,
  type MidiPending,
  type MidiPendingCmd,
  type SequenceItem,
} from './BaseTrack';
export { ChordTrack } from './ChordTrack';
export { BassTrack } from './BassTrack';
export { DrumTrack } from './DrumTrack';
export { Voicing } from './Voicing';
export { registerTrackClass, trackAlloc, trackClasses, type TrackCtor } from './alloc';
export {
  trackHooks,
  type MidiSeqDef,
  type MidiSeqItem,
  type TrackHooks,
  type TruncateState,
} from './hooks';
export { drumVolTable, voiceVolTable } from './VolTables';
export { ChordEvent, SingleVolEvent, BassEvent, PatternEvent, clonePattern, type Pattern } from '../PatternEvent';

// Register the concrete classes with the parse layer's track registry
// (see parse/TrackAlloc.ts: the track modules register themselves at
// import time).  The model keeps its own alloc.py port as well; the
// parser currently imports that one directly.
import { registerTrackType } from '../../parse/TrackAlloc';
import { trackClasses as registeredTrackClasses } from './alloc';

for (const [vtype, ctor] of Object.entries(registeredTrackClasses)) {
  registerTrackType(vtype, (ctx, name) => new ctor(ctx, name));
}

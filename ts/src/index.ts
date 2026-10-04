/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Core entry point (browser-safe: no Node builtins).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

export { MMA, type MMAConstructorConfig } from './api/MMA';
export type {
  MMAOptions,
  MIDIOptions,
  PreviewGrooveOptions,
  DumpDocsOptions,
  DebugOptions,
  DocKind,
} from './api/Options';
export type {
  ParseResult,
  MIDIResult,
  MMASource,
  Diagnostics,
  ExpandedLine,
  PatternTraceRecord,
  SequenceTraceRecord,
} from './api/Results';
export type {
  SongModel,
  BarRecord,
  TrackRecord,
  TempoRecord,
  MIDITextRecord,
  SongSettings,
} from './api/SongModel';

export { MMAError, type WarningRecord } from './engine/Errors';
export { MMA_VERSION, MMA_UPSTREAM_VERSION } from './version';

export {
  MemoryResources,
  CompositeResources,
  HttpResources,
  PrefixedResources,
  normalizeResourceId,
  type MMAResources,
} from './io/MMAResources';
export { decodeMMAText } from './io/decodeText';
export {
  GrooveDatabase,
  type GrooveDatabaseJson,
  type GrooveDatabaseLoadOptions,
  type GrooveEntry,
  type GrooveRef,
} from './groove/GrooveDatabase';

export type {
  IMMAPlugin,
  PluginContext,
  PluginTrackHandle,
  PluginChordInfo,
} from './plugin/IMMAPlugin';

export { type ChordNotes } from './model/ChordNotes';
export { type ChordDef } from './model/chordTable';

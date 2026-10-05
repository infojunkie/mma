/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Plugin contract.  Python plugins (MMA/regplug.py) are directories with
 * a plugin.py that may define run()/trackRun()/dataRun()/printUsage();
 * the browser has no filesystem or dynamic import-by-name, so plugins
 * are plain objects supplied by the host application.  The entry points
 * mirror the Python ones.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { ChordDef } from '../model/chordTable';
import type { MMAContext } from '../engine/Context';

/** Read/write access to a track for plugin code (narrow on purpose). */
export interface PluginTrackHandle {
  readonly name: string;
  readonly vtype: string;
  readonly octave: number[];
  readonly voice: number[];
  readonly volume: number[];
  setOctave(args: string[]): void;
  setVoice(args: string[]): void;
  setVolume(args: string[]): void;
}

export interface PluginChordInfo {
  name: string;
  tonic: string | null;
  chordType: string | null;
  noteList: number[];
  bnoteList: number[];
  scaleList: number[];
  rootNote: number;
  noteListLen: number;
}

export interface PluginContext {
  /** Current source file and line, for messages. */
  readonly file: string;
  readonly line: number;
  readonly tracks: ReadonlyMap<string, PluginTrackHandle>;
  readonly context: MMAContext;
  /** Look up a chord as ChordNotes would build it. */
  chord(name: string): PluginChordInfo;
  /** Define a chord type (DefChord). */
  defineChord(name: string, notes: number[], scale: number[], description?: string): void;
  /** Queue MMA command lines for execution after the current directive. */
  pushCommands(lines: string[]): void;
  /** Queue pre-tokenized lines (gbl.inpath.push equivalent). */
  pushTokens(tokens: string[][]): void;
  /** Raw value of a user macro variable (pluginUtils.getVar). */
  getVar(name: string): string | string[][];
  /** Allocate a track if it does not exist (alloc.trackAlloc(name, 0)). */
  ensureTrack(name: string): void;
  /** Access to the raw chord table. */
  readonly chordList: ReadonlyMap<string, ChordDef>;
}

export interface IMMAPlugin {
  /** Command name: `PLUGIN name` and `@Name` resolve case-insensitively. */
  name: string;
  description?: string;
  author?: string;
  synopsis?: string;
  /** Replaces printUsage() / -I help. */
  help?(): string;
  /** Simple command handler (@Name) - port of plugin run(). */
  run?(args: string[], ctx: PluginContext): void;
  /** Track command handler (TrackName @Name ...) - port of trackRun(). */
  trackRun?(track: string, args: string[], ctx: PluginContext): void;
  /** Data-line handler (@Name on a chord/data line) - port of dataRun(). */
  dataRun?(line: string[], ctx: PluginContext): string[] | void;
}

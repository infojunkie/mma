/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Options structs for the façade methods.  These are the "modifier"
 * options: each one corresponds to a CLI flag that changes how a
 * producer method runs (see the port plan's API taxonomy).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { IMMAPlugin } from '../plugin/IMMAPlugin';

export interface DebugOptions {
  /** -e: collect expanded source lines. */
  expanded?: boolean;
  /** -p: collect pattern definitions. */
  patterns?: boolean;
  /** -s: collect sequence assignments. */
  sequences?: boolean;
}

/** Options shared by all producer methods (CLI modifiers). */
export interface MMAOptions {
  /** -m: maximum bars to process (default 500). */
  maxBars?: number;
  /** -b: bar range such as "1-4,8" (labels or absolute numbers). */
  barRange?: string;
  /** -B: interpret a numeric barRange as absolute bar numbers. */
  barRangeAbsolute?: boolean;
  /** -T: only generate these tracks; all others are muted. */
  muteTracks?: string[];
  /** -S: pre-set macro variables. */
  macros?: Record<string, string>;
  /** RndSeed: deterministic random output. */
  seed?: number;
  /** -w: when false, warnings are dropped (they are still recorded). */
  warnings?: boolean;
  /** Plugins available to `PLUGIN name` / `@name` commands for this run. */
  plugins?: IMMAPlugin[];
  /** -e/-p/-s: diagnostics collected into the result. */
  debug?: DebugOptions;
}

/** Options for the MIDI-producing methods (toMIDI, previewGroove). */
export interface MIDIOptions extends MMAOptions {
  /** -M: SMF file type (0 or 1). */
  format?: 0 | 1;
  /** -xNOCREDIT: omit the MMA credit meta text. */
  noCredit?: boolean;
  /** -xTSPLIT / -xCSPLIT: split output into per-track/per-channel files. */
  splitOutput?: 'tracks' | 'channels';
  /** -0: sync tone (note on/off) at the start of every channel track. */
  syncAtStart?: boolean;
  /** -1: all-notes-off at the end of every channel track. */
  syncAtEnd?: boolean;
  /** Custom sync tone for syncAtStart (default note 60 / velocity 100). */
  syncTone?: { note: number; velocity: number };
  /** -L: report the order of bars processed. */
  barOrder?: boolean;
}

export interface PreviewGrooveOptions extends MIDIOptions {
  /** -V CHORDS=...: comma separated chord progression. */
  chords?: string;
  /** -V COUNT=...: number of bars to generate. */
  count?: number;
  /** Additional `Name Value` commands inserted after the Groove command. */
  commands?: string[];
}

export type DocKind = 'latex' | 'html' | 'htmlGroove' | 'browser';

export interface DumpDocsOptions extends MMAOptions {
  kind: DocKind;
}

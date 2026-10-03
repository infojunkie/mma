/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Result types returned by the façade's output-producing methods.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { BasicMIDI } from 'spessasynth_core';
import type { WarningRecord } from '../engine/Errors';
import type { SongModel } from './SongModel';

export interface ExpandedLine {
  file: string;
  line: number;
  tokens: string[];
}

export interface PatternTraceRecord {
  track: string;
  vtype: string;
  name: string;
  pattern: string;
}

export interface SequenceTraceRecord {
  track: string;
  sequence: Array<string | null>;
}

export interface Diagnostics {
  expandedLines?: ExpandedLine[];
  patterns?: PatternTraceRecord[];
  sequences?: SequenceTraceRecord[];
}

export interface ParseResult {
  model: SongModel;
  warnings: WarningRecord[];
  diagnostics?: Diagnostics;
}

export interface MIDIResult extends ParseResult {
  bytes: ArrayBuffer;
  basicMIDI: BasicMIDI;
  /** -L: bar labels in the order they were processed. */
  barOrder?: string[];
}

/** The source of a run: plain text, or text with a display name. */
export type MMASource = string | { text: string; name?: string };

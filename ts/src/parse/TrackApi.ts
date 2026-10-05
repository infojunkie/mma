/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * The structural contract between the directive layer and the track
 * classes (MMA/pat.py PC and subclasses).  The concrete port lives in
 * src/model/tracks/; this interface lets the parse layer call the track
 * API without depending on the class declarations.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../engine/Context';
import type { CTable } from '../model/CTable';
import type { MidiPending } from '../model/tracks/BaseTrack';

/** View of a track used by the parser and directive handlers. */
export interface TrackApi {
  readonly name: string;
  readonly vtype: string;
  channel: number;
  sticky: boolean;
  sequence: unknown[];
  octave: number[];
  volume: number[];
  voice: number[];
  artic: number[];
  accent: Array<Array<[number, number]>>;
  chord: string[][];
  compress: number[];
  delay: number[];
  direction: string[];
  invert: Array<number[]>;
  chordLimit: [number, number, boolean];
  chordRange: number[];
  rSkip: number[];
  rSkipBeats: number[];
  rDuration: Array<[number, number]>;
  rTime: Array<[number, number]>;
  rVolume: Array<[number, number]>;
  seqRnd: boolean;
  seqRndWeight: number[];
  spanStart: number;
  spanEnd: number;
  strum: Array<[number, number] | null>;
  strumAdd: number[];
  unify: number[];
  toneList: number[];
  cVolume: number;
  mallet: number;
  malletDecay: number;
  /** Queued MIDI events applied by the track engine on the next bar. */
  midiPending: MidiPending[];

  bar(ctable: CTable[]): void;
  setSeqSize(): void;
  clearSequence(): void;
  restart(): void;
  definePattern(name: string, ln: string[], upper?: boolean): void;
  saveGroove(name: string): void;
  restoreGroove(name: string): void;
  setVolume(ln: string[]): void;
  setOctave(ln: string[]): void;
  setMOctave(ln: string[]): void;
  setVoice(ln: string[]): void;
  setTone(ln: string[]): void;
  setOn(): void;
  setOff(): void;
  setRVolume(ln: string[]): void;
  setRSkip(ln: string[]): void;
  setRDuration(ln: string[]): void;
  setRTime(ln: string[]): void;
  setDirection(ln: string[]): void;
  setScaletype(ln: string[]): void;
  setInvert(ln: string[]): void;
  setRange(ln: string[]): void;
  setCompress(ln: string[]): void;
  setVoicing(ln: string[]): void;
  setDelay(ln: string[]): void;
  setDupRoot(ln: string[]): void;
  setChords(ln: string[]): void;
  setChordLimit(ln: string[]): void;
  setStrum(ln: string[]): void;
  setStrumAdd(ln: string[]): void;
  setHarmony(ln: string[]): void;
  setHarmonyOnly(ln: string[]): void;
  setHarmonyVolume(ln: string[]): void;
  setUnify(ln: string[]): void;
  setAccent(ln: string[]): void;
  setArtic(ln: string[]): void;
  setMallet(ln: string[]): void;
  setMidiClear(ln: string[]): void;
  setMidiSeq(ln: string[]): void;
  setMidiVoice(ln: string[]): void;
  setSticky(ln: string[]): void;
  setSpan(start: number, end: number): void;
  setChannel(ln: string[]): void;
  formatPattern(pattern: unknown): string;
  /** MELODY/SOLO only (patSolo.setDrumType). */
  setDrumType(): void;
  /** MELODY/SOLO only (patSolo.setStretch). */
  setStretch(ln: string[]): void;
  /** MELODY/SOLO only (patSolo.setArp). */
  setArp(ln: string[]): void;
  /** Define and set a riff (MELODY/SOLO keep it as a plain string). */
  setRiff(ln: string | string[]): void;
  /** Duplicate riffs from/to another track (MELODY/SOLO). */
  dupRiff(ln: string[]): void;
}

/** Typed accessor for an allocated track. */
export function getTrack(ctx: MMAContext, name: string): TrackApi {
  const track = ctx.tnames.get(name);
  if (!track) ctx.error(`Track '${name}' has not been created`);
  return track as unknown as TrackApi;
}

/**
 * Define a pattern with the Python argument shape (a text list; the
 * track layer joins it).  Keeps the string/array mismatch in one place.
 */
export function definePatternText(track: TrackApi, name: string, text: string[]): void {
  track.definePattern(name, text);
}

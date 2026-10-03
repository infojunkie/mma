/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Pattern event storage - the TypeScript equivalent of Python's bare
 * `Pgroup` class in MMA/pat.py.  Python fills a Pgroup with arbitrary
 * attributes (`offset`, `duration` and a `vol` that is a number for most
 * tracks and a list of 8 numbers for CHORD/PLECTRUM); here the common
 * fields live on a base class and each track defines a typed subclass.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

/** A compiled pattern: the Python Pgroup list used in sequences/riffs. */
export type Pattern = PatternEvent[];

export class PatternEvent {
  /** Start of the event within the bar, in MIDI ticks. */
  offset = 0;
  /** Length of the event in MIDI ticks (before artic/rduration). */
  duration = 0;
  /** Plectrum-only strum value (kept on the base for formatPattern). */
  strum?: number;
  /**
   * Event volume.  Python's Pgroup uses a single number for most tracks
   * and a list of volumes for CHORD/PLECTRUM; the base type is the union
   * and the subclasses narrow it.
   */
  vol?: number | number[];

  /**
   * Shallow copy used by SHIFT / `*` pattern modifiers.  Python uses
   * copy.deepcopy() but the modifiers only ever modify offset/duration,
   * so a shallow copy of the event object is equivalent.
   */
  clone(): this {
    return Object.assign(Object.create(Object.getPrototypeOf(this) as object), this) as this;
  }
}

/** CHORD pattern event: vol is a list of up to 8 note volumes. */
export class ChordEvent extends PatternEvent {
  override vol: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
}

/** BASS pattern event: start, length, note, volume. */
export class BassEvent extends PatternEvent {
  /** 0-based index into the chord scale list. */
  noteoffset = 0;
  /** -1 flat, 0 natural, +1 sharp. */
  accidental = 0;
  /** Octave adjustment in semitones. */
  addoctave = 0;
  override vol = 0;
}

/** Events for tracks with a single volume value (DRUM, WALK, ...). */
export class SingleVolEvent extends PatternEvent {
  override vol = 0;
}

/** Clone a pattern (list of events) preserving the concrete event class. */
export function clonePattern(pattern: PatternEvent[]): PatternEvent[] {
  return pattern.map((e) => e.clone());
}

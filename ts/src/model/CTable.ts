/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the CTable class in MMA/parseCL.py: one instance per chord in
 * the current bar, passed to every track's bar() method.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { ChordNotes } from './ChordNotes';

export class CTable {
  /** Chord name (used by the plectrum track). */
  name: string | null = null;
  /** The parsed chord notes. */
  chord: ChordNotes | null = null;
  /** Chord from the previous ctable (used by trigger()). */
  lastchord: ChordNotes | null = null;
  /** Where in the bar the chord starts (ticks, 0..). */
  chStart = 0;
  /** Where it ends (ticks). */
  chEnd = 0;
  chordZ = false;
  arpeggioZ = false;
  walkZ = false;
  drumZ = false;
  bassZ = false;
  scaleZ = false;
  ariaZ = false;
  plectrumZ = false;
}

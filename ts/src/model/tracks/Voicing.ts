/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the Voicing class in MMA/patChord.py - the CHORD-track voicing
 * state.  It lives in its own module so BaseTrack (which refers to
 * `voicing.mode` in setCompress/setInvert) can type the field without
 * importing ChordTrack.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

export class Voicing {
  mode: string | null = null;
  range = 12;
  center = 4;
  random = 0;
  percent = 0;
  bcount = 0;
  dir = 0;

  clone(): Voicing {
    const v = new Voicing();
    Object.assign(v, this);
    return v;
  }
}

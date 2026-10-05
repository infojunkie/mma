/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/readmidi.py: a whole-file Standard MIDI File reader that
 * keeps only the events MMA's MidiInc command uses - note on/off, key and
 * channel pressure, control changes, (optionally) program changes, pitch
 * bend, plus the text and lyric meta events.
 *
 * Unlike the Python original this does not walk the SMF byte stream
 * itself: spessasynth_core's BasicMIDI.fromArrayBuffer() parses the file
 * and this class normalises its event model to readmidi's observable
 * behaviour (per-channel event lists with absolute ticks in file order,
 * running status expanded, note-off as 0x8x or as 0x9x with velocity 0
 * preserved exactly, octave/velocity adjustments applied while reading).
 *
 * Original Python modules by Bob van der Poel <bob@mellowood.ca>.
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import { BasicMIDI, MIDIMessageTypes } from 'spessasynth_core';
import { decodeMMAText } from '../io/decodeText';

/**
 * One stored channel event.  `status` is the status high nibble
 * (0x80..0xe0, channel stripped) exactly like readmidi's `ev & 0xf0`;
 * `data` holds the data bytes.  Note events always have data
 * [note, velocity] (readmidi stores them as [tm, ev&0xf0, note, vel] and
 * everything else as [tm, ev&0xf0, [data...]]; a uniform shape carries
 * the same information).
 */
export interface MidiDataEvent {
  tick: number;
  status: number;
  data: number[];
}

/** readmidi.MidiData: the events and file properties MidiInc consumes. */
export class MidiData {
  // Set these before reading the file (readmidi.__init__).
  /** Skip (don't save) program-change events. */
  ignorePC = true;
  /** Octave adjustment value (should be -12, 24, ...). */
  octaveAdjust = 0;
  /** Percentage to apply to note-on velocities. */
  velocityAdjust = 100;

  /** channel (0..15) -> events, in file/track order. */
  readonly events: MidiDataEvent[][] = Array.from({ length: 16 }, () => []);
  /** [tick, text] of every 0x01 meta event. */
  readonly textEvents: Array<[number, string]> = [];
  /** [tick, text] of every 0x05 meta event. */
  readonly lyricEvents: Array<[number, string]> = [];

  // Useful things to examine after reading (readmidi attributes).
  MidiFormat = 0;
  numTracks = 0;
  beatDivision = 0;
  /** Offset of the first note in the file (0xffffff when there is none). */
  firstNote = 0xffffff;

  /**
   * Port of readmidi.MidiData.readFile: parse `bytes` and populate the
   * event lists.  `encoding` mirrors gbl.encoding for text/lyric meta
   * events (default cp1252).
   */
  readFile(bytes: ArrayBuffer | Uint8Array, encoding = 'cp1252'): void {
    const buf =
      bytes instanceof Uint8Array
        ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
        : bytes;

    let midi: BasicMIDI;
    try {
      midi = BasicMIDI.fromArrayBuffer(buf);
    } catch (e) {
      throw new Error(
        `Invalid MIDI file (${e instanceof Error ? e.message : String(e)})`,
      );
    }

    this.MidiFormat = midi.format;
    if (this.MidiFormat !== 0 && this.MidiFormat !== 1) {
      throw new Error(`MIDI file format ${this.MidiFormat} not recognized`);
    }

    this.numTracks = midi.tracks.length;
    this.beatDivision = midi.timeDivision;
    this.firstNote = 0xffffff;

    for (const track of midi.tracks) {
      for (const ev of track.events) {
        const status = ev.statusByte;
        const tick = ev.ticks;
        const data = ev.data;

        if (status >= 0x80 && status <= 0xef) {
          const type = status & 0xf0;
          const channel = status & 0x0f;

          if (type === 0x80 || type === 0x90) {
            // Note off / note on.  firstNote tracks every 0x9x event,
            // including velocity 0 (readmidi's sValue == 0x9 branch).
            if (type === 0x90 && tick < this.firstNote) this.firstNote = tick;

            let note = data[0]!;
            let vel = data[1]!;

            // Drums are channel 9 when numbered 0..15 (not 10!).
            if (this.octaveAdjust && channel !== 9) {
              note += this.octaveAdjust;
              while (note < 0) note += 12;
              while (note > 127) note -= 12;
            }

            if (type === 0x90 && this.velocityAdjust !== 100) {
              vel = Math.floor((vel * this.velocityAdjust) / 100);
              if (vel < 0) vel = 1;
              if (vel > 127) vel = 127;
            }

            this.events[channel]!.push({ tick, status: type, data: [note, vel] });
          } else if (type === 0xc0) {
            // Program change: skipped unless ignorePC is off.
            if (!this.ignorePC) {
              this.events[channel]!.push({ tick, status: type, data: [data[0]!] });
            }
          } else {
            // Key pressure (0xa0), control change (0xb0), channel
            // pressure (0xd0) and pitch bend (0xe0) keep all their bytes.
            this.events[channel]!.push({ tick, status: type, data: Array.from(data) });
          }
        } else if (status === MIDIMessageTypes.text) {
          this.textEvents.push([tick, decodeMMAText(data, encoding)]);
        } else if (status === MIDIMessageTypes.lyric) {
          this.lyricEvents.push([tick, decodeMMAText(data, encoding)]);
        }
        // All other meta, sysex and system events are skipped (readmidi
        // walks over them without saving anything).
      }
    }
  }

  /**
   * Port of readmidi.MidiData.adjustBeats: compensate for a different
   * tick/beat standard by scaling every offset (int() truncation).
   */
  adjustBeats(adjustment: number): void {
    for (const ch of this.events) {
      for (const e of ch) e.tick = Math.trunc(e.tick * adjustment);
    }
    for (const e of this.textEvents) e[0] = Math.trunc(e[0] * adjustment);
    for (const e of this.lyricEvents) e[0] = Math.trunc(e[0] * adjustment);

    this.beatDivision = Math.trunc(this.beatDivision * adjustment);
    this.firstNote = Math.trunc(this.firstNote * adjustment);
  }
}

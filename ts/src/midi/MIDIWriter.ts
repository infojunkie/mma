/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Converts the accumulated MIDIDocument into Standard MIDI File bytes
 * using spessasynth_core's BasicMIDI/MIDITrack model.  MMA's packed
 * events are unpacked into (statusByte, data) pairs; MMA's PPQ of 192
 * is preserved.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { BasicMIDI, MIDIMessage, MIDIMessageType, MIDITrack } from 'spessasynth_core';
import { BperQ } from '../model/NoteLen';
import { MIDIDocument } from './MIDIDocument';

export interface MIDIWriteOptions {
  format: 0 | 1;
  /** Track name for the conductor/meta track ('' when unset). */
  metaName?: string;
}

export interface WrittenMIDI {
  bytes: ArrayBuffer;
  basicMIDI: BasicMIDI;
}

/** Write one merged MIDI file (no split modes) from the document. */
export function writeMIDI(doc: MIDIDocument, options: MIDIWriteOptions): WrittenMIDI {
  const format = options.format;

  // Channels with at least one event, ascending; 0 (meta) first.
  let keys = [...doc.tracks.keys()].filter((ch) => (doc.tracks.get(ch)?.miditrk.size ?? 0) > 0).sort((a, b) => a - b);

  // Port of writeTracks: format 0 merges every track into the meta track.
  if (format === 0) {
    const track0 = doc.track(0);
    for (const n of keys) {
      if (n === 0) continue;
      const other = doc.tracks.get(n)!;
      for (const [tick, events] of other.miditrk) {
        const at = track0.miditrk.get(tick);
        if (at) at.push(...events);
        else track0.miditrk.set(tick, [...events]);
      }
    }
    keys = [0];
  }

  const midi = new BasicMIDI();
  midi.timeDivision = BperQ;
  midi.format = format as BasicMIDI['format'];
  midi.tracks = keys.map((ch, index) => {
    const source = doc.tracks.get(ch)!;
    const track = new MIDITrack();
    track.name = ch === 0 ? (options.metaName ?? source.trackname) : source.trackname;
    for (const tick of source.offsets()) {
      for (const event of source.miditrk.get(tick)!) {
        const { statusByte, data } = unpackEvent(event);
        track.pushEvent(new MIDIMessage(tick, statusByte, data));
      }
    }
    void index;
    return track;
  });

  midi.flush(false);
  return { bytes: midi.writeMIDI(), basicMIDI: midi };
}

/**
 * Split a packed MMA event into the (statusByte, data) pair expected by
 * spessasynth's MIDIMessage.  Meta events use the meta type as statusByte
 * (0xFF and the length are implicit); sysex drops the 0xF0 and length.
 */
export function unpackEvent(event: Uint8Array): { statusByte: MIDIMessageType; data: Uint8Array<ArrayBuffer> } {
  if (event[0] === 0xff) {
    const [, dataOffset] = readVarNumber(event, 2);
    return { statusByte: event[1] as MIDIMessageType, data: new Uint8Array(event.slice(dataOffset)) };
  }
  if (event[0] === 0xf0) {
    const [, dataOffset] = readVarNumber(event, 1);
    return { statusByte: 0xf0 as MIDIMessageType, data: new Uint8Array(event.slice(dataOffset)) };
  }
  return { statusByte: event[0] as MIDIMessageType, data: new Uint8Array(event.slice(1)) };
}

/** Read a MIDI variable-length number; returns [value, offset after]. */
export function readVarNumber(buf: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let i = offset;
  while (i < buf.length) {
    const b = buf[i]!;
    value = (value << 7) | (b & 0x7f);
    i++;
    if ((b & 0x80) === 0) break;
  }
  return [value, i];
}

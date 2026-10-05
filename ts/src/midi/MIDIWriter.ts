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

import { BasicMIDI, MIDIMessage, MIDIMessageType, MIDIMessageTypes, MIDITrack } from 'spessasynth_core';
import { BperQ } from '../model/NoteLen';
import { MIDIDocument, type MIDITrack as MMATrack } from './MIDIDocument';
import { encodeText } from './ByteWriter';
import { DRUM_TABLE } from './voices';

export interface MIDIWriteOptions {
  format: 0 | 1;
  /** Track name for the conductor/meta track ('' when unset). */
  metaName?: string;
}

export interface WrittenMIDI {
  bytes: ArrayBuffer;
  basicMIDI: BasicMIDI;
}

/** Write one MIDI file from the document; MIDISPLIT channels expand. */
export function writeMIDI(doc: MIDIDocument, options: MIDIWriteOptions): WrittenMIDI {
  const format = options.format;
  doc.onBeforeWrite?.(); // writeMid.createMIDI: flush pending per-track MIDI

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

  const basicTracks: MIDITrack[] = [];
  for (const ch of keys) {
    const source = doc.tracks.get(ch)!;
    // Port of writeSplitTrack: a MIDISPLIT channel becomes one track per
    // pitch (plus one for all non-note events) in a format-1 file.
    if (format === 1 && doc.splitChannels.includes(ch)) {
      basicTracks.push(...splitTrack(source));
    } else {
      basicTracks.push(
        buildTrack(source, ch === 0 ? (options.metaName ?? source.trackname) : source.trackname),
      );
    }
  }
  midi.tracks = basicTracks;

  midi.flush(false);
  return { bytes: midi.writeMIDI(), basicMIDI: midi };
}

/** Build a spessasynth track from a packed MMA track. */
function buildTrack(source: MMATrack, name: string): MIDITrack {
  const track = new MIDITrack();
  track.name = name;
  for (const tick of source.offsets()) {
    for (const event of source.miditrk.get(tick)!) {
      const { statusByte, data } = unpackEvent(event);
      track.pushEvent(new MIDIMessage(tick, statusByte, data));
    }
  }
  return track;
}

/**
 * Port of midi.writeSplitTrack(): group one channel's events by note
 * number (-1 for everything that is not a note-on/off) and build one
 * track per group, named after the drum tone or "<trackname>-<note>".
 */
function splitTrack(source: MMATrack): MIDITrack[] {
  const groups = new Map<number, Array<[number, Uint8Array]>>();
  const onEvent = 0x90 | source.channel;
  const offEvent = 0x80 | source.channel;

  for (const [offset, evs] of source.miditrk) {
    for (const ev of evs) {
      const isNote = ev.length === 3 && (ev[0] === onEvent || ev[0] === offEvent);
      const n = isNote ? ev[1]! : -1;

      const list = groups.get(n);
      if (list) list.push([offset, ev]);
      else groups.set(n, [[offset, ev]]);
    }
  }

  const out: MIDITrack[] = [];
  for (const a of [...groups.keys()].sort((x, y) => x - y)) {
    const name =
      a === -1
        ? ''
        : source.channel === 9
          ? (DRUM_TABLE[a] ?? String(a))
          : `${source.trackname}-${a}`;
    out.push(buildTrackFromEvents(groups.get(a)!, name));
  }
  return out;
}

function buildTrackFromEvents(events: Array<[number, Uint8Array]>, name: string): MIDITrack {
  const track = new MIDITrack();
  // The spessasynth writer emits deltas in array order (it does not sort
  // by tick), so the events must be tick-sorted like Python's
  // Mtrk.writeMidiTrack does.
  const sorted = [...events].sort((a, b) => a[0] - b[0]);

  // Port of Mtrk.addTrkName(): the name is a meta event at tick 0
  // (BasicMIDI.flush() derives track.name from it, not from the property
  // alone).  It goes after any tick-0 events, like the Python append.
  let i = 0;
  while (i < sorted.length && sorted[i]![0] === 0) {
    const { statusByte, data } = unpackEvent(sorted[i]![1]);
    track.pushEvent(new MIDIMessage(0, statusByte, data));
    i++;
  }
  if (name) {
    track.pushEvent(
      new MIDIMessage(0, MIDIMessageTypes.trackName, new Uint8Array(encodeText(name))),
    );
    track.name = name;
  }
  for (; i < sorted.length; i++) {
    const { statusByte, data } = unpackEvent(sorted[i]![1]);
    track.pushEvent(new MIDIMessage(sorted[i]![0], statusByte, data));
  }
  return track;
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

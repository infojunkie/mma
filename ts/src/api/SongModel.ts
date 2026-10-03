/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Public, JSON-serializable song model returned by parse()/toMIDI().
 * It is derived from the run's MMAContext and MIDIDocument and is
 * decoupled from the internal track classes.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../engine/Context';

export interface BarRecord {
  barNum: number;
  label: string;
  startTick: number;
  endTick: number;
  ticks: number;
}

export interface TrackRecord {
  name: string;
  vtype: string;
  channel: number;
  sticky: boolean;
  /** Pattern names (or null) per sequence slot. */
  sequence: Array<string | null>;
  octave: number[];
  volume: number[];
  voice: number[];
}

export interface TempoRecord {
  tick: number;
  tempo: number;
}

export interface MIDITextRecord {
  tick: number;
  kind: 'text' | 'marker' | 'lyric' | 'cue' | 'copyright' | 'trackName';
  text: string;
}

export interface SongSettings {
  seqSize: number;
  QperBar: number;
  barLen: number;
  tempo: number;
  transpose: number;
  midiFileType: 0 | 1;
  keySignature: string;
  timeSignature: string;
}

export interface SongModel {
  name: string;
  barCount: number;
  bars: BarRecord[];
  tracks: TrackRecord[];
  tempoChanges: TempoRecord[];
  midiText: MIDITextRecord[];
  settings: SongSettings;
}

/** Build the public model from a completed run. */
export function buildSongModel(ctx: MMAContext, name = ''): SongModel {
  const bars: BarRecord[] = [...ctx.barPtrs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([barNum, [label, startTick, endTick]]) => ({
      barNum,
      label,
      startTick,
      endTick,
      ticks: endTick - startTick,
    }));

  const tracks: TrackRecord[] = [...ctx.tnames.values()].map((t) => ({
    name: t.name,
    vtype: t.vtype,
    channel: t.channel,
    sticky: t.sticky,
    sequence: [...((t.sequence ?? []) as Array<unknown>)].map((s) => (s == null ? null : String(s))),
    octave: [...(t.octave ?? [])],
    volume: [...(t.volume ?? [])],
    voice: [...(t.voice ?? [])],
  }));

  const midiText: MIDITextRecord[] = [];
  const meta = ctx.mtrks.tracks.get(0);
  if (meta) {
    for (const tick of meta.offsets()) {
      for (const ev of meta.miditrk.get(tick)!) {
        if (ev[0] !== 0xff) continue;
        const kind = { 0x01: 'text', 0x06: 'marker', 0x05: 'lyric', 0x07: 'cue', 0x02: 'copyright', 0x03: 'trackName' }[
          ev[1]!
        ] as MIDITextRecord['kind'] | undefined;
        if (!kind) continue;
        let i = 2;
        let len = 0;
        while (i < ev.length && (ev[i]! & 0x80) !== 0) len = (len << 7) | (ev[i++]! & 0x7f);
        if (i < ev.length) len = (len << 7) | ev[i++]!;
        if (kind === 'trackName') continue; // internal bookkeeping
        midiText.push({ tick, kind, text: decodeBytes(ev.slice(i, i + len)) });
      }
    }
  }

  return {
    name,
    barCount: ctx.barNum,
    bars,
    tracks,
    tempoChanges: ctx.mtrks.tempoChanges.map((t) => ({ tick: t.tick, tempo: t.tempo })),
    midiText,
    settings: {
      seqSize: ctx.seqSize,
      QperBar: ctx.QperBar,
      barLen: ctx.barLen,
      tempo: ctx.tempo,
      transpose: ctx.transpose,
      midiFileType: ctx.midiFileType,
      keySignature: ctx.keySig.getKeysig(),
      timeSignature: ctx.timeSig.getAscii(),
    },
  };
}

function decodeBytes(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

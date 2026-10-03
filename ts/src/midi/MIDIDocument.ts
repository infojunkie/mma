/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the Mtrk/mtrks MIDI accumulation model in MMA/midi.py.
 * Events are stored as packed bytes keyed by absolute tick, in creation
 * order; the writer converts them to deltas and hands them to
 * spessasynth_core.  Keeping MMA's byte-level model preserves event
 * ordering, de-duplication and note-pair overlap semantics.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { Reporter } from '../engine/Errors';
import { MMARandom } from '../engine/Random';
import { getOffset } from '../util/Common';
import { concatBytes, intTo14, intTo3Byte, intToVarNumber, packBytes, encodeText } from './ByteWriter';
import { voice2tup } from './VoiceValue';

/** evType markers for addToTrack; port of midi.py's MIDI_PRG / MIDI_NOTE. */
export const MIDI_PRG = 'prg';
export const MIDI_NOTE = 'note';
export type MIDIEventType = typeof MIDI_PRG | typeof MIDI_NOTE | null;

/** Special no-tone voice value (midi.py NONETONE). */
export const NONETONE = -2;

export interface TempoChange {
  tick: number;
  tempo: number;
}

export class MIDITrack {
  /** tick -> packed events, in creation order. */
  readonly miditrk = new Map<number, Uint8Array[]>();
  readonly channel: number; // Python stores channel-1; -1 for the meta track
  trackname = '';
  private lastOffEvent: Array<number | null> = new Array(129).fill(null);
  private lastPrg = 0;
  private ipoint: number | undefined;

  constructor(
    channel: number,
    private rep: Reporter,
    private timing: { tickOffset: number },
    private rng: MMARandom | null,
    private tempoChanges: TempoChange[],
  ) {
    this.channel = channel - 1;
  }

  /** Delete duplicate events at an offset that start with the given bytes. */
  delDup(offset: number, cmd: Uint8Array): void {
    const tr = this.miditrk;
    const existing = tr.get(offset);
    if (existing) {
      const lg = cmd.length;
      tr.set(
        offset,
        existing.filter((ev) => !startsWithBytes(ev, cmd, lg)),
      );
    }
  }

  addTimeSig(offset: number, nn: number, dd: number, cc: number, bb: number): void {
    const cmd = packBytes(0xff, 0x58);
    this.delDup(offset, cmd);
    this.addToTrack(offset, packBytes(cmd, [0x04, nn, dd, cc, bb]));
  }

  addKeySig(offset: number, n: number, mi: number): void {
    const cmd = packBytes(0xff, 0x59);
    this.delDup(offset, cmd);
    this.addToTrack(offset, packBytes(cmd, [0x02, n, mi]));
  }

  addMarker(offset: number, msg: string): void {
    this.addToTrack(offset, packBytes([0xff, 0x06], intToVarNumber(encodeText(msg).length), msg));
  }

  addCopyright(offset: number, msg: string): void {
    if (offset !== 0) this.rep.error(`Copyright message must be at offset 0, not ${offset}.`);
    const ev = packBytes([0xff, 0x02], intToVarNumber(encodeText(msg).length), msg);
    this.ipoint = this.ipoint === undefined ? 0 : this.ipoint + 1;
    const tr = this.miditrk;
    const existing = tr.get(offset);
    if (existing) existing.splice(this.ipoint, 0, ev);
    else tr.set(offset, [ev]);
  }

  addText(offset: number, msg: string): void {
    this.addToTrack(offset, packBytes([0xff, 0x01], intToVarNumber(encodeText(msg).length), msg));
  }

  addLyric(offset: number, msg: string): void {
    this.addToTrack(offset, packBytes([0xff, 0x05], intToVarNumber(encodeText(msg).length), msg));
  }

  addCuePoint(offset: number, msg: string): void {
    this.addToTrack(offset, packBytes([0xff, 0x07], intToVarNumber(encodeText(msg).length), msg));
  }

  addTrkName(offset: number, msg: string): void {
    void offset; // user offset ignored, always 0
    this.trackname = msg;
    const cmd = packBytes([0xff, 0x03]);
    this.delDup(0, cmd);
    this.addToTrack(0, packBytes(cmd, intToVarNumber(encodeText(msg).length), msg));
  }

  /** Add a program change, handling extended voice values (bank MSB/LSB). */
  addProgChange(offset: number, program: number, oldprg: number): void {
    if (program === NONETONE) return;
    const [v1, lsb1, msb1] = voice2tup(oldprg);
    const [v2, lsb2, msb2] = voice2tup(program);
    if (msb1 !== msb2) this.addToTrack(offset, packBytes([0xb0 | this.channel, 0x20, msb2]));
    if (lsb1 !== lsb2) this.addToTrack(offset, packBytes([0xb0 | this.channel, 0x00, lsb2]));
    this.addToTrack(offset, packBytes([0xc0 | this.channel, v2]), MIDI_PRG);
  }

  addGlis(offset: number, v: number): void {
    if (v === 0) {
      this.addToTrack(offset, packBytes([0xb0 | this.channel, 0x41, 0x00]));
    } else {
      this.addToTrack(offset, packBytes([0xb0 | this.channel, 0x41, 0x7f]));
      this.addToTrack(offset, packBytes([0xb0 | this.channel, 0x05, v]));
    }
  }

  addWheel(offset: number, v: number): void {
    this.addToTrack(offset, packBytes(0xe0 | this.channel, intTo14(v)));
  }

  addPan(offset: number, v: number): void {
    this.addToTrack(offset, packBytes([0xb0 | this.channel, 0x0a, v]));
  }

  addCtl(offset: number, l: Uint8Array | number[]): void {
    this.addToTrack(offset, packBytes(0xb0 | this.channel, l));
  }

  /** Insert an "All Notes Off" (CC 123) - used by cutTrack(). */
  addNoteOff(offset: number): void {
    this.addToTrack(offset, packBytes([0xb0 | this.channel, 0x7b, 0]), MIDI_NOTE);
  }

  addMasterVolume(offset: number, v: number): void {
    this.addToTrack(
      offset,
      packBytes(0xf0, 0x07, 0x7f, 0x7f, 0x04, 0x01, intTo14(v), 0xf7),
    );
  }

  addChannelVol(offset: number, v: number): void {
    const tr = this.miditrk;
    const cvol = packBytes(0xb0 | this.channel, 0x07);
    for (const off of [...tr.keys()]) {
      if (off >= offset) {
        tr.set(off, tr.get(off)!.filter((e) => !startsWithBytes(e, cvol, 2)));
      }
    }
    this.addToTrack(offset, packBytes(cvol, v));
  }

  addTempo(offset: number, bpm: number): void {
    const cmd = packBytes([0xff, 0x51, 0x03]);
    this.delDup(offset, cmd);
    this.addToTrack(offset, packBytes(cmd, intTo3Byte(Math.floor(60000000 / bpm))));
    this.tempoChanges.push({ tick: offset, tempo: bpm });
  }

  /**
   * Add a note on/off pair, handling overlaps like MMA.
   * duration is in ticks.
   */
  addPairToTrack(
    boffset: number,
    startRnd: number | null,
    endRnd: number | null,
    duration: number,
    note: number,
    v: number,
    unify: boolean,
  ): void {
    let onOffset = this.getTickOffset(boffset, startRnd, endRnd);
    if (onOffset < 0) onOffset = 0;
    let offOffset = onOffset + duration;
    if (offOffset < 0) offOffset = 0;

    const onEvent = packBytes([0x90 | this.channel, note, v]);
    const offEvent = packBytes([0x90 | this.channel, note, 0]);

    let noOnFlag = false;
    const f = this.lastOffEvent[note];
    if (f !== null && f !== undefined && f >= onOffset && f <= offOffset) {
      const at = this.miditrk.get(f);
      if (at && containsBytes(at, offEvent)) {
        removeBytes(at, offEvent);
        if (!unify) this.addToTrack(onOffset, offEvent, MIDI_NOTE);
        else noOnFlag = true;
      }
    }
    if (!noOnFlag) this.addToTrack(onOffset, onEvent, MIDI_NOTE);
    this.addToTrack(offOffset, offEvent, MIDI_NOTE);
    this.lastOffEvent[note] = offOffset;
  }

  /** Add a single note on (v>0) or note off (v=0) - used by plectrum. */
  addNoteOnToTrack(boffset: number, note: number, v: number, startRnd?: number | null, endRnd?: number | null): number {
    const onOffset = this.getTickOffset(boffset, startRnd ?? null, endRnd ?? null);
    const onEvent = packBytes([0x90 | this.channel, note, v]);
    const f = this.lastOffEvent[note];
    if (f !== null && f !== undefined && f >= onOffset) {
      const offEvent = packBytes([0x90 | this.channel, note, 0]);
      const at = this.miditrk.get(f);
      if (at && containsBytes(at, offEvent)) {
        removeBytes(at, offEvent);
        if (v > 0) this.addToTrack(onOffset, offEvent, MIDI_NOTE);
      }
    }
    this.addToTrack(onOffset, onEvent, MIDI_NOTE);
    if (v === 0) this.lastOffEvent[note] = onOffset;
    return onOffset;
  }

  addToTrack(offset: number, event: Uint8Array, evType: MIDIEventType = null): void {
    if (evType === MIDI_NOTE && offset < this.lastPrg) {
      offset = this.lastPrg;
    } else if (evType === MIDI_PRG) {
      this.lastPrg = offset;
    }
    if (offset < 0) offset = 0;
    const tr = this.miditrk;
    const existing = tr.get(offset);
    if (existing) existing.push(event);
    else tr.set(offset, [event]);
  }

  getLastOffset(): number {
    let offset = 0;
    for (const a of this.miditrk.keys()) if (a > offset) offset = a;
    return offset;
  }

  /** Sorted absolute ticks with events. */
  offsets(): number[] {
    return [...this.miditrk.keys()].sort((a, b) => a - b);
  }

  private getTickOffset(boffset: number, startRnd: number | null, endRnd: number | null): number {
    if (startRnd === null || endRnd === null) {
      return getOffset(this.timing.tickOffset, boffset, null);
    }
    return getOffset(this.timing.tickOffset, boffset, this.rng, startRnd, endRnd);
  }
}

export class MIDIDocument {
  /** channel number -> track; 0 is the meta/conductor track. */
  readonly tracks = new Map<number, MIDITrack>();
  readonly tempoChanges: TempoChange[] = [];

  constructor(
    private rep: Reporter,
    private timing: { tickOffset: number },
    private rng: MMARandom | null,
  ) {}

  track(channel: number): MIDITrack {
    let t = this.tracks.get(channel);
    if (!t) {
      t = new MIDITrack(channel, this.rep, this.timing, this.rng, this.tempoChanges);
      this.tracks.set(channel, t);
    }
    return t;
  }

  meta(): MIDITrack {
    return this.track(0);
  }

  has(channel: number): boolean {
    return this.tracks.has(channel);
  }

  eventCount(): { perChannel: Array<[number, number]>; total: number } {
    const perChannel: Array<[number, number]> = [];
    let total = 0;
    for (const [ch, tr] of [...this.tracks.entries()].sort((a, b) => a[0] - b[0])) {
      let n = 0;
      for (const evs of tr.miditrk.values()) n += evs.length;
      perChannel.push([ch, n]);
      total += n;
    }
    return { perChannel, total };
  }
}

function startsWithBytes(ev: Uint8Array, cmd: Uint8Array, len: number): boolean {
  if (ev.length < len) return false;
  for (let i = 0; i < len; i++) if (ev[i] !== cmd[i]) return false;
  return true;
}

function containsBytes(list: Uint8Array[], ev: Uint8Array): boolean {
  return list.some((x) => bytesEqual(x, ev));
}

function removeBytes(list: Uint8Array[], ev: Uint8Array): void {
  const i = list.findIndex((x) => bytesEqual(x, ev));
  if (i >= 0) list.splice(i, 1);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export { concatBytes };

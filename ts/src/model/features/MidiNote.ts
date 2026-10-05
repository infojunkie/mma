/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/midinote.py - the per-track MIDINOTE command.  Raw MIDI
 * events (notes, pitch bends, controllers, channel aftertouch) are
 * written directly into the track's channel buffer, bypassing the
 * pattern engine.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import { drumToValue, ctrlToValue } from '../../midi/voices';
import { getNoteLen } from '../NoteLen';
import { opt2pair, stof, stoi } from '../../util/Common';
import type { BaseTrack } from '../tracks/BaseTrack';

const NOTE_VALUE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** Port of midinote.mopts() - option summary for debug output. */
export function midiNoteOptions(trk: BaseTrack): string {
  const a1 = trk.useticks ? 'Ticks' : 'Beats';
  const a2 = trk.tickdur ? 'Ticks' : 'Notes';
  const a3 = trk.transpose ? 'On' : 'Off';
  const a4 = trk.articulate ? 'On' : 'Off';
  return (
    `Offsets=${a1} Duration=${a2} Transpose=${a3} Articulate=${a4} ` +
    `Adjust=${trk.tadjust} Volume=${trk.vadjust * 100} Octave=${trk.oadjust}`
  );
}

/** Port of midinote.getoffset(). */
function getoffset(trk: BaseTrack, ctx: MMAContext, v: string): number {
  let offset = stof(ctx.rep, v);

  if (trk.useticks) {
    if (offset !== Math.trunc(offset)) {
      ctx.error(`MidiNote: Offset set to ticks, float '${offset}' given. Integer must be used.`);
    }
    offset += trk.tadjust;
  } else {
    if (offset < 1) {
      ctx.warning(`MidiNote: Offset ${offset} generates notes before start of current bar.`);
    }
    if (offset >= ctx.QperBar + 1) {
      ctx.warning(`MidiNote: Offset ${offset} is past end of current bar.`);
    }
    offset = (offset - 1) * ctx.BperQ;
  }

  return Math.trunc(offset);
}

/** Port of midinote.note2val(); the acctable is the key signature's. */
function note2val(trk: BaseTrack, ctx: MMAContext, acctable: Record<string, number>, orig: string): number {
  const t = [...orig];
  const n = t.shift()!;

  const base = NOTE_VALUE[n];
  if (base === undefined) ctx.error(`MidiNote: Expecting valid note name, not '${orig}'.`);
  let val = base;

  val += trk.octave[ctx.seqCount] ?? trk.octave[0] ?? 48; // add in current octave

  // Override the modifier if #, & or n is given.
  if (t.length) {
    if (t[0] === '#') {
      acctable[n] = 1;
      t.shift();
    } else if (t[0] === '&') {
      acctable[n] = -1;
      t.shift();
    } else if (t[0] === 'n') {
      acctable[n] = 0;
      t.shift();
    }
  }

  val += acctable[n] ?? 0;

  // Adjust for octave - or +.
  while (t.length && (t[0] === '-' || t[0] === '+')) {
    if (t[0] === '+') val += 12;
    else val -= 12;
    t.shift();
  }

  if (t.length) {
    ctx.error(`MidiNote: Unknown note specifier '${t.join('')}' in '${orig}'.`);
  }

  return val;
}

/** Port of midinote.insertNote(). */
function insertNote(trk: BaseTrack, ctx: MMAContext, ln: string[]): void {
  if (ln.length !== 4) {
    ctx.error(`Use: ${trk.name} MidiNote: <offset> <note> <velocity> <duration>`);
  }

  const acctable = ctx.keySig.accList; // keysig modifier, use for chord

  const offset = getoffset(trk, ctx, ln[0]!);

  // Set a flag if this is a drum track.
  const isdrum =
    trk.vtype === 'DRUM' || ((trk.vtype === 'MELODY' || trk.vtype === 'SOLO') && Boolean(trk.drumType));

  const notes: number[] = [];
  for (const n0 of ln[1]!.split(',')) {
    let n: number;
    if ('0123456789'.includes(n0[0]!)) {
      n = stoi(ctx.rep, n0);
    } else if (isdrum) {
      if (n0 === '*') {
        n =
          trk.vtype === 'MELODY' || trk.vtype === 'SOLO'
            ? trk.drumTone
            : (trk.toneList[ctx.seqCount] ?? 0);
      } else {
        n = drumToValue(n0);
        if (n < 0) ctx.error(`MidiNote: unknown drum tone '${n}' in ${trk.name}.`);
      }
    } else {
      n = note2val(trk, ctx, acctable, n0);
    }

    if (n < 0 || n > 127) {
      ctx.error(`MidiNote: Notes must be in the range 0...127, not ${n}`);
    }

    if (trk.transpose && !isdrum) {
      n += ctx.transpose;
      while (n < 0) n += 12;
      while (n > 127) n -= 12;
    }

    if (trk.oadjust && !isdrum) {
      n += trk.oadjust * 12;
      while (n < 0) n += 12;
      while (n > 127) n -= 12;
    }

    notes.push(n);
  }

  let velocity = stoi(ctx.rep, ln[2]!);

  if (velocity < 1 || velocity > 127) {
    ctx.error(`MidiNote: Note velocity must be in the range 1...127, not ${velocity}`);
  }

  velocity *= trk.vadjust;

  if (velocity < 1) velocity = 1;
  else if (velocity > 127) velocity = 127;

  velocity = Math.trunc(velocity); // trk.vadjust can be a float

  let duration: number;
  if (trk.tickdur) {
    duration = stoi(ctx.rep, ln[3]!);
  } else {
    duration = getNoteLen(ctx.rep, ctx.noteLenTable, ln[3]!);
    if (trk.articulate) {
      duration = Math.trunc((duration * (trk.artic[ctx.seqCount] ?? 100)) / 100);
      if (duration < 1) duration = 1;
    }
  }

  const channel = trk.channel;
  const track = ctx.mtrks.track(channel);

  for (const n of notes) {
    const onEvent = new Uint8Array([0x90 | (channel - 1), n, velocity]);
    const offEvent = new Uint8Array([onEvent[0]!, n, 0]);

    track.addToTrack(ctx.tickOffset + offset, onEvent);
    track.addToTrack(ctx.tickOffset + offset + duration, offEvent);
  }

  ctx.dPrint(`MidiNote Note ${trk.name}: inserted note ${notes} at offset ${offset}.`);
}

/** Port of midinote.insertPB(). */
function insertPB(trk: BaseTrack, ctx: MMAContext, ln: string[]): void {
  if (ln.length !== 2) ctx.error('MidiNote: PB expecting 2 arguments.');

  const offset = getoffset(trk, ctx, ln[0]!);
  let v = stoi(ctx.rep, ln[1]!);

  if (v < -8192 || v > 8191) {
    ctx.error(`MidiNote: PB value must be -8192..+8191, not '${v}'.`);
  }

  v += 8192; // convert to 0..16383, max 14 bit value

  const channel = trk.channel;
  ctx.mtrks
    .track(channel)
    .addToTrack(ctx.tickOffset + offset, new Uint8Array([0xe0 | (channel - 1), v % 128, Math.trunc(v / 128)]));

  ctx.dPrint(`MidiNote PB ${trk.name}: inserted bend ${v - 8192} at offset ${offset}.`);
}

/** Port of midinote.insertPBrange(). */
function insertPBrange(trk: BaseTrack, ctx: MMAContext, ln: string[]): void {
  if (ln.length !== 3) {
    ctx.error('MidiNote: PBR expecting 3 arguments <count> <start,end> <v1,v2>.');
  }

  const count = stoi(ctx.rep, ln[0]!);
  const s = ln[1]!.split(',');
  if (s.length !== 2) ctx.error(`MidiNote PBR: event range must be 'v1,v2', not '${ln[1]}'.`);
  const s1 = getoffset(trk, ctx, s[0]!);
  const s2 = getoffset(trk, ctx, s[1]!);
  const tinc = (s2 - s1) / count;

  const vv = ln[2]!.split(',');
  if (vv.length !== 2) ctx.error(`MidiNote PBR: pitch blend range must be 'v1,v2', not '${ln[2]}'.`);
  let v1 = stoi(ctx.rep, vv[0]!);
  let v2 = stoi(ctx.rep, vv[1]!);

  if (v1 < -8192 || v1 > 8191 || v2 < -8192 || v2 > 8191) {
    ctx.error(`MidiNote: PBR values must be -8192..+8191, not '${ln[2]}'.`);
  }

  v1 += 8192; // convert to 0..16383, max 14 bit value
  v2 += 8192;
  const vinc = (v2 - v1) / count;

  const channel = trk.channel;
  const track = ctx.mtrks.track(channel);
  const ev = 0xe0 | (channel - 1);

  let offset = s1;
  let bend = v1;
  for (let i = 0; i < count + 1; i++) {
    const v = Math.trunc(bend);
    track.addToTrack(ctx.tickOffset + Math.trunc(offset), new Uint8Array([ev, v % 128, Math.trunc(v / 128)]));
    offset += tinc;
    bend += vinc;
  }

  ctx.dPrint(
    `MidiNote PBR ${trk.name}: inserted bends ${v1 - 8192} to ${v2 - 8192} at offsets ${s1} to ${s2}.`,
  );
}

/** Port of midinote.insertControl(). */
function insertControl(trk: BaseTrack, ctx: MMAContext, ln: string[]): void {
  if (ln.length !== 3) ctx.error('MidiNote: Controller expecting 3 arguments.');

  const offset = getoffset(trk, ctx, ln[0]!);

  let v = ctrlToValue(ln[1]!);
  if (v < 0) {
    v = stoi(ctx.rep, ln[1]!);
    if (v < 0 || v > 0x7f) {
      ctx.error(`MidiNote: Controller values must be 0x00 to 0x7f, not '${ln[1]}'.`);
    }
  }

  const d = stoi(ctx.rep, ln[2]!);
  if (d < 0 || d > 0x7f) {
    ctx.error(`MidiNote: Control Datum value must be 0x00 to 0x7f, not '${ln[2]}'.`);
  }

  const channel = trk.channel;
  ctx.mtrks
    .track(channel)
    .addToTrack(ctx.tickOffset + offset, new Uint8Array([0xb0 | (channel - 1), v, d]));

  ctx.dPrint(`MidiNote Ctrl ${trk.name}: inserted Controller ${v} value ${d} at offset ${offset}.`);
}

/** Port of midinote.insertChTouch(). */
function insertChTouch(trk: BaseTrack, ctx: MMAContext, ln: string[]): void {
  if (ln.length !== 2) ctx.error('MidiNote: ChAT expecting 2 arguments.');

  const offset = getoffset(trk, ctx, ln[0]!);
  const v = stoi(ctx.rep, ln[1]!);

  if (v < 0 || v > 127) ctx.error(`MidiNote: ChAT value must be 0 .. 127, not '${v}'.`);

  const channel = trk.channel;
  ctx.mtrks.track(channel).addToTrack(ctx.tickOffset + offset, new Uint8Array([0xd0 | (channel - 1), v]));

  ctx.dPrint(`MidiNote ChAT ${trk.name}: inserted channel aftertouch ${v} at offset ${offset}.`);
}

/** Port of midinote.insertChTouchRange(). */
function insertChTouchRange(trk: BaseTrack, ctx: MMAContext, ln: string[]): void {
  if (ln.length !== 3) {
    ctx.error('MidiNote: ChATR expecting 3 arguments <count> <start,end> <v1,v2>.');
  }

  const count = stoi(ctx.rep, ln[0]!);
  const s = ln[1]!.split(',');
  if (s.length !== 2) ctx.error(`MidiNote ChATR: event range must be 'v1,v2', not '${ln[1]}'.`);
  const s1 = getoffset(trk, ctx, s[0]!);
  const s2 = getoffset(trk, ctx, s[1]!);
  const tinc = (s2 - s1) / count;

  const vv = ln[2]!.split(',');
  if (vv.length !== 2) ctx.error(`MidiNote ChATR: range must be 'v1,v2', not '${ln[2]}'.`);
  const v1 = stoi(ctx.rep, vv[0]!);
  const v2 = stoi(ctx.rep, vv[1]!);

  if (v1 < 0 || v1 > 127 || v2 < 0 || v2 > 127) {
    ctx.error(`MidiNote: ChATR values must be 0.. 127, not '${ln[2]}'.`);
  }

  const vinc = (v2 - v1) / count;

  const channel = trk.channel;
  const track = ctx.mtrks.track(channel);
  const ev = 0xd0 | (channel - 1);

  let offset = s1;
  let bend = v1;
  for (let i = 0; i < count + 1; i++) {
    const v = Math.trunc(bend);
    track.addToTrack(ctx.tickOffset + Math.trunc(offset), new Uint8Array([ev, v]));
    offset += tinc;
    bend += vinc;
  }

  ctx.dPrint(
    `MidiNote ChATR ${trk.name}: inserted events ${v1} to ${v2} at offsets ${s1} to ${s2}.`,
  );
}

/** Port of midinote.parse() - the track-scoped MIDINOTE command. */
export function midiNote(ctx: MMAContext, trk: BaseTrack, input: string[]): void {
  if (!input.length) ctx.error('MidiNote: Needs arguments');

  // Parse out the cmd=value option pairs.
  const [ln, opts] = opt2pair(input);

  for (const { option: o0, value: v0 } of opts) {
    const o = o0.toUpperCase();
    const v = v0.toUpperCase();
    if (o === 'TRANSPOSE') {
      if (v === '0' || v === 'OFF') trk.transpose = 0;
      else if (v === '1' || v === 'ON') trk.transpose = ctx.transpose;
      else ctx.error(`MIDINote: TRANSPOSE expecting ON or OFF, not ${v}.`);
    } else if (o === 'OFFSETS') {
      if (v === 'BEATS') trk.useticks = 0;
      else if (v === 'TICKS') trk.useticks = 1;
      else ctx.error(`MIDINote: OFFSETS expecting BEATS or TICKS, not ${v}.`);
    } else if (o === 'DURATION') {
      if (v === 'NOTES') trk.tickdur = 0;
      else if (v === 'TICKS') trk.tickdur = 1;
      else ctx.error(`MIDINote: DURATION expecting NOTES or TICKS, not ${v}.`);
    } else if (o === 'ARTICULATE') {
      // Python's ('1,' 'ON') concatenates to the string '1,ON': keep the
      // substring test to match the reference exactly.
      if ('1,ON'.includes(v)) trk.articulate = 1;
      else if (v === '0' || v === 'OFF') trk.articulate = 0;
      else ctx.error(`MIDINote: ARTICULATE expecting ON or OFF, not ${v}.`);
    } else if (o === 'OCTAVE') {
      trk.oadjust = stoi(ctx.rep, v);
      if (trk.oadjust < -4 || trk.oadjust > 4) {
        ctx.error(`MIDINote: Octave adjustment must be -4..4, not '${trk.oadjust}'.`);
      }
    } else if (o === 'VOLUME') {
      trk.vadjust = stof(ctx.rep, v) / 100;
      if (trk.vadjust <= 0) {
        ctx.error(`MIDINote: Volume % adjustment must be > 0, not '${trk.vadjust}'.`);
      }
    } else if (o === 'ADJUST') {
      trk.tadjust = stoi(ctx.rep, v);
    } else {
      ctx.error(`MIDINote: unknown option pair ${o}=${v}.`);
    }
  }

  if (ln.length) {
    // Process the rest of the stuff ... real midi events.
    trk.setForceOut();

    const a = ln[0]!.toUpperCase();
    const a0 = a[0]!;

    if ('.0123456789'.includes(a0)) {
      insertNote(trk, ctx, ln);
    } else if (a === 'NOTE') {
      insertNote(trk, ctx, ln.slice(1));
    } else if (a === 'PB') {
      insertPB(trk, ctx, ln.slice(1));
    } else if (a === 'PBR') {
      insertPBrange(trk, ctx, ln.slice(1));
    } else if (a === 'CTRL') {
      insertControl(trk, ctx, ln.slice(1));
    } else if (a === 'CHAT') {
      insertChTouch(trk, ctx, ln.slice(1));
    } else if (a === 'CHATR') {
      insertChTouchRange(trk, ctx, ln.slice(1));
    } else {
      ctx.error(`MidiNote: Unknown command '${a}'.`);
    }
  }

  if (opts.length) ctx.dPrint(`MIDINOTE: ${midiNoteOptions(trk)}`);
}

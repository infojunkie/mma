/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the non-track MIDI directives in MMA/midifuncs.py: MIDITEXT,
 * MIDITNAME, MIDIMARK, MIDICOPYRIGHT, MIDICUE, MIDIVOLUME, MIDICRESC,
 * MIDIDECRESC, CHANNELPREF, CHANNELINIT, MIDISPLIT and the raw MIDI
 * command.  MIDIFILE lives in Misc.ts and the per-track commands in
 * directives/track/Midi.ts.
 *
 * The Python module kept `channelInit` and `masterMidiVolume` as module
 * globals; here they are per-MMAContext WeakMaps so concurrent runs
 * stay independent.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import { trackAlloc } from '../../model/tracks/alloc';
import { calcMidiVolume14 } from '../../model/features/Volume';
import { packBytes } from '../../midi/ByteWriter';
import { opt2pair, stof, stoi } from '../../util/Common';

// ---------------------------------------------------------------------------
// ChannelInit storage (midifuncs.channelInit)

const channelInitStore = new WeakMap<MMAContext, Map<number, string[][]>>();

function channelMap(ctx: MMAContext): Map<number, string[][]> {
  let m = channelInitStore.get(ctx);
  if (!m) {
    m = new Map();
    channelInitStore.set(ctx, m);
  }
  return m;
}

/** Queue one ChannelInit command line for a channel. */
export function queueChannelInit(ctx: MMAContext, channel: number, ln: string[]): void {
  const m = channelMap(ctx);
  const list = m.get(channel);
  if (list) list.push(ln);
  else m.set(channel, [ln]);
}

/**
 * Port of midifuncs.doChannelInit(): return the queued commands for a
 * channel and clear the queue.  The Parser runs each returned line
 * through its track-function table.
 */
export function takeChannelInit(ctx: MMAContext, channel: number): string[][] {
  const m = channelMap(ctx);
  const list = m.get(channel) ?? [];
  m.set(channel, []);
  return list;
}

// ---------------------------------------------------------------------------
// Master volume state (midifuncs.masterMidiVolume)

const masterVolume = new WeakMap<MMAContext, number>();

/** Current 14-bit master volume; 0x3fff (device at max) until set. */
export function getMasterMidiVolume(ctx: MMAContext): number {
  return masterVolume.get(ctx) ?? 0x3fff;
}

export function setMasterMidiVolume(ctx: MMAContext, v: number): void {
  masterVolume.set(ctx, v);
}

// ---------------------------------------------------------------------------
// Meta-track commands

/** Port of midifuncs.midiMarker (MIDIMARK). */
export function midiMark(ctx: MMAContext, ln: string[]): void {
  let offset: number;
  let msg: string;

  if (ln.length >= 2) {
    offset = stof(ctx.rep, ln[0]!);
    msg = ln.slice(1).join(' ');
  } else if (ln.length === 1) {
    offset = 0;
    msg = ln[0]!;
  } else {
    ctx.error('Usage: MidiMark [offset] label1 label2 ...');
  }

  offset = Math.trunc(ctx.tickOffset + ctx.BperQ * offset);
  if (offset < 0) ctx.error('MidiMark offset points before start of file');

  ctx.metaTrack().addMarker(offset, msg);
}

/** Port of midifuncs.setMidiCue (MIDICUE). */
export function midiCue(ctx: MMAContext, ln: string[]): void {
  if (!ln.length) ctx.error('MidiCue requires text.');
  ctx.metaTrack().addCuePoint(ctx.tickOffset, ln.join(' '));
}

/** Port of midifuncs.setMidiCopyright (MIDICOPYRIGHT). */
export function midiCopyright(ctx: MMAContext, ln: string[]): void {
  if (!ln.length) ctx.error('MidiCopyright needs text message.');
  ctx.metaTrack().addCopyright(0, ln.join(' '));
}

/** Port of midifuncs.setMidiName (MIDITNAME). */
export function midiTName(ctx: MMAContext, ln: string[]): void {
  if (!ln.length) ctx.error('Use: MidiTName text');
  ctx.metaTrack().addTrkName(0, ln.join(' '));
}

/** Port of midifuncs.setMidiText (MIDITEXT). */
export function midiText(ctx: MMAContext, ln: string[]): void {
  if (!ln.length) ctx.error('Use: MidiText text');
  ctx.metaTrack().addText(ctx.tickOffset, ln.join(' '));
}

/** Port of midifuncs.rawMidi (MIDI): send hex bytes as a raw stream. */
export function rawMidi(ctx: MMAContext, ln: string[]): void {
  const mb: number[] = [];
  for (const a0 of ln) {
    const a = stoi(ctx.rep, a0);
    if (a < 0 || a > 0xff) {
      ctx.error(`All values must be in the range 0 to 0xff, not '${a}'`);
    }
    mb.push(a);
  }
  ctx.metaTrack().addToTrack(ctx.tickOffset, packBytes(mb));
  ctx.dPrint(`MIDI: Inserted raw midi in metatrack: ${mb.join(' ')}`);
}

/** Port of midifuncs.setMidiVolume (MIDIVOLUME). */
export function midiVolume(ctx: MMAContext, ln: string[]): void {
  if (ln.length !== 1) ctx.error('MidiVolume: Needs exactly one argument.');

  const v = calcMidiVolume14(ctx.volume, ctx.rep, ln[0]!);
  if (v < 0 || v > 0x3fff) {
    ctx.error('MidiVolume: Volume setting must be 0...16383.');
  }

  ctx.metaTrack().addMasterVolume(ctx.tickOffset, v);
  setMasterMidiVolume(ctx, v);
  ctx.dPrint(`MidiVolume: Master volume set to ${v}.`);
}

/** Port of midifuncs.setMidiCresc (MIDICRESC). */
export function midiCresc(ctx: MMAContext, ln: string[]): void {
  doMidiTrackCresc(ctx, ln, 1, 'MidiCresc');
}

/** Port of midifuncs.setMidiDecresc (MIDIDECRESC). */
export function midiDecresc(ctx: MMAContext, ln: string[]): void {
  doMidiTrackCresc(ctx, ln, -1, 'MidiDeCresc');
}

/** Port of midifuncs.doMidiTrackCresc(): 14-bit master volume ramp. */
function doMidiTrackCresc(ctx: MMAContext, input: string[], dir: number, func: string): void {
  let step = 10;

  let [ln, opts] = opt2pair(input, true);
  for (const { option: o, value: v } of opts) {
    if (o === 'STEP') {
      step = stoi(ctx.rep, v);
      if (step < 1) ctx.error(`${func}: Step rate must be >0.`);
    } else {
      ctx.error(`${func}: Unknow option '${o}'.`);
    }
  }

  if (ln.length !== 2 && ln.length !== 3) {
    ctx.error(`${func}: usage -  [<start>] <end> <count>`);
  }

  if (ln.length === 2) {
    // No start: insert the current master volume.
    ln = [String(getMasterMidiVolume(ctx)), ...ln];
  }

  const v1 = calcMidiVolume14(ctx.volume, ctx.rep, ln[0]!);
  if (v1 < 0 || v1 > 0x3fff) ctx.error(`${func}: Volume must be 0..16383.`);

  const v2 = calcMidiVolume14(ctx.volume, ctx.rep, ln[1]!);
  if (v2 < 0 || v2 > 0x3fff) ctx.error(`${func}: Volume must be 0..16383.`);

  const count = stof(ctx.rep, ln[2]!);
  if (count <= 0) ctx.error(`${func}: count must be >0`);

  if (dir === -1 && v1 < v2) ctx.warning(`${func}: dest volume > start`);
  else if (dir === 1 && v1 > v2) ctx.warning(`${func}: dest volume < start`);

  const ldur = Math.trunc(count * ctx.barLen);
  const start = ctx.tickOffset;
  const end = ctx.tickOffset + ldur;

  if (step > ldur) step = ldur;
  if (step < 1) ctx.error(`${func}: bar count too small.`);
  const changer = Math.floor((v2 - v1) / Math.floor(ldur / step));

  let v = v1;
  let t = 0;
  for (let d = start; d < end; d += step) {
    if (v < 0 || v > 0x3fff) break;
    ctx.metaTrack().addMasterVolume(d, v);
    v += changer;
    t += 1;
  }

  setMasterMidiVolume(ctx, v2);
  ctx.metaTrack().addMasterVolume(end, v2);

  ctx.dPrint(`MIDI(de)Cresc: Added ${t} changes`);
}

/** Port of midifuncs.setChPref (CHANNELPREF). */
export function channelPref(ctx: MMAContext, ln: string[]): void {
  if (!ln.length) ctx.error('Use: ChannelPref TRACKNAME=CHANNEL [...]');

  for (const i of ln) {
    if (!i.includes('=')) ctx.error("Each item in ChannelPref must have an '='");

    const eq = i.indexOf('=');
    const n = i.slice(0, eq);
    const cRaw = i.slice(eq + 1);

    const c = stoi(ctx.rep, cRaw, `Expecting an integer for ChannelPref, not '${cRaw}'`);
    if (c < 1 || c > 16) ctx.error(`Channel for ChannelPref must be 1..16, not ${c}`);

    ctx.midiChPrefs.set(n.toUpperCase(), c);
  }

  ctx.dPrint(
    `ChannelPref: ${[...ctx.midiChPrefs.entries()].map(([n, c]) => `${n}=${c}`).join(' ')}`,
  );
}

/**
 * Port of midifuncs.setChannelInit (CHANNELINIT).  `trackFuncExists`
 * is the parser's track-function table lookup (Python checks
 * MMA.parse.trackFuncs before queueing).
 */
export function channelInit(
  ctx: MMAContext,
  input: string[],
  trackFuncExists: (name: string) => boolean,
): void {
  let channels: number[] = [];

  const [ln, opts] = opt2pair(input);

  for (const { option, value: v } of opts) {
    if (option.toUpperCase() === 'CHANNELS') {
      for (const c of v.split(',')) {
        if (c.includes('-')) {
          const dash = c.indexOf('-');
          let c1 = stoi(ctx.rep, c.slice(0, dash));
          let c2 = stoi(ctx.rep, c.slice(dash + 1));
          if (c2 < c1) [c1, c2] = [c2, c1];
          if (c1 <= 0 || c2 > 16) {
            ctx.error(`ChannelInit: Valid channels range 1..16, not ${c1}-${c2}.`);
          }
          for (let ch = c1; ch <= c2; ch++) channels.push(ch);
        } else {
          const ch = stoi(ctx.rep, c);
          if (ch <= 0 || ch > 16) {
            ctx.error(`ChannelInit: Valid channels are 1..16, not ${ch}.`);
          }
          channels.push(ch);
        }
      }
      channels = [...new Set(channels)];
    } else {
      ctx.error(`ChannelInit: ${option} is not a valid option.`);
    }
  }

  if (!channels.length) channels = Array.from({ length: 16 }, (_, i) => i + 1);

  if (!ln.length) ctx.error('ChannelInit: A command is required.');

  ln[0] = ln[0]!.toUpperCase();
  if (!trackFuncExists(ln[0]!)) {
    ctx.error(`ChannelInit: Track function ${ln[0]} does not exist.`);
  }

  for (const c of channels) queueChannelInit(ctx, c, ln);

  ctx.dPrint(`ChannelInit: '${ln.join(' ')}' queued to channels ${channels.join(',')}`);
}

/** Port of midi.setSplitChannels (MIDISPLIT). */
export function midiSplit(ctx: MMAContext, ln: string[]): void {
  const list: number[] = [];

  for (const a of ln) {
    let ch: number | null = null;

    // Is this a legit channel number?
    try {
      ch = stoi(ctx.rep, a);
    } catch {
      ch = null;
    }

    if (ch === null) {
      // Assume track name then.
      let name = a;
      if (!ctx.tnames.has(name)) {
        name = a.toUpperCase();
        trackAlloc(ctx, name, false); // ensure that track is allocated
      }
      const tr = ctx.tnames.get(name);
      if (!tr) ctx.error(`MidiSplit: Track '${a}' is not valid.`);
      if (!tr.channel) tr.setChannel();
      ch = tr.channel;
    }

    if (ch < 1 || ch > 16) ctx.error(`MidiSplit: Expecting value 1 to 16, not ${a}`);
    if (!list.includes(ch)) list.push(ch);
  }

  ctx.mtrks.splitChannels = list;
  ctx.dPrint(`SplitChannels: ${list.join(' ')}`);
}

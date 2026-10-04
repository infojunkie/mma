/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the per-track command wrappers in MMA/parse.py.  Each function
 * validates the arguments exactly as Python did and then calls the
 * matching method on the track (MMA/pat.py PC API).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import { stoi } from '../../util/Common';
import type { TrackApi } from '../../parse/TrackApi';

export function trackVolume(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Volume DYN [...]`);
  track.setVolume(ln);
}

export function trackVoice(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Voice NN [...]`);
  track.setVoice(ln);
}

export function trackOctave(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Octave N [...], (n=0..10)`);
  track.setOctave(ln);
}

export function trackMOctave(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} MOctave N [...], (n=01..9)`);
  track.setMOctave(ln);
}

export function trackOn(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (ln.length) ctx.error(`Use: ${track.name} ON with no paramater`);
  track.setOn();
}

export function trackOff(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (ln.length) ctx.error(`Use: ${track.name} OFF with no paramater`);
  track.setOff();
}

export function trackRvolume(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} RVolume N [...]`);
  track.setRVolume(ln);
}

export function trackRskip(_ctx: MMAContext, track: TrackApi, ln: string[]): void {
  track.setRSkip(ln);
}

export function trackRtime(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Rtime N [...]`);
  track.setRTime(ln);
}

export function trackRduration(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Rduration N [...]`);
  track.setRDuration(ln);
}

export function trackArtic(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Articulation N [...]`);
  track.setArtic(ln);
}

export function trackAccent(_ctx: MMAContext, track: TrackApi, ln: string[]): void {
  track.setAccent(ln);
}

export function trackUnify(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use ${track.name} UNIFY 1 [...]`);
  track.setUnify(ln);
}

export function trackRange(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Range <value> ... `);
  track.setRange(ln);
}

export function trackCompress(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Compress <value[s]>`);
  track.setCompress(ln);
}

export function trackChordLimit(_ctx: MMAContext, track: TrackApi, ln: string[]): void {
  track.setChordLimit(ln);
}

export function trackDupRoot(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} DupRoot <value> ...`);
  track.setDupRoot(ln);
}

export function trackInvert(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Invert N [...]`);
  track.setInvert(ln);
}

export function trackVoicing(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Voicing <MODE=VALUE> [...]`);
  track.setVoicing(ln);
}

export function trackDirection(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Direction OPT`);
  track.setDirection(ln);
}

export function trackScaletype(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} ScaleType OPT`);
  track.setScaletype(ln);
}

export function trackDelay(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Delay N`);
  track.setDelay(ln);
}

export function trackStrum(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Strum N [...]`);
  track.setStrum(ln);
}

export function trackStrumAdd(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} StrumAdd N [...]`);
  track.setStrumAdd(ln);
}

export function trackHarmony(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Harmony N [...]`);
  track.setHarmony(ln);
}

export function trackHarmonyOnly(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} HarmonyOnly N [...]`);
  track.setHarmonyOnly(ln);
}

export function trackHarmonyVolume(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} HarmonyVolume N [...]`);
  track.setHarmonyVolume(ln);
}

export function trackSticky(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Sticky On/Off`);
  track.setSticky(ln);
}

export function trackChannel(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Channel`);
  track.setChannel([ln[0]!]);
}

export function trackTone(_ctx: MMAContext, track: TrackApi, ln: string[]): void {
  track.setTone(ln);
}

export function trackMallet(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Mallet <Option=Value> [...]`);
  track.setMallet(ln);
}

export function trackMidiClear(_ctx: MMAContext, track: TrackApi, ln: string[]): void {
  track.setMidiClear(ln);
}

export function trackMidiSeq(_ctx: MMAContext, track: TrackApi, ln: string[]): void {
  track.setMidiSeq(ln);
}

export function trackMidiVoice(_ctx: MMAContext, track: TrackApi, ln: string[]): void {
  track.setMidiVoice(ln);
}

export function trackChords(_ctx: MMAContext, track: TrackApi, ln: string[]): void {
  track.setChords(ln);
}

/** Port of parse.trackSpan (track NOTESPAN / Span). */
export function trackSpan(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (ln.length !== 2) ctx.error(`Use: ${track.name} Start End`);

  const start = stoi(ctx.rep, ln[0]!, 'Expecting integer for SPAN 1st arg');
  if (start < 0 || start > 127) ctx.error(`Start arg for Span must be 0..127, not ${start}`);

  const end = stoi(ctx.rep, ln[1]!, 'Expecting integer for SPAN 2nd arg');
  if (end < 0 || end > 127) ctx.error(`End arg for Span must be 0..127, not ${end}`);

  if (end <= start) ctx.error('End arg for Span must be greater than start');
  if (end - start < 11) ctx.error('Span range must be at least 12');

  track.setSpan(start, end);
}

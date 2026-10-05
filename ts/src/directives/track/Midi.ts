/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the per-track MIDI directives in MMA/midifuncs.py: MIDITEXT,
 * MIDITNAME, MIDICUE, MIDIVOLUME, MIDICRESC, MIDIDECRESC, MIDIPAN,
 * MIDIGLIS, MIDIWHEEL, MIDICLEAR, MIDISEQ, MIDIVOICE (and the inline
 * `{...}` sequence expansion those last three share), plus MIDINOTE
 * from MMA/midinote.py.
 *
 * Most of these queue events in the track's `midiPending` buffer; the
 * track engine flushes them when the next bar is generated.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import type { TrackApi } from '../../parse/TrackApi';
import type { BaseTrack } from '../../model/tracks/BaseTrack';
import { trackHooks } from '../../model/tracks/hooks';
import { midiNote } from '../../model/features/MidiNote';
import { trackMidiExt } from '../../model/features/MDefine';
import { calcMidiVolume } from '../../model/features/Volume';
import { getNoteLen } from '../../model/NoteLen';
import { opt2pair, stof, stoi, stotick } from '../../util/Common';

function bt(track: TrackApi): BaseTrack {
  return track as unknown as BaseTrack;
}

/** MIDI PAN value lookup table (midifuncs.panNames). */
const PAN_NAMES: Record<string, number> = {
  LEFT: 0, LEFT100: 0, LEFT90: 6,
  LEFT80: 13, LEFT70: 19, LEFT60: 25,
  LEFT50: 31, LEFT40: 39, LEFT30: 44,
  LEFT20: 50, LEFT10: 57, CENTER: 64,
  RIGHT10: 70, RIGHT20: 77, RIGHT30: 83,
  RIGHT40: 88, RIGHT50: 96, RIGHT60: 102,
  RIGHT70: 108, RIGHT80: 114, RIGHT90: 121,
  RIGHT100: 127, RIGHT: 127,
};

/** Port of midifuncs.trackMidiVolume (track MIDIVOLUME). */
export function trackMidiVolume(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (ln.length !== 1) ctx.error(`${track.name} MidiVolume: Needs exactly 1 arg.`);

  const v = calcMidiVolume(ctx.volume, ctx.rep, ln[0]!);
  if (v < 0 || v > 127) {
    ctx.error(`${track.name} MidiVolume: Volumes need to be 0..127, not ${v}.`);
  }

  bt(track).midiPending.push(['CVOLUME', ctx.tickOffset, v]);
  track.cVolume = v;

  ctx.dPrint(`${track.name} MIDIVolume`);
}

/** Port of midifuncs.trackMidiCresc (track MIDICRESC). */
export function trackMidiCresc(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  doMidiCresc(ctx, track, ln, 1, 'MidiCresc');
}

/** Port of midifuncs.trackMidiDecresc (track MIDIDECRESC). */
export function trackMidiDecresc(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  doMidiCresc(ctx, track, ln, -1, 'MidiDecresc');
}

/** Port of midifuncs.doMidiCresc(): 7-bit channel volume ramp. */
function doMidiCresc(ctx: MMAContext, track: TrackApi, input: string[], dir: number, func: string): void {
  const tptr = bt(track);
  let ln = [...input];

  if (ln.length !== 2 && ln.length !== 3) {
    ctx.error(`${track.name} ${func}: usage -  [<start>] <end> <count>`);
  }

  if (ln.length === 2) {
    // If passing only one param we're doing a change from the current
    // volume.  That setting might be buffered in a channelinit list or
    // in the pending queue, so force a channel, force init stuff and
    // check the pending buffer (from the end).
    if (!tptr.channel) tptr.setChannel();
    trackHooks.doChannelInit(ctx, tptr.channel, tptr.name);

    let currentVol = tptr.cVolume;
    for (let i = tptr.midiPending.length - 1; i >= 0; i--) {
      const [c, , v] = tptr.midiPending[i]!;
      if (c === 'CVOLUME') {
        currentVol = v as number;
        break;
      }
    }

    ln = [String(currentVol), ...ln];
  }

  const v1 = calcMidiVolume(ctx.volume, ctx.rep, ln[0]!);
  if (v1 < 0 || v1 > 127) {
    ctx.error(`${track.name} ${func}: Volume must be 0..127.`);
  }
  const v2 = calcMidiVolume(ctx.volume, ctx.rep, ln[1]!);
  if (v2 < 0 || v2 > 127) {
    ctx.error(`${track.name} ${func}: Volume must be 0..127.`);
  }

  const count = stof(ctx.rep, ln[2]!);
  if (count <= 0) ctx.error(`${track.name} ${func}: count must be >0`);

  if (dir === -1 && v1 < v2) ctx.warning(`${track.name} ${func}: dest volume > start`);
  else if (dir === 1 && v1 > v2) ctx.warning(`${track.name} ${func}: dest volume < start`);

  const t = Math.abs(v2 - v1);
  if (t === 0) ctx.error(`${track.name} ${func}: start and end volume are equal.`);
  const step = Math.trunc((count * ctx.barLen) / t); // step rate
  let p = ctx.tickOffset;

  const direction = v2 < v1 ? -1 : 1;

  for (let v = v1; v !== v2 + direction; v += direction) {
    tptr.midiPending.push(['CVOLUME', Math.trunc(p), v]);
    p += step;
  }

  ctx.dPrint(`${track.name} MidiVolume: Added ${t} changes`);
}

/** Port of midifuncs.trackGlis (track MIDIGLIS). */
export function trackMidiGlis(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (ln.length !== 1) ctx.error(`${track.name} MidiGlis: NN, off=0, 1..127==on`);

  const v = stoi(ctx.rep, ln[0]!, 'Expecting integer for Portamento');
  if (v < 0 || v > 127) {
    ctx.error(`MidiGlis ${track.name}: Value for Glis/Portamento must be 0..127.`);
  }

  bt(track).midiPending.push(['GLIS', ctx.tickOffset, v]);
  ctx.dPrint(`Set ${track.name} MIDIGlis to ${v}`);
}

/** Port of midifuncs.trackWheel (track MIDIWHEEL). */
export function trackMidiWheel(ctx: MMAContext, track: TrackApi, input: string[]): void {
  const tdata = bt(track);

  let startOffset: number | null = null;
  let setOnly: number | null = null;
  let duration: number | null = null;
  let startValue: number | null = null;
  let endValue: number | null = null;
  let step = 10;
  let reset = true;
  let cycle = false;
  let rate: number | null = null;

  const [ln, opts] = opt2pair(input, true);

  if (ln.length) {
    if (ln.length === 1 && ln[0] === 'RESET') {
      opts.push({ option: 'SET', value: 'CENTER' });
    } else {
      ctx.error(`${track.name} MidiWheel: Unrecognized command(s) '${ln.join(' ')}'.`);
    }
  }

  for (const { option: o, value: v } of opts) {
    if (o === 'OFFSET') {
      startOffset =
        stotick(ctx.rep, ctx, v, 'B', `MidiWheel Offset: '${v}' is not recognized.`) + ctx.tickOffset;
      if (startOffset < 0) {
        ctx.error(
          `${track.name} MidiWheel Offset: current pointer is '${ctx.tickOffset} ticks' so start ` +
            `'${startOffset} ticks' is before song start.`,
        );
      }
    } else if (o === 'DURATION' || o === 'COUNT') {
      duration = stotick(ctx.rep, ctx, v, 'B', `MidiWheel Duration: '${v}' is not recognized.`);
      if (duration <= 0) {
        ctx.error(`${track.name} MidiWheel Duration: Must be > 0, not '${duration} Ticks'.`);
      }
    } else if (o === 'SET') {
      setOnly = v === 'CENTER' ? 0x2000 : stoi(ctx.rep, v);
    } else if (o === 'START') {
      startValue = v === 'CENTER' ? 0x2000 : stoi(ctx.rep, v);
    } else if (o === 'END') {
      endValue = v === 'CENTER' ? 0x2000 : stoi(ctx.rep, v);
    } else if (o === 'STEP') {
      step = stoi(ctx.rep, v);
      if (step < 1) ctx.error(`${track.name} MidiWheel Step: must be > 0.`);
    } else if (o === 'RESET') {
      if (['NO', '0', 'OFF'].includes(v)) reset = false;
      else if (['YES', '1', 'ON'].includes(v)) reset = true;
      else ctx.error(`${track.name} MidiWheel Reset: Use ON or OFF, not '${v}'.`);
    } else if (o === 'RATE') {
      rate = getNoteLen(ctx.rep, ctx.noteLenTable, v);
    } else if (o === 'CYCLE') {
      if (['NO', '0', 'OFF'].includes(v)) cycle = false;
      else if (['YES', '1', 'ON'].includes(v)) cycle = true;
      else ctx.error(`${track.name} MidiWheel Cycle: Use ON or OFF, not '${v}'.`);
    } else {
      ctx.error(`${track.name} MidiWheel: Unrecognized command '${o}'.`);
    }
  }

  if (setOnly !== null) {
    if (opts.length > 2 || (opts.length > 1 && startOffset === null)) {
      ctx.warning(`MidiWheel ${track.name} Set: some options may be ignored.`);
    }
    if (startOffset === null) startOffset = ctx.tickOffset;
    tdata.midiPending.push(['WHEEL', startOffset, setOnly]);

    ctx.dPrint(`MidiWheel ${track.name}: detuned to ${setOnly} at ${startOffset} ticks.`);
    return;
  }

  if (startOffset === null) startOffset = ctx.tickOffset;

  if (duration === null) ctx.error(`${track.name} MidiWheel: Duration must be set.`);

  const endOffset = startOffset + duration;

  if (startValue === null || endValue === null) ctx.error(`${track.name} MidiWheel: No start/end value set.`);

  if (startValue < 0 || startValue > 16383) {
    ctx.error(`${track.name} MidiWheel: Start must be 0 ... 16383, not '${startValue}'.`);
  }
  if (endValue < 0 || endValue > 16383) {
    ctx.error(`${track.name} MidiWheel: End must be 0 ... 16383, not '${endValue}'.`);
  }

  let repeat: number;
  let ldur: number;
  if (rate === null) {
    repeat = 1;
    ldur = duration;
  } else {
    ldur = rate; // duration of each loop
    repeat = Math.floor(duration / ldur); // times to loop
  }

  const pitchspan = startValue < endValue ? endValue - startValue : startValue - endValue;

  if (step > ldur) step = ldur;
  let changer = Math.floor(pitchspan / (ldur / step));
  if (startValue > endValue) changer *= -1;

  let value = startValue;
  let off = startOffset;

  for (let r = 0; r < repeat; r++) {
    for (let d = 0; d < ldur; d += step) {
      if (value < 0) value = 0;
      if (value > 0x3fff) value = 0x3fff;

      tdata.midiPending.push(['WHEEL', Math.trunc(off + d), Math.trunc(value)]);
      value += changer;
    }
    off += ldur;
    if (cycle) changer *= -1;
    if (!cycle) value = startValue;
  }

  if (reset) tdata.midiPending.push(['WHEEL', off + 5, 0x2000]); // reset at end

  ctx.dPrint(
    `MidiWheel ${track.name}: detuned ${startValue} to ${endValue} from ${startOffset} to ` +
      `${endOffset}. ${reset ? '' : 'No RESET.'}`,
  );
}

/** Port of midifuncs.trackPan (track MIDIPAN). */
export function trackMidiPan(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  const getv = (v: string): number => {
    const hit = PAN_NAMES[v.toUpperCase()];
    if (hit !== undefined) return hit;
    return stoi(ctx.rep, v, 'Expecting integer value 0..127 or mnemonic (Left*, Center, Right*).');
  };

  const tdata = bt(track);

  if (ln.length !== 1 && ln.length !== 3) {
    ctx.error(
      `MidiPan ${track.name}: needs 1 arg [Value] OR 3 [Initvalue DestValue Beats/Measures].`,
    );
  }

  let beats: number;
  let initPan: number;
  let newPan: number;
  if (ln.length === 3) {
    beats = Math.trunc(stotick(ctx.rep, ctx, ln[2]!, 'B', `MidiPan Duration: '${ln[2]}' is not recognized.`) / ctx.BperQ);
    if (beats < 1) {
      ctx.error(
        `MidiPan ${track.name}: Beat/Measure value must be positive count, not '${beats}'.`,
      );
    }
    initPan = getv(ln[0]!);
    newPan = getv(ln[1]!);
  } else {
    beats = 0;
    initPan = 0;
    newPan = getv(ln[0]!);
  }

  const ticks = beats * ctx.BperQ; // convert beats to midi ticks

  if (newPan < 0 || newPan > 127) ctx.error('MidiPAN: final value must be 0..127');

  let span: number;
  let changer: number;
  if (newPan < initPan) {
    span = initPan - newPan;
    changer = -1;
  } else {
    span = newPan - initPan;
    changer = 1;
  }

  let step = 0;
  if (span > 0) step = ticks / span;
  else beats = 0;

  if (beats) {
    let v = initPan;
    let off = ctx.tickOffset;
    for (let a = 0; a < span + 1; a++) {
      tdata.midiPending.push(['PAN', Math.trunc(off), v]);
      off += step;
      v += changer;
    }
  } else {
    tdata.midiPending.push(['PAN', ctx.tickOffset, newPan]);
  }

  if (beats) {
    ctx.dPrint(`Set ${track.name} MIDIPan from ${initPan} to ${newPan} over ${beats} beats.`);
  } else {
    ctx.dPrint(`Set ${track.name} MIDIPan to ${newPan}`);
  }
}

/** Port of midifuncs.trackMidiText (track MIDITEXT). */
export function trackMidiText(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} Text`);

  const text = ln.join(' ');
  bt(track).midiPending.push(['MIDITEXT', ctx.tickOffset, text]);
  ctx.dPrint(`Set ${track.name} MIDIText '${text}'.`);
}

/** Port of midifuncs.trackMidiCue (track MIDICUE). */
export function trackMidiCue(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`MidiCue ${track.name}: Needs arg(s).`);

  const text = ln.join(' ');
  bt(track).midiPending.push(['MIDICUE', ctx.tickOffset, text]);
  ctx.dPrint(`Set ${track.name} MIDICue '${text}'.`);
}

/** Port of midifuncs.trackMidiName (track MIDITNAME). */
export function trackMidiTName(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use: ${track.name} MidiTName text`);

  const text = ln.join(' ');
  bt(track).midiPending.push(['TNAME', 0, text]);
  ctx.dPrint(`Set ${track.name} MIDI Track Name to ${text}`);
}

/** Port of midifuncs.trackMidiSeq (track MIDISEQ). */
export function trackMidiSeq(ctx: MMAContext, track: TrackApi, ln0: string[]): void {
  let ln = [...ln0];
  if (!ln.length) ctx.error(`Use ${track.name} MidiSeq Controller Data`);

  if (ln[0]![0] !== '{') {
    // add {} wrapper if missing
    ln = ['{', ...ln, '}'];
  }

  if (ln.length === 1 && ln[0] === '-') {
    bt(track).setMidiSeq(['-']);
  } else {
    bt(track).setMidiSeq(trackMidiExt(ctx, ln.join(' ')));
  }
}

/** Port of midifuncs.trackMidiVoice (track MIDIVOICE). */
export function trackMidiVoice(ctx: MMAContext, track: TrackApi, ln0: string[]): void {
  let ln = [...ln0];
  if (!ln.length) ctx.error(`Use ${track.name} MidiVoice Controller Data`);

  if (ln[0]![0] !== '{') {
    // add {} wrapper if missing
    ln = ['{', ...ln, '}'];
  }

  if (ln.length === 1 && ln[0] === '-') {
    bt(track).setMidiVoice(['-']);
  } else {
    bt(track).setMidiVoice(trackMidiExt(ctx, ln.join(' ')));
  }
}

/** Port of midifuncs.trackMidiClear (track MIDICLEAR). */
export function trackMidiClear(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (!ln.length) ctx.error(`Use ${track.name} MIDIClear Controller Data`);

  if (ln.length === 1 && ln[0] === '-') {
    bt(track).setMidiClear(['-']);
    return;
  }

  const s = ln.join(' ');
  if (s.includes('{') || s.includes('}')) {
    ctx.error(`{}s are not permitted in ${track.name} MIDIClear command`);
  }
  bt(track).setMidiClear(trackMidiExt(ctx, `{${s}}`));
}

/** Port of midinote.parse (track MIDINOTE). */
export function trackMidiNote(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  midiNote(ctx, bt(track), ln);
}

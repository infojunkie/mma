/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/tempo.py: TIME, TEMPO and BEATADJUST.  The CUT and
 * FERMATA commands are not part of this milestone.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import { opt2pair, stof, stotick } from '../../util/Common';
import { setChordTabs } from '../../parse/ChordLineParser';
import { formatFloat } from '../../engine/PyValue';
import { byte3ToInt, packBytes } from '../../midi/ByteWriter';

/** Port of tempo.timeTable: beats-per-bar and default tab positions. */
export const timeTable: Record<string, [number, number[]]> = {
  // duple times
  '2/2': [4, [1, 3]],
  '2/4': [2, [1, 2]],
  '6/4': [6, [1, 4]],
  '6/8': [6, [1, 4]], // needed to stay compatible with 'stdpats68'

  // triple
  '3/2': [6, [1, 3, 5]],
  '3/4': [3, [1, 2, 3]],
  '3/8': [1.5, [1, 1.5, 2]],
  '9/8': [4.5, [1, 2.5, 4]],

  // quadruple
  '4/4': [4, [1, 2, 3, 4]],
  '12/8': [6, [1, 2.5, 4, 5.5]],

  // quintuple
  '5/4': [5, [1, 2, 3, 4, 5]],
  '5/8': [2.5, [1, 1.5, 2, 2.5, 3]],

  // septuple
  '7/4': [7, [1, 2, 3, 4, 5, 6, 7]],
};

/** Port of tempo.setTime (TIME command). */
export function setTime(ctx: MMAContext, input: string[]): void {
  let tabList: number[] = [];
  let sigSet = false;

  const [ln, options] = opt2pair(input, true);

  for (const { option: cmd, value: opt } of options) {
    if (cmd === 'TABS') {
      tabList = opt.split(',').map((i) => stof(ctx.rep, i));
      const sorted = [...tabList].sort((a, b) => a - b);
      if (tabList.join(',') !== sorted.join(',')) {
        ctx.error(`Time: Tabs must be in order, not ${pyList(tabList)}.`);
      }
      if (new Set(tabList).size !== tabList.length) {
        ctx.error(`Time: Tabs must not contain duplicates, ${pyList(tabList)}`);
      }
      if (tabList[0] !== 1) ctx.error(`Time: First tab must be 1, not ${formatFloat(tabList[0]!)}.`);
    } else {
      ctx.error(`TIME: Unknown option '${cmd}'.`);
    }
  }

  if (ln.length !== 1) ctx.error('Time: Too many options. Use TIME BperBar [Tabs=xx].');

  // is this a timesig?
  let name = ln[0]!;
  const upper = name.toUpperCase();
  if (upper === 'COMMON') name = '4/4';
  else if (upper === 'CUT') name = '2/2';

  let n: number;
  if (name in timeTable) {
    const i = timeTable[name]!;
    ctx.timeSig.setSig([name]);
    n = i[0];
    if (!tabList.length) tabList = [...i[1]];
    sigSet = true;
  } else {
    if (name.includes('/')) {
      ctx.error(`Time: Unknown timesignature '${name}'. You may need to set TIME and TIMESIG separately.`);
    }
    n = stof(ctx.rep, name);
    if (n < 1 || n > 12) ctx.error('Time: Value must be 1..12.');
  }

  // If there is no change, just ignore this.
  const origTime = ctx.QperBar;
  if (origTime !== n) {
    ctx.QperBar = n;
    ctx.barLen = Math.trunc(ctx.QperBar * ctx.BperQ);

    // Time changes zap all predefined sequences.
    for (const t of ctx.tnames.values()) {
      const tr = t as unknown as { riff?: unknown[]; name: string; clearSequence(): void };
      if (tr.riff && (Array.isArray(tr.riff) ? tr.riff.length : true)) {
        ctx.warning(`Time: Change from ${String(origTime)} to ${String(n)} deleting ${tr.name} riffs.`);
        tr.riff = [];
      }
      tr.clearSequence();
    }
  }

  if (!tabList.length) {
    tabList = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].slice(0, Math.trunc(ctx.QperBar));
  }

  if ((tabList[tabList.length - 1]! - 1) * ctx.BperQ >= ctx.barLen) {
    ctx.error(
      `Time: Last tab must be < ${formatFloat(ctx.barLen / ctx.BperQ + 1)}, ` +
        `not '${formatFloat(tabList[tabList.length - 1]!)}'.`,
    );
  }

  setChordTabs(ctx, tabList);

  const sig = sigSet ? `TimeSig ${ctx.timeSig.getAscii()} ` : '';
  ctx.dPrint(`Time: Time ${ctx.QperBar} ${sig}Tabs=${tabList.map((x) => String(x)).join(',')}.`);
}

/** Port of tempo.tempo (TEMPO command). */
export function tempo(ctx: MMAContext, input: string[]): void {
  let startOffset = 0;
  let restore = 0;
  const origTempo = ctx.tempo;
  let lastChange = 0;

  const [ln, opts] = opt2pair(input, true);

  // Parse off the options.
  for (const { option: cmd, value: opt } of opts) {
    if (cmd === 'OFFSET') {
      startOffset = stotick(ctx.rep, ctx, opt, 'B', `TEMPO Offset: '${opt}' is not recognized.`);
      if (startOffset < 0) ctx.error(`TEMPO Offset: Must be => 0, not '${startOffset}'`);
    } else if (cmd === 'RESTORE') {
      restore = stotick(ctx.rep, ctx, opt, 'B', `TEMPO Restore: '${opt}' is not recognized.`) + ctx.tickOffset;
      if (restore < 0) ctx.error(`TEMPO Restore: Must be => 0, not '${restore}'`);
    } else {
      ctx.error(`Tempo '${cmd}' is an unknown command.`);
    }
  }

  if (!ln.length || ln.length > 2) ctx.error('Tempo: Use [*,+,-]BperM [BARS]');

  // Get the new value.
  const a = ln[0]![0]!;
  let v: number;
  if (a === '+' || a === '-' || a === '*') {
    v = stof(ctx.rep, ln[0]!.slice(1), `Tempo: Expecting value for rate adjustment, not '${ln[0]}'`);
    if (a === '-') v = ctx.tempo - v;
    else if (a === '+') v += ctx.tempo;
    else v *= ctx.tempo;
  } else {
    v = stof(ctx.rep, ln[0]!, `Tempo: Expecting rate, not '${ln[0]}'`);
  }

  if (v <= 1) ctx.error('Tempo: Value must be greater than 1.');

  const meta = ctx.mtrks.meta();

  if (ln.length === 1) {
    ctx.tempo = Math.trunc(v);
    meta.addTempo(ctx.tickOffset + startOffset, ctx.tempo);
    lastChange = ctx.tickOffset + startOffset;
    ctx.dPrint(`Tempo: Set to ${ctx.tempo}, offset=${startOffset / ctx.BperQ} beats`);
  } else {
    // A tempo change over a bar count.
    const numbeats =
      Math.trunc(stotick(ctx.rep, ctx, ln[1]!, 'B', `TEMPO Offset: '${ln[1]}' is not recognized.`) / ctx.BperQ);

    if (numbeats < 1) ctx.error('Tempo: Beat count must be greater than 0');

    const tincr = (v - ctx.tempo) / numbeats;
    const bstart = ctx.tickOffset + startOffset;
    let boff = 0;
    let t2 = ctx.tempo;

    for (let n = 0; n < numbeats; n++) {
      t2 += tincr;
      if (t2) meta.addTempo(bstart + boff, Math.trunc(t2));
      boff += ctx.BperQ;
    }
    if (t2 !== v) meta.addTempo(bstart + boff, Math.trunc(v));
    lastChange = bstart + boff;
    ctx.tempo = Math.trunc(v);
    ctx.dPrint(`Tempo: Set future value to ${Math.trunc(t2)} over ${numbeats} beats`);
  }

  // Restore the original tempo after the specified beats.
  if (restore) {
    meta.addTempo(restore, origTempo);
    ctx.tempo = origTempo;
    lastChange = restore;
    ctx.dPrint(`Tempo: Restored to ${origTempo} in ${(restore - ctx.tickOffset) / ctx.BperQ} beats`);
  }

  if (ctx.tempo <= 0) ctx.error('Tempo: Setting must be greater than 0.');

  // Check the meta track for any tempo changes past the last one inserted.
  for (const tc of ctx.mtrks.tempoChanges) {
    if (tc.tick > lastChange) {
      ctx.warning('Tempo change may be invalid since there are more changes after this point.');
      break;
    }
  }
}

/** Port of tempo.beatAdjust (BEATADJUST command). */
export function beatAdjust(ctx: MMAContext, ln: string[]): void {
  if (ln.length !== 1) ctx.error('BeatAdjust: Expecting single value.');

  const adj = stotick(ctx.rep, ctx, ln[0]!, 'B', `BeatAdjust: Expecting a value (not ${ln[0]}).`);
  ctx.tickOffset += adj;
  ctx.totTime += adj / ctx.BperQ / ctx.tempo;
  ctx.dPrint(`BeatAdjust: inserted ${adj} ticks at bar ${ctx.barNum + 1}.`);
}

/** Python repr of a float list, used in TIME error messages. */
function pyList(l: number[]): string {
  return '[' + l.map((x) => formatFloat(x)).join(', ') + ']';
}

/** Port of tempo.cut (CUT): insert an all-note-off into ALL tracks. */
export function cut(ctx: MMAContext, input: string[]): void {
  let ln = input;
  if (!ln.length) ln = ['0'];

  if (ln.length !== 1) {
    ctx.error('Cut: Expecting single offset or empty argument.');
  }

  // Loop though all the tracks.  Note that trackCut() checks to make sure
  // there is a need to insert in the specified track.  In this loop we
  // create a list of channels as we loop though all the tracks, skipping
  // over any duplicate channels or tracks with no channel assigned.
  const l: number[] = [];
  for (const t of [...ctx.tnames.keys()].sort()) {
    const c = ctx.tnames.get(t)!.channel;
    if (!c || l.includes(c)) continue;
    l.push(c);
    trackCut(ctx, t, ln);
  }
}

/** Port of tempo.trackCut (track CUT): insert an ALL NOTES OFF at the offset. */
export function trackCut(ctx: MMAContext, name: string, input: string[]): void {
  let ln = input;
  if (!ln.length) ln = ['0'];

  if (ln.length !== 1) {
    ctx.error(`Cut ${name}: Offset missing.`);
  }

  const offset = stof(ctx.rep, ln[0]!, `Cut ${name}: Expecting value, (not '${ln[0]}') for offset.`);

  if (offset < -ctx.QperBar || offset > ctx.QperBar) {
    ctx.warning(`Cut ${name}: ${offset} is a large beat offset`);
  }

  const moff = Math.trunc(ctx.tickOffset + ctx.BperQ * offset);

  if (moff < 0) {
    ctx.error(`Cut ${name}: Offset comes before start of track.`);
  }

  // Insert allnoteoff directly in track.  This skips the normal queueing
  // in pats because it would never take if at the end of a track.
  const m = ctx.tnames.get(name)!.channel;
  const tr = m ? ctx.mtrks.tracks.get(m) : undefined;
  if (m && tr && tr.miditrk.size > 1) {
    tr.addNoteOff(moff);
    ctx.dPrint(`Cut ${name}: Beat ${offset}, Bar ${ctx.barNum + 1}`);
  }
}

/**
 * Port of tempo.fermata: lengthen (or shorten) the beat at `offset` by
 * inserting tempo events and moving the affected notes to the fermata
 * boundaries.  The Python implementation only moves events for negative
 * offsets (a fermata placed after the beat it affects).
 */
export function fermata(ctx: MMAContext, ln: string[]): void {
  if (ln.length !== 3) ctx.error("Fermata: use 'offset' 'duration' 'adjustment'");

  const offset = stof(ctx.rep, ln[0]!, `Fermata: Expecting a value (not '%s') for offset`);
  if (offset < -ctx.QperBar || offset > ctx.QperBar) {
    ctx.warning(`Fermata: ${formatFloat(offset)} is a large beat offset`);
  }

  const dur = stof(ctx.rep, ln[1]!, `Fermata: Expecting a value (not '${ln[1]}') for duration`);
  if (dur <= 0) ctx.error('Fermata: duration must be greater than 0');
  if (dur > ctx.QperBar) ctx.warning(`Fermata: ${formatFloat(dur)} is a large duration.`);

  const adj = stof(ctx.rep, ln[2]!, `Fermata: expecting a value (not '${ln[2]}') for adjustment.`);
  if (adj < 100) ctx.warning('Fermata: Adjustment less than 100 is shortening beat value.');
  if (adj === 100) {
    ctx.error('Fermata: using value of 100 makes no difference, must be an error.');
  }

  const moff = Math.trunc(ctx.tickOffset + ctx.BperQ * offset);
  if (moff < 0) ctx.error('Fermata: Offset comes before track start.');
  if (offset >= 0) {
    ctx.warning('Fermata: Better results when placed after event (negative offset).');
  }

  const fermataDuration = Math.trunc(ctx.BperQ * dur); // ticks
  const mend = moff + fermataDuration;

  // Collect tempo changes, delete the ones inside the fermata range, and
  // compute the tempos just before and at the end of the range.
  const meta = ctx.mtrks.meta();
  const tcmd = packBytes([0xff, 0x51, 0x03]);
  const tempos: Array<[number, Uint8Array]> = [];
  for (const t of meta.offsets()) {
    for (const ev of meta.miditrk.get(t)!) {
      if (startsWithBytes(ev, tcmd)) tempos.push([t, ev.slice(3)]);
    }
  }
  for (const [t] of tempos) {
    if (t >= moff && t <= mend) meta.delDup(t, tcmd);
  }
  tempos.sort((a, b) => a[0] - b[0]);

  let oldTempo = ctx.tempo;
  let newTempo = ctx.tempo;
  for (const [f, t] of tempos) {
    if (f <= moff) oldTempo = Math.floor(60000000 / byte3ToInt(t));
    if (f >= moff && f <= mend) newTempo = Math.floor(60000000 / byte3ToInt(t));
  }

  meta.addTempo(moff, Math.trunc(oldTempo / (adj / 100)));
  meta.addTempo(mend, newTempo);

  // Move note-ons/program/controller events to the start and note-offs to
  // the end of the fermata; only when placed after the affected beat.
  if (offset < 0) {
    for (const [n, track] of ctx.mtrks.tracks) {
      if (n <= 0) continue; // skip the meta track
      const trk = track.miditrk;
      const startEvents: Uint8Array[] = [];
      const endEvents: Uint8Array[] = [];

      for (const f of [...trk.keys()].sort((a, b) => a - b)) {
        if (f > moff && f < mend) {
          const remain: Uint8Array[] = [];
          for (const ev of trk.get(f)!) {
            if (!ev.length) continue;
            const evtype = ev[0]! >> 4;
            if (evtype === 0x9) {
              if (ev[2] === 0) endEvents.push(ev);
              else startEvents.push(ev);
              continue;
            }
            if (evtype === 0xb || evtype === 0xc) {
              startEvents.push(ev);
              continue;
            }
            remain.push(ev);
          }
          trk.set(f, remain);
        }
      }

      if (startEvents.length) {
        const at = trk.get(moff);
        if (at) at.push(...startEvents);
        else trk.set(moff, [...startEvents]);
      }
      if (endEvents.length) {
        const at = trk.get(mend);
        if (at) trk.set(mend, [...endEvents, ...at]);
        else trk.set(mend, [...endEvents]);
      }
    }
  }

  ctx.dPrint(
    `Fermata: Beat ${offset} Duration ${dur} Change ${adj} Bar ${ctx.barNum + 1}`,
  );
}

function startsWithBytes(ev: Uint8Array, cmd: Uint8Array): boolean {
  if (ev.length < cmd.length) return false;
  for (let i = 0; i < cmd.length; i++) if (ev[i] !== cmd[i]) return false;
  return true;
}

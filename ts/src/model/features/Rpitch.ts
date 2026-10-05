/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/rpitch.py - the per-track random-pitch modifier.  The state
 * class is attached to BaseTrack.rPitch; setRPitch() is called from the
 * RPITCH track command and doRpitch() from BaseTrack.sendNote() via the
 * track hooks.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 *
 * Original Python module by Bob van der Poel <bob@mellowood.ca>.
 */

import type { MMAContext } from '../../engine/Context';
import { opt2pair, stoi } from '../../util/Common';
import type { BaseTrack } from '../tracks/BaseTrack';

export class Rpitch {
  scale = 'CHROMATIC';
  /** 25% - applies to all notes. */
  rate = 0.25;
  /** Beat offsets (in MIDI ticks) to enable rnd. */
  beats: number[] = [];
  offsets: number[] = [];
  bars: number[] = [];
}

/** Port of rpitch.getOpts: return a string of the current settings. */
export function rpitchGetOpts(track: BaseTrack): string {
  const r = track.rPitch as Rpitch | null;
  if (!r) return 'None';

  const scale = r.scale;
  const rate = Math.trunc(r.rate * 100);
  const bars = r.bars.map((a) => String(a + 1)).join(',');
  const beats = r.beats.length ? r.beats.map((a) => String(Math.trunc((a + 1) / track.ctx.BperQ))).join(',') : '';
  let offsets: string;
  if (!r.offsets.length) offsets = 'None';
  else offsets = r.offsets.map((a) => String(a)).join(',');

  return `Rate=${rate} ScaleType=${scale} Offsets=${offsets} Bars=${bars} Beats=${beats}`;
}

/**
 * Port of rpitch.setRPitch: set the pitch modifier.  Called by the RPITCH
 * track command; the track is looked up by name in Python, here it is
 * passed through from the directive layer.
 */
export function setRPitch(ctx: MMAContext, track: BaseTrack, ln: string[]): void {
  const rp = new Rpitch();
  track.rPitch = rp;

  const msg = `${track.name} RPitch`;

  if (track.vtype === 'DRUM') {
    ctx.rep.error(`RPitch cannot be appied to a drum track ${track.name}.`);
  }

  if (track.vtype === 'PLECTRUM') {
    ctx.rep.warning(`RPitch is ignored by ${track.name} track.`);
    return;
  }

  if (!ln.length || (ln.length === 1 && ['NONE', 'OFF'].includes(ln[0]!.toUpperCase()))) {
    track.rPitch = null;
  } else {
    const [words, opts] = opt2pair(ln, true);

    if (words.length) {
      ctx.rep.error(`${msg} all settings must be Cmd=Opt pairs, not '${words.join(' ')}'`);
    }

    for (const { option: o, value: c } of opts) {
      if (o === 'SCALETYPE' || o === 'SCALE') {
        if (!['CHROMATIC', 'SCALE', 'CHORD'].includes(c)) {
          ctx.rep.error(
            `${track.name} Rpitch ScaleType: Only Chromatic, Scale and Chord are valid.`,
          );
        }
        rp.scale = c;
      } else if (o === 'BARS') {
        const l: number[] = [];
        if (c) {
          for (const a0 of c.split(',')) {
            const a = stoi(ctx.rep, a0);
            if (a < 0) ctx.rep.error(`${msg} Bars must be positive values, not '${a}'.`);
            if (a < 1 || a > ctx.seqSize) {
              ctx.rep.warning(
                `${msg} Bars: setting of ${a} may be ignored since SeqSize is ${ctx.seqSize}.`,
              );
            }
            l.push(a - 1);
          }
        }
        rp.bars = [...l];
      } else if (o === 'BEATS') {
        rp.beats = [];
        for (const t of c.split(',')) {
          const v = stoi(ctx.rep, t);
          if (v < 1 || v > ctx.QperBar) {
            ctx.rep.error(`${msg} Beat values must be in range 1 to ${ctx.QperBar}, not '${v}'.`);
          }
          rp.beats.push((v - 1) * ctx.BperQ); // save as tick offsets
        }
      } else if (o === 'RATE') {
        const v = stoi(ctx.rep, c);
        if (v < 0) ctx.rep.error(`% must be positive, not '${v}'.`);
        rp.rate = v / 100;
      } else if (o === 'OFFSETS') {
        let l: number[] = [];
        if (c.toUpperCase() === 'NONE' || c === '0') {
          l = [];
        } else {
          for (let a0 of c.split(',')) {
            let neg = 1;
            if (a0.startsWith('-')) {
              a0 = a0.slice(1);
              neg = -1;
            }
            if (a0.includes('-')) {
              let [a, b] = a0.split('-', 2) as [string, string];
              let ai = stoi(ctx.rep, a) * neg;
              let bi = stoi(ctx.rep, b);
              if (bi < ai) [ai, bi] = [bi, ai];
              for (let x = ai; x <= bi; x++) l.push(x);
            } else {
              l.push(stoi(ctx.rep, a0) * neg);
            }
          }
        }
        for (const a of l) {
          if (a < -12 || a > 12) {
            ctx.rep.warning(`${msg} value of ${a} is large.`);
            break;
          }
        }
        rp.offsets = [...l];
      } else {
        ctx.rep.error(`${msg} '${o}' is an  unknown option.`);
      }
    }
  }

  if (!rp.offsets.length) {
    ctx.rep.warning(`${msg} No offsets have been set, command will have no effect.`);
  }

  ctx.dPrint(`${track.name} RPitch set.`);
}

/** Port of rpitch.doRpitch: apply the rpitch setting to a note. */
export function doRpitch(
  ctx: MMAContext,
  track: BaseTrack,
  position: number,
  note: number,
): number {
  const rp = track.rPitch as Rpitch | null;
  if (!rp) return note;

  const mode = rp.scale;
  const ch = rp.offsets;

  if (!ch.length) return note; // no offset table; the user was warned

  // ..rate is stored as value .01 to .99 and random() returns in same range
  if (ctx.rng.random() > rp.rate) return note;

  // we have a bar list but the current bar isn't there, just return.
  if (rp.bars.length && !rp.bars.includes(ctx.seqCount)) return note;

  // both beats and position are stored as tick values
  if (rp.beats.length && !rp.beats.includes(position)) return note;

  // just add/sub a value. 'ch' is a list of chord/scale offsets to use
  if (mode === 'CHROMATIC') {
    note += ctx.rng.choice(ch);
  } else {
    let notelist: number[] | null = null;
    const cur = track.currentChord;
    if (mode === 'SCALE' && cur && cur.chord && cur.chord.scaleList.length) {
      notelist = [...cur.chord.scaleList];
    } else if (mode === 'CHORD' && cur && cur.chord && cur.chord.noteList.length) {
      notelist = [...cur.chord.noteList];
    }

    if (notelist) {
      // select the offset to use from the offsets list
      let change = ctx.rng.choice(ch);
      let neg: number;
      if (change < 0) {
        neg = -1;
        change = Math.abs(change);
      } else {
        neg = 1;
      }

      // Make sure the scale list is long enough to select from.  Keep
      // doubling the list, adding the octave adjustment each time.
      let o = 12;
      while (notelist.length <= change) {
        notelist = notelist.concat(notelist.map((i) => i + o));
        o += 12;
      }
      note += notelist[change]! * neg;
    }
  }

  // default fallthrough
  while (note > 127) note -= 12;
  while (note < 0) note += 12;

  return note;
}

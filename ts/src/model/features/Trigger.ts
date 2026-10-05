/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/trigger.py - the per-track trigger state (Trigger class),
 * the sequence generator (makeTriggerSequence) and the TRIGGER command
 * (setTrigger/getTriggerOptions).  Every track creates one Trigger in
 * clearSequence(); mode === null disables the feature.
 *
 * The Python code reads gbl.barLabel for the MEASURES option; the parser
 * owns the bar label here, so it is published to this module per context.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 *
 * Original Python module by Bob van der Poel <bob@mellowood.ca>.
 */

import type { MMAContext } from '../../engine/Context';
import type { CTable } from '../CTable';
import { PatternEvent, type Pattern } from '../PatternEvent';
import type { BaseTrack } from '../tracks/BaseTrack';
import { trackHooks } from '../tracks/hooks';
import { getTF, opt2pair, pextract, stoi } from '../../util/Common';
import { formatFloat } from '../../engine/PyValue';

export class Trigger {
  mode: string | null = null;
  truncate = false;
  count = 1;
  bars: number[] = [];
  beats: number[] = [];
  seq: Pattern | null = null;
  measures: string[] = [];
  cnames: string[] = [];
  ctonics: string[] = [];
  ctypes: string[] = [];
  override = false;
}

/** Current bar label, published by the Parser for the MEASURES option. */
const barLabels = new WeakMap<MMAContext, string>();

/** Port of parse.py's gbl.barLabel assignment at the top of a data line. */
export function setCurrentBarLabel(ctx: MMAContext, label: string): void {
  barLabels.set(ctx, label);
}

function currentBarLabel(ctx: MMAContext): string {
  return barLabels.get(ctx) ?? '';
}

/** Deep copy of one pattern event (Python copy.deepcopy of a Pgroup). */
function copyEvent(e: PatternEvent): PatternEvent {
  const c = e.clone();
  if (Array.isArray(e.vol)) c.vol = [...e.vol];
  return c;
}

/**
 * Port of trigger.makeTriggerSequence: create a new sequence based on a
 * trigger setting.  Called only from BaseTrack.bar().
 */
export function makeTriggerSequence(
  ctx: MMAContext,
  track: BaseTrack,
  ctable: CTable[],
  pattern: Pattern | null,
): Pattern {
  const trigger = track.trigger;

  if (trigger.bars.length && !trigger.bars.includes(ctx.seqCount)) return [];
  if (trigger.measures.length && !trigger.measures.includes(currentBarLabel(ctx))) return [];

  // Use the internal trigger sequence if it's set, otherwise use the
  // pattern(s) from the sequence set for the track.
  if (trigger.seq) pattern = trigger.seq;

  if (!pattern || !pattern.length) return [];

  let trigs: number[] = [];

  // If we have trigger set to "AUTO" then we create a set of offsets
  // based on the chord changes in ctable.
  if (trigger.mode === 'AUTO') {
    trigs = [];
    for (const c of ctable) {
      if (c.name !== 'z' && c.name !== (c.lastchord as unknown as string)) {
        trigs.push(c.chStart);
      }
    }
  } else if (trigger.mode === 'REST') {
    // This works with 'z' chords only, not 'XXzYY'
    trigs = [];
    for (const c of ctable) {
      if (c.name === 'z' && c.name !== (c.lastchord as unknown as string)) {
        trigs.push(c.chStart);
      }
    }
  } else if (trigger.mode === 'BEATS') {
    // If chord names are set, set if the beat and the chord NAME at that point.
    if (trigger.cnames.length) {
      trigs = [];
      for (const t of trigger.beats) {
        for (const c of ctable) {
          if (t >= c.chStart && t < c.chEnd && trigger.cnames.includes(c.chord!.name)) {
            trigs.push(t);
            break;
          }
        }
      }
    } else if (trigger.ctonics.length) {
      // Chord tonic names (C, D, E ... G)
      trigs = [];
      for (const t of trigger.beats) {
        for (const c of ctable) {
          if (t >= c.chStart && t < c.chEnd && trigger.ctonics.includes(c.chord!.tonic!)) {
            trigs.push(t);
            break;
          }
        }
      }
    } else if (trigger.ctypes.length) {
      trigs = [];
      for (const t of trigger.beats) {
        for (const c of ctable) {
          if (t >= c.chStart && t < c.chEnd && trigger.ctypes.includes(c.chord!.chordType!)) {
            trigs.push(t);
            break;
          }
        }
      }
    } else {
      // use the user defined beat list
      trigs = trigger.beats;
    }
  } else {
    return [];
  }

  // make copies of pattern(s) for each beat.  The number of patterns to
  // copy are determined by the 'count' option (default==1).
  const c = Math.min(pattern.length, trigger.count);
  if (c < 1) return [];

  const tpats: Pattern = [];
  for (const t of trigs) {
    for (let i = 0; i < c; i++) {
      const base = copyEvent(pattern[i]!);
      base.offset += t;
      if (base.offset >= ctx.barLen) continue;
      tpats.push(base);
    }
  }

  // normalize the durations of the new patterns so they terminate at the
  // next pattern or the end of the bar
  if (trigger.truncate) {
    for (let i = 0; i < tpats.length; i++) {
      let maxd: number;
      if (i < tpats.length - 1) {
        // another chord follows, truncate at start of next chord
        maxd = tpats[i + 1]!.offset - tpats[i]!.offset;
      } else {
        // last chord, truncate at end of bar.  Note the TRUNCATE option
        // is used to shorten a bar's duration, so the end of bar can be
        // 'gbl.barLen' or 'truncate.length'.
        const barEnd = trackHooks.truncate.length ? trackHooks.truncate.length : ctx.barLen;
        maxd = barEnd - tpats[i]!.offset;
      }
      tpats[i]!.duration = Math.min(tpats[i]!.duration, maxd);
    }
  }

  return tpats;
}

/**
 * Port of trigger.setTrigger: set a trigger for a track.  A trigger is
 * simply a list of offsets which are processed by the trackBar()
 * functions for each track.
 */
export function setTrigger(ctx: MMAContext, track: BaseTrack, input: string[]): void {
  if (['MELODY', 'SOLO'].includes(track.vtype)) {
    ctx.rep.error(`Trigger is not valid in ${track.vtype} track.`);
  }

  track.trigger = new Trigger();
  const trigger = track.trigger;

  let ln = [...input];
  let sequence: string | null = null;

  if (!ln.length) ln = ['OFF']; // empty line is same as singleton 'off'

  const argCount = ln.length;
  trigger.mode = 'ON';

  // extract a possible sequence.  Only 1st is extracted and saved for use
  // by the 'SEQUENCE = ' command.  The stuff in {} is replaced by empty {}.
  const l = ln.join(' ');
  let words = ln;
  if (l.includes('{') && l.includes('}')) {
    let rest: string;
    let subs: string[];
    [rest, subs] = pextract(l, '{', '}', true, '{}');
    words = rest.split(/\s+/).filter((w) => w !== '');
    sequence = subs[0]!;
  }

  const [plainWords, opts] = opt2pair(words);

  // do opts with args
  for (const { option, value: opt } of opts) {
    const cmd = option.toUpperCase();
    if (cmd === 'BEATS') {
      trigger.mode = 'BEATS';
      for (const t of opt.split(',')) {
        trigger.beats.push(track.setBarOffset(t));
      }
      trigger.beats.sort((a, b) => a - b);
    } else if (cmd === 'BARS') {
      for (const t of opt.split(',')) {
        const v = stoi(ctx.rep, t);
        if (v < 1 || v > ctx.seqSize) {
          ctx.rep.warning(
            `${track.name} Trigger Bars: setting of ${v} may be ignored since SeqSize is ${ctx.seqSize}.`,
          );
        }
        trigger.bars.push(v - 1);
      }
    } else if (cmd === 'CNAMES') {
      for (const a of opt.split(',')) trigger.cnames.push(a);
    } else if (cmd === 'CTYPES') {
      for (const a of opt.split(',')) trigger.ctypes.push(a);
    } else if (cmd === 'CTONICS') {
      for (const a of opt.split(',')) trigger.ctonics.push(a);
    } else if (cmd === 'COUNT') {
      trigger.count = stoi(ctx.rep, opt);
      if (trigger.count <= 0) {
        ctx.rep.error(
          `${track.name} Trigger Count must be greater than 0, not '${trigger.count}'.`,
        );
      }
    } else if (cmd === 'MEASURES') {
      for (const a of opt.split(',')) {
        if (!/^[\p{Nd}]+$/u.test(a)) {
          ctx.rep.warning(
            `${track.name} Trigger: Measures should be bar labels, not '${a}'.` +
              `This trigger will be ignored.`,
          );
          continue;
        }
        trigger.measures.push(a.replace(/^0+/, ''));
      }
    } else if (cmd === 'OVERRIDE') {
      trigger.override = getTF(ctx.rep, opt, "Trigger 'OverRide'");
    } else if (cmd === 'TRUNCATE') {
      trigger.truncate = getTF(ctx.rep, opt, "Trigger 'Turncate'");
    } else if (cmd === 'SEQUENCE') {
      if (!sequence && opt) sequence = opt;
      if (sequence) {
        sequence = sequence.replace(/[; ]+$/, '');
        trigger.seq = track.defPatRiff(sequence) as Pattern;
      } else {
        ctx.rep.error(`${track.name} Trigger Sequence expecting {patterns...}.`);
      }
    } else if (cmd === 'STICKY') {
      track.sticky = getTF(ctx.rep, opt, "Trigger 'Sticky'");
    } else {
      ctx.rep.error(`${track.name} Trigger '${cmd}' is an unknown command.`);
    }
  }

  // opts without args
  for (const w of plainWords) {
    const cmd = w.toUpperCase();
    if (cmd === 'AUTO') {
      trigger.mode = 'AUTO';
    } else if (cmd === 'OFF') {
      // It's all been set to default at top, so leave it alone
      if (argCount > 1) ctx.rep.error("Trigger: 'OFF' argument must be the only arg.");
    } else if (cmd === 'REST') {
      trigger.mode = 'REST';
    } else {
      ctx.rep.error(`${track.name} Trigger '${cmd}' is an unknown command.`);
    }
  }

  ctx.dPrint(`${track.name} Trigger set.`);
}

/** Port of trigger.getTriggerOptions: settings string for macro/debug use. */
export function getTriggerOptions(track: BaseTrack): string {
  const trigger = track.trigger;

  let mode = '';
  if (trigger.mode === 'AUTO' || trigger.mode === 'REST') mode = trigger.mode;

  const beats = !trigger.beats.length
    ? '[]'
    : trigger.beats.map((i) => formatFloat(1 + i / track.ctx.BperQ)).join(',');

  const cnames = trigger.cnames.length ? trigger.cnames.join(',') : '[]';
  const ctypes = trigger.ctypes.length ? trigger.ctypes.join(',') : '[]';
  const tonics = trigger.ctonics.length ? trigger.ctonics.join(',') : '[]';
  const bars = trigger.bars.length ? trigger.bars.map((a) => String(a + 1)).join(',') : '[]';

  const seq = trigger.seq
    ? `Sequence={${track.formatPattern(trigger.seq)}}`
    : 'Sequence={}';

  const measures = trigger.measures.length ? trigger.measures.join(',') : '[]';

  return (
    `${mode} Beats=${beats} CNames=${cnames} CTypes=${ctypes} CTonics=${tonics} ` +
    `Bars=${bars} Count=${trigger.count} Truncate=${trigger.truncate ? 'True' : 'False'} ` +
    `Override=${trigger.override ? 'True' : 'False'} Measures=${measures} ${seq}`
  );
}

/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/swing.py: the SWINGMODE directive, its settings string and
 * the note-length skew.  The pattern-level swing adjustments
 * (swing.pattern/swingSolo) belong to the track layer and are not
 * included in this milestone.
 *
 * Python's module-level state is replaced by a SwingSettings object
 * stored on ctx.swingMode so DefGroove/Groove snapshots and restores it
 * the same way the Python groove code did.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import { opt2pair, stoi } from '../../util/Common';

export interface SwingSettings {
  mode: number;
  skew: string | null;
  accent1: number;
  accent2: number;
  delay1: number;
  delay2: number;
  noteValue: number;
}

export function defaultSwingSettings(): SwingSettings {
  return { mode: 0, skew: null, accent1: 1, accent2: 1, delay1: 0, delay2: 0, noteValue: 8 };
}

/**
 * Port of the swing.py module init (`swingMode(['Skew=66'])`).  Must be
 * called once per run before parsing; sets noteLenTable['81'/'82'].
 */
export function initialiseSwing(ctx: MMAContext): SwingSettings {
  const s = defaultSwingSettings();
  ctx.swingMode = s;
  swingMode(ctx, ['Skew=66']);
  return s;
}

export function swingSettings(ctx: MMAContext): SwingSettings {
  return (ctx.swingMode as SwingSettings | null) ?? defaultSwingSettings();
}

const EMSG =
  'Use: SwingMode [ ON | 1, OFF | 0, SKEW=nn | Accent=nn,nn | Delay=nn,nn | Notes=8|16 ].';

/** Port of swing.swingMode. */
export function swingMode(ctx: MMAContext, input: string[]): void {
  if (!input.length) ctx.error(EMSG);

  const cur = swingSettings(ctx);
  const next: SwingSettings = { ...cur };

  const [ln, opts] = opt2pair(input, true);

  for (const v of ln) {
    if (v === 'ON' || v === '1') next.mode = 1;
    else if (v === 'OFF' || v === '0') next.mode = 0;
    else return ctx.error(EMSG);
  }

  for (const { option: v, value: o } of opts) {
    if (v === 'SKEW') {
      next.skew = o;
      const a = Math.trunc(stoi(ctx.rep, o) * ctx.BperQ / 100);
      ctx.noteLenTable['81'] = a;
      ctx.noteLenTable['82'] = ctx.BperQ - a;
    } else if (v === 'ACCENT') {
      if ((o.match(/,/g) ?? []).length !== 1) {
        ctx.error(`Swingmode: ACCENT expecting comma separated values, not '${o}'.`);
      }
      const [a1s, a2s] = o.split(',') as [string, string];
      const a1 = stoi(ctx.rep, a1s);
      const a2 = stoi(ctx.rep, a2s);
      if (a1 < 1 || a1 > 200 || a2 < 1 || a2 > 200) {
        ctx.error(`Swingmode: Both ACCENT values must be 1..200, not ${a1},${a2}.`);
      }
      next.accent1 = a1 / 100;
      next.accent2 = a2 / 100;
    } else if (v === 'DELAY') {
      if ((o.match(/,/g) ?? []).length !== 1) {
        ctx.error(`Swingmode: DELAY expecting comma separated values, not '${o}'.`);
      }
      const [a1s, a2s] = o.split(',') as [string, string];
      const a1 = stoi(ctx.rep, a1s);
      const a2 = stoi(ctx.rep, a2s);
      if (a1 < -20 || a1 > 20 || a2 < -20 || a2 > 20) {
        ctx.error(`Swingmode: Both DELAY values must be -20..20, not ${a1},${a2}.`);
      }
      next.delay1 = a1;
      next.delay2 = a2;
    } else if (v === 'NOTES') {
      const o2 = stoi(ctx.rep, o);
      if (o2 !== 8 && o2 !== 16) ctx.error(`Swingmode: NOTES expecting 8 or 16, not '${o2}'.`);
      next.noteValue = o2;
    } else {
      return ctx.error(EMSG);
    }
  }

  // Replace (never mutate) so groove snapshots keep their own settings.
  ctx.swingMode = next;

  const s = next;
  ctx.dPrint(
    `SwingMode: Status=${s.mode}; Accent=${Math.trunc(s.accent1 * 100)},${Math.trunc(s.accent2 * 100)}; ` +
      `Delay=${s.delay1},${s.delay2}; Skew Note lengths: ${ctx.noteLenTable['81']} and ` +
      `${ctx.noteLenTable['82']} ticks. Notes=${s.noteValue}`,
  );
}

/** Port of swing.settings - used by the $_SWINGMODE macro. */
export function swingSettingsString(ctx: MMAContext): string {
  const s = swingSettings(ctx);
  const a = s.mode ? 'On' : 'Off';
  return (
    `${a} Accent=${Math.trunc(s.accent1 * 100)},${Math.trunc(s.accent2 * 100)} ` +
    `Delay=${s.delay1},${s.delay2} Skew=${s.skew} Notes=${s.noteValue}`
  );
}

/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/truncate.py: the TRUNCATE directive and its bar counter.
 * This module only sets the state; the heavy lifting is done by the
 * track layer (pat.py/bar() slices the pattern) and by the parser (which
 * shrinks the bar pointers) - exactly as in Python.
 *
 * Python keeps the state in module globals; here it lives on the shared
 * trackHooks.truncate object because that is where the track layer
 * already reads it.  length 0 / count null represent Python's None.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import { formatFloat } from '../../engine/PyValue';
import { opt2pair, stof, stoi } from '../../util/Common';
import { trackHooks } from '../tracks/hooks';

/**
 * Python's '%g' for the values used here: up to six significant digits,
 * trailing zeros (and a trailing point) removed.  4.0 -> '4', 1.5 -> '1.5'.
 */
function pyG(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  return String(Number(v.toPrecision(6)));
}

/** Port of truncate.setTruncate: set the truncate variable for the next bar. */
export function setTruncate(ctx: MMAContext, ln: string[]): void {
  const state = trackHooks.truncate;

  if (state.length) {
    ctx.warning('Truncate: option set with value pending, previous setting discarded.');
  }

  state.side = 0; // assume 'right' or start of bar
  state.count = 1; // assume 1 bar only

  const [words, opts] = opt2pair(ln); // separate out the option strings

  // Grab the truncate length first, need this to figure the
  // value for the side option, later.
  if (words.length !== 1) {
    ctx.error('Truncate: Beats must be set. Syntax is <beats> [option=value]');
  }

  const beats = stof(ctx.rep, words[0]!, 'Truncate: Bar length must be value.');

  if (beats <= 0 || beats >= ctx.QperBar) {
    ctx.error(`Truncate: Range must be >0 and <=${ctx.QperBar}, not '${formatFloat(beats)}'.`);
  }

  state.length = Math.trunc(beats * ctx.BperQ);

  // now parse options
  for (const { option, value } of opts) {
    const cmd = option.toUpperCase();

    if (cmd === 'COUNT') {
      const b = stoi(ctx.rep, value, 'Truncate: Bar COUNT must be integer.');
      if (b < 1) {
        ctx.error('Truncate: Bar COUNT must be 1 or greater.');
      }
      state.count = b;
    } else if (cmd === 'SIDE') {
      const opt = value.toUpperCase();
      const max = ctx.barLen;

      if (opt === 'LEFT') {
        // side to use, default==left
        state.side = 0;
      } else if (opt === 'RIGHT') {
        // use the right side of pattern
        state.side = max - state.length;
      } else {
        const num = stof(ctx.rep, value, `Truncate: Expecting value, not '${opt}'.`);
        state.side = Math.trunc((num - 1) * ctx.BperQ);
        if (state.side >= ctx.barLen) {
          ctx.error(`Truncate: Side value of '${pyG(num)}' too large.`);
        }
      }
    } else {
      ctx.error(`Truncate: '${cmd}' is an unknown option.`);
    }
  }

  ctx.dPrint(
    `Truncate: Next ${state.count} bar(s) are ${pyG(beats)} beats, ` +
      `using pattern from beats ${pyG(state.side / ctx.BperQ)} to ` +
      `${pyG((state.side + state.length) / ctx.BperQ)}.`,
  );
}

/** Port of truncate.countDown: decrement the bar count. Called from parse. */
export function countDown(): void {
  const state = trackHooks.truncate;

  state.count = (state.count ?? 0) - 1;
  if (state.count <= 0) {
    state.count = null;
    state.length = 0;
    state.side = 0;
  }
}

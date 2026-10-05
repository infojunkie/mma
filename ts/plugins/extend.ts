/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * extend plugin: port of plugins/extend/plugin.py by bvdp.  A sort of
 * reverse truncate: it splits a data line into parts with interleaving
 * Truncate lines so the data can be longer (in beats) than the current
 * Time setting supports.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { IMMAPlugin } from '../src/plugin/IMMAPlugin';
import { opt2pair, stoi } from '../src/util/Common';

const USAGE = `
@Extend len=dd [other options] Chord Data

Convert a data line into parts so that it can be longer (in beats)
than what the current Time supports. For example, you might have a
song in 3/4 which switches to 4/4 for a few bars. This function
will split the data lines into parts with interleaving TRUNCATE
lines. You can use a short length and it will work as a normal
Truncate function.

A few differences between this plugin and the native Truncate:
  The is no Count option
  The length is specified with Len=dd
  The new bar length must be an integer value

Supported options are:
  Side=right,left,beat  -- defaults to left
  Len=count             -- new bar length REQUIRED
  TimeSig=N/D           -- inserts a timesig event in the midi file

Caution: Do not attempt to use this in Begin/End block. The line will
         recurse and you will end up in an infinite loop.

Following the options is a MMA data line with optional line number and chords.

  Author: bvdp, 2018/12/25. `;

/** Python str.isdigit() for the (ASCII) bar-number label check. */
function isDigit(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

export const extendPlugin: IMMAPlugin = {
  name: 'extend',
  description: 'Split a data line into parts with interleaving Truncates.',
  author: 'Written by bvdp.',
  help: () => USAGE,

  run(args, pctx) {
    const ctx = pctx.context;

    let barLen: number | null = null; // We do need to fill this value
    let side: string | number = 1; // default to left (1)
    let timesig: string | null = null; // optional; helpful in score programs

    const [ln, opts] = opt2pair(args); // Use MMA to gather options
    for (const { option, value: o } of opts) {
      if (option.toUpperCase() === 'SIDE') {
        side = o;
      } else if (option.toUpperCase() === 'LEN') {
        barLen = stoi(ctx.rep, o, '@Extend LEN option expecting integer');
        if (barLen === ctx.QperBar) {
          ctx.error('@Extend: Expected the Len= to be different from the current TIME value.');
        }
      } else if (option.toUpperCase() === 'TIMESIG') {
        timesig = o;
      }
    }

    // Do some sanity/validity tests
    if (ln.includes('*')) {
      ctx.error("@Extend: does not support the '*' multiplier in data lines.");
    }

    for (const a of ln) {
      if (a.includes('{')) {
        ctx.error('@Extend: Does not support embedded solo/melody. Use Riff instead.');
      }
      if (a.includes('@')) {
        ctx.error(
          "@Extend: the '@' notation in chord data lines is not supported. " +
            "You probably don't need to use it since it makes very little " +
            'difference to the final sound. But, you can always create 2 chord ' +
            'lines and a Truncate by hand.',
        );
      }
    }

    if (barLen === null) {
      ctx.error('@Extend: requires a LEN=x option. x is the new length of bar');
      return; // unreachable; ctx.error throws
    }

    if (barLen > ctx.QperBar * 2) {
      ctx.error("@Extend: doesn't support lines longer than 2x the current TIME setting.");
    }

    // Create new lines for MMA to consider
    const line1: string[] = [];
    const line2: string[] = [];

    // We're shortening the line (just a normal Truncate) so we don't need
    // the split data.  Just end up with "Truncate ..." then "Data".
    if (barLen <= ctx.QperBar) {
      line2.push(...ln);
    } else {
      // Lengthen.  End with: data for full bar, Truncate, data for partial bar.
      let data = [...ln];
      if (data.length === 0) {
        ctx.error('@Extend: no chord data supplied.');
      }
      if (isDigit(data[0]!)) {
        line1.push(data[0]!);
        line2.push(data[0]!);
        data = data.slice(1);
      }
      for (let c = 0; c < data.length; c++) {
        if (c < ctx.QperBar) line1.push(data[c]!);
        else line2.push(data[c]!);
      }
      // Python writes `len(line2)==1 and line2[0].isdigit` here; since the
      // bound method object is always truthy, that is exactly `len<=1`.
      if (line2.length <= 1) {
        line2.push('/');
      }
    }

    let len2 = Math.trunc(barLen - ctx.QperBar);
    if (len2 < 1) {
      len2 = barLen;
    }

    // Generate input for MMA.
    const ret: string[][] = [];
    let oldtime: string | null = null;

    if (timesig) {
      oldtime = ctx.timeSig.getAscii();
      ret.push(['Timesig', timesig]);
    }

    if (len2 <= ctx.QperBar) {
      ret.push(line1);
    }

    ret.push(['Truncate', `side=${side}`, `${len2}`]);

    ret.push(line2);

    if (timesig) {
      ret.push(['Timesig', oldtime!]);
    }

    // And now MMA will happily do it all.
    pctx.pushTokens(ret);
  },
};

export default extendPlugin;

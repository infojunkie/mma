/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/common.py - string/number helpers, option parsing and
 * sequence list expansion.  Python functions raise via the module-global
 * error(); here a Reporter is passed explicitly so that multiple MMA
 * instances stay independent.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { Reporter } from '../engine/Errors';
import { MMARandom } from '../engine/Random';

/** Python int(s, 0): decimal, 0x/0o/0b prefixes and _ separators. */
export function stoi(rep: Reporter, s: string, errmsg?: string): number {
  const t = s.trim().replace(/_/g, '');
  let v: number | undefined;
  if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(t)) v = parseInt(t.replace(/^[+-]?0[xX]/, ''), 16) * (t.startsWith('-') ? -1 : 1);
  else if (/^[+-]?0[oO][0-7]+$/.test(t)) v = parseInt(t.replace(/^[+-]?0[oO]/, ''), 8) * (t.startsWith('-') ? -1 : 1);
  else if (/^[+-]?0[bB][01]+$/.test(t)) v = parseInt(t.replace(/^[+-]?0[bB]/, ''), 2) * (t.startsWith('-') ? -1 : 1);
  else if (/^[+-]?\d+$/.test(t)) v = parseInt(t, 10);
  if (v === undefined) {
    if (errmsg) rep.error(errmsg);
    rep.error(`Expecting integer value, not ${s}`);
  }
  return v;
}

export function stof(rep: Reporter, s: string, errmsg?: string): number {
  const t = s.trim();
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t);
  try {
    return stoi(rep, t, errmsg);
  } catch {
    if (errmsg) rep.error(errmsg);
    rep.error(`Expecting a value, not ${s}`);
  }
}

export interface Timing {
  barLen: number;
  BperQ: number;
}

/** Port of stotick: convert a value with optional M (measures), B (beats), T (ticks). */
export function stotick(rep: Reporter, timing: Timing, s: string, defaultExt = 'B', emsg?: string): number {
  let body = s;
  let ext = defaultExt;
  if (!/[0-9]$/.test(s)) {
    ext = s.slice(-1).toUpperCase();
    body = s.slice(0, -1);
  }
  const mult = { M: timing.barLen, B: timing.BperQ, T: 1 }[ext as 'M' | 'B' | 'T'];
  if (mult === undefined) rep.error(`The extension '${ext}' is not valid. Use M, B or T.`);
  const v = stof(rep, body, emsg);
  return Math.trunc(v * mult);
}

/**
 * Extract parenthesized substrings.  eg pextract("x{123}{666}y", '{', '}')
 * returns ["xy", ["123","666"]].
 */
export function pextract(
  s: string,
  open: string,
  close: string,
  onlyone = false,
  insert = '',
): [string, string[]] {
  const subs: string[] = [];
  const magic = '\u0001';
  for (;;) {
    const lstart = s.indexOf(open);
    const lend = s.indexOf(close);
    if (lstart > -1 && lstart < lend) {
      subs.push(s.slice(lstart + open.length, lend).trim());
      s = s.slice(0, lstart) + magic + s.slice(lend + close.length);
      if (onlyone) break;
    } else break;
  }
  return [s.split(magic).join(insert).trim(), subs];
}

/** Expand/contract an existing sequence list to the current seqSize. */
export function seqBump(l: string[], seqSize: number): string[] {
  const out = [...l];
  while (out.length < seqSize) out.push(...out);
  return out.slice(0, seqSize);
}

/** Validate and expand a list passed to a set command. */
export function lnExpand(rep: Reporter, ln: string[], msg: string, seqSize: number, inAllGrooves: boolean): string[] {
  let out = [...ln];
  if (out.length > seqSize) {
    if (!inAllGrooves) rep.warning(`${msg} list truncated to ${seqSize} patterns`);
    out = out.slice(0, seqSize);
  }
  let last: string | null = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i] === '/') {
      if (last === null) rep.error(`${msg} cannot use a '/' as the first item in list.`);
      out[i] = last;
    } else {
      last = out[i]!;
    }
  }
  return out;
}

export interface OptPair {
  option: string;
  value: string;
}

/**
 * Parse a list of words into (plain words, [option, value] pairs).
 * "Beats = 1 , 3" style spacing is normalised first.
 */
export function opt2pair(
  ln: string[],
  toupper = false,
  notoptstop = false,
): [string[], OptPair[]] {
  const opts: OptPair[] = [];
  const newln: string[] = [];

  let line = ln.join(' ');
  line = line.replace(/ {2}/g, ' ');
  line = line.replace(/= /g, '=').replace(/ =/g, '=');
  line = line.replace(/, /g, ',').replace(/ ,/g, ',');
  const words = line.split(/\s+/).filter((w) => w !== '');

  for (let v = 0; v < words.length; v++) {
    let a = words[v]!;
    if (toupper) a = a.toUpperCase();
    if (a === '--') {
      newln.push(...words.slice(v + 1));
      break;
    }
    const eq = a.indexOf('=');
    if (eq >= 0) {
      const o = a.slice(0, eq);
      const val = a.slice(eq + 1);
      opts.push({ option: o, value: val });
    } else {
      newln.push(a);
      if (notoptstop) {
        newln.push(...words.slice(v + 1));
        break;
      }
    }
  }
  return [newln, opts];
}

/** Test a string option for true/false. */
export function getTF(rep: Reporter, option: string, e = ''): boolean {
  const v = option.toUpperCase();
  if (v === 'TRUE' || v === 'ON' || v === '1') return true;
  if (v === 'FALSE' || v === 'OFF' || v === '0') return false;
  const prefix = e ? `${e}: ` : '';
  return rep.error(`${prefix}Requires True or False, not '${v}'.`);
}

/**
 * Port of getOffset: tick offset of a note within a bar, with optional
 * random adjustment (RTIME) that never pushes a note before the bar start.
 */
export function getOffset(
  tickOffset: number,
  ticks: number,
  rng: MMARandom | null,
  ranLow?: number,
  ranHigh?: number,
): number {
  let p = tickOffset + Math.trunc(ticks);
  if (ranLow !== undefined && ranHigh !== undefined && rng) {
    let r = rng.randrange(ranLow, ranHigh + 1);
    if (ticks === 0 && r < 0) r = 0;
    p += r;
  }
  return p;
}

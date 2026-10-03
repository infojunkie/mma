/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the track pattern/sequence commands in MMA/parse.py
 * (trackDefPattern) and MMA/sequence.py (trackSequence, trackSeqClear,
 * trackSeqRnd, trackSeqRndWeight).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import { getTF, lnExpand, pextract } from '../../util/Common';
import { getWeights } from '../simple/Sequence';
import { definePatternText as definePatternArray, getTrack, type TrackApi } from '../../parse/TrackApi';
import { trackAlloc } from '../../model/tracks/alloc';
import type { MacroExpander } from '../../parse/MacroExpander';

/** Port of parse.trackDefPattern (track DEFINE). */
export function trackDefPattern(ctx: MMAContext, track: TrackApi, input: string[]): void {
  let ln = [...input];

  const name = track.name.split('-')[0]!;
  trackAlloc(ctx, name, true);

  let pattern: string;
  if (ln.length) pattern = ln.shift()!.toUpperCase();
  else return ctx.error('Define is expecting a pattern name');

  if (pattern === 'Z' || pattern === '-') {
    ctx.error(`Pattern name '${pattern}' is reserved`);
  }
  if (pattern.startsWith('_')) ctx.error('Names with a leading underscore are reserved');
  if (!ln.length) ctx.error(`No pattern list given for '${name} ${pattern}'`);

  definePatternArray(getTrack(ctx, name), pattern, ln);
}

/** Port of sequence.trackSequence (track SEQUENCE). */
export function trackSequence(
  ctx: MMAContext,
  expander: MacroExpander,
  track: TrackApi,
  input: string[],
  seqshow = false,
): void {
  if (!input.length) ctx.error(`Use: ${track.name} Sequence NAME [...]`);

  let ln = input.join(' ');

  if (track.vtype === 'SOLO') {
    ctx.warning('Sequences for SOLO tracks are not saved in Grooves.');
  }

  // Long sequence lines may be continued; we need matching {} pairs.
  const oLine = ctx.lineno;
  const countChar = (s: string, c: string): number => (s.match(new RegExp(`\\${c}`, 'g')) ?? []).length;
  while (countChar(ln, '{') !== countChar(ln, '}')) {
    const l = ctx.inpath!.read();
    if (l === null) {
      ctx.lineno = oLine;
      ctx.error(`${track.name} Sequence {}s do not match`);
    }
    const text = expander.expand(l).join(' ');
    if (!text.endsWith('}') && !text.endsWith(';')) {
      ctx.error(`${track.name}: Expecting multiple sequence lines to end in ';'`);
    }
    ln += ' ' + text;
  }

  // Extract {} definitions into dynamic patterns (_1, _2, ...).
  let ids = 1;
  for (;;) {
    const sp = ln.indexOf('{');
    if (sp < 0) break;

    const [rest, s] = pextract(ln, '{', '}', true);
    ln = rest;
    if (!s.length) ctx.error("Did not find matching '}' for '{'");

    const pn = `_${ids}`;
    ids += 1;

    const trk = track.name.split('-')[0]!;
    trackAlloc(ctx, trk, true);

    // Plectrum sub-tracks inherit the base class tuning while defining.
    const base = getTrack(ctx, trk);
    const baseTuning = (base as unknown as { _tuning?: number[] })._tuning;
    const ownTuning = (track as unknown as { _tuning?: number[] })._tuning;
    let saved: number[] | undefined;
    if (trk === 'PLECTRUM' && track.name !== trk && baseTuning && ownTuning) {
      saved = [...baseTuning];
      (base as unknown as { _tuning?: number[] })._tuning = ownTuning;
    }

    definePatternArray(base, pn, [s[0]!]);

    if (saved) (base as unknown as { _tuning?: number[] })._tuning = saved;

    ln = ln.slice(0, sp) + ' ' + pn + ' ' + ln.slice(sp);
  }

  let tokens = ln.split(/\s+/).filter((w) => w !== '');

  tokens = lnExpand(ctx.rep, tokens, `${track.name} Sequence`, ctx.seqSize, ctx.inAllGrooves);

  const tmp: Array<unknown> = new Array(tokens.length).fill(null);

  for (let i = 0; i < tokens.length; i++) {
    const n = tokens[i]!.toUpperCase();
    if (n === 'Z' || n === '-') {
      tmp[i] = null;
    } else if (n === '*') {
      tmp[i] = track.sequence[i];
    } else {
      if (!ctx.pats.has(track.vtype, n)) {
        ctx.error(`Track ${track.vtype} does not have pattern '${n}'`);
      }
      tmp[i] = ctx.pats.get(track.vtype, n);
    }
  }

  track.sequence = ctx.seqBump(tmp);

  if (seqshow) {
    ctx.dPrint(
      `${track.name} sequence set: ${tokens.map((a) => (a === 'Z' || a === 'z' || a === '-' ? '-' : a)).join(' ')}`,
    );
  }
}

/** Port of sequence.trackSeqClear (track SEQCLEAR). */
export function trackSeqClear(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (ln.length) ctx.error(`No args permitted. Use ${track.name} SEQCLEAR`);

  for (const [name, t] of ctx.tnames) {
    if (name.startsWith(track.name)) {
      (t as unknown as { clearSequence(): void }).clearSequence();
      ctx.dPrint(`SeqClear: Track ${name} cleared.`);
    }
  }
}

/** Port of sequence.trackSeqRnd (track SEQRND). */
export function trackSeqRnd(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (ln.length !== 1) ctx.error(`Use: ${track.name} SeqRnd [On, Off]`);
  track.seqRnd = getTF(ctx.rep, ln[0]!.toUpperCase(), `${track.name} SeqRnd`);
  ctx.dPrint(`${track.name} SeqRnd: ${track.seqRnd ? 'On' : 'Off'}`);
}

/** Port of sequence.trackSeqRndWeight (track SEQRNDWEIGHT). */
export function trackSeqRndWeight(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  track.seqRndWeight = getWeights(ctx, ln, `${track.name} SeqRndWeight`);
}

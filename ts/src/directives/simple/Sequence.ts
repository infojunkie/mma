/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the global half of MMA/sequence.py (SeqSize, Seq, SeqClear)
 * and MMA/seqrnd.py (SeqRnd, SeqRndWeight and the per-bar setseq used by
 * the parser loop).  The track-sequence commands stay with the track
 * layer in src/directives/track/.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import { getTF, lnExpand, opt2pair, seqBump, stoi } from '../../util/Common';

// ---------------------------------------------------------------------
// sequence.py

/** Port of sequence.seqsize (global SeqSize). */
export function seqsize(ctx: MMAContext, ln: string[]): void {
  if (ln.length !== 1) ctx.error("Usage 'SeqSize N'");

  const n = stoi(ctx.rep, ln[0]!, 'Argument for SeqSize must be integer');
  if (n < 1) ctx.error(`SeqSize: sequence size must be 1 or greater, not '${n}'.`);

  // Setting the sequence size always resets the seq point.
  ctx.seqCount = 0;

  if (n !== ctx.seqSize) {
    ctx.seqSize = n;
    for (const a of ctx.tnames.values()) a.setSeqSize();
    ctx.seqRndWeight = ctx.seqBump(ctx.seqRndWeight);
  }

  ctx.dPrint(`Set SeqSize to ${n}`);
}

/** Port of sequence.seq (SEQ command). */
export function seq(ctx: MMAContext, ln: string[]): void {
  let s: number;
  if (ln.length === 0) s = 0;
  else if (ln.length === 1) s = stoi(ctx.rep, ln[0]!, 'Expecting integer value after SEQ');
  else return ctx.error('Use: SEQ or SEQ NN to reset seq point');

  if (s > ctx.seqSize) ctx.error(`Sequence size is '${ctx.seqSize}', you can't set to '${s}'`);
  if (s === 0) s = 1;
  if (s < 0) ctx.error(`Seq parm must be greater than 0, not ${s}`);

  ctx.seqCount = s - 1;

  if (ctx.seqRnd[0] === 1) {
    ctx.warning('SeqRnd has been disabled by a Seq command');
    ctx.seqRnd = [0];
  }
}

/** Port of sequence.seqClear (global SeqClear). */
export function seqClear(ctx: MMAContext, ln: string[]): void {
  if (ln.length) ctx.error("Use: 'SeqClear' with no args");

  for (const n of ctx.tnames.values()) {
    const t = n as unknown as { vtype: string; sticky: boolean; clearSequence(): void };
    if (t.vtype === 'SOLO' || t.vtype === 'ARIA' || t.sticky) continue;
    t.clearSequence();
  }

  ctx.volume.futureVol = [];
  ctx.seqRndWeight = getWeights(ctx, ['1'], 'SeqRndWeight');
}

// ---------------------------------------------------------------------
// seqrnd.py

/** Port of seqrnd.setSeqRnd. */
export function setSeqRnd(ctx: MMAContext, ln: string[]): void {
  const emsg = 'use [ON, OFF or TrackList ]';
  if (!ln.length) ctx.error('SeqRnd:' + emsg);

  const a = ln[0]!.toUpperCase();

  // The Python list mixes the flag int with track-name strings.
  let list: Array<number | string>;
  if ((a === 'ON' || a === '1') && ln.length === 1) {
    list = [1];
  } else if ((a === 'OFF' || a === '0') && ln.length === 1) {
    list = [0];
  } else {
    list = [2];
    for (const item of ln) {
      const t = item.toUpperCase();
      if (!ctx.tnames.has(t)) ctx.error(`SeqRnd: Track '${t}' does not exist, ${emsg}`);
      if (list.includes(t)) ctx.error(`SeqRnd: Duplicate track '${t}' specified, ${emsg}`);
      list.push(t);
    }
  }

  ctx.seqRnd = list as unknown as number[];

  const msg = ['SeqRnd:'];
  if (list[0] === 2) for (const a2 of list.slice(1)) msg.push(String(a2));
  else if (list[0] === 1) msg.push('On');
  else msg.push('Off');
  ctx.dPrint(msg.join(' '));
}

/**
 * Port of seqrnd.getweights: parse a rndweight line into the expanded
 * weight list.  Also used by the track SeqRndWeight command.
 */
export function getWeights(ctx: MMAContext, input: string[], msgName: string): number[] {
  let ln = lnExpand(ctx.rep, input, msgName, ctx.seqSize, ctx.inAllGrooves);
  const [notopt, opt] = opt2pair(ln, true);

  let tmp: number[];

  if (opt.length) {
    if (notopt.length) {
      ctx.error(`${msgName} use only an option=values or individual values.`);
    }
    tmp = [];
    for (const { option: v, value: a } of opt) {
      if (v === 'FROM') {
        tmp = new Array(ctx.seqSize).fill(0) as number[];
        for (const s of a.split(',')) {
          const n = stoi(ctx.rep, s, `${msgName} FROM expecting integer, not '${s}'.`);
          if (n < 1 || n > ctx.seqSize) {
            ctx.error(
              `${msgName} FROM must only have values in the sequence size (${ctx.seqSize}), not '${n}'.`,
            );
          }
          tmp[n - 1] += 1;
        }
      } else {
        ctx.error(`${msgName} ${v} is not a valid option.`);
      }
    }
  } else {
    if (!notopt.length) ctx.error(`Use: ${msgName} <weight factors>`);
    tmp = [];
    for (const n of notopt) {
      const v = stoi(ctx.rep, n, `${msgName} expecting integer, not '${n}'.`);
      if (v < 0) ctx.error(`${msgName}: Values must be 0 or greater`);
      tmp.push(v);
    }
  }

  tmp = ctx.seqBump(tmp);

  if (!tmp.some((x) => x !== 0)) ctx.error(`${msgName} Using all '0's is not permitted.`);

  ctx.dPrint(`Set ${msgName}: ${tmp.join(' ')}`);
  return tmp;
}

/** Port of seqrnd.setSeqRndWeight. */
export function setSeqRndWeight(ctx: MMAContext, ln: string[]): void {
  ctx.seqRndWeight = getWeights(ctx, ln, 'SeqRndWeight');
}

/** Port of seqrnd.getrndseq. */
export function getrndseq(ctx: MMAContext, weights: number[]): number {
  const tmp: number[] = [];
  for (let x = 0; x < weights.length; x++) {
    for (let i = 0; i < weights[x]!; i++) tmp.push(x);
  }
  if (!tmp.length) ctx.error('SeqRndWeight has generated an empty list.');
  return ctx.rng.choice(tmp);
}

/**
 * Port of seqrnd.setseq, called from the parser before each bar.  Returns
 * a (weighted) random sequence point and the track list that should use
 * it, or r == -1 when rndseq is not enabled.
 */
export function setseq(ctx: MMAContext): [number, string[]] {
  let r: number;
  if (ctx.seqRnd[0]) {
    r = getrndseq(ctx, ctx.seqRndWeight);
    if (ctx.seqRnd[0] === 1) {
      ctx.seqCount = r;
      r = -1;
    }
  } else {
    r = -1;
  }
  return [r, ctx.seqRnd.slice(1).map((x) => String(x))];
}

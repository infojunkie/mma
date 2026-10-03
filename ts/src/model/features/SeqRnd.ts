/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/seqrnd.py getrndseq() - the weighted random sequence
 * selection used by per-track SeqRnd.  The global (all tracks in sync)
 * selection is handled by the parser loop, as in Python; this module only
 * provides the weighted choice.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../../engine/Context';

/**
 * Weighted random choice of a sequence slot.  `weights[x]` is the weight
 * for slot x (the Python code builds the repeated list explicitly so the
 * RNG consumption matches random.choice()).
 */
export function getRndSeq(ctx: MMAContext, weights: number[]): number {
  const tmp: number[] = [];
  weights.forEach((weight, x) => {
    for (let i = 0; i < weight; i++) tmp.push(x);
  });
  if (tmp.length === 0) {
    return ctx.rep.error('SeqRndWeight has generated an empty list.');
  }
  return ctx.rng.choice(tmp);
}

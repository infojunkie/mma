/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the groove commands in MMA/grooves.py: DefGroove, DefAlias,
 * Groove, GrooveClear and the track-level Groove.  The in-memory groove
 * library itself is in src/groove/GrooveLibrary.ts.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import type { TrackApi } from '../../parse/TrackApi';

/** Port of grooves.grooveDefine (DefGroove). */
export function defGroove(ctx: MMAContext, ln: string[]): void {
  if (!ln.length) ctx.error('Use: DefGroove  Name');
  ctx.grooves.define(ctx, ln);
}

/** Port of grooves.grooveAlias (DefAlias). */
export function defAlias(ctx: MMAContext, ln: string[]): void {
  if (ln.length !== 2) ctx.error('DefAlias needs exactly 2 args: GrooveName AliasName.');
  ctx.grooves.alias(ctx, ln);
}

/** Port of grooves.groove (Groove) - may auto-load from the libraries. */
export async function groove(ctx: MMAContext, ln: string[]): Promise<void> {
  await ctx.grooves.select(ctx, ln);
}

/**
 * Port of grooves.grooveClear (GrooveClear): delete all defined grooves
 * except the integer-named temporary slots used by USE/INCLUDE.
 */
export function grooveClear(ctx: MMAContext, ln: string[]): void {
  if (ln.length) ctx.error('GrooveClear does not have any arguments.');

  for (const key of [...ctx.grooves.glist.keys()]) {
    if (!/^\d+$/.test(key)) ctx.grooves.glist.delete(key);
  }
  ctx.grooves.aliaslist.clear();
  ctx.grooves.groovesList = null;
  ctx.grooves.groovesCount = 0;
  ctx.grooves.lastGroove = '';
  ctx.grooves.currentGroove = '';

  ctx.dPrint('All grooves deleted.');
}

/** Port of grooves.trackGroove (track GROOVE command). */
export function trackGroove(ctx: MMAContext, track: TrackApi, ln: string[]): void {
  if (ln.length !== 1) ctx.error(`Use: ${track.name} Groove Name`);

  let slot = ln[0]!.toUpperCase();

  if (!ctx.grooves.glist.has(slot) && ctx.grooves.aliaslist.has(slot)) {
    slot = ctx.grooves.aliaslist.get(slot)!;
  }
  if (!ctx.grooves.glist.has(slot)) ctx.error(`Groove '${slot}' not defined`);

  track.restoreGroove(slot);

  if (track.sequence.length > 0 && track.sequence.every((s) => s === null)) {
    ctx.warning(`'${track.name}' Track Groove has no sequence. Track name error?`);
  }

  ctx.dPrint(`${track.name} Groove settings restored from '${slot}'.`);
}

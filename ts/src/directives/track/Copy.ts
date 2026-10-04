/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of grooves.trackCopy / trackCopyDo: `Track Copy <other>` copies
 * all pattern data from another track of the same type, optionally
 * loading a groove first (`Copy groove::Track`).  Registered as the
 * track command COPY (MM/parse.py trackFuncs).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import type { BaseTrack } from '../../model/tracks/BaseTrack';
import { trackAlloc } from '../../model/tracks/alloc';

/** groves.py COPYGROOVE: scratch groove slot (int in Python, string here). */
const COPY_GROOVE = '-2387';

export async function trackCopy(ctx: MMAContext, track: BaseTrack, args: string[]): Promise<void> {
  let ln = [...args];

  if (ln.length && ln[0]!.toUpperCase() === 'TO') {
    const src = track.name;
    for (const destRaw of ln.slice(1)) {
      const dest = destRaw.toUpperCase();
      trackAlloc(ctx, dest, true); // create dest if it doesn't exist
      await trackCopyDo(ctx, dest, [src]);
    }
    return;
  }

  if (ln.length && ln[0]!.toUpperCase() === 'FROM') {
    ln = ln.slice(1);
    if (ln.length !== 1) ctx.error(`Copy FROM ${track.name}: Exactly one arg needed (track to copy).`);
    await trackCopyDo(ctx, track.name, ln);
    return;
  }

  await trackCopyDo(ctx, track.name, ln);
}

async function trackCopyDo(ctx: MMAContext, name: string, ln: string[]): Promise<void> {
  if (ln.length !== 1) ctx.error(`Copy ${name}: Exactly one arg needed (track to copy).`);
  let cp = ln[0]!.toUpperCase();

  const self = ctx.tnames.get(name);
  if (!self) ctx.error(`Copy ${name}: Track '${name}' is not defined.`);

  // Split the track-to-copy into a trackname and a groovename.
  let gr = '';
  if (cp.includes('::')) {
    const i = cp.indexOf('::');
    gr = cp.slice(0, i);
    cp = cp.slice(i + 2);
  }

  if (gr) {
    const otime = ctx.QperBar;
    ctx.grooves.push(ctx);
    await ctx.grooves.select(ctx, [gr.split(':')[0]!]); // groove([gr.split(':',1)[0]])
    if (otime !== ctx.QperBar) {
      ctx.error(`Copy ${name}: TIME mismatch, groove ${gr} has time of ${ctx.QperBar}, not ${otime}.`);
    }
  }

  const source = ctx.tnames.get(cp);
  if (!source) ctx.error(`Copy ${name}: Track '${cp}' is not defined.`);
  if (source.vtype !== self.vtype) {
    ctx.error(`Copy ${name}: tracks must be of same type, not ${source.vtype} and ${self.vtype}.`);
  }

  // Save the source into the shared scratch slot and restore it into the
  // target (grooves.py: COPYGROOVE indirection).  Solo tracks use the
  // force methods since they normally do not save groove info.
  const forcedSave = source as unknown as { forceSaveGroove?: (g: string) => void };
  const forcedRestore = self as unknown as { forceRestoreGroove?: (g: string) => void };
  if (source.vtype === 'SOLO' && gr) {
    ctx.error(`Copy ${name}: Solo tracks cannot be copied from a groove, only from memory.`);
  }
  if (typeof forcedSave.forceSaveGroove === 'function') forcedSave.forceSaveGroove(COPY_GROOVE);
  else source.saveGroove(COPY_GROOVE);

  const data = source.grooves.get(COPY_GROOVE);
  if (data) self.grooves.set(COPY_GROOVE, data);
  else ctx.error(`Copy ${name}: nothing to copy from '${cp}'.`);

  if (gr) ctx.grooves.pop(ctx);

  if (typeof forcedRestore.forceRestoreGroove === 'function') {
    forcedRestore.forceRestoreGroove(COPY_GROOVE);
  } else {
    self.restoreGroove(COPY_GROOVE);
  }
}

/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the Solo class plus the module-level auto-solo state and the
 * chord-line solo extractor at the bottom of MMA/patSolo.py.  SOLO tracks
 * are not saved in grooves (so their sequences/riffs survive a Groove
 * command) unless forceSaveGroove()/forceRestoreGroove() is used.
 *
 * The Python module global `autoSoloTracks` (default SOLO, SOLO-1..3) is
 * per-run state here, held in a WeakMap keyed by the context.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 *
 * Original Python module by Bob van der Poel <bob@mellowood.ca>.
 */

import type { MMAContext } from '../../engine/Context';
import { pextract } from '../../util/Common';
import { BaseTrack } from './BaseTrack';
import { Melody } from './MelodyTrack';
import { trackHooks } from './hooks';

/** Pattern class for a solo track. */
export class Solo extends Melody {
  constructor(ctx: MMAContext, name: string) {
    super(ctx, name, 'SOLO');
  }

  // Grooves are not saved/restored for solo tracks.
  override restoreGroove(_gname: string): void {
    this.setSeqSize();
  }

  override saveGroove(_gname: string): void {
    /* solo tracks are not saved in grooves */
  }

  // Python defines these only on Solo (PC has no force* methods); the
  // Copy command calls them for SOLO tracks, bypassing the overrides.
  forceRestoreGroove(gname: string): void {
    BaseTrack.prototype.restoreGroove.call(this, gname);
  }

  forceSaveGroove(gname: string): void {
    BaseTrack.prototype.saveGroove.call(this, gname);
  }
}

// -------------------------------------------------------------------------
// Auto-solo track names (patSolo.autoSoloTracks)

const DEFAULT_AUTO_SOLO_TRACKS = ['SOLO', 'SOLO-1', 'SOLO-2', 'SOLO-3'];

const autoSoloByCtx = new WeakMap<MMAContext, string[]>();

/** Current auto-solo track list for this run. */
export function getAutoSoloTracks(ctx: MMAContext): string[] {
  return autoSoloByCtx.get(ctx) ?? DEFAULT_AUTO_SOLO_TRACKS;
}

/**
 * Port of patSolo.setAutoSolo: set the order and names of tracks to use
 * when assigning automatic solos (specified on chord lines in {}s).
 */
export function setAutoSolo(ctx: MMAContext, ln: string[]): void {
  if (!ln.length) ctx.rep.error('You must specify at least one track for autosolos');

  const list: string[] = [];
  for (const n0 of ln) {
    const n = n0.toUpperCase();
    trackHooks.trackAlloc(ctx, n, true);
    const t = ctx.tnames.get(n);
    if (!t) continue; // trackAlloc(err=true) always throws when it fails

    if (t.vtype !== 'MELODY' && t.vtype !== 'SOLO') {
      ctx.rep.error(`All autotracks must be Melody or Solo tracks, not ${t.vtype}`);
    }

    list.push(n);
  }

  autoSoloByCtx.set(ctx, list);
  ctx.dPrint(`AutoSolo track names: ${list.join(' ')}`);
}

/** Python str.count() for single characters. */
function countChar(s: string, c: string): number {
  return (s.match(new RegExp(`\\${c}`, 'g')) ?? []).length;
}

/**
 * Port of patSolo.extractSolo: parser calls this to extract solo strings
 * ({...}) from a chord/data line, push them into the auto-solo tracks as
 * riffs, and return the line with the {} data removed.
 */
export function extractSolo(ctx: MMAContext, ln: string, rptcount: number): string {
  const autoSoloTracks = getAutoSoloTracks(ctx);

  const a = countChar(ln, '{');
  const b = countChar(ln, '}');

  if (a !== b) {
    ctx.rep.error('Mismatched {}s for solo found in chord line');
  }

  if (!a) return ln;

  if (rptcount > 1) {
    ctx.rep.error('Bars with both repeat count and solos are not permitted');
  }

  let solo: string[];
  [ln, solo] = pextract(ln, '{', '}');

  if (solo.length > autoSoloTracks.length) {
    ctx.rep.error(
      `Too many melody/solo riffs in chord line. ${solo.length} used, ` +
        `only ${autoSoloTracks.length} defined`,
    );
  }

  const firstSolo = solo[0] ?? ''; // saved for the autoharmony tracks

  // Loop through each solo, ensure/create the MMA track, and push the
  // solo data into a Riff for that track.
  let trk = '';
  for (let i = 0; i < solo.length && i < autoSoloTracks.length; i++) {
    const s = solo[i]!;
    trk = autoSoloTracks[i]!;
    if (!s) continue; // skip placeholder/empty tracks

    trackHooks.trackAlloc(ctx, trk, true);
    const t = ctx.tnames.get(trk);
    if (!t) continue;

    if (t.riff.length) {
      ctx.rep.error(
        `${t.name}: Attempt to add {} solo when the track has pending RIFF data.`,
      );
    }
    t.setRiff(s.trim());
  }

  // Check any leftover tracks: if a track is empty AND is harmony-only,
  // the data from the first track is interpreted again for it.  The set()
  // test in Python means "any bar has harmonyonly set".
  for (const tName of autoSoloTracks.slice(1)) {
    const t = ctx.tnames.get(tName);
    if (t && !t.riff.length && t.harmonyOnly.some((h) => h !== null)) {
      t.setRiff(firstSolo.slice(0));
      ctx.dPrint(`${trk} duplicated to ${tName} for HarmonyOnly.`);
    }
  }

  return ln;
}

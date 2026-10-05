/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/mdefine.py - the MDEFINE MIDI-sequence registry used by
 * the track commands MidiClear, MidiSeq and MidiVoice (and, internally,
 * by the `{...}` inline sequences of those commands).
 *
 * Python keeps a single module-global registry; here the definitions
 * live in a WeakMap keyed by the MMAContext so independent runs (and
 * tests) never share MDEFINE data.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import { ctrlToValue } from '../../midi/voices';
import { pextract, stof, stoi } from '../../util/Common';
import type { MidiSeqDef } from '../tracks/hooks';

const registries = new WeakMap<MMAContext, Map<string, MidiSeqDef>>();

function defs(ctx: MMAContext): Map<string, MidiSeqDef> {
  let d = registries.get(ctx);
  if (!d) {
    d = new Map();
    registries.set(ctx, d);
  }
  return d;
}

/** Port of Mdefine.get(): return a defined sequence or error. */
export function mdefGet(ctx: MMAContext, name: string): MidiSeqDef {
  const d = defs(ctx).get(name.toUpperCase());
  if (!d) ctx.error(`The MDEFINE pattern ${name} has not been defined`);
  return d;
}

/**
 * Port of Mdefine.create(): parse a "NAME <beat> <ctrl> <dat> [; ...]"
 * definition.  A single-value segment refers to another definition.
 */
export function mdefCreate(ctx: MMAContext, name: string, text: string): void {
  // Python: ln.rstrip('; ') then split(';').
  const stripped = text.replace(/[;\s]+$/, '');
  const evs: MidiSeqDef = [];
  for (const part of stripped.split(';')) {
    const l = part.split(/\s+/).filter((w) => w !== '');

    if (l.length === 1) {
      evs.push(...mdefGet(ctx, l[0]!.toUpperCase()));
      continue;
    }

    if (l.length !== 3) {
      ctx.error('MDEFINE sequence must have 3 values: Beat, Ctrl, Datum');
    }

    const off = stof(ctx.rep, l[0]!, 'Value for offset must be integer/float');

    let c = ctrlToValue(l[1]!);
    if (c < 0) {
      c = stoi(ctx.rep, l[1]!);
      if (c < 0 || c > 0x7f) ctx.error('Controller values must be 0x00 to 0x7f');
    }

    const d = stoi(ctx.rep, l[2]!);
    if (d < 0 || d > 0x7f) ctx.error('MIDI Control Datum value must be 0x00 to 0x7f');

    evs.push([off, [c, d]]);
  }

  defs(ctx).set(name.toUpperCase(), evs);
}

/** Port of mdefine.mdefine (the global MIDIDEF command). */
export function mdefine(ctx: MMAContext, ln: string[]): void {
  if (!ln.length) ctx.error('MDefine needs arguments');

  const name = ln[0]!;
  if (name.startsWith('_')) ctx.error('Names with a leading underscore are reserved');
  if (name.toUpperCase() === 'Z') ctx.error("The name 'Z' is reserved");

  mdefCreate(ctx, name, ln.slice(1).join(' '));
}

/**
 * Port of midifuncs.trackMidiExt(): extract `{...}` blocks from a
 * MidiSeq/MidiVoice line, define each as an internal `_n` MDEFINE
 * pattern, and return the line as tokens with the names substituted.
 */
export function trackMidiExt(ctx: MMAContext, line: string): string[] {
  let ln = line;
  let ids = 1;

  for (;;) {
    const sp = ln.indexOf('{');
    if (sp < 0) break;

    const [rest, s] = pextract(ln, '{', '}', true);
    if (!s.length) ctx.error("Did not find matching '}' for '{'");

    const pn = `_${ids}`;
    ids += 1;

    mdefCreate(ctx, pn, s[0]!);
    ln = rest.slice(0, sp) + ' ' + pn + ' ' + rest.slice(sp);
  }

  return ln.split(/\s+/).filter((w) => w !== '');
}

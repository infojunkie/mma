/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the Dtable.get() helper in MMA/translate.py - drum-tone name
 * validation and TONETR translation.
 *
 * Python's Dtable stores its translation table keyed by tone VALUE
 * (`drumToValue(name) -> drumToValue(newName)`); the TypeScript Translator
 * (ctx.dtable) is keyed by NAME, so the lookup below falls back to the
 * validated tone value, matching Python's `except KeyError: return v`.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 *
 * Original Python module by Bob van der Poel <bob@mellowood.ca>.
 */

import type { MMAContext } from '../../engine/Context';
import { drumToValue, instToValue } from '../../midi/voices';

/**
 * Return the MIDI tone value for a drum name, applying the TONETR table.
 * Unknown names error exactly as MMA's Dtable.get() does.
 */
export function dtableGet(ctx: MMAContext, name: string): number {
  const v = drumToValue(name);

  if (v < 0) {
    // The hint is produced by an (odd) instToValue() test in Python.
    const emsg =
      instToValue(name) >= 0 && /^[A-Za-z]/.test(name) ? `(Note: ${name} is a valid TONE name.)` : '';
    ctx.rep.error(`Drum Tone '${name}' not defined. ${emsg}`);
  }

  const tr = ctx.dtable.get(name);
  return typeof tr === 'number' ? tr : v;
}

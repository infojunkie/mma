/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the Trigger class in MMA/trigger.py (the per-track trigger
 * state).  Only the state container and defaults are ported for M1:
 * every track creates one in clearSequence(), the default (mode === null)
 * disables the feature, and the TRIGGER parser directive is not yet
 * ported.  makeTriggerSequence() is an explicit M2 stub.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../../engine/Context';
import type { CTable } from '../CTable';
import type { PatternEvent } from '../PatternEvent';

export class Trigger {
  mode: string | null = null;
  truncate = false;
  count = 1;
  bars: number[] = [];
  beats: number[] = [];
  seq: PatternEvent[] | null = null;
  measures: string[] = [];
  cnames: string[] = [];
  ctonics: string[] = [];

  ctypes: string[] = [];
  override = false;
}

/**
 * M2 stub: MMA/trigger.py makeTriggerSequence() is not ported.  The
 * function is only reachable when the TRIGGER directive has been used,
 * which requires the (unported) parser command.
 */
export function makeTriggerSequence(
  ctx: MMAContext,
  _track: unknown,
  _ctable: CTable[],
  _pattern: PatternEvent[] | null,
): PatternEvent[] {
  return ctx.rep.error(
    'M2: TRIGGER sequences are not ported to TypeScript yet (MMA/trigger.py makeTriggerSequence).',
  );
}

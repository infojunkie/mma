/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the VoiceVolTable / DrumVolTable classes in MMA/translate.py
 * (VOICEVOLTR / DRUMVOLTR).  These tables are process-global in Python and
 * have no home in MMAContext yet, so they live here as module singletons
 * until the translate.py directive port wires them (M2).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

class VolTable {
  private table: Record<number, number> = {};

  /** Replace the whole table (name/value pairs already converted). */
  set(values: Record<number, number>): void {
    this.table = { ...values };
  }

  clear(): void {
    this.table = {};
  }

  entries(): Array<[number, number]> {
    return Object.entries(this.table).map(([k, v]) => [Number(k), v] as [number, number]);
  }

  /** Port of voiceVolTable.get()/drumVolTable.get(): scale or pass through. */
  get(v: number, vol: number): number {
    const adj = this.table[v];
    return adj === undefined ? vol : vol * adj;
  }
}

/** Port of MMA/translate.py voiceVolTable. */
export const voiceVolTable = new VolTable();
/** Port of MMA/translate.py drumVolTable. */
export const drumVolTable = new VolTable();

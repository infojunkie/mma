/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Storage for pattern definitions (Python's `pats` dict in pat.py).
 * Keys are (track type, uppercase pattern name); values are track-defined
 * pattern payloads (Pgroup lists for most tracks, strings for Solo/Melody).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

export type PatternData = unknown;

export class PatternStore {
  private map = new Map<string, PatternData>();

  private key(vtype: string, name: string): string {
    return `${vtype}\u0000${name.toUpperCase()}`;
  }

  get(vtype: string, name: string): PatternData | undefined {
    return this.map.get(this.key(vtype, name));
  }

  set(vtype: string, name: string, pattern: PatternData): void {
    this.map.set(this.key(vtype, name), pattern);
  }

  has(vtype: string, name: string): boolean {
    return this.map.has(this.key(vtype, name));
  }

  delete(vtype: string, name: string): void {
    this.map.delete(this.key(vtype, name));
  }

  clear(): void {
    this.map.clear();
  }
}

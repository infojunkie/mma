/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Static scanner for `DefGroove` definitions in .mma sources.  It is
 * only a hint: the parser verifies groove names after actually parsing
 * a library file (dynamic definitions via macros cannot be seen
 * statically), exactly like the Python implementation does.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

export interface GrooveDef {
  name: string;
  description: string;
}

/** Remove `//` and block comments from an .mma source. */
export function stripMMAComments(text: string): string {
  const out: string[] = [];
  let inComment = false;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw;
    if (inComment) {
      const end = line.indexOf('*/');
      if (end < 0) continue;
      line = line.slice(end + 2);
      inComment = false;
    }
    line = line.split('//', 1)[0]!;
    let idx: number;
    while ((idx = line.indexOf('/*')) >= 0) {
      const end = line.indexOf('*/', idx + 2);
      if (end < 0) {
        line = line.slice(0, idx);
        inComment = true;
        break;
      }
      line = line.slice(0, idx) + line.slice(end + 2);
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Find `DefGroove NAME [description...]` definitions. */
export function findGrooveDefs(text: string): GrooveDef[] {
  const defs: GrooveDef[] = [];
  for (const line of stripMMAComments(text).split('\n')) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length >= 2 && tokens[0]!.toUpperCase() === 'DEFGROOVE') {
      defs.push({ name: tokens[1]!.toUpperCase(), description: tokens.slice(2).join(' ') });
    }
  }
  return defs;
}

export function findGrooveNames(text: string): string[] {
  return findGrooveDefs(text).map((d) => d.name);
}

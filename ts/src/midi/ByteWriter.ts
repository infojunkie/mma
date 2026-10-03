/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/midiM.py - big-endian MIDI value packing helpers.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

export type PackArg = number | Uint8Array | number[] | string;

/** Port of midiM.packBytes: concatenate ints, byte arrays, lists/tuples, strings. */
export function packBytes(...args: PackArg[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const a of args) {
    if (typeof a === 'number') {
      parts.push(new Uint8Array([a & 0xff]));
    } else if (typeof a === 'string') {
      parts.push(encodeText(a));
    } else if (a instanceof Uint8Array) {
      parts.push(a);
    } else if (Array.isArray(a)) {
      parts.push(new Uint8Array(a.map((x) => x & 0xff)));
    } else {
      throw new TypeError(`Unknown type for MIDI packBytes: ${typeof a}`);
    }
  }
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Text encoding used for MIDI meta text (gbl.encoding, default cp1252). */
let textEncoding: 'cp1252' | 'utf-8' = 'cp1252';

export function setTextEncoding(enc: string): void {
  const e = enc.toLowerCase().replace('_', '-');
  textEncoding = e === 'utf-8' || e === 'utf8' ? 'utf-8' : 'cp1252';
}

export function encodeText(s: string): Uint8Array {
  if (textEncoding === 'utf-8') return new TextEncoder().encode(s);
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) out.push(cp);
    else {
      const mapped = CP1252_REVERSE[cp];
      out.push(mapped !== undefined ? mapped : 0x3f); // '?'
    }
  }
  return new Uint8Array(out);
}

const CP1252_REVERSE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

/** Convert INT to a 2 byte MSB LSB value. */
export function intToWord(x: number): Uint8Array {
  return new Uint8Array([(x >> 8) & 0xff, x & 0xff]);
}

/** Convert INT to a 3 byte MSB...LSB value. */
export function intTo3Byte(x: number): Uint8Array {
  return new Uint8Array([(x >> 16) & 0xff, (x >> 8) & 0xff, x & 0xff]);
}

export function byte3ToInt(x: Uint8Array): number {
  return ((x[0]! << 16) | (x[1]! << 8) | x[2]!) >>> 0;
}

/** Convert INT to a 4 byte MSB...LSB value. */
export function intToLong(x: number): Uint8Array {
  return new Uint8Array([(x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff]);
}

/** Convert INT to a variable length MIDI value. */
export function intToVarNumber(x: number): Uint8Array {
  if (x < 0) throw new RangeError(`Negative value ${x} not permitted in MIDI variable length number`);
  const lst = [x & 0x7f];
  let v = x;
  for (;;) {
    v = v >> 7;
    if (v) lst.unshift((v & 0x7f) | 0x80);
    else return new Uint8Array(lst);
  }
}

/** Convert INT to a 2 byte 14 bit number. */
export function intTo14(x: number): Uint8Array {
  if (x < 0 || x > 0x3fff) throw new RangeError('Value out of 14 bit range');
  return new Uint8Array([0x7f & x, x >> 7]);
}

/** Convenience: concatenate byte arrays. */
export function concatBytes(...parts: Array<Uint8Array | number[]>): Uint8Array {
  const arrs = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

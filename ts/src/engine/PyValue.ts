/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * A small Python value model used by the $() expression evaluator
 * (safe_eval.py) and macro expansion (macro.py).  Python distinguishes
 * int and float values and their str() forms; JS numbers do not, so
 * PyNum carries the distinction explicitly.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

/** A Python number: int or float. */
export class PyNum {
  constructor(
    readonly value: number,
    readonly isInt: boolean,
  ) {}

  static int(v: number): PyNum {
    return new PyNum(Number.isFinite(v) ? Math.trunc(v) : v, true);
  }

  static float(v: number): PyNum {
    return new PyNum(v, false);
  }
}

export type PyValue = PyNum | string | boolean | PyValue[];

export function isPyNum(v: PyValue): v is PyNum {
  return v instanceof PyNum;
}

/** Python truthiness. */
export function pyTruthy(v: PyValue): boolean {
  if (v instanceof PyNum) return v.value !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'boolean') return v;
  return v.length > 0;
}

/** Python == (no exceptions for mismatched types, unlike ordering). */
export function pyEquals(a: PyValue, b: PyValue): boolean {
  if (a instanceof PyNum && b instanceof PyNum) return a.value === b.value;
  if (typeof a === 'boolean' && b instanceof PyNum) return (a ? 1 : 0) === b.value;
  if (a instanceof PyNum && typeof b === 'boolean') return a.value === (b ? 1 : 0);
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!pyEquals(a[i]!, b[i]!)) return false;
    return true;
  }
  return false;
}

/** Python str() of a value. */
export function pyStr(v: PyValue): string {
  if (v instanceof PyNum) return v.isInt ? String(v.value) : formatFloat(v.value);
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return '[' + v.map(pyRepr).join(', ') + ']';
}

/** Python repr() of a value (used inside list displays). */
export function pyRepr(v: PyValue): string {
  if (typeof v === 'string') return quoteString(v);
  return pyStr(v);
}

function quoteString(s: string): string {
  const hasSingle = s.includes("'");
  const hasDouble = s.includes('"');
  const quote = hasSingle && !hasDouble ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += '\\' + quote;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else out += ch;
  }
  return out + quote;
}

/**
 * Format a float the way CPython's repr/str does: shortest round-trip
 * digits, positional notation when -4 <= exponent < 16, scientific
 * otherwise (e.g. 1e+16, 1.5e-05), always with a decimal point.
 */
export function formatFloat(v: number): string {
  if (Number.isNaN(v)) return 'nan';
  if (v === Infinity) return 'inf';
  if (v === -Infinity) return '-inf';
  if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0';

  const sign = v < 0 ? '-' : '';
  const [mant, expPart] = Math.abs(v).toExponential().split('e') as [string, string];
  const exponent = Number(expPart);
  const digits = mant.replace('.', '');

  if (exponent >= -4 && exponent < 16) {
    let out: string;
    if (exponent >= digits.length - 1) {
      out = digits + '0'.repeat(exponent - (digits.length - 1)) + '.0';
    } else if (exponent >= 0) {
      out = digits.slice(0, exponent + 1) + '.' + digits.slice(exponent + 1);
    } else {
      out = '0.' + '0'.repeat(-exponent - 1) + digits;
    }
    return sign + out;
  }

  const m = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits[0]!;
  const e = (exponent >= 0 ? '+' : '-') + String(Math.abs(exponent)).padStart(2, '0');
  return `${sign}${m}e${e}`;
}

/**
 * CPython round(): round-half-to-even; returns an int when no ndigits
 * is given, a float otherwise.
 */
export function pyRound(x: number, ndigits?: number): PyNum {
  if (ndigits === undefined) {
    return PyNum.int(pyRoundHalfEven(x, 0));
  }
  const shift = Math.pow(10, ndigits);
  return PyNum.float(shift === 0 ? x : pyRoundHalfEven(x * shift, 0) / shift);
}

function pyRoundHalfEven(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x;
  const shift = Math.pow(10, digits);
  const scaled = x * shift;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let rounded: number;
  if (diff > 0.5) rounded = floor + 1;
  else if (diff < 0.5) rounded = floor;
  else rounded = floor % 2 === 0 ? floor : floor + 1;
  return rounded / shift;
}

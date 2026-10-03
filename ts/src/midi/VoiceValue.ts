/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the voice-value helpers in MMA/midiC.py that are not table
 * lookups: decodeVoice(), voice2tup() and extVocStr().
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { Reporter } from '../engine/Errors';
import { stoi } from '../util/Common';
import { drumToValue, instToValue } from './voices';

/** Runtime voice-translation table (VOICETR command). */
export interface VoiceTranslator {
  get(name: string): string;
}

/** Convert an integer voice value into [voice, lsb, msb]. */
export function voice2tup(x: number): [number, number, number] {
  if (x === -1) return [-1, -1, -1];
  let msb: number;
  let rest = x;
  if (rest > 0xffff) {
    msb = rest >> 16;
    rest &= 0xffff;
  } else {
    msb = 0;
  }
  let lsb: number;
  if (rest > 0xff) {
    lsb = rest >> 8;
    rest &= 0xff;
  } else {
    lsb = 0;
  }
  return [rest, lsb, msb];
}

/** Extended voice value as a string: v.msb.lsb with trailing .0 removed twice. */
export function extVocStr(v: number): string {
  let s = voice2tup(v).join('.');
  if (s.endsWith('.0')) s = s.slice(0, -2);
  if (s.endsWith('.0')) s = s.slice(0, -2);
  return s;
}

/** Convert a voice name/value string into MMA's internal numeric voice value. */
export function decodeVoice(rep: Reporter, vtable: VoiceTranslator, name: string): number {
  const n = vtable.get(name);
  let voc = instToValue(n);

  if (voc < 0 && /^[A-Za-z]/.test(n)) {
    const t = drumToValue(n);
    const emsg = t >= 0 ? `(Note: ${n} is a valid DRUM tone.)` : '';
    rep.error(`Voice '${n}' is not defined. ${emsg}`);
  }

  if (voc < 0) {
    // Not a valid name; assume vv.msb(ctrl0).lsb(ctrl32) value.
    const nn = n.split('.');
    if (nn.length > 3 || nn.length < 1) {
      rep.error(`Expecting a voice value Prog.MSB.LSB, not '${n}'`);
    }
    voc = 0;
    if (nn.length > 2) {
      const i = stoi(rep, nn[2]!);
      if (i < 0 || i > 127) rep.error(`LSB must be 0..127, not '${i}'`);
      voc = i << 16;
    }
    if (nn.length > 1) {
      const i = stoi(rep, nn[1]!);
      if (i < 0 || i > 127) rep.error(`MSB must be 0..127, not '${i}'`);
      voc += i << 8;
    }
    const i = stoi(rep, nn[0]!);
    if (i < 0 || i > 127) rep.error(`Program must be 0..127, not '${i}'`);
    voc += i;
  }
  return voc;
}

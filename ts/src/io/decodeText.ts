/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Decoding helper for .mma sources.  The Python MMA reads source files
 * with `gbl.encoding` (cp1252 by default), and real-world groove files
 * do contain cp1252 characters (degree signs in chord types like `m°`,
 * accented author names, ...).  Browsers fetch bytes; decode them with
 * this helper rather than Response.text() (which assumes UTF-8).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

/** Decode bytes from an .mma source file; default matches MMA (cp1252). */
export function decodeMMAText(bytes: ArrayBuffer | Uint8Array, encoding = 'cp1252'): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new TextDecoder(normalizeEncoding(encoding)).decode(view);
}

function normalizeEncoding(encoding: string): string {
  const e = encoding.toLowerCase().replace(/_/g, '-');
  if (e === 'utf8' || e === 'utf-8') return 'utf-8';
  if (e === 'cp1252' || e === 'windows-1252' || e === 'latin1' || e === 'iso-8859-1') {
    return 'windows-1252';
  }
  return encoding;
}

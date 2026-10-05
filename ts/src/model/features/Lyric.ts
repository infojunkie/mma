/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/lyric.py - lyric extraction from chord lines, the LYRIC
 * command (option), the $_LYRIC system variable (setting) and the
 * end-of-parse leftovers() check.  Python keeps a single module-level
 * Lyric() instance; here one instance exists per MMAContext.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 *
 * Original Python module by Bob van der Poel <bob@mellowood.ca>.
 */

import type { MMAContext } from '../../engine/Context';
import { getTranspose } from './KeySig';
import { getTF, opt2pair, pextract, stof } from '../../util/Common';

export class Lyric {
  textev: number | null = null; // set if TEXT EVENTS (not recommended)
  barsplit: number | null = null; // set if lyrics NOT split into sep. events for bar
  versenum = 1; // current verse number of lyric
  dupchords = 0; // set if we want chords as lyric events
  transpose = 0; // transpose chord names (for dupchords only)
  karmode = 0; // in kar mode use textevents, split at hyphens
  enabled = true; // set true/false
  pushedLyrics: string[] = [];
  hasSetkar = false;

  transNames = [
    ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'],
    ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  ];

  transKey = 0; // 0==flat, 1=sharp

  chordnames: Record<string, number> = {
    'B#': 0, C: 0, 'C#': 1, Db: 1,
    D: 2, 'D#': 3, Eb: 3, E: 4,
    Fb: 4, 'E#': 5, F: 5, 'F#': 6,
    Gb: 6, G: 7, 'G#': 8, Ab: 8,
    A: 9, 'A#': 10, Bb: 10, B: 11,
    Cb: 11,
  };
}

const lyrics = new WeakMap<MMAContext, Lyric>();

/** Per-context Lyric singleton (Python's module-level `lyric`). */
export function getLyric(ctx: MMAContext): Lyric {
  let l = lyrics.get(ctx);
  if (!l) {
    l = new Lyric();
    lyrics.set(ctx, l);
  }
  return l;
}

/** Port of Lyric.setting: the $_LYRIC macro string. */
export function lyricSetting(ctx: MMAContext): string {
  const self = getLyric(ctx);

  let a = 'Event=';
  a += self.textev ? 'Text' : 'Lyric';

  a += ' Split=';
  a += self.barsplit ? 'Bar' : 'Normal';

  a += ` Verse=${self.versenum}`;

  a += ' Chords=';
  a += self.dupchords ? 'On' : 'Off';

  a += ` Transpose=${self.transpose}`;

  a += ' CNames=';
  a += self.transKey ? 'Sharp' : 'Flat';

  a += ' KAR=';
  a += self.karmode ? 'On' : 'Off';

  return a;
}

/** Port of Lyric.option: set a lyric option (the LYRIC command). */
export function lyricOption(ctx: MMAContext, input: string[]): void {
  const self = getLyric(ctx);
  let ln = [...input];
  const [words, opts] = opt2pair(ln);
  ln = words;

  for (const { option, value } of opts) {
    const o = option.toUpperCase();
    const v = value.toUpperCase();

    if (o === 'EVENT') {
      if (v === 'TEXT') {
        self.textev = 1;
        ctx.rep.warning('Lyric: Placing lyrics as TEXT EVENTS is not recommended');
      } else if (v === 'LYRIC') {
        self.textev = null;
        ctx.dPrint('Lyric: lyrics set as LYRIC events.');
      } else {
        ctx.rep.error('Lyric: Valid options for EVENT are TEXT or LYRIC.');
      }
    } else if (o === 'SPLIT') {
      if (v === 'BAR') {
        self.barsplit = 1;
        ctx.dPrint('Lyric: lyrics distributed thoughout bar.');
      } else if (v === 'NORMAL') {
        self.barsplit = null;
        ctx.dPrint('Lyric: lyrics appear as one per bar.');
      } else {
        ctx.rep.error('Lyric: Valid options for SPLIT are BAR or NORMAL.');
      }
    } else if (o === 'VERSE') {
      if (/^[\p{Nd}]+$/u.test(v)) {
        self.versenum = parseInt(v, 10);
      } else if (v === 'INC') {
        self.versenum += 1;
      } else if (v === 'DEC') {
        self.versenum -= 1;
      } else {
        ctx.rep.error('Lyric: Valid options for VERSE are <nn>, INC or DEC');
      }

      if (self.versenum < 1) {
        ctx.rep.error(`Lyric: Attempt to set Verse to ${self.versenum}. Values must be > 0`);
      }

      ctx.dPrint(`Lyric: Verse number set to ${self.versenum}`);
    } else if (o === 'CHORDS') {
      self.dupchords = getTF(ctx.rep, v, 'Lyric Chords') ? 1 : 0;
      ctx.dPrint(
        self.dupchords
          ? 'Lyric: Chords are duplicated as lyrics.'
          : 'Lyric: Chords are NOT duplicated as lyrics.',
      );
    } else if (o === 'TRANSPOSE') {
      let addTrans = false;
      let vv: string | number = v;
      for (const t of v.split(',')) {
        if (t.toUpperCase() === 'ADD') {
          // keyword
          addTrans = true;
        } else {
          // either int or up-maj-3, etc.
          vv = getTranspose(ctx, [t], 'Lyric Transpose');
        }
      }

      if (addTrans) {
        self.transpose += vv as number;
      } else {
        self.transpose = vv as number;
      }

      ctx.dPrint(`Lyric: Chord names transposed ${self.transpose} steps.`);
    } else if (o === 'ADDTRANSPOSE') {
      self.transpose += getTranspose(ctx, [v], 'Lyric AddTranspose');
      ctx.dPrint(`Lyric: Chord names transposed ${self.transpose} steps.`);
    } else if (o === 'CNAMES') {
      if (v === '#' || v === 'SHARP') {
        self.transKey = 1;
      } else if (v === 'B' || v === '&' || v === 'FLAT') {
        self.transKey = 0;
      } else {
        ctx.rep.error(`Lyric CNames: expecting 'Sharp' or 'Flat', not '${v}'`);
      }

      ctx.dPrint(`Lyric: Chord names favor ${self.transKey ? '#' : 'b'}.`);
    } else if (o === 'KARMODE') {
      const k = getTF(ctx.rep, v, 'Lyric Kar');
      if (k) {
        self.karmode = 1;
        if (!self.hasSetkar) {
          self.hasSetkar = true;
          const meta = ctx.metaTrack();
          const mt = meta.miditrk;
          if (mt.has(0)) {
            const events = mt.get(0)!;
            let txt: string | null = null;
            for (let t = 0; t < events.length; t++) {
              const ev = events[t]!;
              if (ev[1] === 1) {
                const body = ev.slice(3);
                if (startsWithAscii(body, 'Created by MMA')) {
                  txt = '@I ' + bytesToAscii(body);
                  events.splice(t, 1);
                  break;
                }
              }
            }
            if (txt) meta.addText(0, txt);
          }
          // other kar fields
          meta.addText(0, '@KMIDI KARAOKE FILE');
          meta.addText(0, '@V0100');
          // Python changes the default output extension to .kar here;
          // the TypeScript façade owns the output name, so that is a no-op.
        }
      }

      ctx.dPrint(`Lyric: Karmode ${self.karmode ? 'ENABLED.' : 'DISABLED.'}`);
    } else {
      ctx.rep.error(
        `Usage: Lyric expecting EVENT, SPLIT, VERSE, CHORDS, TRANSPOSE,` +
          `CNAMES, KARMODE, ENABLE or SET, not '${o}'`,
      );
    }
  }

  // All the opt=value options have been taken care of.  ln can now only
  // contain "On", "OFF" or "Set ..."  Anything else is an error.
  for (;;) {
    if (!ln.length) return;

    const w = ln[0]!.toUpperCase();
    if (w === 'OFF') {
      // Python sets a local 'enable' here and never uses it (the class
      // attribute self.enabled is never updated); reproduced as a no-op.
      ln = ln.slice(1);
    } else if (w === 'ON') {
      ln = ln.slice(1);
    } else if (w === 'SET') {
      let s = ln.slice(1).join(' ').trim();
      if (!s.startsWith('[')) s = '[' + s + ']';
      self.pushedLyrics.push(s);
      ln = [];
    } else {
      ctx.rep.error(`Lyric: Unknown option '${ln[0]}'.`);
    }
  }
}

/** Port of Lyric.leftovers: report leftovers on stack. */
export function lyricLeftovers(ctx: MMAContext): void {
  const self = getLyric(ctx);
  if (self.pushedLyrics.length) {
    ctx.rep.warning('Lyrics remaining on stack');
  }
}

/**
 * Port of Lyric.extract: extract lyric info from a chord line and place
 * it in the META track.  Returns the line and the lyric syllables (for
 * debugging); the lyrics have already been inserted into the MIDI track.
 */
export function lyricExtract(
  ctx: MMAContext,
  ln0: string,
  rpt: number,
): [string, string[]] {
  const self = getLyric(ctx);
  let ln = ln0;

  let a = (ln.match(/\[/g) ?? []).length;
  let b = (ln.match(/\]/g) ?? []).length;

  if (a !== b) {
    ctx.rep.error('Mismatched []s for lyrics found in chord line');
  }

  if (self.pushedLyrics.length) {
    if (a || b) {
      ctx.rep.error('Lyrics not permitted inline and as LYRIC SET');
    }
    ln = ln + self.pushedLyrics.shift()!;
    a = b = 1; // flag that we have lyrics; count really doesn't matter
  }
  void a;
  void b;

  let lyrics: string[];
  [ln, lyrics] = pextract(ln, '[', ']');

  // If the CHORDS=TRUE option is set, make a copy of the chords and
  // insert as lyric.  This permits illegal chord lines, but they will be
  // caught by the parser.  NOTE: Also discards [] or SET lyrics.
  if (self.dupchords) {
    const ly: string[] = [];
    for (let v of ln.split(/\s+/).filter((x) => x !== '')) {
      if (v !== '/') {
        v = v.replace(/&/g, 'b'); // remember, "&" is optional

        if (v === 'z' || v === 'z!') {
          // convert plain z to "NC"
          v = 'N.C.';
        }

        if (v.includes('z')) {
          // strip out the 'zCDA..' after the chord
          v = v.split('z')[0]!;
        }

        v = v.replace(/^[+-]+/, ''); // strip off leading "+" and "-"

        if (self.transpose) {
          // transpose will be set to 0, 1, -1, etc.
          let t: number | null = null; // needed in case line is not a chord
          let cn = '';
          try {
            // try for 2 char chord name (F#, Gb, etc)
            cn = v.slice(0, 2);
            t = self.chordnames[cn]! + self.transpose;
            if (t === undefined || Number.isNaN(t)) throw new Error('no');
          } catch {
            try {
              // try 1 char chord name (C, D, etc)
              cn = v.slice(0, 1);
              t = self.chordnames[cn]! + self.transpose;
              if (t === undefined || Number.isNaN(t)) throw new Error('no');
            } catch {
              t = null; // not a chord pitch
            }
          }

          if (t !== null) {
            // use None, 0 is okay
            while (t >= 12) t -= 12;
            while (t <= -12) t += 12;

            // Python indexes the 12-name list with a negative value.
            const idx = t < 0 ? t + 12 : t;
            v = self.transNames[self.transKey]![idx]! + v.slice(cn.length);
          }
        }
      }
      ly.push(v);
    }

    const i = Math.trunc(ctx.QperBar - ly.length);
    if (i > 0) {
      for (let x = 0; x < i; x++) ly.push('/');
    }
    lyrics.unshift(ly.join(' ') + '\\r');
  }

  let v = self.versenum;

  if (lyrics.length === 1) v = 1;

  let lyText: string;
  if (v > lyrics.length) lyText = '';
  else lyText = lyrics[v - 1]!;

  if (!lyText.length) return [ln, []];

  lyText = lyText.replace(/\\r/g, ' \\r ');
  lyText = lyText.replace(/\\n/g, ' \\n ');
  lyText = lyText.replace(/ {5}/g, ' ');

  if (self.karmode) {
    lyText = lyText.replace(/\\-/g, '\x01');
    lyText = lyText.replace(/-/g, '\x00 ');
  }

  let syllables: string[];
  if (self.barsplit) syllables = [lyText];
  else syllables = lyText.split(/\s+/).filter((w) => w !== '');

  let beat = 0;
  let bstep = ctx.QperBar / syllables.length;

  for (let t = 0; t < syllables.length; t++) {
    let [aStr, bSubs] = pextract(syllables[t]!, '<', '>', true);

    if (self.dupchords) {
      aStr = aStr.split('@')[0]!; // ignore chord position marker
    }

    if (bSubs.length && bSubs[0]) {
      beat = stof(ctx.rep, bSubs[0]!, `Expecting value in <${bSubs.join(' ')}> in lyric`);
      if (beat < 1 || beat > ctx.QperBar + 1) {
        ctx.rep.error(`Offset in lyric <> must be 1 to ${ctx.QperBar}`);
      }
      beat -= 1;
      bstep = (ctx.QperBar - beat) / (syllables.length - t);
    }

    aStr = aStr.replace(/\\r/g, '\r');
    aStr = aStr.replace(/\\n/g, '\n');

    if (aStr && aStr !== ' ') {
      if (aStr && self.karmode && (aStr.includes('\x00') || aStr.includes('\x01'))) {
        aStr = aStr.replace(/\x00/g, '');
        aStr = aStr.replace(/\x01/g, '-');
      } else if (
        !aStr.endsWith('-') &&
        !aStr.endsWith('\n') &&
        !aStr.endsWith('\r')
      ) {
        aStr += ' ';
      }

      // Call midi module to add lyric syllable to the MIDI track
      const p = ctx.getOffset(beat * ctx.BperQ);
      if (self.enabled) {
        if (self.textev || self.karmode) {
          ctx.mtrks.meta().addText(p, aStr);
        } else {
          ctx.mtrks.meta().addLyric(p, aStr);
        }
      }
    }
    beat += bstep;
  }

  void rpt; // Python ignores the repeat count here
  return [ln, syllables];
}

// ---------------------------------------------------------------------
// Small byte helpers for the karmode meta scan.

function bytesToAscii(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

function startsWithAscii(bytes: Uint8Array, text: string): boolean {
  if (bytes.length < text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

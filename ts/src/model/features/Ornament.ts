/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/ornament.py - all ornamentation functions.  Every track
 * keeps an ornaments record created by `defaultOrnaments()`; the type is
 * null until an ORNAMENT command (setOrnament) enables it, and the track
 * BAR code calls doOrnament() when a type is set.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 *
 * Original Python module by Bob van der Poel <bob@mellowood.ca>.
 */

import type { MMAContext } from '../../engine/Context';
import type { PatternEvent } from '../PatternEvent';
import { getRndPair } from '../tracks/BaseTrack';
import type { BaseTrack } from '../tracks/BaseTrack';
import { getTF, opt2pair, stof, stoi } from '../../util/Common';
import { formatFloat } from '../../engine/PyValue';

export interface Ornaments {
  type: string | null;
  chromatic: boolean;
  duration: number;
  pad: [number, number];
  place: string;
  volume: number;
  beats: number[];
  bars: number[];
  rskip: number;
  rvolume: [number, number];
  count: number;
  offset: number;
  /**
   * Python int/float tracking for the option string: rskip/offset/rvolume
   * default to ints ("0") and only become floats when set ("0.0").  This
   * matters because the option string is re-parsed by songs that feed
   * $_TRACK_ORNAMENT back into the ORNAMENT command.
   */
  rskipInt: boolean;
  offsetInt: boolean;
  rvolumeInt: boolean;
}

/** Port of MMA/ornament.py default(). */
export function defaultOrnaments(): Ornaments {
  return {
    type: null,
    chromatic: false,
    duration: 0.2,
    pad: [0.1, 0.1],
    place: 'ABOVE',
    volume: 0.75,
    beats: [],
    bars: [],
    rskip: 0,
    rvolume: [0, 0],
    count: 5,
    offset: 0,
    rskipInt: true,
    offsetInt: true,
    rvolumeInt: true,
  };
}

/** Port of ornament.getOrnOpts: the $_TRACK_ORNAMENT setting string. */
export function getOrnOpts(track: BaseTrack): string {
  const o = track.ornaments;

  const bars = o.bars.length ? o.bars.map((i) => String(i + 1)).join(',') : 'ALL';
  const beats = o.beats.length
    ? o.beats.map((i) => formatFloat(1 + i / track.ctx.BperQ)).join(',')
    : 'ALL';

  return (
    `Type=${(o.type === null ? 'None' : o.type).toUpperCase()} Chromatic=${o.chromatic ? 'ON' : 'OFF'} ` +
    `Duration=${formatFloat(o.duration * 100)} Count=${o.count} ` +
    `Pad=${formatFloat(o.pad[0] * 100)},${formatFloat(o.pad[1] * 100)} ` +
    `Offset=${o.offsetInt ? String(o.offset) : formatFloat(o.offset)} ` +
    `Volume=${formatFloat(o.volume * 100)} ` +
    `RVolume=${o.rvolume.map((x) => (o.rvolumeInt ? String(x) : formatFloat(x * 100))).join(',')} ` +
    `Place=${o.place} Beats=${beats} ` +
    `Rskip=${o.rskipInt ? String(o.rskip) : formatFloat(o.rskip * 100)} Bars=${bars}`
  );
}

/** Port of ornament.setOrnament: add an ornamentation option. */
export function setOrnament(ctx: MMAContext, track: BaseTrack, ln: string[]): void {
  const o = (track.ornaments = defaultOrnaments());
  const [notopt, optpair] = opt2pair(ln);

  if (!['CHORD', 'BASS', 'WALK', 'ARPEGGIO', 'SCALE'].includes(track.vtype)) {
    ctx.rep.error(`Ornament is not valid in ${track.vtype} tracks.`);
  }

  if (
    (notopt.length === 1 && ['NONE', 'OFF'].includes(notopt[0]!.toUpperCase())) ||
    (!notopt.length && !optpair.length)
  ) {
    o.type = null;
    ctx.dPrint(`${track.name} Ornament: Off`);
    return;
  }

  if (notopt.length || !optpair.length) {
    ctx.rep.error(
      `${track.name} Ornament: expecting cmd=opt pairs,not '${notopt.join(' ')}'.`,
    );
  }

  for (const pair of optpair) {
    const cmd = pair.option.toUpperCase();
    const opt = pair.value.toUpperCase();

    if (cmd === 'TYPE') {
      if (['MORDENT', 'TRILL', 'TURN', 'GRACE', '3AFTER', 'FALL', 'GLISS', 'GLISSAFTER'].includes(opt)) {
        o.type = opt;
      } else {
        ctx.rep.error(`${track.name} Ornament Type: '${opt}' is an unknown type.`);
      }
    } else if (cmd === 'COUNT') {
      o.count = stoi(ctx.rep, opt);
      if (o.count <= 0) {
        ctx.rep.error(
          `${track.name} Ornament Count: value must be positive integer, not '${opt}'.`,
        );
      }
    } else if (cmd === 'CHROMATIC') {
      o.chromatic = getTF(ctx.rep, opt, `${track.name} Ornament Chromatic`);
    } else if (cmd === 'DURATION') {
      const v = stof(ctx.rep, opt);
      if (v < 0 || v > 100) {
        ctx.rep.error(
          `${track.name} Ornament Duration: values must be greater than 0 and less that 100, not '${v}'.`,
        );
      }
      o.duration = v / 100;
    } else if (cmd === 'PAD') {
      const pad: number[] = [];
      for (const v0 of opt.split(',', 2)) {
        const v = stof(ctx.rep, v0);
        if (v < -100 || v > 100) {
          ctx.rep.error(`${track.name} Ornament Pad: values must be -100...100, not '${v}'`);
        }
        pad.push(v / 100);
      }
      if (pad.length === 1) pad.push(pad[0]!);
      o.pad = [pad[0]!, pad[1]!];
    } else if (cmd === 'PLACE') {
      if (!['ABOVE', 'BELOW', 'RANDOM'].includes(opt)) {
        ctx.rep.error(
          `${track.name} Ornament Place: must be ABOVE, BELOW or RANDOM, not '${opt}'.`,
        );
      }
      o.place = opt;
    } else if (cmd === 'VOLUME') {
      const t = stof(ctx.rep, opt);
      if (t > 0 && t <= 1000) {
        o.volume = t / 100;
      } else {
        ctx.rep.error(
          `${track.name} Ornament Volume: must be greater than 0 and less that 1000, not '${opt}'.`,
        );
      }
    } else if (cmd === 'BEATS') {
      o.beats = [];
      if (opt !== 'ALL') {
        for (const t of opt.split(',')) {
          // Python renames the track for the error message in setBarOffset().
          const z = track.name;
          (track as unknown as { name: string }).name = `${z} Ornament beats`;
          try {
            o.beats.push(track.setBarOffset(t));
          } finally {
            (track as unknown as { name: string }).name = z;
          }
        }
      }
    } else if (cmd === 'RSKIP') {
      const v = stof(ctx.rep, opt);
      if (v < 0 || v > 100) {
        ctx.rep.error(`${track.name} Ornament Rskip: must be 0 .. 100, not '${v}'.`);
      }
      o.rskip = v / 100;
      o.rskipInt = false;
    } else if (cmd === 'RVOLUME') {
      const [n1, n2] = getRndPair(ctx.rep, opt, `${track.name} Ornament`, -100, 100);
      o.rvolume = [n1 / 100, n2 / 100];
      o.rvolumeInt = false;
    } else if (cmd === 'BARS') {
      o.bars = [];
      if (opt !== 'ALL') {
        for (const t of opt.split(',')) {
          const v = stoi(ctx.rep, t);
          if (v < 1 || v > ctx.seqSize) {
            ctx.rep.warning(
              `${track.name} Ornament Bars: setting of ${v} may be ignored since SeqSize is ${ctx.seqSize}.`,
            );
          }
          o.bars.push(v - 1);
        }
      }
    } else if (cmd === 'OFFSET') {
      const v = stof(ctx.rep, opt);
      if (v < -ctx.BperQ || v > ctx.BperQ) {
        ctx.rep.error(
          `${track.name} Ornament Offset: must be ${-ctx.BperQ} .. ${ctx.BperQ}, not '${v}' ` +
            `(note: value is MIDI ticks).`,
        );
      }
      o.offset = v;
      o.offsetInt = false;
    } else {
      ctx.rep.error(`${track.name} Ornament: '${cmd}' is an unknown option.`);
    }
  }

  ctx.dPrint(`${track.name} Ornament: ${getOrnOpts(track)}`);
}

/** Port of ornament.getNote: calc a new note (the ornament) from the original. */
export function getNote(
  ctx: MMAContext,
  o: Ornaments,
  orig: number,
  scale: number[],
  off: number,
): number {
  if (o.place === 'BELOW') {
    off *= -1;
  } else if (o.place === 'RANDOM') {
    off = ctx.rng.choice([1, -1]);
  }

  // Chromatic is easy.
  if (o.chromatic) {
    return orig + off;
  }

  let inoct = orig; // a copy of the original note adjusted to be in a 0..12
  let oadjust = 0; // range. this lets us find it in the scale list.

  // Adjust 'inoct' to be in the scale list.  The original note could be
  // '44' which is not in any scale list, so adjust it down by '12's until
  // it's in range, keeping track of the opposite adjustment.
  while (inoct > scale[scale.length - 1]!) {
    oadjust += 12;
    inoct -= 12;
  }
  while (inoct < scale[0]!) {
    oadjust -= 12;
    inoct += 12;
  }

  let nn: number;
  if (scale.includes(inoct)) {
    const i = scale.indexOf(inoct); // position of the note in the scale

    nn = i + off; // new note is just offset + old

    // adjust new into scale list
    while (nn >= scale.length) {
      oadjust += 12;
      nn -= scale.length;
    }
    while (nn < 0) {
      oadjust -= 12;
      nn += scale.length;
    }
    nn = scale[nn]! + oadjust; // new note, plus octave
  } else {
    // opps, not in scale, do chromatic adjustment
    nn = orig + off;
  }

  return nn;
}

/** Port of ornament.getOvolume: apply the ornament VOLUME and RVOLUME. */
export function getOvolume(ctx: MMAContext, o: Ornaments, nvol: number): number {
  let vol = Math.trunc(nvol * o.volume);
  let r1 = Math.trunc(vol * o.rvolume[0]);
  let r2 = Math.trunc(vol * o.rvolume[1]);
  if (r1 || r2) {
    if (r2 < r1) [r1, r2] = [r2, r1];
    vol += ctx.rng.randrange(r1, r2);
  }
  return vol;
}

/** Port of ornament.getNOdur: actual durations for note and ornament. */
export function getNOdur(o: Ornaments, noteDur: number, ornamentDur: number): [number, number] {
  return [
    Math.trunc(noteDur + noteDur * o.pad[0]),
    Math.trunc(ornamentDur + ornamentDur * o.pad[1]),
  ];
}

/**
 * Port of ornament.doOrnament: ornament the first note/duration passed
 * and return the offset of the main note (for CHORD/harmony lining up).
 */
export function doOrnament(
  ctx: MMAContext,
  track: BaseTrack,
  nlist: Array<[number, number]>,
  scale: number[],
  p: PatternEvent,
): number {
  const o = track.ornaments;
  const ornament = o.type;
  const orn_duration = o.duration;
  const orn_beats = o.beats;
  const orn_rskip = o.rskip;
  const orn_bars = o.bars;
  const orn_offset = o.offset;
  let orn_count = o.count; // only effects gliss

  const [note, nvol] = nlist[0]!; // unpack the first note/duration passed.

  // if there is a beat list and the current note is not in the list
  // or if not the right seq bar, we send that note out without ornamentation.

  // Every reachable branch below assigns retoffset.
  let retoffset: number = p.offset;

  // skip over bars, beats and random
  if (
    (orn_beats.length && !orn_beats.includes(p.offset)) ||
    (orn_bars.length && !orn_bars.includes(ctx.seqCount)) ||
    (orn_rskip && ctx.rng.random() < orn_rskip)
  ) {
    track.sendChord([[note, nvol]], p.duration, p.offset);
    retoffset = p.offset;
    return retoffset;
  }

  if (ornament === 'GRACE') {
    // short note before main
    const gnote = getNote(ctx, o, note, scale, 1);
    const odur = Math.trunc(p.duration * orn_duration);
    const ndur = p.duration - odur;
    const [noteDur, ornamentDur] = getNOdur(o, ndur, odur);
    const ovol = getOvolume(ctx, o, nvol);
    track.sendChord([[gnote, ovol]], ornamentDur, p.offset + orn_offset);
    track.sendChord([[note, nvol]], noteDur, p.offset + odur);
    retoffset = p.offset + odur;
  } else if (ornament === 'FALL') {
    // short note after main (reverse grace)
    const gnote = getNote(ctx, o, note, scale, 1);
    const odur = Math.trunc(p.duration * orn_duration);
    const ndur = p.duration - odur;
    const ovol = getOvolume(ctx, o, nvol);
    const [noteDur, ornamentDur] = getNOdur(o, ndur, odur);

    track.sendChord([[note, nvol]], ornamentDur, p.offset);
    track.sendChord([[gnote, ovol]], noteDur, p.offset + ndur + orn_offset);
    retoffset = p.offset;
  } else if (ornament === 'TRILL') {
    const tnote = getNote(ctx, o, note, scale, 1);
    const odur = Math.trunc(p.duration * orn_duration);
    const [noteDur] = getNOdur(o, odur, odur);
    let offset = p.offset;
    const n = odur ? Math.trunc(p.duration / odur / 2) : 0; // number of pairs
    const count = n < 1 ? 1 : n; // ensure at least 1 pair
    for (let t = 0; t < count; t++) {
      track.sendChord([[note, getOvolume(ctx, o, nvol)]], noteDur, offset);
      track.sendChord(
        [[tnote, getOvolume(ctx, o, nvol)]],
        noteDur,
        offset + odur + orn_offset,
      );
      offset += odur + odur;
    }
    retoffset = p.offset;
  } else if (ornament === 'MORDENT') {
    // note, above, note
    const onote = getNote(ctx, o, note, scale, 1);
    const odur = Math.trunc((p.duration * orn_duration) / 2);
    const ndur = p.duration - odur - odur;
    const [noteDur, ornamentDur] = getNOdur(o, ndur, odur);

    track.sendChord([[note, getOvolume(ctx, o, nvol)]], ornamentDur, p.offset + orn_offset);
    track.sendChord(
      [[onote, getOvolume(ctx, o, nvol)]],
      ornamentDur,
      p.offset + odur + orn_offset,
    );
    track.sendChord([[note, nvol]], noteDur, p.offset + odur + odur);
    retoffset = p.offset + odur + odur;
  } else if (ornament === 'TURN') {
    // above, note, below, note
    const note1 = getNote(ctx, o, note, scale, 1);
    const note2 = getNote(ctx, o, note, scale, -1);
    const odur = Math.trunc((p.duration * orn_duration) / 3);
    const ndur = p.duration - odur * 3;
    const [noteDur, ornamentDur] = getNOdur(o, ndur, odur);
    track.sendChord(
      [[note1, getOvolume(ctx, o, nvol)]],
      ornamentDur,
      p.offset + orn_offset,
    );
    track.sendChord(
      [[note, getOvolume(ctx, o, nvol)]],
      ornamentDur,
      p.offset + odur + orn_offset,
    );
    track.sendChord(
      [[note2, getOvolume(ctx, o, nvol)]],
      ornamentDur,
      p.offset + odur * 2 + orn_offset,
    );
    track.sendChord([[note, nvol]], noteDur, p.offset + odur * 3);
    retoffset = p.offset + odur * 3;
  } else if (ornament === '3AFTER') {
    // note, 2above, 1above, 2above
    const note1 = getNote(ctx, o, note, scale, 1);
    const note2 = getNote(ctx, o, note, scale, 2);

    const odur = Math.trunc((p.duration * orn_duration) / 3);
    const ndur = p.duration - odur * 3;
    const [noteDur, ornamentDur] = getNOdur(o, ndur, odur);

    track.sendChord([[note, nvol]], noteDur, p.offset);
    track.sendChord(
      [[note2, getOvolume(ctx, o, nvol)]],
      ornamentDur,
      p.offset + ndur + orn_offset,
    );
    track.sendChord(
      [[note1, getOvolume(ctx, o, nvol)]],
      ornamentDur,
      p.offset + ndur + odur + orn_offset,
    );
    track.sendChord(
      [[note2, getOvolume(ctx, o, nvol)]],
      ornamentDur,
      p.offset + ndur + odur + odur + orn_offset,
    );
    retoffset = p.offset;
  } else if (ornament === 'GLISS' || ornament === 'GLISSAFTER') {
    // notes before or after

    // Make sure that each note in the gliss sounds for at least a tick.
    if (orn_duration * p.duration < orn_count) {
      orn_count = Math.trunc(orn_duration * p.duration);
    }

    // Create a list of gliss notes
    const gliss: number[] = [];
    for (let n = 1; n <= orn_count; n++) {
      const nn = getNote(ctx, o, note, scale, n);
      gliss.unshift(nn);
    }

    const odur = Math.trunc((p.duration * orn_duration) / orn_count);
    const ndur = p.duration - odur * orn_count;
    const [noteDur, ornamentDur] = getNOdur(o, ndur, odur);

    let y = p.offset;

    if (ornament === 'GLISSAFTER') {
      track.sendChord([[note, nvol]], noteDur, y);
      retoffset = y;
      y += ndur;
    }

    for (const n of gliss) {
      track.sendChord([[n, getOvolume(ctx, o, nvol)]], ornamentDur, y);
      y += odur;
    }

    if (ornament === 'GLISS') {
      track.sendChord([[note, nvol]], noteDur, y);
      retoffset = y;
    }
  } else {
    // Unreachable for callers that check ornaments.type first.
    retoffset = ctx.rep.error(`Unknown ornament type '${String(ornament)}'.`);
  }

  // when done we return the offset of the main note.  This is only used
  // by CHORD so that the other notes in the chord line up.
  return retoffset;
}

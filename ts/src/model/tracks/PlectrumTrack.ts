/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/patPlectrum.py - the PLECTRUM track: a guitar-like track
 * with a tuning, per-string pluck volumes, strum timing, chord shapes
 * and (optionally) fret noise played on a BASS track.
 *
 * Python keeps the "stop strings on groove change" switch in the module
 * global patPlectrum.plectrumReset; here it lives in the per-run state
 * table (model/tracks/Defaults.ts), set by `Tweaks PlectrumReset=...`.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 *
 * Original Python module by Bob van der Poel <bob@mellowood.ca>,
 * Louis James Barman.
 */

import type { MMAContext } from '../../engine/Context';
import type { CTable } from '../CTable';
import { PlectrumEvent, type Pattern } from '../PatternEvent';
import { getNoteLen } from '../NoteLen';
import { opt2pair, stoi } from '../../util/Common';
import { formatFloat } from '../../engine/PyValue';
import { BaseTrack, titleCase, type GrooveData } from './BaseTrack';
import { trackHooks } from './hooks';

/** One candidate finger position (Python's bare PlecStruct). */
interface Fret {
  pitch: number;
  /** Fret number, or null for a muted string. */
  fretNo: number | null;
  /** Index of the chord note used for this string. */
  chordIndex: number;
  duplicate: boolean;
}

/** State of one sounding string (patPlectrum's vibration structs). */
class Vibrating {
  /** MIDI note, or null when the string is not vibrating. */
  note: number | null = null;
  /** Tick offset of the note-on. */
  offset: number | null = null;
  /** Volume of the sounding note (set when the string is plucked). */
  volume = 0;
}

/** Fret-noise options (patPlectrum.Fnoise). */
export class Fnoise {
  track: string | null = null;
  strings: number[] = [];
  /** Note duration in ticks; default 1/4 note. */
  duration = 192;
  /** Octave adjustment in semitones. */
  octave = 0;
  /** Max number of noises per beat. */
  max = 1;
  /** Beat filter (bar offsets); empty means all. */
  beats: number[] = [];
  /** Bar filter (0-based); empty means all. */
  bars: number[] = [];
}

interface PlectrumGrooveData extends GrooveData {
  CAPO: number;
  TUNING: number[];
  PSTRUM: number;
}

/** Convert a name ('e', 'g#') to a MIDI pitch (patPlectrum.noteNameToMidiPitch). */
export function noteNameToMidiPitch(s: string): number | null {
  const tb: Record<string, number> = {
    c: 0, 'c#': 1, 'd&': 1, d: 2, 'd#': 3, 'e&': 3,
    e: 4, 'f&': 4, 'e#': 5, f: 5, 'f#': 6, 'g&': 6,
    g: 7, 'g#': 8, 'a&': 8, a: 9, 'a#': 10, 'b&': 10,
    b: 11, 'c&': 11, 'b#': 0,
  };

  // Strip and count trailing '+' and '-'.
  if (s.includes('-') && s.includes('+')) return null;

  let adjust = 0;
  while (s.endsWith('-')) {
    adjust -= 12;
    s = s.slice(0, -1);
  }
  while (s.endsWith('+')) {
    adjust += 12;
    s = s.slice(0, -1);
  }

  const value = tb[s];
  if (value === undefined) return null; // puts into middle octave 60==5*12
  return value + adjust;
}

function arraysEqual<T>(a: readonly T[], b: readonly (T | null)[] | null | undefined): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class PlectrumTrack extends BaseTrack {
  /** Vibrating strings; index 0 is the lowest string (patPlectrum._vibrating). */
  vibrating: Vibrating[] = [];
  /** Last note-off per string, for fret noise (patPlectrum._lastOff). */
  lastOff: Array<Vibrating | null> = [];
  /** MIDI pitch of each open string. */
  tuning: number[] = [];
  /** Strum center: 0=start, 1=center, 2=end. */
  strumCenter = 0;
  /** Capo position in frets (may be negative). */
  capoFretNo = 0;
  fretNoise: Fnoise | null = null;
  /** Chord-name -> fret list; null entries are muted strings. */
  chordShapes = new Map<string, Array<number | null>>();
  /** Previous chord name for fret-noise triggering (Python lastChord). */
  plectrumLastChord: string | null = null;

  // printChordShape() memo (Python uses hasattr on these).
  private previousChordList?: number[];
  private previousFretNo?: number;
  private previousShape?: Array<number | null> | null;

  constructor(ctx: MMAContext, name: string) {
    super(ctx, name, 'PLECTRUM');
    this.setPlectrumTuning(['e-', 'a-', 'd', 'g', 'b', 'e+']);
  }

  /** Save special/local variables for groove. */
  override saveGroove(gname: string): void {
    super.saveGroove(gname); // create storage first
    const g = this.grooves.get(gname) as PlectrumGrooveData;
    g.CAPO = this.capoFretNo;
    g.TUNING = [...this.tuning];
    g.PSTRUM = this.strumCenter;
  }

  /** Restore special/local variables for groove. */
  override restoreGroove(gname: string): void {
    const g = this.grooves.get(gname) as PlectrumGrooveData | undefined;
    if (g) {
      this.capoFretNo = g.CAPO;
      this.tuning = [...g.TUNING];
      this.strumCenter = g.PSTRUM;
    }
    super.restoreGroove(gname);
  }

  /** Set some initial values.  Called from init and clear seq. */
  override clearSequence(): void {
    super.clearSequence();
    this.capoFretNo = 0;
    // Not sure if this is necessary, but safer!  (channel is 0 while the
    // base constructor runs, before the derived fields exist.)
    if (this.channel !== 0) this.grooveFinish(0);
  }

  /** Reset MIDI settings; special hook for stopping strings. */
  override doMidiClear(): void {
    if (this.channel !== 0) this.grooveFinish(0);
    super.doMidiClear();
  }

  /** Return options.  Used in setPlectrumFretNoise() and macros. */
  getFretNoiseOptions(): string {
    const o = this.fretNoise!;

    const bars = o.bars.length ? o.bars.map((i) => String(i + 1)).join(',') : 'ALL';

    const beats = o.beats.length
      ? o.beats.map((i) => formatFloat(1 + i / this.ctx.BperQ)).join(',')
      : 'All';

    return (
      `${this.name} FretNoise Track=${o.track} Duration=${o.duration}T Octave=${formatFloat(o.octave / 12)} ` +
      `Strings=${o.strings.map((x) => String(Math.abs(x - this.tuning.length))).join(',')} ` +
      `Max=${o.max} Beats=${beats} Bars=${bars}`
    );
  }

  /** Set up the fretnoise stuff. */
  setPlectrumFretNoise(l: string[]): void {
    if (!l.length || (l.length === 1 && ['OFF', 'NONE'].includes(l[0]!.toUpperCase()))) {
      this.fretNoise = null;
      if (this.ctx.debug.debug) this.ctx.dPrint(`${this.name} FretNoise Off`);
      return;
    }

    const o = new Fnoise();
    const scount = this.tuning.length;

    const [notopt, optpair] = opt2pair(l, true);

    if (notopt.length) {
      this.ctx.rep.error(`${this.name} FretNoise: All options are Key=Value, not '${notopt.join(' ')}'.`);
    }

    for (const { option: cmd, value: opt } of optpair) {
      if (cmd === 'BEATS') {
        o.beats = [];
        if (opt !== 'ALL') {
          for (const t of opt.split(',')) {
            // Python temporarily renames the track for error messages in
            // setBarOffset() ("... FretNoise Beats"); the port keeps the
            // plain name (only visible in error text).
            o.beats.push(this.setBarOffset(t));
          }
        }
      } else if (cmd === 'BARS') {
        o.bars = [];
        if (opt !== 'ALL') {
          for (const t of opt.split(',')) {
            const i = stoi(this.ctx.rep, t);
            if (i < 1 || i > this.ctx.seqSize) {
              this.ctx.rep.warning(
                `${this.name} FretNoise Bars: setting of ${i} may be ignored since SeqSize is ${this.ctx.seqSize}.`,
              );
            }
            o.bars.push(i - 1);
          }
        }
      } else if (cmd === 'DURATION') {
        o.duration = getNoteLen(this.ctx.rep, this.ctx.noteLenTable, opt);
      } else if (cmd === 'MAX') {
        const i = stoi(this.ctx.rep, opt);
        if (i < 1 || i > scount) {
          this.ctx.rep.error(`${this.name} FretNoise Max must be 1..${scount}, not '${opt}'.`);
        }
        o.max = i;
      } else if (cmd === 'STRINGS') {
        o.strings = [];
        for (const s of opt.split(',')) {
          const i = Math.abs(stoi(this.ctx.rep, s) - scount); // convert 1-6 to 6-1
          if (i < 0 || i > scount) {
            this.ctx.rep.error(`${this.name} FretNoise STRING must be 1-${scount}, not ${i}.`);
          }
          if (!o.strings.includes(i)) o.strings.push(i);
        }
      } else if (cmd === 'TRACK') {
        trackHooks.trackAlloc(this.ctx, opt, true);
        const trk = this.ctx.tnames.get(opt);
        if (trk && trk.vtype !== 'BASS') {
          this.ctx.rep.error(`${this.name} FretNoise Track must be a BASS track, not ${trk.vtype}.`);
        }
        o.track = opt;
        if (trk && !trk.channel) trk.setForceOut();
      } else if (cmd === 'OCTAVE') {
        const i = stoi(this.ctx.rep, opt);
        if (i < -8 || i > 8) {
          this.ctx.rep.error(`${this.name} FretNoise Octave: adjustment must be -8 to 8, not '${i}'.`);
        }
        o.octave = i * 12;
      } else {
        this.ctx.rep.error(`${this.name} FretNoise: Unknown option '${cmd}'.`);
      }
    }

    // No strings specified, set to the top 3 (adjusted to fit tuning).
    if (!o.strings.length) o.strings = [0, 1, 2].slice(0, scount);

    if (!o.track) {
      this.ctx.rep.error(`${this.name} Fretnoise: No track was set. Use 'Track=some-bass-track' option.`);
    }

    this.fretNoise = o;
    if (this.ctx.debug.debug) this.ctx.dPrint(this.getFretNoiseOptions());
  }

  /**
   * Called from the parser STRUM option.  Sets the strum center to bar
   * start, center or end.  NOTE: this overrides the class setStrum().
   */
  override setStrum(l: string[]): void {
    if (l.length !== 1) {
      this.ctx.rep.error(`Strum: ${this.name} permits exactly one strum setting`);
    }

    const v = l[0]!.toLowerCase();

    if (v === 'start') this.strumCenter = 0;
    else if (v === 'center') this.strumCenter = 1;
    else if (v === 'end') this.strumCenter = 2;
    else {
      this.ctx.rep.error(
        `Strum: ${this.name} options are 'Start', 'Center' or 'End'. '${titleCase(v)}' is illegal`,
      );
    }
  }

  /**
   * Called from the parser TUNING option: set the instrument tuning.
   * For standard guitar tuning use setPlectrumTuning(['e-','a-','d','g','b','e+']).
   */
  setPlectrumTuning(stringPitchNames: string[]): void {
    if (this.channel !== 0) this.grooveFinish(0); // tuning changed while strings sound

    this.tuning = [];
    this.fretNoise = null; // turn off fret noise (could be string count diff)

    for (const pitchName of stringPitchNames) {
      const midiPitch = noteNameToMidiPitch(pitchName);
      if (midiPitch === null) {
        this.ctx.rep.error(`${this.name} TUNING: Illegal/unknown string name '${pitchName}'.`);
      }

      this.tuning.push(midiPitch);
      // Python appends to self._vibrating without clearing it (the
      // `self._vibration = []` line is a typo and dead); reproduced.
      this.vibrating.push(new Vibrating());
    }

    this.lastOff = new Array<Vibrating | null>(this.vibrating.length).fill(null);
  }

  /** Set a capo value.  Called from the main parser. */
  setPlectrumCapo(capoFretNo: string): void {
    this.capoFretNo = stoi(
      this.ctx.rep,
      capoFretNo,
      `${this.name} Capo: expecting integer, not '${capoFretNo}'.`,
    );
  }

  /**
   * Define a chord shape:
   *
   *   PLECTRUM SHAPE [ chord [ f1 f2 ... fn ] ]
   *
   * If a shape is defined for a chord it is used for the notes to sound;
   * capo and barre settings are ignored for that chord.  Values are
   * integers 0..24 and a minus sign ('x', 'n') for a muted string.
   * Without arguments all shapes are removed; with only a chord name the
   * shape for that chord is removed.
   */
  setPlectrumShape(shapeIn: string[]): void {
    const shape = [...shapeIn];

    if (shape.length === 0) {
      // Forget all definitions.
      this.chordShapes = new Map();
      return;
    }

    const chord = shape.shift()!;
    if (shape.length === 0) {
      // Forget definition for this chord.
      if (this.chordShapes.has(chord)) this.chordShapes.delete(chord);
      else this.ctx.rep.warning(`${this.name}: Chord ${chord} was not shaped`);
      return;
    }

    if (shape.length !== this.tuning.length) {
      this.ctx.rep.error(
        `${this.name}: Shape requires values for ${this.tuning.length} strings (${shape.length} provided)`,
      );
    }

    const frets: Array<number | null> = [];
    for (const n of shape) {
      // Python's third test is `n.lower == 'n'` (missing parens, always
      // false) so an upper-case 'N' is not accepted as a mute; reproduced.
      if (n === '-' || n.toLowerCase() === 'x') {
        frets.push(null);
      } else {
        const t = n.trim();
        const pos = /^[+-]?\d+$/.test(t) ? parseInt(t, 10) : null;
        if (pos === null || pos < -127 || pos > 127) {
          this.ctx.rep.error(
            `${this.name}: Shape requires values between -127 and 127, or '-' for a muted string`,
          );
        }
        frets.push(pos);
      }
    }
    this.chordShapes.set(chord, frets);
  }

  /** Decode plectrum patterns; see the module docs for examples. */
  decodePlectrumPatterns(a: PlectrumEvent, patterns: string[]): void {
    a.pluckVol = [];
    if (patterns[0]!.includes(':') || patterns.length === 1) {
      // Set all strings to note plucked.
      for (let i = 0; i < this.tuning.length; i++) a.pluckVol.push(-1);

      if (patterns.length === 1 && !patterns[0]!.includes(':')) {
        // Put in the missing : if there is just one pattern.
        patterns[0] = ':' + patterns[0];
      }

      for (const patString of patterns) {
        if (!patString.includes(':')) {
          this.ctx.rep.error(
            `${this.name}: Not all string definitions have a : in them '${patterns.join(' ')}'`,
          );
        }

        let start = 0;
        let end = this.tuning.length - 1;

        const pat = patString.split(':');

        if (pat[0]) {
          const emsg = `${this.name}: Note String Number in Plectrum definition not int`;
          if (pat[0].includes('-')) {
            const [startString, endString] = pat[0].split('-') as [string, string];
            if (startString) start = stoi(this.ctx.rep, startString, emsg) - 1;
            if (endString) end = stoi(this.ctx.rep, endString, emsg) - 1;
          } else {
            start = stoi(this.ctx.rep, pat[0], emsg) - 1;
            end = start;
          }
        }

        if (start > end) [start, end] = [end, start];

        for (let n = start; n <= end; n++) {
          // We number strings from the other end.
          const stringNo = this.tuning.length - n - 1;
          if (stringNo < 0 || stringNo >= this.tuning.length) {
            this.ctx.rep.error(`${this.name}: string number ${stringNo + 1} does not exists`);
          }
          if (a.pluckVol[stringNo] !== -1) {
            this.ctx.rep.error(`${this.name}: Duplicate string ${stringNo + 1} definition`);
          }
          a.pluckVol[stringNo] = stoi(
            this.ctx.rep,
            pat[1] ?? '',
            `${this.name}: Note volume not int`,
          );
        }
      }
    } else {
      // Without a string specifier all strings must be listed.
      if (patterns.length !== this.tuning.length) {
        this.ctx.rep.error(
          `${this.name}: There must be ${this.tuning.length} strings listed definition, not '${patterns.join(' ')}'`,
        );
      }
      for (let stringNo = 0; stringNo < this.tuning.length; stringNo++) {
        let val = patterns[stringNo]!;
        if (val === '-') val = '-1'; // -1 means ignore this string
        a.pluckVol.push(stoi(this.ctx.rep, val, `${this.name}: Note volume not int`));
      }
    }
  }

  /** Get a pattern group: start, strum, patterns (see patPlectrum docs). */
  override getPgroup(ev: string[]): PlectrumEvent {
    if (ev.length < 3) {
      this.ctx.rep.error(
        `${this.name}: There must be n groups of 3 or more in a pattern definition, not '${ev.join(' ')}'`,
      );
    }

    const a = new PlectrumEvent();
    a.offset = this.setBarOffset(ev[0]!);
    a.strum = stoi(this.ctx.rep, ev[1]!, `${this.name}: Expecting int value for strum`);

    this.decodePlectrumPatterns(a, ev.slice(2));

    // This track doesn't really have a duration; 0 matches a drum track.
    // The author used "pluckVol" and the docs expect a "vol" variable, so
    // it is duplicated here (both names point at the same list).
    a.duration = 0;
    a.vol = a.pluckVol;

    return a;
  }

  override restart(): void {
    this.ssvoice = -1;
  }

  /** Add in a fret noise note. */
  doFretNoise(stringNo: number, note: number, offset: number): void {
    const last = this.lastOff[stringNo];
    if (!last || last.note === note) return;

    const o = this.fretNoise!;
    const trk = this.ctx.tnames.get(o.track!);

    // Let the user override fretnoise by setting a RIFF or TRIGGER on the
    // bass track.
    if (!trk || trk.disable || trk.riff.length || trk.trigger.mode) return;

    // Skip if incorrect beat/bar setting.
    if (
      (o.beats.length && !o.beats.includes(offset)) ||
      (o.bars.length && !o.bars.includes(this.ctx.seqCount))
    ) {
      return;
    }

    // Use the plectrum track's seq (the BASS doesn't set it).
    trk.seq = this.seq;

    // Use the same volume as the string on, adjusted as the bass would.
    // We bypass sendChord() so volume isn't adjusted; do it anyway!
    const volume = trk.adjustVolume(last.volume, offset);

    // Bypassing voice set, do it here; bypass even more.
    trk.insertVoice(this.seq);
    trk.clearPending();

    // Octave adjustment.
    note += o.octave;
    while (note > 127) note -= 12;
    while (note < 0) note += 12;

    trk.sendNote(offset, o.duration, note, volume);
  }

  /** Kill the vibration on the string by sending out a note off. */
  endVibration(stringNo: number, offset: number): void {
    const vibration = this.vibrating[stringNo]!;

    // First test if this string has been played before.
    if (vibration.note === null) return;

    const lastOffset = vibration.offset!;
    let o = offset - this.artic[this.seq]!; // move off point back before the next ON

    // Ensure we turn this string OFF after the ON offset for this note.
    while (o + this.ctx.tickOffset <= lastOffset) o += 1;

    this.ctx.mtrks.track(this.channel).addNoteOnToTrack(o, vibration.note, 0); // v=0 == note off

    // Save the turn-off point for the fret noise function.
    this.lastOff[stringNo] = {
      note: vibration.note,
      offset: o + this.ctx.tickOffset,
      volume: vibration.volume,
    };

    vibration.note = null;
    vibration.offset = null;
  }

  /** End all vibrations (i.e. output all outstanding note offs). */
  grooveFinish(offset: number): void {
    for (let stringNo = 0; stringNo < this.vibrating.length; stringNo++) {
      this.endVibration(stringNo, offset);
    }
  }

  /**
   * Returns a single note that is on the chord for one string.  Unlike a
   * guitar string number the lowest string is string number 0.
   */
  fretboardNote(
    stringNo: number,
    chordList: number[],
    startIdx: number,
    previousFret: Fret | null,
    chordBarreFretNo: number,
  ): Fret {
    const openString = this.tuning[stringNo]! + this.capoFretNo + chordBarreFretNo;

    const fretNotes = new Map<number, Fret>();
    for (let n = 0; n < chordList.length - startIdx; n++) {
      const note = chordList[startIdx + n]!;
      let fretNo = note - (openString % 12);
      while (fretNo < 0) fretNo += 12;
      fretNo %= 12;

      fretNotes.set(fretNo, {
        pitch: this.adjustNote(openString + fretNo),
        fretNo,
        chordIndex: n + startIdx,
        duplicate: false,
      });
    }

    // Try to guess where the next finger position in the chord goes
    // without trying to stretch the hand too much.
    if (previousFret) {
      const pf = previousFret.fretNo!;
      if (fretNotes.has(pf)) return fretNotes.get(pf)!;
      if (fretNotes.has(pf - 1)) return fretNotes.get(pf - 1)!;
      if (fretNotes.has(pf - 2)) return fretNotes.get(pf - 2)!;
      if (fretNotes.has(pf + 1) && pf <= 3) return fretNotes.get(pf + 1)!;
    }

    const lowest = Math.min(...fretNotes.keys());
    return fretNotes.get(lowest)!;
  }

  fretboardNotes(chordList: number[], chordBarreFretNo: number): Fret[] {
    const notes: Fret[] = [];

    if (chordList.length >= 5 || this.tuning.length >= 8) {
      // Five or more notes in a chord, or more than 8 strings (e.g. a
      // harp), can't be handled: just do a single pass and see what happens.
      let previousFret: Fret | null = null;
      for (let stringNo = 0; stringNo < this.tuning.length; stringNo++) {
        const fret = this.fretboardNote(stringNo, chordList, 0, previousFret, chordBarreFretNo);
        previousFret = fret;
        notes.push(fret);
      }
    } else {
      // Find the triad chord (the first three notes of the chord) first.
      let previousFret: Fret | null = null;
      for (let stringNo = 0; stringNo < this.tuning.length; stringNo++) {
        const fret = this.fretboardNote(stringNo, chordList.slice(0, 3), 0, previousFret, chordBarreFretNo);
        previousFret = fret;
        notes.push(fret);
      }

      if (chordList.length === 4) {
        // Now put in the missing 7th (or whatever it is called), starting
        // the search from the top string.
        for (let stringNo = this.tuning.length - 1; stringNo >= 0; stringNo--) {
          const fret = this.fretboardNote(stringNo, chordList, 3, null, chordBarreFretNo);
          if (fret.fretNo! <= 4) {
            notes[stringNo] = fret;

            // Now go back up to the top string to make sure there is no bunching.
            let s = stringNo + 1;
            while (s < this.tuning.length) {
              notes[s] = this.fretboardNote(s, chordList, 0, null, chordBarreFretNo);
              s += 1;
            }
            break;
          }
        }
      }
    }

    // Look for and mark duplicates.
    notes[0]!.duplicate = false;
    for (let stringNo = 1; stringNo < this.tuning.length; stringNo++) {
      notes[stringNo]!.duplicate = notes[stringNo - 1]!.pitch === notes[stringNo]!.pitch;
    }

    return notes;
  }

  fretboardShapes(chordName: string, _chordList: number[]): Fret[] {
    const shape = this.chordShapes.get(chordName)!;
    const notes: Fret[] = [];
    let stringNo = -1;
    for (const fretNo0 of shape) {
      stringNo += 1;
      const fretNo = typeof fretNo0 === 'number' ? fretNo0 : null;

      const openString = this.tuning[stringNo]!;
      notes.push({
        pitch: fretNo === null ? openString : this.adjustNote(openString + fretNo),
        fretNo,
        chordIndex: stringNo,
        duplicate: false,
      });
    }
    return notes;
  }

  /** Do a plectrum bar.  Called from self.bar(). */
  override trackBar(pattern: Pattern, ctable: CTable[]): void {
    const sc = this.seq;

    for (const p0 of pattern) {
      const p = p0 as PlectrumEvent;
      const ct = this.getChordInPos(p.offset, ctable);
      if (!ct || !ct.chord) continue; // catch no noteList attribute

      const chordName = ct.chord.name;
      const chordList = ct.chord.noteList;

      if (ct.plectrumZ) continue;

      if (this.tuning.length !== p.pluckVol.length) {
        this.ctx.rep.error(
          `${this.name}: Pattern and tuning lengths (${p.pluckVol.length}, ${this.tuning.length}) ` +
            'do not match. Was tuning changed?',
        );
      }

      let chordBarreFretNo = 0;
      const ctName = ct.name ?? '';
      if (ctName.startsWith('+')) chordBarreFretNo += 12;
      if (ctName.startsWith('-')) chordBarreFretNo += -12;

      chordBarreFretNo += ct.chord.barre;

      if (this.ctx.debug.debug || Boolean((this.ctx.debug as { plecShow?: boolean }).plecShow)) {
        this.printChordShape(ct, chordBarreFretNo);
      }

      const plectrumNoteOnList: number[] = []; // for debugging only

      // Find how many strings have been plucked this time.
      let pluckStringCount = 0;
      for (const vol of p.pluckVol) {
        if (vol === -1) continue;
        pluckStringCount += 1;
      }

      let pluckStringIndex = 0;

      const notes = this.chordShapes.has(chordName)
        ? this.fretboardShapes(chordName, chordList)
        : this.fretboardNotes(chordList, chordBarreFretNo);

      let fretNoiseCount = 0;
      for (let stringNo = 0; stringNo < p.pluckVol.length; stringNo++) {
        const vol = p.pluckVol[stringNo]!;
        const strum = p.strum ?? 0;

        let strumOffset: number;
        if (strum) {
          if (this.strumCenter === 0) {
            // Start strum at end of beat.
            strumOffset = p.offset + strum * pluckStringIndex;
          } else if (this.strumCenter === 1) {
            // The center of the strum is on the beat.
            strumOffset = p.offset + strum * (pluckStringIndex - pluckStringCount / 2.0);
          } else {
            // Start strum at end of beat.
            strumOffset = p.offset + strum * (pluckStringCount - pluckStringIndex - 1);
          }

          if (strum < 0) strumOffset += -strum * pluckStringCount;
        } else {
          strumOffset = p.offset;
        }

        if (vol === -1) {
          // Silence this string if the note on it has changed even if the
          // string has not been plucked or muted.
          if (notes[stringNo]!.pitch !== this.vibrating[stringNo]!.note) {
            this.endVibration(stringNo, strumOffset);
          }
          continue; // this string has not been plucked or damped
        }

        pluckStringIndex += 1;

        this.endVibration(stringNo, strumOffset);
        if (vol >= 1) {
          const note = notes[stringNo]!.pitch;

          if (notes[stringNo]!.duplicate) {
            if (this.ctx.debug.debug) {
              this.ctx.dPrint(`${this.name}: Ignoring duplicate note ${note}.`);
            }
            continue;
          }

          if (notes[stringNo]!.fretNo === null) {
            if (this.ctx.debug.debug) {
              this.ctx.dPrint(`${this.name}: Ignoring muted note ${note}.`);
            }
            continue;
          }

          const outputVolume = this.adjustVolume(vol, p.offset);

          const ontime = this.ctx.mtrks
            .track(this.channel)
            .addNoteOnToTrack(strumOffset, note, outputVolume, this.rTime[sc]![0], this.rTime[sc]![1]);

          this.vibrating[stringNo]!.note = note;
          this.vibrating[stringNo]!.offset = ontime; // save the start time
          this.vibrating[stringNo]!.volume = outputVolume; // and volume
          if (outputVolume === 0) this.vibrating[stringNo]!.note = null;

          // Do fretnoise stuff if enabled.
          const fn = this.fretNoise;
          if (this.plectrumLastChord !== ct.name && fn && outputVolume && fn.strings.includes(stringNo)) {
            if (fretNoiseCount < fn.max) {
              this.doFretNoise(stringNo, note, strumOffset);
              fretNoiseCount += 1;
            }
          }

          plectrumNoteOnList.push(note); // for debugging only
        }

        this.plectrumLastChord = ct.name;
      }

      if (this.ctx.debug.debug) {
        this.ctx.dPrint(
          `${this.name}: channel=${this.channel} offset=${p.offset + this.ctx.tickOffset} ` +
            `chordList=[${chordList.join(', ')}] NoteOn=[${plectrumNoteOnList.join(', ')}].`,
        );
      }
    }
  }

  /** Debug dump of one chord shape (MMA.debug.plecShow / debug). */
  printChordShape(chordTable: CTable, chordBarreFretNo = 0): void {
    const chordList = chordTable.chord!.noteList;
    const chordName = chordTable.name ?? '';

    // Catch the case when there is no noteList attribute.
    if (this.previousChordList !== undefined) {
      if (
        arraysEqual(chordList, this.previousChordList) &&
        chordBarreFretNo === this.previousFretNo &&
        !(this.chordShapes.has(chordName) &&
          !arraysEqual(this.chordShapes.get(chordName)!, this.previousShape))
      ) {
        return;
      }
    }
    this.previousChordList = [...chordList];
    this.previousFretNo = chordBarreFretNo;
    this.previousShape = this.chordShapes.has(chordName)
      ? [...this.chordShapes.get(chordName)!]
      : null;

    let capoFretNo = this.capoFretNo;
    let notes: Fret[];
    if (this.chordShapes.has(chordName)) {
      notes = this.fretboardShapes(chordName, chordList);
      capoFretNo = 0;
      chordBarreFretNo = 0;
    } else {
      notes = this.fretboardNotes(chordList, chordBarreFretNo);
    }
    notes.reverse();

    let printStart = 0;
    const startFretNo = capoFretNo + chordBarreFretNo;
    if (startFretNo < 0) printStart = startFretNo;

    this.ctx.dPrint(`${this.name} ${chordTable.name} chord [${chordList.join(', ')}]`);
    const revTuning = [...this.tuning].reverse();
    for (let stringNo = 0; stringNo < revTuning.length; stringNo++) {
      const openNote = this.adjustNote(revTuning[stringNo]!); // middle octave 60==5*12
      const note = notes[stringNo]!.pitch;

      const msg: string[] = [`${this.name}   ${String(openNote + capoFretNo).padStart(3)}`];
      const finger = note - openNote;
      for (let fretNo = printStart; fretNo < 20; fretNo++) {
        if (fretNo === 0 && notes[stringNo]!.fretNo === null && capoFretNo === 0) msg.push('X');
        else if (fretNo === 0 && capoFretNo === 0) msg.push('|');
        else if (fretNo === capoFretNo && chordBarreFretNo === 0) {
          msg.push(notes[stringNo]!.fretNo === null ? 'X' : '$');
        } else if (fretNo === finger) msg.push('*');
        else if (fretNo === capoFretNo) msg.push('$');
        else if (fretNo === startFretNo) msg.push(':');
        else if (fretNo === 0) msg.push('|');
        else msg.push('-');
      }

      msg.push(String(notes[stringNo]!.chordIndex));
      if (notes[stringNo]!.fretNo !== null) msg.push(`  ${note}`);
      if (notes[stringNo]!.duplicate) msg.push('  duplicate');

      this.ctx.dPrint(msg.join(' '));
    }
    this.ctx.dPrint('\n');
  }
}

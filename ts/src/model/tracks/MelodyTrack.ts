/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the Melody class in MMA/patSolo.py: the MELODY track and its
 * note-string ("solo line") parser.  The SOLO subclass lives in
 * SoloTrack.ts.  Unlike the other pattern tracks, a MELODY/SOLO pattern is
 * a plain string parsed note-by-note at play time (getLine/getChord).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 *
 * Original Python module by Bob van der Poel <bob@mellowood.ca>.
 */

import type { MMAContext } from '../../engine/Context';
import type { CTable } from '../CTable';
import type { Pattern } from '../PatternEvent';
import { getNoteLen as baseNoteLen } from '../NoteLen';
import { opt2pair, pextract, stof, stoi } from '../../util/Common';
import { getSwing, swingSolo } from '../features/Swing';
import { BaseTrack, defaultDrum, type GrooveData } from './BaseTrack';
import { trackHooks } from './hooks';
import { dtableGet } from './Translate';

/** One note of a solo line (patSolo.NoteEvent). */
export class NoteEvent {
  duration: number | null = null;
  pitch: number | null;
  articulation: number | null = null;
  velocity: number;
  defvelocity: number;
  /** Number (grace offset) when this is a grace note, else false. */
  isgrace: number | false;

  constructor(pitch: number | null, velocity: number, isgrace: number | false) {
    this.pitch = pitch;
    this.velocity = velocity;
    this.defvelocity = velocity;
    this.isgrace = isgrace;
  }
}

/** Note events of one bar keyed by MIDI-tick offset into the bar. */
export type NoteMap = Map<number, NoteEvent[]>;

/** Accidental symbols used inside a note chunk. */
export const accValues: Record<string, number> = { '#': 1, '&': -1, n: 0 };

/** Default velocity for solo notes (patSolo.defaultVelocity). */
export const defaultVelocity = 90;

/** Groove entries added by Melody.saveGroove(). */
interface MelodyGrooveData extends GrooveData {
  FOLLOWCHORD: number | null;
  FOLLOWKEY: number | null;
  ROOT: number;
  TONES: number[];
}

export class Melody extends BaseTrack {
  override drumTone = 38;
  arpRate = 0;
  arpDecay = 0;
  arpDirection = 'UP';
  stretch = 1;
  followChord: number | null = 0;
  followKey: number | null = 1;
  rootChord = 0;
  /** [ticks-over-bar, tickOffset] of a trailing '~' (patSolo.endTilde). */
  endTilde: number[] = [];
  /** Per-bar accidental table (copy of keySig.accList or all-natural). */
  acc: Record<string, number> = {};
  /** Note-name -> semitone map (built per getLine call). */
  midiNotes: Record<string, number | null> = {};

  constructor(ctx: MMAContext, name: string, vtype = 'MELODY') {
    // Python's Melody.__init__ creates toneList *before* PC.__init__;
    // clearSequence() (below) provides a valid list during that window and
    // this assignment restores the drum tone once the derived field
    // initializers have run.
    super(ctx, name, vtype);
    this.toneList = [this.drumTone];
  }

  /** Set this track to be a drum track (patSolo.setDrumType). */
  setDrumType(): void {
    if (this.channel) {
      this.ctx.rep.error('You cannot change a track to DRUM once it has been used');
    }

    this.drumType = true;
    this.setChannel('10'); // MMA assumes all drums are on channel 10
    this.voice = this.ctx.seqBump([defaultDrum]);
  }

  /**
   * Set the voicing option for a solo/melody track.  Only permitted option
   * is FOLLOWCHORD, FOLLOWKEY and ROOT.
   */
  override setVoicing(ln: string[]): void {
    const [notopt, opts] = opt2pair(ln, true);

    if (notopt.length) {
      this.ctx.rep.error(`Voicing ${this.name}: Each option must be a OPT=VALUE pair.`);
    }

    for (const { option: opt, value: val } of opts) {
      if (opt === 'FOLLOWCHORD') {
        if (val === '0' || val === 'OFF') this.followChord = null;
        else if (val === '1' || val === 'ON') this.followChord = 1;
        else this.ctx.rep.error(`${this.name} Voicing FollowChord: expecting On or Off.`);
      } else if (opt === 'FOLLOWKEY') {
        if (val === '0' || val === 'OFF') this.followKey = null;
        else if (val === '1' || val === 'ON') this.followKey = 1;
        else this.ctx.rep.error(`${this.name} Voicing FollowKey: expecting On or Off.`);
      } else if (opt === 'ROOT') {
        // Python looks the name up with .upper(); biname keys such as 'Gb'
        // therefore fail (reproduced, see chords.cdAdjust).
        const adj = this.ctx.cdAdjust[val.toUpperCase()];
        if (adj === undefined) {
          this.ctx.rep.error(`Voicing ${this.name}: Chord name ${val} not valid.`);
        }
        this.rootChord = adj;
      } else {
        this.ctx.rep.error(
          `Voicing ${this.name}: Only valid options are 'FollowChord', 'FollowKey' and 'Root'.`,
        );
      }
    }
  }

  /** Format an existing pattern. Overrides the class default. */
  override formatPattern(pat: Pattern | string | null): string {
    if (!pat) return '';
    return typeof pat === 'string' ? pat : '';
  }

  /** Save special/local variables for the groove. */
  override saveGroove(gname: string): void {
    super.saveGroove(gname); // create storage; do this first
    const g = this.grooves.get(gname) as MelodyGrooveData;
    g.FOLLOWCHORD = this.followChord;
    g.FOLLOWKEY = this.followKey;
    g.ROOT = this.rootChord;
    g.TONES = [...this.toneList];
  }

  /** Restore special/local variables for the groove. */
  override restoreGroove(gname: string): void {
    const g = this.grooves.get(gname) as MelodyGrooveData | undefined;
    if (!g) this.ctx.rep.error(`${this.name}: no groove data for '${gname}' - call Bob.`);
    this.followChord = g.FOLLOWCHORD;
    this.followKey = g.FOLLOWKEY;
    this.rootChord = g.ROOT;
    this.toneList = g.TONES;
    super.restoreGroove(gname);
  }

  /** Expand existing pattern list. */
  override setSeqSize(): void {
    this.toneList = this.ctx.seqBump(this.toneList);
    super.setSeqSize();
  }

  /** Set some initial values.  Called from init and clear seq. */
  override clearSequence(): void {
    // toneList must be valid before PC.clearSequence() calls setSeqSize()
    // (patSolo.Melody.__init__ sets it before PC.__init__).  During
    // construction the derived drumTone field has not been initialized
    // yet, so fall back to the class default (38).
    const tone = (this.drumTone as number | undefined) ?? 38;
    this.toneList = this.ctx.seqBump([tone]);
    super.clearSequence();
    this.toneList = this.ctx.seqBump([tone]);
  }

  /**
   * Create a solo pattern.  All we do is return the string set as a
   * pattern - MELODY/SOLO patterns are plain strings, not Pgroup lists.
   */
  override defPatRiff(ln: string | string[], _upper = true): string {
    return typeof ln === 'string' ? ln : ln.join(' ');
  }

  /** Set a stretch (or compress) value for each note set in a solo. */
  setStretch(ln: string[]): void {
    const s = stof(this.ctx.rep, ln[0]!);

    if (s < 1 || s > 500) {
      this.ctx.rep.error(
        `${this.name} Stretch: value must be a percentage in range 1 to 500, not '${s}'`,
      );
    }

    this.stretch = s / 100;
  }

  /** Set the arpeggiate options. */
  setArp(ln: string[]): void {
    if (ln.length === 1 && ln[0]!.toUpperCase() === 'OFF') ln = ['Rate=0'];

    const [notopt, opts] = opt2pair(ln, true);

    if (notopt.length) {
      this.ctx.rep.error(
        `${this.name} Arpeggiate: expecting cmd=opt pairs, not '${notopt.join(' ')}'.`,
      );
    }

    for (const { option: cmd, value: opt } of opts) {
      if (cmd === 'RATE') {
        if (opt === '0' || opt === 'NONE') this.arpRate = 0;
        else this.arpRate = this.getNoteLen(opt);
      } else if (cmd === 'DECAY') {
        const v = stof(this.ctx.rep, opt, `Arpeggiate Decay must be a value, not '${opt}'`);
        if (v < -50 || v > 50) {
          this.ctx.rep.error(`${this.name} Arpeggiate: Decay rate must be -50..+50`);
        }
        this.arpDecay = v / 100;
      } else if (cmd === 'DIRECTION') {
        const valid = ['UP', 'DOWN', 'BOTH', 'RANDOM'];
        if (!valid.includes(opt)) {
          this.ctx.rep.error(
            `${this.name} Arpeggiate Direction: Unknown setting '${opt}', use ${valid.join(', ')}.`,
          );
        }
        this.arpDirection = opt;
      }
    }

    this.ctx.dPrint(
      `${this.name} Arpeggiate: Rate=${this.arpRate} Decay=${this.arpDecay} Direction=${this.arpDirection}`,
    );
  }

  /**
   * Special interface to NoteLen.getNoteLen() adjusting the length (in
   * MIDI ticks) by the stretch value for this class.
   */
  getNoteLen(n: string): number {
    return baseNoteLen(this.ctx.rep, this.ctx.noteLenTable, n) * this.stretch;
  }

  override restart(): void {
    this.ssvoice = -1;
  }

  /** A solo track can have a tone, if it is DRUMTYPE. */
  override setTone(ln: string[]): void {
    if (!this.drumType) {
      this.ctx.rep.error('You must set a Solo track to DrumType before setting Tone');
    }

    if (ln.length > 1) {
      this.ctx.rep.error('Only 1 value permitted for Drum Tone in Solo tracks');
    }

    this.drumTone = dtableGet(this.ctx, ln[0]!);
  }

  /**
   * Extract a set of notes for a single beat.  Notes can be a single note
   * or a series of notes, with each note a letter a-g (or r), an optional
   * accidental "#,&,n" and a series of "+"s or "-"s for the octave.  Drum
   * solos must have each note separated by " " or ",".
   */
  private getChord(c: string, velocity: number, isdrum: boolean, isgrace: number | false): NoteEvent[] {
    const parts = c.split(/[, ]+/);

    // Convert the note part into a series of midi values.
    const events: NoteEvent[] = [];

    for (let cc of parts) {
      if (!cc) continue;

      let thisvel: number;
      if (cc.includes('/')) {
        if ((cc.match(/\//g) ?? []).length > 1) {
          this.ctx.rep.error(
            `${this.name}: Only 1 '/velocity' permitted. You can separate ` +
              `notes in the chord with ',' or ' ' and it'll work.`,
          );
        }
        const split = cc.split('/') as [string, string];
        cc = split[0];
        const newvel = split[1];
        if (!newvel) this.ctx.rep.error(`${this.name}: expecting 'volume' after '/'`);
        if (!cc) this.ctx.rep.error(`${this.name}: Volume '/' must immediately follow note.`);

        thisvel = stoi(this.ctx.rep, newvel);

        if (thisvel < 0 || thisvel > 127) {
          this.ctx.rep.error(`${this.name}: Velocity must be 0..127, not '${newvel}'.`);
        }
      } else {
        thisvel = velocity;
      }

      if (cc[0] === 'r') {
        if (isgrace) this.ctx.rep.warning(`${this.name}: Grace note is a rest (ignored).`);

        if (events.length || cc.length > 1) {
          this.ctx.rep.error(`${this.name}: Rests and notes cannot be combined.`);
        } else {
          events.push(new NoteEvent(null, 0, isgrace)); // note event with no pitch
        }
      } else if (/^[0-9]/.test(cc)) {
        const n = stoi(this.ctx.rep, cc, `${this.name}: Note values must be integer or literal.`);
        if (n < 0 || n > 127) {
          this.ctx.rep.error(`${this.name}: Midi notes must be 0..127, not '${n}'`);
        }

        // If using a value we fake-adjust the octave; it (and transpose)
        // is set later.
        events.push(new NoteEvent(isdrum ? n : n - this.octave[this.seq]!, thisvel, isgrace));
      } else if (isdrum) {
        // A drum must be a value, * or a drum-name.
        if (cc === '*') {
          events.push(new NoteEvent(this.drumTone, thisvel, isgrace));
        } else {
          events.push(new NoteEvent(dtableGet(this.ctx, cc), thisvel, isgrace));
        }
      } else {
        // Must be a note (or notes) in standard notation.
        const chars = [...cc];
        while (chars.length) {
          const name = chars.shift()!;

          if (!(name in this.midiNotes)) {
            this.ctx.rep.error(`${this.name}: Encountered illegal note name '${name}'`);
          }

          let n = this.midiNotes[name]!;
          if (n === null) {
            // Python would crash on a 'r' in a non-leading position; report
            // it like any other illegal name instead.
            this.ctx.rep.error(`${this.name}: Encountered illegal note name '${name}'`);
          }

          // Parse out a '#', '&' or 'n' accidental.
          if (chars.length && chars[0]! in accValues) {
            const i = chars.shift()!;
            this.acc[name] = accValues[i]!;
          }

          n += this.acc[name] ?? 0; // accidental adjust (from above or keysig)

          // Parse out +/- (or series) for the octave.
          while (chars.length && (chars[0] === '+' || chars[0] === '-')) {
            const a = chars.shift()!;
            if (a === '+') n += 12;
            else n -= 12;
          }

          events.push(new NoteEvent(n, thisvel, isgrace));
        }
      }
    }

    return events;
  }

  /**
   * Extract a melody line for solo/melody tracks.  Returns the notes
   * structure: a map from offset in MIDI ticks in the current bar to an
   * array of NoteEvents.
   */
  getLine(pat: string): NoteMap {
    const ctx = this.ctx;

    // Get a copy of the key-signature note table.  As a bar is processed
    // the table is updated.  FollowKey=Off is usually set when using a
    // sequence pattern.
    if (this.followKey) {
      this.acc = { ...ctx.keySig.accList };
    } else {
      this.acc = { a: 0, c: 0, b: 0, e: 0, d: 0, g: 0, f: 0 };
    }

    this.midiNotes = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11, r: null };

    // The initial string is in the format "1ab;4c;;4r;".  The trailing
    // ';' is important: it tells us if the last note repeats.
    if (!pat.endsWith(';')) {
      ctx.rep.error("All Solo strings must end with a ';'");
    }

    // End of the bar in ticks; use the temporary truncate length if set.
    const barEnd = trackHooks.truncate.length ? trackHooks.truncate.length : ctx.barLen;

    let duration = this.getNoteLen('4'); // default note length
    let velocity = defaultVelocity; // default velocity for solo notes
    let articulation = 1; // additional articulation for solo notes

    const notes: NoteMap = new Map(); // NoteEvent list, keys == offset

    const isdrum = this.drumType === true;
    let lastc = isdrum ? String(this.drumTone) : '';

    // Convert pat to a list.
    const chunks = pat
      .split(';')
      .slice(0, -1)
      .map((x) => x.trim());

    // Set the initial offset into the bar.  This compensates for the
    // previous bar ending in a ~ and this one starting with ~.
    let offset = 0;
    if (chunks[0]!.startsWith('~')) {
      if (!this.endTilde.length || this.endTilde[1] !== ctx.tickOffset) {
        ctx.rep.error("Previous line did not end with '~'");
      } else {
        chunks[0] = chunks[0]!.slice(1).trim();
        offset = this.endTilde[0]!;
      }
    }

    // Strip off a trailing ~: this permits long notes to end past the
    // current bar end.  The flag is set for the next bar's leading ~ test.
    const lastChunk = chunks[chunks.length - 1]!;
    if (lastChunk.endsWith('~')) {
      this.endTilde = [1, ctx.tickOffset + barEnd];
      chunks[chunks.length - 1] = lastChunk.slice(0, -1).trim();
    } else {
      this.endTilde = [];
    }

    // Now parse each chunk of the solo string.
    for (let a of chunks) {
      // A "<>" is ignored; useful with ~ continuations.
      let accentVol: number | null = null;
      let accentDur: number | null = null;
      let isgrace: number | false = false;

      if (a === '<>') continue;

      // Strip out all <SPECIAL=xx> settings.  With no option set we assume
      // VOLUME; GRACE defaults to an offset of 2.
      let vls: string[];
      [a, vls] = pextract(a, '<', '>');

      if (vls.length) {
        if (vls.length > 1) {
          ctx.rep.error('Only 1 <modifier> is permitted per note-set');
        }

        for (let vv of vls[0]!.split(',')) {
          vv = vv.toUpperCase().trim();

          if (vv === 'GRACE') vv = 'GRACE=2';

          if (!vv.includes('=')) vv = `VOLUME=${vv}`;

          const eq = vv.indexOf('=');
          const vc = vv.slice(0, eq);
          const vo = vv.slice(eq + 1);

          if (vc === 'VOLUME') {
            if (Object.prototype.hasOwnProperty.call(ctx.volume.vols, vo)) {
              velocity = defaultVelocity * ctx.volume.vols[vo]!;
            } else {
              ctx.rep.error(`${this.name}: No volume '${vo}'.`);
            }
          } else if (vc === 'GRACE') {
            isgrace = stof(ctx.rep, vo, `${this.name}: Expecting a value, not ${vo}.`);
            if (isgrace <= 0) {
              ctx.rep.error(`${this.name}: Offset modifier must be greater than 0.`);
            }
          } else if (vc === 'OFFSET') {
            offset = stoi(ctx.rep, vo, `${this.name}: Offset expecting integer, not ${vo}.`);

            if (offset < 0) ctx.rep.error(`${this.name}: Offset must be positive.`);
            if (offset >= barEnd) {
              ctx.rep.error(`${this.name}: Offset has been set past the end of the bar.`);
            }
          } else if (vc === 'ARTICULATE') {
            articulation = stoi(
              ctx.rep,
              vo,
              `${this.name}: Articulation expecting integer, not ${vo}.`,
            );

            if (articulation < 1 || articulation > 200) {
              ctx.rep.error(`${this.name}: Articulation must be 1..200, not ${vo}.`);
            }
            articulation /= 100;
          } else {
            ctx.rep.error(`${this.name}: Unknown command '${vv}'.`);
          }
        }
      }

      if (offset >= barEnd) {
        ctx.rep.error(`Attempt to start Solo note '${a}' after end of bar`);
      }

      // Split the chord chunk into a note length and notes.  Each part is
      // optional and defaults to the previously parsed value.
      let i = 0;
      while (i < a.length && '1234567890.+-tT:'.includes(a[i]!)) i++;
      if (i) {
        duration = this.getNoteLen(a.slice(0, i).replace(/ /g, ''));
        a = a.slice(i).trim();
      }

      // Next item might be an accent string.
      i = 0;
      while (i < a.length && '!-_^&'.includes(a[i]!)) i++;
      if (i) {
        const c = a.slice(0, i);
        accentVol = 1;
        accentDur = 1;

        accentDur -= (c.match(/!/g) ?? []).length * 0.2;
        accentDur += (c.match(/-/g) ?? []).length * 0.2;
        accentDur += (c.match(/_/g) ?? []).length * 0.2;
        accentVol += (c.match(/\^/g) ?? []).length * 0.2;
        accentVol -= (c.match(/&/g) ?? []).length * 0.2;

        if (accentDur < 0.1) accentDur = 0.1;
        if (accentDur > 2) accentDur = 2;
        if (accentVol < 0.1) accentVol = 0.1;
        if (accentVol > 2) accentVol = 2;
        a = a.slice(i);
      }

      // Now we get to look at pitches.
      if (!a) a = lastc;
      const evts = this.getChord(a, velocity, isdrum, isgrace); // get chord

      if (!evts.length) ctx.rep.error('No pitches specifed for notes.');

      for (const e of evts) {
        e.velocity = this.adjustVolume(e.defvelocity, offset);
        if (accentVol) e.velocity *= accentVol;
        e.duration = duration;

        e.articulation = accentDur ? articulation * accentDur : articulation;
      }

      lastc = a; // save last chord for the next loop

      // Add note event(s) to notes{}.
      const bucket = notes.get(offset);
      if (bucket) bucket.push(...evts);
      else notes.set(offset, evts);

      if (!evts[evts.length - 1]!.isgrace) offset += duration;
    }

    if (offset <= barEnd) {
      if (this.endTilde.length) ctx.rep.error('Tilde at end of bar has no effect');
    } else if (this.endTilde.length) {
      this.endTilde[0] = offset - barEnd;
    } else {
      ctx.rep.warning(
        `${this.name}, end of last note overlaps end of bar by ${
          (offset - barEnd) / ctx.BperQ
        } beat(s).`,
      );
    }

    const sw = getSwing(ctx);
    if (sw && sw.mode) {
      return swingSolo(ctx, sw, notes);
    }

    return notes;
  }

  /** Convert pitches to reflect the current chord (FOLLOWCHORD mode). */
  followAdjust(notes: NoteMap, ctable: CTable[]): NoteMap {
    for (const [offset, nn] of notes) {
      if (nn.length === 1 && nn[0]!.pitch !== null) {
        const tb = this.getChordInPos(offset, ctable);
        if (!tb || tb.chordZ) continue;

        nn[0]!.pitch += tb.chord!.rootNote + this.rootChord;
      }
    }

    return notes;
  }

  /** Add harmony to solo notes, being careful of grace and NULL notes. */
  addHarmony(notes: NoteMap, ctable: CTable[]): void {
    const sc = this.seq;

    const harmony = this.harmony[sc];
    const harmOnly = this.harmonyOnly[sc];

    for (const [offset, nn] of notes) {
      let pitch: number | null = null;
      let count = 0;
      let duration: number | null = null;
      let articulation: number | null = null;
      let velocity = 0;

      for (const n of nn) {
        if (n.isgrace || n.pitch === null) continue;
        pitch = n.pitch;
        duration = n.duration;
        articulation = n.articulation;
        velocity = n.defvelocity;
        count += 1; // signals multiple notes, don't harmonize

        if (harmOnly) n.pitch = null;
      }

      // The chord might have no notes, more than one, or be all grace.
      if (pitch === null || count !== 1) continue;

      const tb = this.getChordInPos(offset, ctable);
      if (!tb || tb.chordZ) continue;

      const h = trackHooks.harmonize(this.ctx, harmony!, pitch, tb.chord!.bnoteList);

      for (const n of h) {
        const e = new NoteEvent(
          n,
          this.adjustVolume(velocity * this.harmonyVolume[sc]!, offset),
          false,
        );
        e.duration = duration;
        e.articulation = articulation;
        nn.push(e);
      }
    }
  }

  /** Do the solo/melody line. Called from bar(). */
  override trackBar(pat: Pattern | string, ctable: CTable[]): void {
    const sc = this.seq;

    let notes = this.getLine(pat as string);

    // Adjust all notes for the given chord in FOLLOWCHORD mode.
    if (this.followChord && !this.drumType) {
      notes = this.followAdjust(notes, ctable);
    }

    if (this.harmony[sc] && !this.drumType) {
      this.addHarmony(notes, ctable);
    }

    const offsets = [...notes.keys()].sort((a, b) => a - b);

    for (const offset of offsets) {
      const nn = notes.get(offset)!;

      // The "None" test is important: Arp doesn't like rests.
      if (this.arpRate && nn[0]!.pitch !== null) {
        this.trackArp(nn, offset);
        continue;
      }

      // For each chord we process 2x.  First find all the grace notes and
      // send them to the midi machine; then the normal notes.  Grace notes
      // ignore strum.
      for (const nev of nn) {
        let n = nev.pitch;
        if (n === null || !nev.isgrace) continue; // skip rests and non-grace

        if (!this.drumType) n = this.adjustNote(n); // no octave/transpose for drums

        // Each grace note has its own offset and duration.
        this.sendNote(
          Math.trunc(offset - nev.duration! / (nev.isgrace as number)),
          this.getDur(Math.trunc(nev.duration! * nev.articulation!)),
          n,
          Math.trunc(nev.velocity),
        );
      }

      // Normal notes.
      let strumAdjust = this.getStrum(sc);
      const strumAdd = this.strumAdd[sc]!;
      let strumOffset = 0;

      let dur: number | null = null; // default duration for notes in chord

      for (const nev of nn) {
        let n = nev.pitch;
        if (n === null || nev.isgrace) continue; // skip rests and grace

        if (!this.drumType) n = this.adjustNote(n); // no octave/transpose for drums

        const off = offset + strumOffset;

        // Set duration for this chord; only do it once so they are all the
        // same length.  The call to getDur() adjusts for RDURATION.
        if (dur === null) {
          dur = this.getDur(Math.trunc(nev.duration! * nev.articulation!));
        }

        this.sendNote(off, dur, n, Math.trunc(nev.velocity));

        strumAdjust += strumAdd;
        strumOffset += strumAdjust;
      }
    }
  }

  /** Special trackBar() for the arpeggiator. */
  private trackArp(nn: NoteEvent[], offset: number): void {
    if (this.drumType) {
      this.ctx.rep.error(`${this.name} Arpeggiate: Incompatible with DRUMTYPE. Try MALLET?`);
    }

    const notes: Array<[number, number]> = nn.map((x) => [this.adjustNote(x.pitch!), x.velocity]);
    notes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    // Python computes `random = self.direction == 'RANDOM'`, comparing the
    // per-sequence direction LIST with a string: always False, so the
    // shuffle below is dead code (and would crash if it ever ran).
    const isRandom = (this.direction as unknown) === 'RANDOM';

    if (this.arpDirection === 'DOWN') {
      notes.reverse();
    } else if (this.arpDirection === 'BOTH') {
      const z = notes.slice();
      z.reverse();
      notes.push(...z.slice(1, -1));
    }

    let duration = this.arpRate; // duration of each note
    let count = Math.floor(nn[0]!.duration! / duration); // total number to play
    if (count < 1) count = 1;

    for (;;) {
      const idx: number[] = [...notes.keys()];
      if (isRandom) this.ctx.rng.shuffle(idx);

      for (const i of idx) {
        const n = notes[i]!;

        this.sendNote(offset, this.getDur(duration), n[0], this.adjustVolume(n[1], offset));
        count -= 1;
        if (!count) break;

        offset += duration;

        if (this.arpDecay) {
          n[1] = Math.trunc(n[1] + n[1] * this.arpDecay);
          if (n[1] < 1) n[1] = 1;
          if (n[1] > 127) n[1] = 127;
        }
      }

      if (!count) break;
    }
  }
}

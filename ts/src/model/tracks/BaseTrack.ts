/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of `class PC` in MMA/pat.py - the pattern/track engine shared by
 * the pattern tracks (CHORD, BASS, DRUM, ...).  All mutable global state
 * comes from the MMAContext (see engine/Context.ts); calls into modules
 * that are not part of M1 are routed through tracks/hooks.ts.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../../engine/Context';
import type { Reporter } from '../../engine/Errors';
import type { CTable } from '../CTable';
import { clonePattern, PatternEvent, type Pattern } from '../PatternEvent';
import { getNoteLen } from '../NoteLen';
import { decodeVoice, extVocStr, voice2tup } from '../../midi/VoiceValue';
import { CONTROLLER_TABLE, DRUM_KITS_BY_NAME, DRUM_TABLE, NONETONE, VOICE_TABLE } from '../../midi/voices';
import { getTF, lnExpand, opt2pair, pextract, stoi, stof, type OptPair } from '../../util/Common';
import { defaultOrnaments, type Ornaments } from '../features/Ornament';
import { makeTriggerSequence, Trigger } from '../features/Trigger';
import { getRndSeq } from '../features/SeqRnd';
import { getSwing, swingPattern } from '../features/Swing';
import { trackHooks, type MidiSeqDef, type MidiSeqItem } from './hooks';
import { drumVolTable, voiceVolTable } from './VolTables';
import type { Voicing } from './Voicing';

/** Default voice/tone values (MMA/pat.py defaultVoice/defaultDrum). */
export const defaultVoice = 0;
export const defaultDrum = 0;

export type SequenceItem = Pattern | null;
export type MidiPendingCmd = 'TNAME' | 'GLIS' | 'PAN' | 'CVOLUME' | 'MIDITEXT' | 'MIDICUE' | 'WHEEL';
export type MidiPending = [MidiPendingCmd, number, number | string];

/** Snapshot of the per-track settings stored by DefGroove. */
export interface GrooveData {
  ACCENT: Array<Array<[number, number]>>;
  ARTIC: number[];
  CHORD: string[][];
  COMPRESS: number[];
  DELAY: number[];
  DIR: string[];
  DUPROOT: number[][];
  HARMONY: [Array<string | null>, Array<string | null>, number[]];
  INVERT: number[][];
  LIMIT: [number, number, boolean];
  RANGE: number[];
  OCTAVE: number[];
  RSKIP: number[];
  RSKIPBEATS: number[];
  RTIME: Array<[number, number]>;
  RDURATION: Array<[number, number]>;
  RVOLUME: Array<[number, number]>;
  RPITCH: unknown;
  SCALE: string[];
  SEQ: SequenceItem[];
  SEQRND: boolean;
  SEQRNDWT: number[];
  STRUM: Array<[number, number] | null>;
  STRUMADD: number[];
  VOICE: number[];
  VOLUME: number[];
  UNIFY: number[];
  MIDISEQ: Array<MidiSeqDef | null>;
  MIDIVOICE: Array<MidiSeqDef | null>;
  MIDICLEAR: MidiSeqDef | null;
  SPAN: [number, number];
  MALLET: [number, number];
  ORNAMENT: Ornaments;
}

/** See pat.getIncDec(). */
export function getIncDec(v: string): [number, string] {
  if (v.startsWith('-')) return [-1, v.slice(1)];
  if (v.startsWith('+')) return [1, v.slice(1)];
  return [0, v];
}

/** See pat.getIncDecValue(). */
export function getIncDecValue(orig: number, inc: number, newV: number): number {
  if (inc === -1) return orig - newV;
  if (inc === 1) return orig + newV;
  return newV;
}

/** See pat.getRndPair(). */
export function getRndPair(
  rep: Reporter,
  l: string,
  trk: string,
  min: number,
  max: number,
): [number, number] {
  if (!l) rep.error(`${trk}: expecting a value or value pair.`);

  const commas = (l.match(/,/g) ?? []).length;
  if (commas > 1) rep.error(`${trk}: Random pairs can only have one ','.`);

  let n1: number;
  let n2: number;
  if (commas === 1) {
    const [a, b] = l.split(',') as [string, string];
    n1 = stoi(rep, a, `${trk}: Expecting integers, not '${a}' or '${b}'.`);
    n2 = stoi(rep, b, `${trk}: Expecting integers, not '${a}' or '${b}'.`);
  } else {
    n1 = stoi(rep, l, `${trk}: Expecting integer, not '${l}'.`);
    n2 = n1 * -1;
  }

  if (n2 < n1) [n1, n2] = [n2, n1];

  if (n1 < min || n1 > max || n2 < min || n2 > max) {
    rep.error(`${trk}: Max range is ${min} to ${max}.`);
  }
  return [n1, n2];
}

/** Python str.title() for the track names MMA uses. */
export function titleCase(s: string): string {
  return s.replace(/[A-Za-z0-9]+/g, (m) => m[0]!.toUpperCase() + m.slice(1).toLowerCase());
}

/** Python %g-ish formatting for debug/formatPattern output. */
function gfmt(n: number): string {
  if (Object.is(n, -0)) return '-0';
  return String(n);
}

export class BaseTrack {
  readonly vtype: string;
  /** Set by ChordTrack (Python's self.voicing); declared here for PC code. */
  voicing: Voicing | null = null;
  /** Set/used by DrumTrack. */
  toneList: number[] = [];

  inited = 0;
  channel = 0;
  grooves = new Map<string, GrooveData>();
  /** Present in Python; currently unused. */
  saveVols: Record<string, number> = {};
  ssvoice = -1;
  smidiVoice: MidiSeqDef | null = null;
  midiSent = 0;
  midiPending: MidiPending[] = [];
  riff: Array<Pattern | string> = [];
  disable = 0;
  sticky = false;

  // clearSequence() defaults (also declared here for type info)
  artic: number[] = [90];
  chord: string[][] = [[]];
  sequence: SequenceItem[] = [null];
  seqRnd = false;
  seqRndWeight: number[] = [1];
  scaleType: string[] = ['AUTO'];
  rVolume: Array<[number, number]> = [[0, 0]];
  rPitch: unknown = null;
  rSkip: number[] = [0];
  rSkipBeats: number[] = [];
  rTime: Array<[number, number]> = [[0, 0]];
  rDuration: Array<[number, number]> = [[0, 0]];
  octave: number[] = [4 * 12];
  voice: number[] = [defaultVoice];
  chordRange: number[] = [1];
  harmony: Array<string | null> = [null];
  harmonyOnly: Array<string | null> = [null];
  harmonyVolume: number[] = [0.8];
  strum: Array<[number, number] | null> = [null];
  strumAdd: number[] = [0];
  volume: number[] = [1];
  compress: number[] = [0];
  dupRoot: number[][] = [[]];
  chordLimit: [number, number, boolean] = [0, 0, false];
  invert: number[][] = [[]];
  lastChord: number[] = [];
  accent: Array<Array<[number, number]>> = [[]];
  unify: number[] = [0];
  midiClear: MidiSeqDef | null = [];
  midiSeq: Array<MidiSeqDef | null> = [];
  midiVoice: Array<MidiSeqDef | null> = [];
  spanStart = 0;
  spanEnd = 127;
  trigger: Trigger = new Trigger();
  mallet = 0;
  malletDecay = 0;
  futureVols: number[] = [];
  direction: string[] = ['BOTH'];
  delay: number[] = [0];
  ornaments: Ornaments = defaultOrnaments();

  // midinote.py state (created here so Restart/clearSequence have a home)
  transpose = 0;
  useticks = 1;
  tickdur = 1;
  articulate = 0;
  tadjust = 0;
  vadjust = 1;
  oadjust = 0;

  nextVolume: number | null = null;
  cVolume = 127;

  /**
   * SOLO/MELODY drum-type state.  Declared on the base class because the
   * parser's TrackApi contract exposes them (PC itself has no such fields).
   */
  /** Python's Melody.drumType default is None; setDrumType() sets true. */
  drumType: boolean | null = null;
  drumTone = 0;

  /** Current sequence slot used by bar() (Python self.seq). */
  seq = 0;
  /** Last CTable returned by getChordInPos() (used by RPitch). */
  currentChord: CTable | null = null;

  constructor(
    readonly ctx: MMAContext,
    readonly name: string,
    vtype = 'BASE',
  ) {
    this.vtype = vtype;
    this.clearSequence();
    this.inited = 1;

    // Double test is needed! We disable a track only when there is a list
    // of tracks which are NOT disabled (gbl.muteTracks).
    if (ctx.muteTracks.length && !ctx.muteTracks.includes(name.toUpperCase())) {
      this.disable = 1;
    }
  }

  // ##########################################
  // These are called from parse() to set options
  // ##########################################

  setCompress(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} Compress`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: number[] = [];
    for (const n0 of ln) {
      const n = getTF(this.ctx.rep, n0, `${this.name} Compress`) ? 1 : 0;
      if (n && this.vtype === 'CHORD' && this.voicing?.mode) {
        // Python sets a local 'vwarn' here but never uses it.
      }
      tmp.push(n);
    }
    this.compress = this.ctx.seqBump(tmp);
    if (!['CHORD', 'ARPEGGIO'].includes(this.vtype)) {
      this.ctx.rep.warning(`Compress is ignored in ${this.vtype} tracks`);
    }
  }

  setRange(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} Range`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: number[] = [];
    for (const n0 of ln) {
      let n = stof(this.ctx.rep, n0);
      if (n === 0) n = 1;
      if (n <= 0 || n >= 6) {
        this.ctx.rep.error(`Range ${this.name} out-of-range; must be between 0..6, not ${n}`);
      }
      tmp.push(n);
    }
    this.chordRange = this.ctx.seqBump(tmp);
    if (!['SCALE', 'ARPEGGIO', 'ARIA'].includes(this.vtype)) {
      this.ctx.rep.warning(`${this.name} Range: ignored in '${this.vtype}' tracks`);
    }
    if (this.vtype === 'ARIA') this.restart();
  }

  /** Error trap stub; the real code is in Chord (and patSolo for SOLO). */
  setVoicing(_ln: string[]): void {
    this.ctx.rep.error(`Voicing is not supported for ${this.vtype} tracks`);
  }

  /** Force output: assigns a MIDI channel and sends the voicing setting. */
  setForceOut(): void {
    if (!this.channel) this.setChannel();
    this.clearPending();
    this.insertVoice(this.ctx.seqCount);
  }

  setDelay(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} Delay`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: number[] = [];
    for (const n0 of ln) {
      let n = n0;
      let mul: number;
      if (n.startsWith('-')) {
        mul = -1;
        n = n.slice(1);
      } else if (n.startsWith('+')) {
        mul = 1;
        n = n.slice(1);
      } else {
        mul = 1;
      }
      tmp.push(getNoteLen(this.ctx.rep, this.ctx.noteLenTable, n) * mul);
    }
    this.delay = this.ctx.seqBump(tmp);
  }

  /** Stub: only valid for CHORD tracks, which override this. */
  setDupRoot(_ln: string[]): void {
    this.ctx.rep.warning(`RootDup has no effect in ${this.vtype} tracks`);
  }

  setChords(ln: string[]): void {
    // An empty arg. or a single '-' turns off this stuff.
    if (ln.length === 0) {
      this.chord = this.ctx.seqBump([[]]);
      return;
    }

    let s = ln.join(' ');
    const clist: string[][] = [];
    for (;;) {
      if (!s) break;

      if (s[0] === '/') {
        if (clist.length) {
          clist.push([...clist[clist.length - 1]!]);
          s = s.slice(1).trim();
          continue;
        }
        this.ctx.rep.error(`${this.name} CHORDS: cannot start with a '/'.`);
      }

      if (s[0] !== '{') {
        s = `{ ${s}}`;
        continue;
      }

      let subs: string[];
      [s, subs] = pextract(s, '{', '}', true);
      if (!subs.length) {
        this.ctx.rep.error(`${this.name} CHORDS: Multiple bar chords need {}s.`);
      }

      const parts = subs[0]!.split(/\s+/).filter((x) => x !== '');
      if (parts.length === 1 && parts[0] === '/') {
        s = `/${s}`;
        continue;
      }
      if (parts.length && parts[0] === '/') {
        this.ctx.rep.error(`${this.name} CHORDS: Chord list cannot start with '/'.`);
      }
      clist.push(parts);
    }

    if (clist.length > this.ctx.seqSize) {
      this.ctx.rep.warning(
        `${this.name} CHORDS: Too many bars(${clist.length}) for seq size(${this.ctx.seqSize}). Chord list truncated.`,
      );
    }
    this.chord = this.ctx.seqBump(clist);
  }

  setChordLimit(ln: string[]): void {
    let mode = 0;
    let forceLen = false;
    const tname = this.name;

    const [words, options] = opt2pair(ln, true);
    for (const { option: cmd, value: opt } of options) {
      if (cmd === 'DROP') {
        mode = stoi(this.ctx.rep, opt, `Expecting integer value for ${tname} DROP, not '${opt}'`);
        if (mode < 1 || mode > 7) {
          this.ctx.rep.error(`${tname} LIMIT Drop value must be 1..7, not '${mode}'.`);
        }
      } else if (cmd === 'FORCE') {
        forceLen = getTF(this.ctx.rep, opt, `${tname} LIMIT FORCE expecting True/False, not '${opt}'`);
      } else {
        this.ctx.rep.error(`LIMIT: Option '${cmd}' not known.`);
      }
    }
    if (words.length !== 1) {
      this.ctx.rep.error(`${tname} LIMIT: Use <value 0-8> DROP=arg (too many args).`);
    }

    let n: number;
    const w = words[0]!.toUpperCase();
    if (w === 'OFF' || w === 'FALSE') n = 0;
    else n = stoi(this.ctx.rep, w, `${tname} LIMIT argument for must be a value, not '${w}'.`);

    if (n !== 0 && (n < 3 || n > 8)) {
      this.ctx.rep.error(`${this.name} LIMIT '${n}' out-of-range; must be 0 or 3 to 8`);
    }

    this.chordLimit = [n, mode, forceLen];

    if (!['CHORD', 'ARPEGGIO'].includes(this.vtype)) {
      this.ctx.rep.warning(`${tname} LIMIT is ignored in ${this.vtype} tracks`);
    }
  }

  /**
   * Set the midi-channel number for a track.  With no argument a free
   * channel is auto-allocated (MidiChPref preference first, then the
   * highest free channel, skipping 10).
   */
  setChannel(ln?: string[] | string): void {
    // The parser passes the channel as a single string (trackChannel); the
    // documented API is a string list - accept both.
    const arg = typeof ln === 'string' ? [ln] : ln;
    let c: number;
    if (!arg || arg.length === 0) {
      c = this.ctx.midiChPrefs.get(this.name) ?? 0;

      if (!c || this.ctx.midiAvail[c]) {
        c = -1;
        for (let a = 16; a >= 1; a--) {
          if (a !== 10 && !this.ctx.midiAvail[a]) {
            c = a;
            break;
          }
        }
      }

      if (c < 0) {
        // Parse all tracks and find the lowest allocated offset.
        // (Python indexes gbl.mtrks[ch] directly; the TS document creates
        // tracks on demand and the writer ignores empty ones.)
        let lowOff = this.ctx.tickOffset;
        let lowCh = -1;
        for (let ch = 1; ch <= 16; ch++) {
          const t = this.ctx.mtrks.track(ch).getLastOffset();
          if (t < lowOff) {
            lowOff = t;
            lowCh = ch;
          }
        }
        c = lowCh;
      }
    } else {
      c = stoi(
        this.ctx.rep,
        arg.join(' '),
        `${this.name} Channel assignment expecting Value, not ${arg.join(' ')}`,
      );
      if (c < 0 || c > 16) {
        this.ctx.rep.error(`${this.name} Channel must be 0..16, not ${arg.join(' ')}`);
      }
    }

    if (c === 10) {
      if (this.vtype === 'DRUM') {
        /* ok */
      } else if (['SOLO', 'MELODY'].includes(this.vtype) && this.drumType) {
        /* ok */
      } else {
        this.ctx.rep.error(`Channel 10 is reserved for DRUM, not ${this.name}`);
      }
    }

    if (this.vtype === 'DRUM' && c !== 10) {
      this.ctx.rep.error('DRUM tracks must be assigned to channel 10');
    }

    // Disable the channel.
    if (c === 0) {
      if (this.ctx.midiAvail[this.channel]) this.ctx.midiAvail[this.channel]! -= 1;
      let s = `${this.name} channel disabled`;
      if (this.ctx.midiAvail[this.channel]) {
        s += ` Other tracks are still using channel ${this.channel}`;
      } else {
        s += ` Channel ${this.channel} available`;
      }
      this.ctx.rep.warning(s);
      this.channel = 0;
      this.disable = 1;
      return;
    }

    if (c !== 10) {
      for (const [a, tr] of this.ctx.tnames) {
        if (a === this.name) continue;
        if (tr.channel === c) {
          this.ctx.rep.warning(`Channel ${c} is being reassigned to ${tr.name}`);
        }
      }
    }

    this.channel = c;
    const assigns = this.ctx.midiAssigns[c]!;
    if (!assigns.includes(this.name)) assigns.push(this.name);

    this.ctx.midiAvail[c]! += 1;

    this.ctx.mtrks.track(c);

    // If a track name has not been set via MidiTName we queue a default.
    if (c !== 10) {
      if (!this.midiPending.some((i) => i[0] === 'TNAME')) {
        this.midiPending.push(['TNAME', 0, titleCase(this.name)]);
      }
    }

    this.ctx.dPrint(`MIDI Channel ${this.channel} assigned to ${this.name}`);
  }

  /** Share a midi-channel with another track. */
  setChShare(ln: string): void {
    if (this.channel) {
      this.ctx.rep.warning(`Channel for ${this.name} has previously been assigned (can't ChShare)`);
      return;
    }

    const sc = ln.toUpperCase();

    trackHooks.trackAlloc(this.ctx, sc, true);

    const other = this.ctx.tnames.get(sc);
    if (!other) this.ctx.rep.error(`Channel '${sc}' does not exist. No such name`);
    if (sc === this.name) this.ctx.rep.error(`${sc} can't share MIDI channel with itself`);

    if (!other.channel) other.setChannel();
    const schannel = other.channel;
    if (!schannel) {
      this.ctx.rep.error(`CHShare attempted to assign MIDI channel for ${this.name}, but none avaiable`);
    }

    this.channel = schannel;
    this.voice = [...other.voice];

    this.ctx.midiAssigns[this.channel]!.push(this.name);
    this.ctx.midiAvail[this.channel]! += 1;
  }

  /** Sticky tracks are ignored by groove commands. */
  setSticky(ln: string[]): void {
    if (ln.length !== 1) {
      this.ctx.rep.error(`${this.name} Sticky needs single argument ('True/False').`);
    }
    this.sticky = getTF(this.ctx.rep, ln[0]!.toUpperCase(), `${this.name} Sticky`);
  }

  setStrum(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} Strum`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: Array<[number, number] | null> = [];
    for (const n of ln) {
      let a: number;
      let b: number;
      if (n.includes(',')) {
        const [x, y] = n.split(',', 2) as [string, string];
        a = stoi(this.ctx.rep, x, `Argument for ${this.name} Strum must be an integer`);
        b = stoi(this.ctx.rep, y, `Argument for ${this.name} Strum must be an integer`);
      } else {
        a = stoi(this.ctx.rep, n, `Argument for ${this.name} Strum must be an integer`);
        b = a;
      }
      if (a > b) [a, b] = [b, a];
      if (a < -300 || a > 300 || b < -300 || b > 300) {
        this.ctx.rep.error(`STRUM: ${n} out-of-range. All values must be -300..300`);
      }
      if (a === 0 && b === 0) tmp.push(null);
      else tmp.push([a, b]);
    }
    this.strum = this.ctx.seqBump(tmp);
    if (this.vtype === 'DRUM') this.ctx.rep.warning(`Strum has no effect in ${this.name} tracks`);
  }

  setStrumAdd(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} StrumAdd`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: number[] = [];
    for (const i of ln) {
      tmp.push(stoi(this.ctx.rep, i, `Argument for ${this.name} StrumAdd must be an integer`));
    }
    this.strumAdd = this.ctx.seqBump(tmp);
  }

  /** Set the harmony mode(s); see MMA/harmony.py setHarmony. */
  setHarmony(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} Harmony`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: Array<string | null> = [];
    for (let n of ln) {
      n = n.toUpperCase();
      if (['-', '0', 'NONE'].includes(n)) tmp.push(null);
      else tmp.push(n);
    }
    this.harmony = this.ctx.seqBump(tmp);

    if (['CHORD', 'DRUM'].includes(this.vtype)) {
      this.ctx.rep.warning(`Harmony setting for ${this.vtype} track ignored`);
    }
  }

  /** Set harmony-only mode; this also enables the harmony notes. */
  setHarmonyOnly(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} HarmonyOnly`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: Array<string | null> = [];
    for (let n of ln) {
      n = n.toUpperCase();
      if (['-', '0', 'NONE'].includes(n)) tmp.push(null);
      else tmp.push(n);
    }
    this.harmony = this.ctx.seqBump(tmp);
    this.harmonyOnly = this.ctx.seqBump(tmp);

    if (['CHORD', 'DRUM'].includes(this.vtype)) {
      this.ctx.rep.warning(`HarmonyOnly setting for ${this.vtype} track ignored`);
    }
  }

  /** Set the harmony volume adjustment (percentage of the note volume). */
  setHarmonyVolume(ln: string[]): void {
    // Python passes '%s HarmonyOnly' as the lnExpand message here (typo in
    // MMA/harmony.py setHarmonyVolume); reproduced for identical warnings.
    ln = lnExpand(this.ctx.rep, ln, `${this.name} HarmonyOnly`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: number[] = [];
    for (const n of ln) {
      const v = stoi(this.ctx.rep, n);
      if (v < 0) this.ctx.rep.error('HarmonyVolume adjustment must be positive integer');
      tmp.push(v / 100);
    }
    this.harmonyVolume = this.ctx.seqBump(tmp);

    if (['PLECTRUM', 'DRUM'].includes(this.vtype)) {
      this.ctx.rep.warning(`HarmonyVolume adjustment for ${this.vtype} track ignored`);
    }
  }

  /** Returns the strum factor; 0 when strum is (0,0)/unset. */
  getStrum(sc: number): number {
    const s = this.strum[sc];
    if (!s) return 0;
    const [a, b] = s;
    if (a === b) return a;
    return this.ctx.rng.randint(a, b);
  }

  /** Error trap; only drum tracks have tones. */
  setTone(_ln: string[]): void {
    this.ctx.rep.error(`Tone command not supported for ${this.name} track`);
  }

  setOn(): void {
    if (this.ctx.muteTracks.length && !this.ctx.muteTracks.includes(this.name)) {
      this.ctx.rep.warning(`Attempt to enable muted track ${this.name} ignored.`);
    } else {
      this.disable = 0;
      this.ssvoice = -1;
    }
    this.ctx.dPrint(`${this.name} Enabled`);
  }

  setOff(): void {
    this.disable = 1;
    this.ctx.dPrint(`${this.name} Disabled`);
  }

  setRVolume(ln: string[]): void {
    const msg = `${this.name} Rvolume`;
    ln = lnExpand(this.ctx.rep, ln, msg, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: Array<[number, number]> = [];
    for (const n of ln) {
      const [n1, n2] = getRndPair(this.ctx.rep, n, msg, -100, 100);
      tmp.push([n1 / 100, n2 / 100]);
    }
    this.rVolume = this.ctx.seqBump(tmp);
  }

  setRSkip(ln: string[]): void {
    const msg = `${this.name} RSkip`;
    const [words, options] = opt2pair(ln);

    if (words.length === 0) {
      this.ctx.rep.error(`${msg}: Needs weighting list and optional beats=[].`);
    }

    this.rSkipBeats = [];
    for (const { option: cmd, value: opt } of options) {
      if (cmd.toUpperCase() === 'BEATS') {
        const beats = opt.split(',');
        if (!beats.length) this.ctx.rep.error(`${msg} Beats: Expecting list of affected beats.`);
        this.rSkipBeats = [];
        for (const b0 of beats) {
          const b = stof(this.ctx.rep, b0);
          if (b < 1) this.ctx.rep.error(`${msg}: Beats must be => 1, not '${b}'`);
          if (b >= this.ctx.QperBar + 1) {
            this.ctx.rep.error(`${msg}: Beats must less than ${this.ctx.QperBar + 1}, not '${b}'`);
          }
          this.rSkipBeats.push(Math.trunc((b - 1) * this.ctx.BperQ));
        }
      } else {
        this.ctx.rep.error(`${msg}: Unknown option ${cmd}.`);
      }
    }

    const expanded = lnExpand(this.ctx.rep, words, msg, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: number[] = [];
    for (const n0 of expanded) {
      const n = stoi(this.ctx.rep, n0, `${msg}: Expecting integer`);
      if (n < 0 || n > 99) this.ctx.rep.error(`${msg}: arg must be 0..99`);
      tmp.push(n / 100);
    }
    this.rSkip = this.ctx.seqBump(tmp);
  }

  setRDuration(ln: string[]): void {
    const msg = `${this.name} RDuration`;
    ln = lnExpand(this.ctx.rep, ln, msg, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: Array<[number, number]> = [];
    for (const n of ln) {
      const [n1, n2] = getRndPair(this.ctx.rep, n, msg, -100, 100);
      tmp.push([n1 / 100, n2 / 100]);
    }
    this.rDuration = this.ctx.seqBump(tmp);
  }

  setRTime(ln: string[]): void {
    const msg = `${this.name} RTime`;
    ln = lnExpand(this.ctx.rep, ln, msg, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: Array<[number, number]> = [];
    for (const n of ln) {
      tmp.push(getRndPair(this.ctx.rep, n, msg, -100, 100));
    }
    this.rTime = this.ctx.seqBump(tmp);
  }

  setDirection(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} Direction`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: string[] = [];
    for (const n0 of ln) {
      const n = n0.toUpperCase();
      if (!['UP', 'DOWN', 'BOTH', 'RANDOM'].includes(n)) {
        this.ctx.rep.error(`Unknown ${this.name} Direction '${n}'`);
      }
      tmp.push(n);
    }
    this.direction = this.ctx.seqBump(tmp);
    if (this.vtype === 'SCALE') {
      this.lastChord = [];
      // Python also sets lastNote = -1 (SCALE-only state).
    }
  }

  /** Error stub; the real code is in the permitted track code. */
  setScaletype(_ln: string[]): void {
    this.ctx.rep.warning(`ScaleType has no effect in ${this.vtype} tracks`);
  }

  /**
   * Set inversion for the track.  Can be applied to any track but has no
   * effect in drum tracks: it inverts the chord by one rotation per value.
   */
  setInvert(ln: string[]): void {
    const msg = `${this.name} Invert`;
    ln = lnExpand(this.ctx.rep, ln, msg, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: number[][] = [];
    for (const n of ln) {
      let n1: number;
      let n2: number;
      if (!n.includes(',')) {
        n1 = stoi(this.ctx.rep, n, `Invert ${this.name} doesn't recognize '${n}'.`);
        n2 = n1;
      } else {
        [n1, n2] = getRndPair(this.ctx.rep, n, msg, -10, 10);
      }
      if (n1 === 0 && n2 === 0) tmp.push([]);
      else tmp.push([n1, n2]);
    }

    if (this.vtype === 'CHORD' && this.voicing?.mode && tmp.some((x) => x.length)) {
      this.ctx.rep.warning(`${this.name}: Setting both Voicing Mode and Invert is not a good idea`);
    }
    if (!['CHORD', 'ARPEGGIO'].includes(this.vtype)) {
      this.ctx.rep.warning(`Invert is ignored in ${this.vtype} tracks`);
    }
    this.invert = this.ctx.seqBump(tmp);
  }

  /** Set the octave for a track. Use 0-10, -x, +x. */
  setOctave(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} Octave`, this.ctx.seqSize, this.ctx.inAllGrooves);
    ln = this.ctx.seqBump(ln); // needed for +/- values to complete
    const tmp: number[] = [];
    let i = 0;
    for (const n0 of ln) {
      const [incr, body] = getIncDec(n0);
      const v = stoi(this.ctx.rep, body, `Argument for ${this.name} Octave must be an integer`);
      const n = getIncDecValue(Math.floor(this.octave[i]! / 12), incr, v);
      if (n < 0 || n > 10) this.ctx.rep.error(`Octave ${n} out-of-range; must be 0..10`);
      tmp.push(n * 12);
      i += 1;
    }
    this.octave = this.ctx.seqBump(tmp);
    this.ctx.dPrint(`Set ${this.name} Octave to: ${this.octave.map((x) => x / 12).join(' ')}`);
  }

  /** Set the octave using MIDI octave values (-1..9). */
  setMOctave(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} MOctave`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: number[] = [];
    for (const n0 of ln) {
      const n = stoi(this.ctx.rep, n0, `Argument for ${this.name} MOctave must be an integer`);
      if (n < -1 || n > 9) this.ctx.rep.error(`MOctave ${n} out-of-range; must be -1..9`);
      tmp.push((n + 1) * 12);
    }
    this.octave = this.ctx.seqBump(tmp);
    this.ctx.dPrint(`Set ${this.name} MOctave to: ${this.octave.map((x) => x / 12 - 1).join(' ')}`);
  }

  /** Set span (start/end already verified by the parser). */
  setSpan(start: number, end: number): void {
    if (this.vtype === 'DRUM') this.ctx.rep.warning('Span has no effect in Drum tracks');
    this.spanStart = start;
    this.spanEnd = end;
    this.ctx.dPrint(`Set ${this.name} Span to ${this.spanStart}...${this.spanEnd}`);
  }

  /** Expand existing pattern lists to the current sequence size. */
  setSeqSize(): void {
    this.sequence = this.ctx.seqBump(this.sequence);
    if (this.midiVoice.length) this.midiVoice = this.ctx.seqBump(this.midiVoice);
    if (this.midiSeq.length) this.midiSeq = this.ctx.seqBump(this.midiSeq);
    this.invert = this.ctx.seqBump(this.invert);
    this.artic = this.ctx.seqBump(this.artic);
    this.chord = this.ctx.seqBump(this.chord);
    this.volume = this.ctx.seqBump(this.volume);
    this.voice = this.ctx.seqBump(this.voice);
    this.rVolume = this.ctx.seqBump(this.rVolume);
    this.rSkip = this.ctx.seqBump(this.rSkip);
    this.rTime = this.ctx.seqBump(this.rTime);
    this.rDuration = this.ctx.seqBump(this.rDuration);
    this.seqRndWeight = this.ctx.seqBump(this.seqRndWeight);
    this.strum = this.ctx.seqBump(this.strum);
    this.strumAdd = this.ctx.seqBump(this.strumAdd);
    this.octave = this.ctx.seqBump(this.octave);
    this.harmony = this.ctx.seqBump(this.harmony);
    this.harmonyOnly = this.ctx.seqBump(this.harmonyOnly);
    this.harmonyVolume = this.ctx.seqBump(this.harmonyVolume);
    this.direction = this.ctx.seqBump(this.direction);
    this.delay = this.ctx.seqBump(this.delay);
    this.scaleType = this.ctx.seqBump(this.scaleType);
    this.compress = this.ctx.seqBump(this.compress);
    this.chordRange = this.ctx.seqBump(this.chordRange);
    this.dupRoot = this.ctx.seqBump(this.dupRoot);
    this.unify = this.ctx.seqBump(this.unify);
    this.accent = this.ctx.seqBump(this.accent);
  }

  /**
   * Set the voice for a track.  This just sets flags; the voice is sent
   * in bar().  The voice can be a gm-string, user-def-string, or value.
   */
  setVoice(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} Voice`, this.ctx.seqSize, this.ctx.inAllGrooves);

    // Drum tracks permit setting the voice with the name of a drumkit.
    if (this.vtype === 'DRUM') {
      const newline: string[] = [];
      for (let a of ln.map((x) => x.toUpperCase())) {
        if (a.endsWith('KIT')) {
          a = a.slice(0, -3);
          if (a in DRUM_KITS_BY_NAME) a = String(DRUM_KITS_BY_NAME[a]);
        }
        newline.push(a);
      }
      ln = newline;
    }

    const tmp: number[] = [];
    for (const n of ln) {
      tmp.push(
        decodeVoice(
          this.ctx.rep,
          {
            get: (x) => {
              const v = this.ctx.vtable.get(x);
              return v === undefined ? x : String(v);
            },
          },
          n,
        ),
      );
    }
    this.voice = this.ctx.seqBump(tmp);

    if (this.channel && (this.ctx.midiAssigns[this.channel]?.length ?? 0) > 1) {
      const a: string[] = [];
      for (const n of this.ctx.midiAssigns[this.channel]!) {
        if (n !== this.name) a.push(n);
      }
      const [t1, v1] = a.length > 1 ? ['Tracks', 'are'] : ['Track', 'is'];
      this.ctx.rep.warning(
        `${t1} ${a.join(', ')} ${v1} shared with ${this.name}. Changing voice may create conflict`,
      );
    }
  }

  setMidiClear(ln: string[]): void {
    if (['z', 'Z', '-'].includes(ln[0]!)) {
      this.midiClear = null;
    } else {
      this.midiClear = trackHooks.mdefGet(this.ctx, ln[0]!);
    }
    this.ctx.dPrint(`${this.name} MIDIClear: ${this.midiSeqFmt(this.midiClear)}`);
  }

  /** Reset MIDI settings. */
  doMidiClear(): void {
    if (this.midiSent) {
      if (!this.midiClear) {
        this.ctx.rep.warning(
          `${this.name}: Midi data has been inserted with MIDIVoice/Seq but no MIDIClear data is present`,
        );
      } else {
        for (const i of this.midiClear) {
          this.ctx.mtrks.track(this.channel).addCtl(this.ctx.tickOffset, i[1]);
        }
      }
      this.midiSent = 0;
    }
  }

  /**
   * Reset the midi voicing to 'sane' when the track ends.  Standard MIDI
   * voicing is left alone, only extended voicing is affected.
   */
  doChannelReset(): void {
    if (this.ssvoice > 127 && this.ssvoice !== NONETONE) {
      this.ctx.mtrks.track(this.channel).addProgChange(this.ctx.tickOffset, 0, this.ssvoice);
    }
  }

  setMidiSeq(ln: string[]): void {
    // lnExpand works here; midi data has been converted to pseudo-macros
    // by the parser.
    ln = lnExpand(this.ctx.rep, ln, `${this.name} MidiSeq`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const seq: Array<MidiSeqDef | null> = [];
    for (const a of ln) {
      if (['z', 'Z', '-'].includes(a)) seq.push(null);
      else seq.push(trackHooks.mdefGet(this.ctx, a.toUpperCase()));
    }
    if (seq.every((x) => x === null)) this.midiSeq = [];
    else this.midiSeq = this.ctx.seqBump(seq);
  }

  setMidiVoice(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} MIDIVoice`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const seq: Array<MidiSeqDef | null> = [];
    for (const a of ln) {
      if (['z', 'Z'].includes(a)) seq.push(null);
      else seq.push(trackHooks.mdefGet(this.ctx, a.toUpperCase()));
    }
    if (seq.every((x) => x === null)) this.midiVoice = [];
    else this.midiVoice = this.ctx.seqBump(seq);
  }

  /** Debug formatting for MIDIVoice/MidiSeq/MidiClear. */
  midiSeqFmt(lst: MidiSeqDef | null): string {
    if (lst === null) return '';
    let ret = '';
    for (const i of lst) {
      ret += `${i[0]} ${valueToCtrl(i[1][0]!)} 0x${(i[1][1] ?? 0).toString(16).padStart(2, '0')} ; `;
    }
    return ret.replace(/; $/, '');
  }

  setVolume(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} Volume`, this.ctx.seqSize, this.ctx.inAllGrooves);
    ln = this.ctx.seqBump(ln); // needed for -/+ setting to apply to all seqs

    const tmp: number[] = new Array(ln.length).fill(0);
    this.futureVols = []; // clear off dangling (de)cresc for voice.

    for (let i = 0; i < ln.length; i++) {
      // Python's calcVolume() regex is case-insensitive (re.IGNORECASE) and
      // upper-cases the mnemonic; Volume.ts compiles without the flag, so
      // normalise here to keep 'ff'/'pp' working (reported to the owner).
      let a = this.ctx.volume.calcVolume(ln[i]!.toUpperCase(), this.volume[i]!);
      if (this.vtype === 'DRUM' || (['MELODY', 'SOLO'].includes(this.vtype) && this.drumType)) {
        a = drumVolTable.get(this.toneList[i]!, a);
      } else {
        a = voiceVolTable.get(this.voice[i]!, a);
      }
      tmp[i] = a;
    }
    this.volume = this.ctx.seqBump(tmp);
    this.ctx.dPrint(`Set ${this.name} Volume to: ${this.volume.map((a) => Math.trunc(a * 100)).join(' ')}`);
  }

  /** Set Crescendo for a track. */
  setCresc(dir: number, ln: string[]): void {
    if (ln.length === 3) {
      this.setVolume([ln[0]!]);
      ln = ln.slice(1);
    }
    if (ln.length !== 2) this.ctx.rep.error('Cresc expecting 2 or 3 args.');

    const vol = this.volume[0]!;
    if (this.volume.filter((v) => v === vol).length !== this.volume.length) {
      this.ctx.rep.warning('(De)Crescendo being used with track with variable sequence volumes');
    }

    this.futureVols = fvolume(this.ctx, dir, vol, ln);
    this.ctx.dPrint(`Set ${this.name} Cresc to: ${this.futureVols.map((a) => Math.trunc(a * 100)).join(' ')}`);
  }

  /** Set a swell (cresc<>decresc) for a track. */
  setSwell(ln: string[]): void {
    if (ln.length === 3) {
      this.setVolume([ln[0]!]);
      ln = ln.slice(1);
    }
    if (ln.length !== 2) this.ctx.rep.error(`${this.name} Swell expecting 2 or 3 args.`);

    if (this.volume.filter((v) => v === this.volume[0]).length !== this.volume.length) {
      this.ctx.rep.warning(`${this.name} Swell being used with track with variable sequence volumes.`);
    }

    let count = stoi(this.ctx.rep, ln[1]!);
    if (count < 2) this.ctx.rep.error(`${this.name} Swell bar count must be 2 or greater.`);

    count += 1;
    let c = Math.floor(count / 2);
    let offset: number;
    if (count % 2) {
      offset = 1;
      c += 1;
    } else {
      offset = 0;
    }
    const cStr = String(c);

    this.futureVols = fvolume(this.ctx, 0, this.volume[0]!, [ln[0]!, cStr]);
    this.futureVols.push(
      ...fvolume(this.ctx, 0, this.futureVols[this.futureVols.length - 1]!, [
        String(Math.trunc(this.volume[0]! * 100)),
        cStr,
      ]).slice(offset),
    );
    this.ctx.dPrint(`Set ${this.name} Swell to: ${this.futureVols.map((a) => Math.trunc(a * 100)).join(' ')}`);
  }

  /** Mallet (repeat) settings. */
  setMallet(ln: string[]): void {
    if (this.vtype === 'PLECTRUM') {
      this.ctx.rep.warning(`${this.name}: Mallet has no effect, ignored.`);
      return;
    }

    for (const l of ln) {
      const eq = l.indexOf('=');
      if (eq < 0) {
        this.ctx.rep.error(`${this.name} Mallet: each option must contain a '=', not '${l}'`);
      }
      const mode = l.slice(0, eq).toUpperCase();
      const val = l.slice(eq + 1);

      if (mode === 'RATE') {
        if (val === '0' || val.toUpperCase() === 'NONE') this.mallet = 0;
        else this.mallet = getNoteLen(this.ctx.rep, this.ctx.noteLenTable, val);
      } else if (mode === 'DECAY') {
        const v = stof(this.ctx.rep, val, `Mallet Decay must be a value, not '${val}'`);
        if (v < -50 || v > 50) this.ctx.rep.error(`${this.name} Mallet: Decay rate must be -50..+50`);
        this.malletDecay = v / 100;
      } else {
        this.ctx.rep.error(`${this.name} Mallet: ${mode} is not a option.`);
      }
    }
    this.ctx.dPrint(`${this.name} Mallet Rate:${this.mallet} Decay:${this.malletDecay}`);
  }

  /** Set the accent values: a list of (beat, percentage) per sequence. */
  setAccent(ln: string[]): void {
    let s = ln.join(' ');
    if (!s.startsWith('{')) s = `{${s}}`;

    const l: Array<string | string[]> = [];
    while (s) {
      if (s[0] === '/') s = `{/}${s.slice(1)}`;

      if (s[0] !== '{') {
        this.ctx.rep.error(`${this.name} Accent: Unmatched or missing '{} delimters`);
      }

      let subs: string[];
      [s, subs] = pextract(s, '{', '}', true);

      if (subs.length === 1 && subs[0] === '/') l.push('/');
      else l.push(subs[0]!.split(/\s+/).filter((x) => x !== ''));
    }

    const expanded = lnExpandMixed(this.ctx, l, `${this.name} Accent`);

    const tmp: Array<Array<[number, number]>> = [];
    for (const e of expanded) {
      if (typeof e === 'string') {
        this.ctx.rep.error(`Use: ${this.name} Accent Beat Percentage [...]`);
      }
      const tt: Array<[number, number]> = [];
      if (Math.floor(e.length / 2) * 2 !== e.length) {
        this.ctx.rep.error(`Use: ${this.name} Accent Beat Percentage [...]`);
      }
      for (let i = 0; i < e.length; i += 2) {
        const b = this.setBarOffset(e[i]!);
        const v = stoi(this.ctx.rep, e[i + 1]!, `Beat offset must be a value, not '${e[i + 1]}'`);
        if (v < -100 || v > 100) {
          this.ctx.rep.error(`Velocity adjustment (as percentage) must be -100..100, not '${v}'`);
        }
        tt.push([b, v / 100]);
      }
      tmp.push(tt);
    }
    this.accent = this.ctx.seqBump(tmp);
  }

  /** Set the note articulation value. */
  setArtic(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} Articulate`, this.ctx.seqSize, this.ctx.inAllGrooves);
    ln = this.ctx.seqBump(ln);
    const tmp: number[] = [];
    let i = 0;
    for (const n0 of ln) {
      const [incr, n] = getIncDec(n0);
      const v = stoi(this.ctx.rep, n, 'Expecting value in articulation setting');
      const a = getIncDecValue(this.artic[i]!, incr, v);

      if (this.vtype === 'PLECTRUM') {
        if (a < 0 || a > 500) {
          this.ctx.rep.error(`${this.name}: Articulation setting must be 0 .. 500 (midi ticks), not ${a}`);
        }
      } else {
        if (a < 1 || a > 500) {
          this.ctx.rep.error(`${this.name}: Articulation setting must be 1..500, not ${a}`);
        }
        if (a > 200) this.ctx.rep.warning(`${this.name}: Articulation '${a}' is a large value.`);
      }
      tmp.push(a);
      i += 1;
    }
    this.artic = this.ctx.seqBump(tmp);
    this.ctx.dPrint(`Set ${this.name} Articulate to: ${this.artic.join(' ')}`);
  }

  setUnify(ln: string[]): void {
    ln = lnExpand(this.ctx.rep, ln, `${this.name} Unify`, this.ctx.seqSize, this.ctx.inAllGrooves);
    const tmp: number[] = [];
    for (const n of ln) tmp.push(getTF(this.ctx.rep, n, 'Unify') ? 1 : 0);
    this.unify = this.ctx.seqBump(tmp);
    this.ctx.dPrint(`Set ${this.name} Unify to: ${this.unify.join(' ')}`);
  }

  // ##################################################
  // Save/restore grooves
  // ##################################################

  /** Snapshot this track's settings under a groove name. */
  saveGroove(gname: string): void {
    this.grooves.set(gname, {
      ACCENT: this.accent.map((tt) => tt.map(([b, a]) => [b, a] as [number, number])),
      ARTIC: [...this.artic],
      CHORD: this.chord.map((x) => [...x]),
      COMPRESS: [...this.compress],
      DELAY: [...this.delay],
      DIR: [...this.direction],
      DUPROOT: this.dupRoot.map((x) => [...x]),
      HARMONY: [[...this.harmony], [...this.harmonyOnly], [...this.harmonyVolume]],
      INVERT: this.invert.map((x) => [...x]),
      LIMIT: [this.chordLimit[0], this.chordLimit[1], this.chordLimit[2]],
      RANGE: [...this.chordRange],
      OCTAVE: [...this.octave],
      RSKIP: [...this.rSkip],
      RSKIPBEATS: [...this.rSkipBeats],
      RTIME: this.rTime.map(([a, b]) => [a, b] as [number, number]),
      RDURATION: this.rDuration.map(([a, b]) => [a, b] as [number, number]),
      RVOLUME: this.rVolume.map(([a, b]) => [a, b] as [number, number]),
      // Python deepcopies rPitch; it is either null or an unported Rpitch.
      RPITCH: this.rPitch,
      SCALE: [...this.scaleType],
      SEQ: [...this.sequence],
      SEQRND: this.seqRnd,
      SEQRNDWT: [...this.seqRndWeight],
      STRUM: this.strum.map((x) => (x ? [x[0], x[1]] : null)),
      STRUMADD: [...this.strumAdd],
      VOICE: [...this.voice],
      VOLUME: [...this.volume],
      UNIFY: [...this.unify],
      MIDISEQ: this.midiSeq.map(copySeq),
      MIDIVOICE: this.midiVoice.map(copySeq),
      MIDICLEAR: copySeq(this.midiClear),
      SPAN: [this.spanStart, this.spanEnd],
      MALLET: [this.mallet, this.malletDecay],
      ORNAMENT: {
        ...this.ornaments,
        pad: [...this.ornaments.pad],
        beats: [...this.ornaments.beats],
        bars: [...this.ornaments.bars],
        rvolume: [...this.ornaments.rvolume],
      },
    });
  }

  /** Restore a defined groove. */
  restoreGroove(gname: string): void {
    if (this.vtype !== 'PLECTRUM') this.doMidiClear();

    const g = this.grooves.get(gname);
    if (!g) this.ctx.rep.error(`${this.name}: no groove data for '${gname}' - call Bob.`);

    this.sequence = g.SEQ;
    this.volume = g.VOLUME;
    this.accent = g.ACCENT;
    this.rTime = g.RTIME;
    this.rDuration = g.RDURATION;
    this.rVolume = g.RVOLUME;
    this.rPitch = g.RPITCH;
    this.rSkip = g.RSKIP;
    this.rSkipBeats = g.RSKIPBEATS;
    this.strum = g.STRUM;
    this.strumAdd = g.STRUMADD;
    this.octave = g.OCTAVE;
    this.voice = g.VOICE;
    this.harmony = g.HARMONY[0];
    this.harmonyOnly = g.HARMONY[1];
    this.harmonyVolume = g.HARMONY[2];
    this.direction = g.DIR;
    this.delay = g.DELAY;
    this.scaleType = g.SCALE;
    this.invert = g.INVERT;
    this.chord = g.CHORD;
    this.artic = g.ARTIC;
    this.seqRnd = g.SEQRND;
    this.seqRndWeight = g.SEQRNDWT;
    this.compress = g.COMPRESS;
    this.chordRange = g.RANGE;
    this.dupRoot = g.DUPROOT;
    this.chordLimit = g.LIMIT;
    this.unify = g.UNIFY;
    this.midiClear = g.MIDICLEAR;
    this.midiSeq = g.MIDISEQ;
    this.midiVoice = g.MIDIVOICE;
    [this.spanStart, this.spanEnd] = g.SPAN;
    [this.mallet, this.malletDecay] = g.MALLET;
    this.ornaments = g.ORNAMENT;

    // A track may have been created after the groove was saved, in which
    // case the restored data has the wrong sequence size.
    if (this.octave.length !== this.ctx.seqSize) this.setSeqSize();
  }

  // ####################################
  // Sequence functions
  // ####################################

  /**
   * Clear the sequence for a track.  Also called from the constructor to
   * set the initial defaults for each track.
   */
  clearSequence(): void {
    if (this.vtype !== 'SOLO' || !this.inited) {
      this.artic = this.vtype === 'PLECTRUM' ? [0] : [90];
      this.chord = [[]];
      this.sequence = [null];
      this.seqRnd = false;
      this.seqRndWeight = [1];
      this.scaleType = ['AUTO'];
      this.rVolume = [[0, 0]];
      this.rPitch = null;
      this.rSkip = [0];
      this.rSkipBeats = [];
      this.rTime = [[0, 0]];
      this.rDuration = [[0, 0]];
      this.octave = [4 * 12];
      this.voice = [this.vtype === 'DRUM' ? defaultDrum : defaultVoice];
      this.chordRange = [1];
      this.harmony = [null];
      this.harmonyOnly = [null];
      this.harmonyVolume = [0.8];
      this.strum = [null];
      this.strumAdd = [0];
      this.volume = [this.ctx.volume.vols['M']!];
      this.compress = [0];
      this.dupRoot = [[]];
      this.chordLimit = [0, 0, false];
      this.invert = [[]];
      this.lastChord = [];
      this.accent = [[]];
      this.unify = [0];
      this.midiClear = [];
      this.midiSeq = [];
      this.midiVoice = [];
      this.spanStart = 0;
      this.spanEnd = 127;
      this.trigger = new Trigger();
      this.mallet = 0;
      this.malletDecay = 0;
      this.futureVols = [];
      this.direction = ['BOTH'];
      this.delay = [0];
      this.ornaments = defaultOrnaments();

      // for midinote (see midinote.py)
      this.transpose = 0;
      this.useticks = 1;
      this.tickdur = 1;
      this.articulate = 0;
      this.tadjust = 0;
      this.vadjust = 1;
      this.oadjust = 0;
    }

    if (this.riff.length) {
      if (this.riff.length > 1) {
        this.ctx.rep.warning(`${this.name} sequence clear deleting ${this.riff.length} riffs`);
      } else {
        this.ctx.rep.warning(`${this.name} sequence clear deleting unused riff`);
      }
    }
    this.riff = [];
    this.setSeqSize();
  }

  /** Restart the track to almost-default conditions (subclasses extend). */
  restart(): void {
    this.ssvoice = -1;
  }

  // ############################
  // Pattern functions
  // ############################

  /**
   * Define a pattern; stored in ctx.pats under (vtype, name).  The parser
   * passes the pattern text as one string (MMA/pat.py); a token list is
   * also accepted and joined.
   */
  definePattern(name: string, ln: string[] | string, upper = true): void {
    const nm = name.toUpperCase();

    let redef: string;
    if (nm.startsWith('_')) redef = 'dynamic define';
    else if (this.ctx.pats.has(this.vtype, nm)) redef = `${nm} redefined`;
    else redef = `${nm} created`;

    let s = typeof ln === 'string' ? ln : ln.join(' ');
    if (this.vtype !== 'SOLO' && this.vtype !== 'MELODY') s = s.replace(/[; ]+$/, '');

    const pat = this.defPatRiff(s, upper);
    this.ctx.pats.set(this.vtype, nm, pat);

    if (this.ctx.debug.pshow) {
      this.ctx.dPrint(`${titleCase(this.name)} pattern ${redef}: ${this.formatPattern(pat)}`);
    }
  }

  /** Duplicate riffs from/to another solo track (not used by M1 tracks). */
  dupRiff(ln: string[]): void {
    if (ln.length && ln[0]!.toUpperCase() === 'FROM') {
      if (ln.length !== 2) {
        this.ctx.rep.error(`${this.name} DupRiff: FROM option needs exactly one track to copy from.`);
      }
      const t = ln[1]!.toUpperCase();
      const tr = this.ctx.tnames.get(t);
      if (!tr) this.ctx.rep.error(`${this.name} DupRiff: Source track '${t}' does not exist.`);
      if (this.vtype !== tr.vtype) {
        this.ctx.rep.error(
          `${this.name} DupRiff: Can't copy from ${t}, incompatible types (${this.vtype} != ${tr.vtype}).`,
        );
      }
      if (this.riff.length) this.ctx.rep.error(`${this.name} DupRiff: This track had pending data.`);
      if (!tr.riff.length) this.ctx.rep.error(`${this.name} DupRiff: Source track '${t}' has no data to copy.`);
      this.riff = copyRiff(tr.riff);
    } else {
      let dest = ln;
      if (dest.length && dest[0]!.toUpperCase() === 'TO') dest = dest.slice(1);
      if (!dest.length) this.ctx.rep.error(`${this.name} DupRiff: No destination track specified.`);
      if (!this.riff.length) this.ctx.rep.error(`${this.name} DupRiff: No data to copy.`);
      for (const t0 of dest) {
        const t = t0.toUpperCase();
        const tr = this.ctx.tnames.get(t);
        if (!tr) this.ctx.rep.error(`${this.name} DupRiff: Destination track ${t} does not exist.`);
        if (this.vtype !== tr.vtype) {
          this.ctx.rep.error(
            `${this.name} DupRiff: Can't copy to ${t}, incompatible types (${this.vtype} != ${tr.vtype}).`,
          );
        }
        if (tr.riff.length) {
          this.ctx.rep.error(`${this.name} DupRiff: Destination track ${tr.name} has pending data.`);
        }
        tr.riff = copyRiff(this.riff);
      }
    }
  }

  /** Define and set a riff. */
  setRiff(ln: string | string[]): void {
    const solo = ['MELODY', 'SOLO'].includes(this.vtype);
    if (solo) {
      this.riff.push(typeof ln === 'string' ? ln : ln.join(' '));
    } else {
      let s = typeof ln === 'string' ? ln : ln.join(' ');
      s = s.replace(/[; ]+$/, '');
      if (s.length === 1 && ['Z', 'z', '-'].includes(s)) this.riff.push([]);
      else this.riff.push(this.defPatRiff(s));
    }
  }

  /**
   * Worker shared by definePattern() and setRiff(): convert "1 4 90; 2 4 90"
   * into a sorted list of PatternEvents, resolving track/pattern references
   * and applying SHIFT / `*` modifiers.  MELODY/SOLO override this and keep
   * the pattern as a plain string.
   */
  defPatRiff(ln: string | string[], upper = true): Pattern | string {
    let s = typeof ln === 'string' ? ln : ln.join(' ');
    if (upper) s = s.toUpperCase();

    const p: string[][] = [];
    for (const l of s.split(';')) p.push(l.split(/\s+/).filter((x) => x !== ''));

    const plist: Pattern = [];

    for (const evOrig of p) {
      let ev = [...evOrig];
      let more: string[] = [];
      for (let i = 0; i < ev.length; i++) {
        const e = ev[i]!;
        if (e === 'SHIFT' || e === '*') {
          if (i === 0) this.ctx.rep.error("Pattern definition can't start with SHIFT or *");
          more = ev.slice(i);
          ev = ev.slice(0, i);
          break;
        }
      }

      let pt: Pattern;
      if (ev.length === 1) {
        const nm = ev[0]!;
        const stored = this.ctx.pats.get(this.vtype, nm);
        if (stored === undefined) {
          // Python checks `nm[0]` (the vtype) for a leading underscore here,
          // which can never be true; the error below is the only reachable one.
          this.ctx.rep.error(`${nm} is not an existing ${titleCase(this.vtype)} pattern`);
        }
        pt = stored as Pattern;
      } else {
        pt = [this.getPgroup(ev)];
      }

      while (more.length) {
        const cmd = more.shift()!;
        if (cmd !== 'SHIFT' && cmd !== '*') {
          this.ctx.rep.error(`Expecting SHIFT or *, not '${cmd}'`);
        }
        if (!more.length) this.ctx.rep.error(`Expecting factor after ${cmd}`);
        if (cmd === 'SHIFT') pt = shiftPatRiff(this.ctx, pt, more.shift()!);
        else pt = mulPatRiff(this.ctx, pt, more.shift()!);
      }

      plist.push(...pt);
    }

    plist.sort((a, b) => a.offset - b.offset);

    const sw = getSwing(this.ctx);
    if (sw && sw.mode) return swingPattern(this.ctx, sw, plist, this.vtype);

    return plist;
  }

  /** Format a pattern for display (debug / pshow). */
  formatPattern(pat: Pattern | string | null): string {
    if (!pat || !pat.length) return ' z ';

    const pp: string[] = [];
    for (const p of pat as Pattern) {
      const s: string[] = [];
      s.push(gfmt(1 + p.offset / this.ctx.BperQ));
      if (this.vtype !== 'PLECTRUM') s.push(`${p.duration}t`);

      if (this.vtype === 'CHORD') {
        for (const a of (p.vol as number[]) ?? []) s.push(gfmt(a));
      } else if (this.vtype === 'PLECTRUM') {
        s.push(String(p.strum));
        for (const a of (p.vol as number[]) ?? []) s.push(gfmt(a));
      } else if (this.vtype === 'BASS') {
        const b = p as unknown as { noteoffset: number; accidental: number; addoctave: number; vol: number };
        let f = String(b.noteoffset + 1);
        if (b.accidental === 1) f += '#';
        else if (b.accidental === -1) f += 'b';
        if (b.addoctave > 0) f += '+'.repeat(Math.floor(b.addoctave / 12));
        else if (b.addoctave < 0) f += '-'.repeat(Math.floor(b.addoctave / -12));
        s.push(`${f} ${gfmt(b.vol)}`);
      } else if (['ARPEGGIO', 'SCALE', 'DRUM', 'WALK'].includes(this.vtype)) {
        s.push(`${gfmt(p.vol as number)} `);
      }
      pp.push(s.join(' '));
    }
    return pp.join('; ');
  }

  /** Subclass hook: build one pattern event from definition tokens. */
  getPgroup(_ev: string[]): PatternEvent {
    this.ctx.rep.error(`Track class ${this.vtype} has no getPgroup() (call Bob).`);
  }

  /** Subclass hook: generate one bar of music. */
  trackBar(_pattern: Pattern | string, _ctable: CTable[]): void {
    this.ctx.rep.error(`Track class ${this.vtype} has no trackBar() (call Bob).`);
  }

  /** Called from bar() and setForceOut(): add the voice settings. */
  insertVoice(sc: number): void {
    // 1st pass for MIDIVOICE: offset 0 entries are sent BEFORE the voice.
    if (this.midiVoice.length) {
      const v = this.midiVoice[sc];
      if (v && v !== this.smidiVoice) {
        for (const i of v) {
          if (!i[0]) this.ctx.mtrks.track(this.channel).addCtl(this.ctx.tickOffset, i[1]);
        }
      }
    }

    const v = this.voice[sc]!;
    if (v !== this.ssvoice) {
      this.ctx.mtrks.track(this.channel).addProgChange(this.ctx.tickOffset, v, this.ssvoice);
      this.ssvoice = v;

      // Mark ssvoice also in shared tracks.
      for (const a of this.ctx.midiAssigns[this.channel]!) {
        const tr = this.ctx.tnames.get(a);
        if (tr) tr.ssvoice = v;
      }

      this.ctx.dPrint(
        this.vtype === 'DRUM'
          ? `${this.name} Tone '${valueToDrum(v)}' inserted at ${this.ctx.tickOffset}`
          : `${this.name} Voice '${valueToInst(v)}' inserted at ${this.ctx.tickOffset}`,
      );
    }

    // 2nd stab at MIDIVOICE: entries with an offset > 0 go AFTER the voice.
    if (this.midiVoice.length) {
      const mv = this.midiVoice[sc];
      if (mv && mv !== this.smidiVoice) {
        for (const i of mv) {
          if (i[0]) this.ctx.mtrks.track(this.channel).addCtl(this.ctx.tickOffset, i[1]);
        }
        this.smidiVoice = mv;
        this.midiSent = 1; // used by MIDICLEAR
      }
    }
  }

  // #########################
  // Music processing
  // #########################

  /** Process a bar of music for this track. */
  bar(ctable: CTable[]): void {
    // Future vol == de(cresc). Done if the track is on or off!
    if (this.futureVols.length) {
      this.volume = this.ctx.seqBump([this.futureVols.shift()!]);
    }
    this.nextVolume = this.futureVols.length ? this.futureVols[0]! : null;

    // If the track is off don't do anything else.
    if (this.disable) {
      if (this.riff.length) this.riff.shift();
      return;
    }

    // Decide which seq to use: the current seqCount, or a random one if
    // SeqRnd has been set for the track.
    this.seq = this.seqRnd ? getRndSeq(this.ctx, this.seqRndWeight) : this.ctx.seqCount;
    const sc = this.seq;

    // Get pattern for this sequence: a Riff, Pattern or trigger.  String
    // patterns only exist on SOLO/MELODY tracks (their trackBar parses
    // them note by note).
    let pattern: Pattern | string | null;
    if (this.riff.length) {
      pattern = this.riff.shift()!;
    } else {
      pattern = this.sequence[sc] ?? null;
      if (this.trigger.mode) {
        pattern = makeTriggerSequence(this.ctx, this, ctable, pattern as Pattern | null);
        if ((!pattern || !pattern.length) && this.trigger.override) {
          pattern = this.sequence[sc] ?? null;
        }
      }
      if (!pattern || !pattern.length) return;
    }

    // MIDI channel assignment if needed.
    if (!this.channel) this.setChannel();

    trackHooks.doChannelInit(this.ctx, this.channel, this.name);

    // Track specific chord data substitutes for the passed ctable.
    if (this.chord[sc]!.length) {
      ctable = trackHooks.parseChordLine(this.ctx, this.chord[sc]!);
    }

    // Pending midi commands, then the voice.
    this.clearPending();
    this.insertVoice(sc);

    // MIDISeq for this voice.
    if (this.midiSeq.length) {
      const l = this.midiSeq[sc];
      if (l) {
        for (const i of l) {
          this.ctx.mtrks.track(this.channel).addCtl(this.ctx.getOffset(i[0]), i[1]);
        }
        this.midiSent = 1;
      }
    }

    // TRUNCATE: resize patterns to fit the truncated bar.  SOLO patterns
    // are not touched since they are not yet compiled.
    if (trackHooks.truncate.length && this.vtype !== 'SOLO' && this.vtype !== 'MELODY') {
      const pstart = trackHooks.truncate.side;
      const pend = pstart + trackHooks.truncate.length;
      const out: Pattern = [];
      for (const a of clonePattern(pattern as Pattern)) {
        if (a.offset >= pstart && a.offset < pend) {
          a.offset -= pstart;
          out.push(a);
        }
      }
      pattern = out;
    }

    if (pattern && pattern.length) this.trackBar(pattern, ctable);
  }

  clearPending(): void {
    // Python sorts whole (cmd, offset, value) tuples; a stable sort by
    // cmd+offset preserves insertion order for ties, matching Python for
    // the equal-key cases that actually occur.
    this.midiPending.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));

    while (this.midiPending.length) {
      const [c, off, v] = this.midiPending.shift()!;
      const tr = this.ctx.mtrks.track(this.channel);

      switch (c) {
        case 'TNAME':
          tr.addTrkName(off, v as string);
          break;
        case 'GLIS':
          tr.addGlis(off, v as number);
          break;
        case 'PAN':
          tr.addPan(off, v as number);
          break;
        case 'CVOLUME':
          tr.addChannelVol(off, v as number);
          break;
        case 'MIDITEXT':
          tr.addText(off, v as string);
          break;
        case 'MIDICUE':
          tr.addCuePoint(off, v as string);
          break;
        case 'WHEEL':
          tr.addWheel(off, v as number);
          break;
        default:
          this.ctx.rep.error('Unknown midi command pending. Call Bob');
      }
    }
  }

  /**
   * Return the ctable active at the given offset.  Offsets outside the
   * chord range resolve to the first/last entry, matching Python.
   */
  getChordInPos(offset: number, ctabs: CTable[]): CTable | undefined {
    let c: CTable | undefined;
    for (const x of ctabs) {
      c = x;
      if (offset < x.chEnd) break;
    }
    if (!c) this.ctx.rep.error(`${this.name}: no chord data in bar (call Bob).`);
    this.currentChord = c; // for others who might need the chord (RPITCH)
    return c;
  }

  /**
   * Adjust a note volume for the track and global volume settings.  This
   * expensive operation is applied to each generated note.
   */
  adjustVolume(v: number, beat: number): number {
    if (!v) return 0;

    const sc = this.seq;

    // Random skip and random skipbeats, return OFF.
    if (
      this.rSkip[sc] &&
      (!this.rSkipBeats.length || this.rSkipBeats.includes(beat)) &&
      this.ctx.rng.random() < this.rSkip[sc]!
    ) {
      return 0;
    }

    // If the track is set to OFF, return OFF.
    let trackAdjust = this.volume[sc]!;
    if (!trackAdjust) return 0;

    // Single bar cresc adjust the track volume adjuster value.
    if (this.nextVolume) {
      let bt = beat;
      if (bt < 1) bt = 0; // may have negative offsets; cres code ignores
      trackAdjust += ((this.nextVolume - trackAdjust) * bt) / this.ctx.barLen;
    }

    trackAdjust *= this.ctx.volume.vTRatio;

    let fullAdjust = this.ctx.volume.volume;
    if (!fullAdjust) return 0;

    // Global single bar cresc adjust.
    if (this.ctx.volume.nextVolume) {
      let bt = beat;
      if (bt < 1) bt = 0;
      fullAdjust += ((this.ctx.volume.nextVolume - fullAdjust) * bt) / this.ctx.barLen;
    }

    fullAdjust *= this.ctx.volume.vMRatio;

    v *= trackAdjust + fullAdjust;

    for (const [b, a] of this.accent[sc]!) {
      if (b === beat) v += v * a;
    }

    // Random volume adjustment.
    if (this.rVolume[sc]) {
      let r1 = Math.trunc(v * this.rVolume[sc]![0]);
      let r2 = Math.trunc(v * this.rVolume[sc]![1]);
      if (r1 || r2) {
        if (r2 < r1) [r1, r2] = [r2, r1];
        v += this.ctx.rng.randrange(r1, r2);
      }
    }

    // Normalize.
    if (v > 127) v = 127;
    else if (v < 1) v = 1;

    return Math.trunc(v);
  }

  /** Adjust a note for the given octave/transposition, keeping it in span. */
  adjustNote(n: number): number {
    n += this.octave[this.seq]! + this.ctx.transpose;

    while (n < this.spanStart) n += 12; // spanStart is 0 from init
    while (n > this.spanEnd) n -= 12; // spanEnd is 127 from init

    return n;
  }

  /** Convert a string into a valid bar offset in midi ticks. */
  setBarOffset(v0: string, emsg = ''): number {
    const v = v0;
    const m = v.indexOf('-');
    const p = v.indexOf('+');

    let sp: number | null;
    let sign: number;

    if (m > -1 && p > -1) {
      if (m > p) {
        sp = p;
        sign = 1;
      } else {
        sp = m;
        sign = -1;
      }
    } else if (m > -1) {
      sp = m;
      sign = -1;
    } else if (p > -1) {
      sp = p;
      sign = 1;
    } else {
      sp = null; // easier, no split
      sign = 0;
    }

    let notepart = 0;
    let body = v;
    if (sp) {
      const note = v.slice(sp + 1);
      body = v.slice(0, sp);
      notepart = getNoteLen(this.ctx.rep, this.ctx.noteLenTable, note) * sign;
    }

    const num = stof(
      this.ctx.rep,
      body,
      `${emsg}Value for ${this.name} bar offset must be integer/float, not '${body}'`,
    );
    const offset = (num - 1) * this.ctx.BperQ + notepart;

    if (offset < 0) {
      if (offset < -this.ctx.BperQ) {
        this.ctx.rep.error(
          `${emsg}Value for ${this.name} bar offset must be 0 or greater, not '${
            offset / this.ctx.BperQ + 1
          }'`,
        );
      } else {
        this.ctx.rep.warning(`Offset in '${this.name}' is '${-offset} ticks' before bar start!`);
      }
    }

    if (offset >= this.ctx.barLen) {
      this.ctx.rep.error(
        `${emsg}Value for ${this.name} bar offset must be less than ${this.ctx.QperBar + 1}, not '${
          offset / this.ctx.BperQ + 1
        }'.`,
      );
    }

    return Math.trunc(offset);
  }

  /** Return the adjusted duration for a note (Articulate and RDuration). */
  getDur(d: number): number {
    const sc = this.seq;

    d = Math.floor((d * this.artic[sc]!) / 100);

    if (this.rDuration[sc]) {
      const a1 = Math.trunc(d * this.rDuration[sc]![0]);
      const a2 = Math.trunc(d * this.rDuration[sc]![1]);
      if (a1 || a2) d += this.ctx.rng.randrange(a1, a2);
    }
    if (d <= 0) d = 1; // force a value if we end with 0 or less.

    return Math.trunc(d);
  }

  /**
   * Send a note to the MIDI machine.  Handles mallet-repeat, rpitch and
   * delay.  Returns 1 when a note was sent (Python returns None/1 unused).
   */
  sendNote(offset: number, duration: number, note: number, velocity: number): number {
    if (!velocity) return 0;

    const sc = this.seq;

    if (this.rPitch) {
      note = trackHooks.doRpitch(this.ctx, this, offset, note);
    }

    const rptr = this.mallet;
    if (rptr && duration > rptr) {
      const ll = this.getDur(rptr);
      let offs = 0;
      let vel = velocity;
      for (let q = 0; q < Math.floor(duration / rptr); q++) {
        this.ctx.mtrks.track(this.channel).addPairToTrack(
          offset + offs + this.delay[sc]!,
          this.rTime[sc]![0],
          this.rTime[sc]![1],
          ll,
          note,
          vel,
          false,
        );

        offs += rptr;
        if (this.malletDecay) {
          vel = Math.trunc(vel + vel * this.malletDecay);
          if (vel < 1) vel = 1;
          if (vel > 127) vel = 127;
        }
      }
    } else {
      this.ctx.mtrks.track(this.channel).addPairToTrack(
        offset + this.delay[sc]!,
        this.rTime[sc]![0],
        this.rTime[sc]![1],
        duration,
        note,
        velocity,
        Boolean(this.unify[sc]),
      );
    }
    return 1;
  }

  /**
   * Send a chord (list of [note, volume]) to midi with strum delay.
   * Compensates the strum value so that additional (harmony) notes all end
   * at the same time, and applies RDURATION.
   */
  sendChord(chord: Array<[number, number]>, duration: number, offset: number): void {
    const sc = this.seq;
    let strumAdjust = this.getStrum(sc);
    const strumAdd = this.strumAdd[sc]!;

    // NOTE: Python has a typo in the Bper128 clamp ('minDuraiton'), so
    // minDuration is always duration // 3 here; reproduced as-is.
    const minDuration = strumAdjust ? Math.floor(duration / 3) : 0;

    let strumOffset = 0; // 1st note in list is not offset-strummed

    duration = this.getDur(duration);
    for (const [n, vol] of chord) {
      this.sendNote(
        Math.trunc(offset + strumOffset),
        duration,
        this.adjustNote(n),
        this.adjustVolume(vol, offset),
      );

      if (strumAdjust) {
        strumAdjust += strumAdd;
        strumOffset += strumAdjust;
        duration -= strumAdjust;
        if (duration < minDuration) duration = minDuration;
      }
    }
  }
}

/** Port of volume.fvolume: build a list of future volumes for (De)Cresc. */
function fvolume(ctx: MMAContext, dir: number, startvol: number, ln: string[]): number[] {
  // See the note in setVolume(): Python's calcVolume() regex is
  // case-insensitive, Volume.ts's is not - normalise the mnemonic here.
  const destvol = ctx.volume.calcVolume(ln[0]!.toUpperCase(), startvol);

  let bcount = stoi(ctx.rep, ln[1]!, `Type error in bar count for (De)Cresc, '${ln[1]}'`);
  if (bcount <= 0) ctx.rep.error('Bar count for (De)Cresc must be postive');

  // Test to see if (de)cresc is contrary to current settings.  A 'dir' of
  // 0 bypasses this (used by SWELL).
  if (dir > 0 && destvol < startvol) ctx.rep.warning('Cresc volume less than current setting');
  else if (dir < 0 && destvol > startvol) ctx.rep.warning('Decresc volume greater than current setting');
  else if (destvol === startvol) ctx.rep.warning('(De)Cresc volume equal to current setting');

  if (bcount > 1) bcount -= 1;
  const step = (destvol - startvol) / bcount;
  const volList: number[] = [startvol];
  for (let a = 0; a < bcount - 1; a++) {
    startvol += step;
    volList.push(startvol);
  }
  volList.push(destvol);
  return volList;
}

/** Python lnExpand() over a mixed list of strings and token lists. */
function lnExpandMixed(
  ctx: MMAContext,
  l: Array<string | string[]>,
  msg: string,
): Array<string | string[]> {
  let out = [...l];
  if (out.length > ctx.seqSize) {
    if (!ctx.inAllGrooves) ctx.rep.warning(`${msg} list truncated to ${ctx.seqSize} patterns`);
    out = out.slice(0, ctx.seqSize);
  }

  let last: string | string[] | null = null;
  for (let i = 0; i < out.length; i++) {
    const n = out[i]!;
    if (n === '/') {
      if (last === null) ctx.rep.error(`${msg} cannot use a '/' as the first item in list.`);
      out[i] = last;
    } else {
      last = n;
    }
  }
  return out;
}

/** Port of pat.mulPatRiff(): make N adjusted copies of a pattern. */
function mulPatRiff(ctx: MMAContext, oldpat: Pattern, factStr: string): Pattern {
  const fact = stoi(ctx.rep, factStr, `The multiplier arg must be an integer not '${factStr}'`);
  if (fact < 1 || fact > 100) ctx.rep.error('The multiplier arg must be in the range 2 to 100');

  const out: Pattern = [];
  let add = 0;
  const step = Math.floor(ctx.barLen / fact);

  for (let n = 0; n < fact; n++) {
    const orig = clonePattern(oldpat);
    for (const z of orig) {
      z.offset = Math.floor(z.offset / fact) + add;
      z.duration = Math.floor(z.duration / fact);
      if (z.duration < 1) z.duration = 1;
      out.push(z);
    }
    add += step;
  }
  return out;
}

/** Port of pat.shiftPatRiff(): shift all beat offsets of a pattern. */
function shiftPatRiff(ctx: MMAContext, oldpat: Pattern, factStr: string): Pattern {
  const fact = stof(ctx.rep, factStr, `The shift arg must be a value, not '${factStr}'`);

  const out = clonePattern(oldpat);
  const max = ctx.barLen;
  for (const n of out) {
    n.offset += fact * ctx.BperQ;
    if (n.offset < 0 || n.offset > max) {
      ctx.rep.error(`Pattern shift with factor ${fact} has resulted in an illegal offset`);
    }
  }
  return out;
}

function copySeq(s: MidiSeqDef | null): MidiSeqDef | null {
  if (s === null) return null;
  return s.map((e) => [e[0], [...e[1]]] as MidiSeqItem);
}

function copyRiff(riff: Array<Pattern | string>): Array<Pattern | string> {
  return riff.map((r) => (typeof r === 'string' ? r : clonePattern(r)));
}

/** Port of midiC.valueToCtrl(): controller name, or 'ERROR'. */
function valueToCtrl(val: number): string {
  return CONTROLLER_TABLE[val] ?? 'ERROR';
}

/** Port of midiC.valueToDrum(): drum tone name, or the number as string. */
function valueToDrum(val: number): string {
  return DRUM_TABLE[val] ?? String(val);
}

/** Port of midiC.valueToInst(): instrument name or extended-value string. */
function valueToInst(val: number): string {
  if (val === NONETONE) return 'None';
  const n = VOICE_TABLE[val];
  if (n !== null && n !== undefined) return n;
  if (!Number.isInteger(val)) return 'ERROR';
  return extVocStr(val);
}

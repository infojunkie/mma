/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * MMAContext replaces the module-global state of MMA/gbl.py and the
 * various singletons.  One instance exists per run and is owned by the
 * MMA façade; passing it explicitly keeps multiple façades independent.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { MMAError, Reporter } from './Errors';
import { MMARandom } from './Random';
import { BperQ, createNoteLenTable, type NoteLenTable } from '../model/NoteLen';
import { PatternStore } from '../model/PatternStore';
import { MIDIDocument, type MIDITrack } from '../midi/MIDIDocument';
import { createChordList, type ChordDef } from '../model/chordTable';
import { createChordAdjust } from '../model/ChordNotes';
import { KeySig } from '../model/features/KeySig';
import { TimeSig } from '../model/features/TimeSig';
import { VolumeState } from '../model/features/Volume';
import { SourceReader } from '../io/SourceReader';
import { getOffset } from '../util/Common';
import type { BaseTrack } from '../model/tracks/BaseTrack';
import type { MMAResources } from '../io/MMAResources';
import type { IMMAPlugin } from '../plugin/IMMAPlugin';
import { GrooveLibrary } from '../groove/GrooveLibrary';

export interface DebugFlags {
  debug?: boolean;
  showExpand?: boolean;
  pshow?: boolean;
  seqshow?: boolean;
  showFilenames?: boolean;
  printProcessed?: boolean;
  rmShow?: boolean;
  showrun?: boolean;
}

export interface ContextOptions {
  maxBars?: number;
  barRange?: string[];
  muteTracks?: string[];
  inAllGrooves?: boolean;
  noCredit?: boolean;
  midiFileType?: 0 | 1;
  encoding?: string;
  debug?: DebugFlags;
  /** RndSeed; when omitted the RNG must be seeded explicitly by the caller. */
  seed?: number;
  plugins?: IMMAPlugin[];
}

/** Simple runtime name translation table (VOICETR / TONETR). */
export class Translator {
  private table = new Map<string, string | number>();

  get(name: string): string | number | undefined {
    return this.table.get(name.toUpperCase());
  }

  set(name: string, value: string | number): void {
    this.table.set(name.toUpperCase(), value);
  }

  clear(): void {
    this.table.clear();
  }

  entries(): Array<[string, string | number]> {
    return [...this.table.entries()];
  }
}

export class MMAContext {
  readonly rep: Reporter;
  readonly rng: MMARandom;
  readonly opts: ContextOptions;
  resources: MMAResources | null = null;

  // gbl.py timing and song state
  readonly BperQ = BperQ;
  readonly Bper128 = BperQ / 16;
  QperBar = 4;
  barLen = BperQ * 4;
  tickOffset = 0;
  tempo = 120;
  seqSize = 1;
  seqCount = 0;
  totTime = 0;
  transpose = 0;
  lineno = -1;
  barLabels: string[] = [];
  barNum = 0;
  barPtrs = new Map<number, [string, number, number]>();
  midiFileType: 0 | 1 = 1;
  runningStatus = 1;
  inAllGrooves = false;
  noCredit = false;
  encoding = 'cp1252';
  maxBars: number;
  barRange: string[];
  muteTracks: string[];
  debug: DebugFlags;
  plugins: IMMAPlugin[] = [];

  // containers
  tnames = new Map<string, BaseTrack>();
  deletedTracks: string[] = [];
  midiAssigns: string[][] = Array.from({ length: 17 }, () => []);
  midiAvail: number[] = new Array(17).fill(0);
  midiChPrefs = new Map<string, number>();
  mtrks: MIDIDocument;
  pats = new PatternStore();
  chordList: Map<string, ChordDef> = createChordList();
  cdAdjust = createChordAdjust();
  noteLenTable: NoteLenTable = createNoteLenTable();
  vtable = new Translator();
  dtable = new Translator();
  grooves = new GrooveLibrary();

  // sequence random state (seqrnd.py) and swing (swing.py) - minimal M1 state
  seqRnd: number[] = [0];
  seqRndWeight: number[] = [1];
  swingMode: unknown = null;

  // feature state
  keySig: KeySig;
  timeSig: TimeSig;
  volume: VolumeState;

  // parse-time
  inpath: SourceReader | null = null;
  beginData: string[] = [];
  beginPoints: number[] = [];
  lastChord: string | null = null;
  /** Positions of chord changes within the current bar (parseCL chordTabs). */
  chordTabs: number[] = [];
  /** Names of tracks that must be saved into newly defined grooves. */
  currentGroove = '';
  lastGroove = '';

  constructor(options: ContextOptions = {}) {
    this.opts = options;
    this.rep = new Reporter();
    this.rep.warningsEnabled = true;
    this.rng = new MMARandom(options.seed);
    this.maxBars = options.maxBars ?? 500;
    this.barRange = options.barRange ? [...options.barRange] : [];
    this.muteTracks = options.muteTracks ? options.muteTracks.map((s) => s.toUpperCase()) : [];
    this.midiFileType = options.midiFileType ?? 1;
    this.noCredit = options.noCredit ?? false;
    this.inAllGrooves = options.inAllGrooves ?? false;
    this.encoding = options.encoding ?? 'cp1252';
    this.debug = options.debug ?? {};
    this.plugins = options.plugins ?? [];
    this.rep.debugEnabled = this.debug.debug ?? false;
    this.rep.setLocationProvider(() => ({ file: this.infile, line: this.lineno }));

    this.mtrks = new MIDIDocument(this.rep, this, this.rng);
    this.keySig = new KeySig(this);
    this.timeSig = new TimeSig(this);
    this.volume = new VolumeState(this.rep);
  }

  private infileValue = '';

  /** Current source name; set by SourceReader as files are read. */
  get infile(): string {
    return this.infileValue || this.inpath?.fname || '';
  }

  set infile(value: string) {
    this.infileValue = value;
  }

  error(msg: string): never {
    this.rep.error(msg);
  }

  warning(msg: string): void {
    this.rep.warning(msg);
  }

  dPrint(msg: string): void {
    this.rep.dPrint(msg);
  }

  /** Expand/contract a list to the current sequence size. */
  seqBump<T>(l: T[]): T[] {
    const out = [...l];
    while (out.length < this.seqSize) out.push(...out);
    return out.slice(0, this.seqSize);
  }

  /** Absolute tick offset with the current bar offset and optional RTIME randomness. */
  getOffset(ticks: number, ranLow?: number, ranHigh?: number): number {
    return getOffset(this.tickOffset, ticks, this.rng, ranLow, ranHigh);
  }

  metaTrack(): MIDITrack {
    return this.mtrks.track(0);
  }

  hasTrack(name: string): boolean {
    return this.tnames.has(name.toUpperCase());
  }

  track(name: string): BaseTrack | undefined {
    return this.tnames.get(name.toUpperCase());
  }

  throwIf(condition: boolean, msg: string): void {
    if (condition) throw new MMAError(msg, this.infile, this.lineno);
  }
}

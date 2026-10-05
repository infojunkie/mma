/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the parse() main loop and parseFile/usefile/include in
 * MMA/parse.py: read a line, expand macros, handle BEGIN/END, dispatch
 * through the directive tables, parse chord-data lines, run every
 * track's bar() for each repeat, and do the bar bookkeeping (tick
 * offset, total time, bar pointers, max-bars and groove-list advance).
 *
 * The Python code kept the parser state on gbl and in module globals;
 * here the Parser owns its expander, directive registry and per-run
 * bookkeeping.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../engine/Context';
import type { GrooveDatabase } from '../groove/GrooveDatabase';
import { findGrooveNames } from '../groove/scanGrooves';
import type { TrackApi } from './TrackApi';
import { SourceReader } from '../io/SourceReader';
import { normalizeResourceId, type MMAResources } from '../io/MMAResources';
import { parseChordLine } from './ChordLineParser';
import { DirectiveRegistry } from './Directives';
import { PluginRegistry } from '../plugin/PluginRegistry';
import type { BaseTrack } from '../model/tracks/BaseTrack';
import { MacroExpander } from './MacroExpander';
import { getTrack } from './TrackApi';
import { trackAlloc } from './TrackAlloc';
import { takeChannelInit } from '../directives/simple/Midi';
import '../model/tracks/index'; // side effect: register track classes
import { trackHooks } from '../model/tracks/hooks';
import { extractSolo } from '../model/tracks/SoloTrack';
import { getLyric, lyricExtract, lyricLeftovers } from '../model/features/Lyric';
import { setCurrentBarLabel } from '../model/features/Trigger';
import { AfterState } from '../model/features/After';
import { countDown } from '../model/features/Truncate';
import { DebugState } from '../directives/simple/Debug';
import { initialiseSwing, swingSettingsString } from '../directives/simple/Swing';
import { setTime } from '../directives/simple/Tempo';
import { setseq } from '../directives/simple/Sequence';
import { stoi } from '../util/Common';

export interface ParserOptions {
  /** Groove database used for `Groove` auto-loading. */
  grooveDatabase?: GrooveDatabase;
  /** Search roots for INCLUDE; default ['includes']. */
  includePaths?: string[];
  /** Search roots for USE/groove autoload; default ['lib/stdlib', 'lib']. */
  libPaths?: string[];
}

const MMA_EXT = '.mma';

export class Parser {
  readonly ctx: MMAContext;
  readonly expander: MacroExpander;
  readonly debugState: DebugState;
  readonly registry: DirectiveRegistry;
  /** Plugin catalog + activation (regplug.py port). */
  readonly plugins: PluginRegistry;
  /** AFTER event stack (after.py port), owned by this parser. */
  readonly after: AfterState;

  private fileDepth = 0;
  private barLabel = '';
  private readonly includePaths: string[];
  private readonly libPaths: string[];
  private readonly grooveDatabase?: GrooveDatabase;
  private grooveFileCache = new Map<string, string | null>();

  constructor(ctx: MMAContext, options: ParserOptions = {}) {
    this.ctx = ctx;
    this.includePaths = options.includePaths ?? ['includes'];
    this.libPaths = options.libPaths ?? ['lib/stdlib', 'lib'];
    this.grooveDatabase = options.grooveDatabase;

    this.debugState = new DebugState(ctx);
    initialiseSwing(ctx);
    this.after = new AfterState();

    // MMA/main.py sets the default TIME (and chord tabs) before parsing.
    setTime(ctx, ['4/4']);

    this.expander = new MacroExpander(ctx, {
      swingModeString: () => swingSettingsString(ctx),
      debugFlags: (last) => this.debugState.flags(last),
    });

    this.registry = new DirectiveRegistry({
      ctx,
      expander: this.expander,
      debugState: this.debugState,
      after: this.after,
      includeFile: (name) => this.includeFile(name),
      useFile: (name) => this.useFile(name),
    });

    // Plugin runtime: plugins come from the run options instead of the
    // filesystem; PLUGIN activates them and @NAME commands dispatch into
    // the same directive tables Python registers into.
    this.plugins = new PluginRegistry(ctx, {
      registerSimple: (n, fn) => this.registry.registerSimple(n, fn),
      registerTrack: (n, fn) =>
        this.registry.registerTrack(n, (c, t, a) => fn(c, t as unknown as BaseTrack, a)),
      registerData: (n, fn) => this.registry.registerData(n, fn),
      pushTokens: (tokens, linenos) =>
        ctx.inpath?.push(tokens, linenos ?? tokens.map(() => ctx.lineno)),
      getVar: (name) => this.expander.getVar(name),
      ensureTrack: (name) => {
        trackAlloc(ctx, name, false); // port of alloc.trackAlloc(name, 0)
      },
    });
    this.registry.setPluginLoader((a) => this.plugins.load(a));

    // Wire the groove auto-load hooks (grooves.py used MMA.auto + usefile).
    ctx.grooves.finder = (name) => this.findGroove(name);
    ctx.grooves.fileParser = (file) => this.parseFile(file);

    // The track layer needs parseChordLine() for track-specific CHORDS
    // data (pat.py) and the truncate state; wire them here.
    trackHooks.parseChordLine = (c, line) => parseChordLine(c, line);

    // Port of midifuncs.doChannelInit(): when a track gets its channel,
    // replay the commands queued by CHANNELINIT through the track table.
    // Handlers are module functions, but SEQUENCE closes over this
    // parser's expander: chain to the previous hook for other contexts so
    // concurrently live MMA instances keep their own parser.
    const prevDoChannelInit = trackHooks.doChannelInit;
    trackHooks.doChannelInit = (c, channel, name) => {
      if (c !== ctx) {
        prevDoChannelInit(c, channel, name);
        return;
      }
      for (const line of takeChannelInit(c, channel)) {
        const fn = this.registry.track.get(line[0]!.toUpperCase());
        if (fn) void fn(c, getTrack(c, name), line.slice(1));
      }
    };

    // Port of the pre-write flush in MMA/writeMid.py createMIDI(): pending
    // track MIDI, MIDICLEAR and the channel reset are emitted just before
    // the document is written, not at the end of parsing.
    ctx.mtrks.onBeforeWrite = () => {
      // writeMid.py reports unresolved lyric sets before writing.
      lyricLeftovers(ctx);
      for (const trk of ctx.tnames.values()) {
        if (!trk.channel) continue;
        trk.clearPending();
        trk.doMidiClear();
        trk.doChannelReset();
        if (trk.riff.length) ctx.rep.warning(`${trk.name} has pending Riff(s)`);
      }
    };
  }

  // ---------------------------------------------------------------------
  // File handling

  private resources(): MMAResources {
    const res = this.ctx.resources;
    if (!res) this.ctx.error('No resource loader is attached to the context');
    return res;
  }

  /** Build the locFile() candidate list: root/name.mma, root/name, name.mma, name. */
  private static candidates(name: string, roots: string[]): string[] {
    const out: string[] = [];
    const hasExt = name.endsWith(MMA_EXT);
    for (const root of roots) {
      const cleanRoot = root.replace(/\/+$/, '');
      const base = cleanRoot ? `${cleanRoot}/${name}` : name;
      if (!hasExt) out.push(`${base}${MMA_EXT}`);
      out.push(base);
    }
    if (!hasExt) out.push(`${name}${MMA_EXT}`);
    out.push(name);
    return [...new Set(out)];
  }

  private async resolveFile(name: string, roots: string[]): Promise<string | null> {
    const res = this.resources();
    for (const candidate of Parser.candidates(normalizeResourceId(name), roots)) {
      if (await res.exists(candidate)) return candidate;
    }
    return null;
  }

  /** Port of parse.parseFile: parse one resource; depth limited to 50. */
  async parseFile(name: string): Promise<void> {
    this.fileDepth += 1;
    if (this.fileDepth > 50) {
      this.ctx.error(
        'USE/INCLUDE recursion error. Use and Include are limited to a depth of 50. ' +
          'Check current file and rc files for error.',
      );
    }

    const ctx = this.ctx;
    const prev = ctx.inpath;
    const id = normalizeResourceId(name);
    const text = await this.resources().load(id);
    const reader = new SourceReader(ctx, id, text);

    await this.parse(reader);

    ctx.inpath = prev;
    // SourceReader sets ctx.infile on construction; restore it with the
    // reader so errors after an Include point at the right file.
    ctx.infile = prev?.fname ?? '';
    this.fileDepth -= 1;
    ctx.dPrint(`File '${id}' closed.`);
  }

  /** Port of parse.include. */
  async includeFile(name: string): Promise<void> {
    const id = await this.resolveFile(name, this.includePaths);
    if (!id) this.ctx.error(`Could not find include file '${name}'`);
    await this.parseFile(id);
  }

  /** Port of parse.usefile: includes, but saves/restores the groove state. */
  async useFile(name: string): Promise<void> {
    const id = await this.resolveFile(name, this.libPaths);
    if (!id) this.ctx.error(`Unable to locate library file '${name}'`);

    this.ctx.grooves.push(this.ctx);
    await this.parseFile(id);
    this.ctx.grooves.pop(this.ctx);
  }

  /** Groove finder hook: index lookup, else scan the library files once. */
  private async findGroove(name: string): Promise<{ file: string; groove: string } | null> {
    const key = name.toUpperCase();

    const hit = this.grooveDatabase?.lookup(key);
    if (hit) return { file: hit.file, groove: key };
    // A miss falls through to scanning the resources once: this covers
    // files that were added to a database without an index entry, and
    // resource-only configurations (no database at all).

    const cached = this.grooveFileCache.get(key);
    if (cached !== undefined) return cached === null ? null : { file: cached, groove: key };
    this.grooveFileCache.set(key, null); // avoid rescanning on repeated misses

    const res = this.resources();
    // Python expands libPath with stdlib first (paths.expandLib), then the
    // remaining library directories; resource-only setups must match that
    // or a groove name defined in several libraries resolves differently.
    const rank = (id: string): number =>
      id.startsWith('lib/stdlib/') ? 0 : id.startsWith('lib/') ? 1 : 2;
    const ids = (await res.list(''))
      .filter((id) => id.toLowerCase().endsWith(MMA_EXT))
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    for (const id of ids) {
      let text: string;
      try {
        text = await res.load(id);
      } catch {
        continue;
      }
      const names = findGrooveNames(text);
      if (names.includes(key)) {
        this.grooveFileCache.set(key, id);
        return { file: id, groove: key };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Main loop

  /** Port of parse.parse: process an MMA source. */
  async parse(inpath: SourceReader): Promise<void> {
    const ctx = this.ctx;
    ctx.inpath = inpath;

    for (;;) {
      // Port of MMA/parse.py:113 - execute any AFTER events due now,
      // before reading the next line.
      await this.after.check(ctx);

      const curline = inpath.read();
      if (curline === null) break; // EOF, exit parser

      let l = this.expander.expand(curline);
      if (!l.length) continue;

      let action = l[0]!.toUpperCase();

      // BEGIN/END are handled outside the dispatch tables.
      if (action === 'BEGIN') {
        if (l.length <= 1) ctx.error('Use: Begin STUFF');
        ctx.beginPoints.push(ctx.beginData.length);
        ctx.beginData.push(...l.slice(1));
        continue;
      }
      if (action === 'END') {
        if (l.length > 1) ctx.error('No arguments permitted for END');
        if (!ctx.beginData.length) ctx.error("No 'BEGIN' for 'END'");
        ctx.beginData = ctx.beginData.slice(0, ctx.beginPoints.pop()!);
        continue;
      }

      if (ctx.beginData.length) {
        l = [...ctx.beginData, ...l];
        action = l[0]!.toUpperCase();
      }

      if (ctx.debug.showExpand && action !== 'REPEAT') ctx.dPrint(l.join(' '));

      const simple = this.registry.simple.get(action);
      if (simple) {
        await simple(ctx, l.slice(1));
        continue;
      }

      // Is it a track name (allocated on demand), or chord data?
      if (!ctx.tnames.has(action)) trackAlloc(ctx, action, false);

      if (ctx.tnames.has(action)) {
        const name = action;
        if (l.length < 2) ctx.error(`Expecting argument after '${name}'`);
        action = l[1]!.toUpperCase();

        const trackFn = this.registry.track.get(action);
        if (trackFn) {
          await trackFn(ctx, getTrack(ctx, name), l.slice(2));
          continue;
        }
        if (this.registry.simple.has(action)) {
          ctx.error(`${action} is not a track function. Use global form.`);
        }
        ctx.error(`${action} is not a ${name} track function.`);
      }

      // -----------------------------------------------------------------
      // Gotta be a chord-data line.

      // Optional leading bar-number label.
      if (isDigits(l[0]!)) {
        this.barLabel = l[0]!.replace(/^0+/, '');
        l = l.slice(1);
        if (!l.length) continue; // ignore empty lines
      } else {
        this.barLabel = '';
      }
      // Publish the label for the TRIGGER MEASURES option (gbl.barLabel).
      setCurrentBarLabel(ctx, this.barLabel);

      // Optional repeat count: '* xx' at the end of the bar.
      let rptcount = 1;
      if (l.length > 1 && l[l.length - 2] === '*') {
        rptcount = stoi(ctx.rep, l[l.length - 1]!, "Expecting integer after '*'");
        l = l.slice(0, -2);
      }

      // Data plugins all start with '@': the handler modifies the line.
      if (l[0]!.startsWith('@')) {
        l = this.plugins.runData(l[0]!, l.slice(1));
        if (!l.length) ctx.error('Data plugin returned an empty line.');
      }

      // Extract solo(s) from the line: anything in {}s.  The solo data is
      // pushed into RIFFs and discarded from the current line.
      const joined = l.join(' ');
      const noSolo = extractSolo(ctx, joined, rptcount);

      // Set lyrics from [stuff] in the current line.  lyric.extract()
      // inserts previously created data from LYRIC SET and inserts the
      // chord names if that flag is active.
      const extracted = lyricExtract(ctx, noSolo, rptcount);
      let lyrics = extracted[1];
      l = extracted[0].split(/\s+/).filter((w) => w !== '');

      if (!l.length) {
        ctx.error(
          'Expecting music (chord) data. Even lines with lyrics or solos still need a chord. ' +
            "If you don't want a chord use 'z'.",
        );
      }

      const ctable = parseChordLine(ctx, l);

      // Create the MIDI data for the bar, once per repeat.
      for (let rpt = 0; rpt < rptcount; rpt++) {
        if (ctx.volume.futureVol.length) ctx.volume.volume = ctx.volume.futureVol.shift()!;
        if (ctx.volume.futureVol.length) ctx.volume.nextVolume = ctx.volume.futureVol[0]!;
        else ctx.volume.nextVolume = null;

        const [rsq, seqlist] = setseq(ctx);

        for (const a of ctx.tnames.values()) {
          const tr = a as unknown as TrackApi;
          if (rsq >= 0) {
            const seqSave = ctx.seqCount;
            if (seqlist.includes(tr.name)) ctx.seqCount = rsq;
            tr.bar(ctable);
            ctx.seqCount = seqSave;
          } else {
            tr.bar(ctable);
          }
        }

        // Adjust the counters; barPtrs is used by the -B/-b options.
        // Port of parse.py:300: an active TRUNCATE shortens this bar and
        // the countdown may clear the setting after use.
        let nextOffset: number;
        if (trackHooks.truncate.length) {
          nextOffset = trackHooks.truncate.length;
          countDown();
        } else {
          nextOffset = ctx.barLen;
        }

        ctx.barPtrs.set(ctx.barNum + 1, [this.barLabel, ctx.tickOffset, ctx.tickOffset + nextOffset - 1]);
        ctx.totTime += nextOffset / ctx.BperQ / ctx.tempo;
        ctx.tickOffset += nextOffset;

        if (ctx.debug.printProcessed) {
          ctx.barLabels.push(this.barLabel || '?');
        }

        ctx.barNum += 1;
        ctx.seqCount = (ctx.seqCount + 1) % ctx.seqSize;

        if (ctx.barNum > ctx.maxBars) {
          ctx.error(`Capacity exceeded. Maxbar setting is ${ctx.maxBars}. Use -m option`);
        }

        ctx.grooves.next(ctx); // using a groove list? advance

        if (ctx.debug.showrun) {
          const ly = lyrics.length ? ` [${lyrics.join(' ')}]` : '';
          ctx.dPrint(`${String(ctx.barNum).padStart(3, ' ')}: ${l.join(' ')}${ly}`);
        }

        // If repeat count is set with dupchord we push the chord back and
        // get lyric.extract to add the chord to the midi file again.  A
        // real lyric is just ignored ... 2 reasons: the lyric is mangled
        // and it makes sense to only have it once!
        if (rptcount > 1 && getLyric(ctx).dupchords) {
          lyrics = lyricExtract(ctx, l.join(' '), 0)[1];
        }

        // The barNum and other pointers have been incremented and a bar
        // of data has been processed.  If we are repeating due to a '*'
        // we do an AGAIN test; without a rpt this is done at the start
        // of a data line.  Port of parse.py:350-351.
        if (rptcount > 1 && this.after.needed(ctx)) {
          await this.after.check(ctx, {
            recurse: true,
            parseText: (text, fname) => this.parseText(text, fname),
          });
        }
      }
    }
  }

  /**
   * Parse a block of raw MMA source as if it were a file.  This is the
   * browser equivalent of the temporary scratch file that after.py
   * writes for recursion in a repeat (*) section.
   */
  async parseText(text: string, fname: string): Promise<void> {
    this.fileDepth += 1;
    if (this.fileDepth > 50) {
      this.ctx.error(
        'USE/INCLUDE recursion error. Use and Include are limited to a depth of 50. ' +
          'Check current file and rc files for error.',
      );
    }

    const ctx = this.ctx;
    const prev = ctx.inpath;
    const reader = new SourceReader(ctx, fname, text);

    await this.parse(reader);

    ctx.inpath = prev;
    ctx.infile = prev?.fname ?? '';
    this.fileDepth -= 1;
    ctx.dPrint(`File '${fname}' closed.`);
  }
}

// -------------------------------------------------------------------------

/** Python str.isdigit() for the bar-number label check. */
function isDigits(s: string): boolean {
  return /^[\p{Nd}]+$/u.test(s);
}

export { findGrooveNames };

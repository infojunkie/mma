/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/grooves.py: in-memory groove definitions, aliases and
 * selection.  Groove .mma files are parsed on demand through the
 * resource loader (see GrooveIndex for name -> file resolution).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../engine/Context';

export interface GrooveSettings {
  SEQSIZE: number;
  SEQRNDWT: number[];
  QPERBAR: number;
  BARLEN: number;
  SEQRND: number[];
  TIMESIG: [number | null, number | null];
  SWINGMODE: unknown;
  VRATIO: [number, number];
  CTABS: number[];
}

export interface Groove {
  name: string;
  settings: GrooveSettings;
}

/** Hook used to autoload groove files (wired to GrooveIndex + resources). */
export type GrooveFinder = (name: string) => Promise<{ file: string; groove: string } | null>;
/** Hook that parses a groove library file inline (wired to the Parser). */
export type GrooveFileParser = (file: string) => Promise<void>;

export class GrooveLibrary {
  readonly glist = new Map<string, Groove>();
  readonly aliaslist = new Map<string, string>();
  groovesList: string[] | null = null;
  groovesCount = 0;
  lastGroove = '';
  currentGroove = '';
  private stack: number[] = [];

  finder: GrooveFinder | null = null;
  fileParser: GrooveFileParser | null = null;
  onFutureVolumes?: () => void;

  /** DefGroove: snapshot the current settings under a name. */
  define(ctx: MMAContext, ln: string[]): void {
    if (ln.length === 0) ctx.error('Use: DefGroove  Name');
    const slot = ln[0]!.toUpperCase();
    if (slot.includes('/')) ctx.error("The '/' is not permitted in a groove name.");
    if (slot.includes(':')) ctx.error("The ':' is not permitted in a groove name.");
    if (this.aliaslist.has(slot)) {
      ctx.error(`Can't define groove name ${slot}, already defined as an alias for ${this.aliaslist.get(slot)}.`);
    }
    this.defineDo(ctx, slot);
    ctx.dPrint(`Groove settings saved to '${slot}'.`);
  }

  /** Snapshot without command-line parsing (also used by ALLGROOVES). */
  defineDo(ctx: MMAContext, slot: string): void {
    for (const t of ctx.tnames.values()) {
      if (t.sticky) continue;
      t.saveGroove(slot);
    }
    this.glist.set(slot, {
      name: slot,
      settings: {
        SEQSIZE: ctx.seqSize,
        SEQRNDWT: [...ctx.seqRndWeight],
        QPERBAR: ctx.QperBar,
        BARLEN: ctx.barLen,
        SEQRND: [...ctx.seqRnd],
        TIMESIG: ctx.timeSig.get(),
        SWINGMODE: ctx.swingMode,
        VRATIO: [ctx.volume.vTRatio, ctx.volume.vMRatio],
        CTABS: [...ctx.chordTabs],
      },
    });
  }

  /** DefAlias: an alias for an existing groove (not a copy). */
  alias(ctx: MMAContext, ln: string[]): void {
    if (ln.length !== 2) ctx.error('DefAlias needs exactly 2 args: GrooveName AliasName.');
    const g = ln[0]!.toUpperCase();
    const a = ln[1]!.toUpperCase();
    if (!this.glist.has(g)) ctx.error(`DefAlias: Groove ${ln[0]} has not been defined.`);
    this.aliaslist.set(a, g);
  }

  /** Groove command: select ([count] name...) with '/' repetition. */
  async select(ctx: MMAContext, ln: string[]): Promise<void> {
    if (ln.length === 0) ctx.error('Groove: needs agrument(s)');

    let args = [...ln];
    const tmpList: string[] = [];
    let wh: number | null = null;
    if (/^\d/.test(args[0]!)) {
      wh = parseInt(args[0]!, 10);
      if (wh < 1) ctx.error(`Groove selection must be > 0, not '${wh}'`);
      args = args.slice(1);
    }

    for (const slotOrig of args) {
      let slot = slotOrig.toUpperCase();
      if (slot === '/') {
        if (tmpList.length) slot = tmpList[tmpList.length - 1]!;
        else ctx.error("A previous groove name is needed before a '/'");
      }

      if (!this.glist.has(slot) && this.aliaslist.has(slot)) {
        slot = this.aliaslist.get(slot)!;
      }

      if (!this.glist.has(slot)) {
        ctx.dPrint(`Groove '${slot}' not defined. Trying auto-load from libraries`);
        const found = this.finder ? await this.finder(slotOrig) : null;
        if (!found) {
          ctx.error(`Groove '${slot}' could not be found in memory or library files`);
        }
        this.onFutureVolumes?.();
        if (!this.fileParser) ctx.error(`Groove '${slot}' not found. Is the groove in the file '${found.file}'?`);
        await this.fileParser(found.file);
        if (!this.glist.has(slot)) {
          ctx.error(
            `Groove '${slot}' not found. Is the groove in the file '${found.file}'? Have libraries changed since last 'mma -g' run?`,
          );
        }
      }
      tmpList.push(slot);
    }

    if (tmpList.length === 0) ctx.error('Use: Groove [selection] Name [...]');

    if (wh !== null) {
      wh = (wh - 1) % tmpList.length;
      tmpList.splice(0, tmpList.length, tmpList[wh]!);
    }

    const slot = tmpList[0]!;
    this.apply(ctx, slot);

    this.groovesCount = 0;
    this.groovesList = tmpList.length === 1 ? null : tmpList;

    this.lastGroove = this.currentGroove;
    this.currentGroove = slot;
    if (this.lastGroove === '') this.lastGroove = slot;

    ctx.dPrint(`Groove settings restored from '${slot}'.`);
  }

  /** Restore the settings of an in-memory groove. */
  apply(ctx: MMAContext, slot: string): void {
    this.onFutureVolumes?.();

    const oldSeqSize = ctx.seqSize;
    const g = this.glist.get(slot);
    if (!g) ctx.error(`Groove '${slot}' is not defined.`);
    const s = g.settings;

    ctx.seqSize = s.SEQSIZE;
    ctx.seqRndWeight = [...s.SEQRNDWT];
    ctx.QperBar = s.QPERBAR;
    ctx.barLen = s.BARLEN;
    ctx.seqRnd = [...s.SEQRND];
    ctx.timeSig.create(s.TIMESIG[0] ?? 4, s.TIMESIG[1] ?? 2);
    ctx.swingMode = s.SWINGMODE;
    ctx.volume.vTRatio = s.VRATIO[0];
    ctx.volume.vMRatio = s.VRATIO[1];
    ctx.chordTabs = [...s.CTABS];

    for (const t of ctx.tnames.values()) {
      if (t.sticky) continue;
      t.restoreGroove(slot);
    }

    if (oldSeqSize !== ctx.seqSize) {
      for (const t of ctx.tnames.values()) t.setSeqSize();
    }

    ctx.seqRndWeight = ctx.seqBump(ctx.seqRndWeight);
    ctx.seqCount = 0;
  }

  /** Per-bar progression through a Groove list. */
  next(ctx: MMAContext): void {
    if (this.groovesList === null) return;
    const l = this.groovesList;
    this.lastGroove = this.currentGroove;
    this.groovesCount += 1;
    if (this.groovesCount >= l.length) this.groovesCount = 0;
    const slot = l[this.groovesCount]!;
    this.currentGroove = slot;
    this.apply(ctx, slot);
    ctx.dPrint(`Groove list: selecting '${slot}'.`);
  }

  /** Push/pop a temporary groove slot (used when autoloading groove files). */
  push(ctx: MMAContext): void {
    const n = this.stack.length;
    this.stack.push(n);
    this.defineDo(ctx, String(n));
  }

  pop(ctx: MMAContext): void {
    const n = this.stack.pop();
    if (n === undefined) ctx.error('Groove stacking error. Call Bob.');
    this.apply(ctx, String(n));
  }

  clear(): void {
    this.glist.clear();
    this.aliaslist.clear();
    this.groovesList = null;
    this.stack = [];
  }
}

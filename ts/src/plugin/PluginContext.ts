/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * PluginContext implementation: the narrow surface plugins get instead
 * of Python's global modules (gbl + pluginUtils).  Ports the parts of
 * MMA/pluginUtils.py that plugins actually use: command injection,
 * chord definition/lookup, track access and metadata.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../engine/Context';
import type { ChordDef } from '../model/chordTable';
import { ChordNotes } from '../model/ChordNotes';
import { chordEnv } from '../parse/ChordLineParser';
import { defChord } from '../directives/simple/Misc';
import type { IMMAPlugin, PluginChordInfo, PluginContext, PluginTrackHandle } from './IMMAPlugin';

/** Services the plugin runtime needs from the parser. */
export interface PluginContextHost {
  /** Push pre-tokenized command lines into the parser input queue. */
  pushTokens(tokens: string[][], linenos?: number[]): void;
  /** Port of pluginUtils.getVar: value of a user macro variable. */
  getVar(name: string): string | string[][];
  /** Port of MMA/alloc.trackAlloc(name, 0): allocate a track if possible. */
  ensureTrack(name: string): void;
}

export function createPluginContext(
  plugin: IMMAPlugin,
  ctx: MMAContext,
  host: PluginContextHost,
): PluginContext {
  const context: PluginContext = {
    get file(): string {
      return ctx.infile;
    },
    get line(): number {
      return ctx.lineno;
    },
    get context(): MMAContext {
      return ctx;
    },
    get tracks(): ReadonlyMap<string, PluginTrackHandle> {
      const map = new Map<string, PluginTrackHandle>();
      for (const [name, track] of ctx.tnames) {
        map.set(name, track as unknown as PluginTrackHandle);
      }
      return map;
    },
    get chordList(): ReadonlyMap<string, ChordDef> {
      return ctx.chordList;
    },

    chord(name: string): PluginChordInfo {
      const c = new ChordNotes(chordEnv(ctx), name);
      return {
        name: c.name,
        tonic: c.tonic,
        chordType: c.chordType,
        noteList: [...c.noteList],
        bnoteList: [...c.bnoteList],
        scaleList: [...c.scaleList],
        rootNote: c.rootNote,
        noteListLen: c.noteListLen,
      };
    },

    defineChord(name: string, notes: number[], scale: number[], description?: string): void {
      // Same path as the DefChord directive, so validation and warnings
      // match; the optional description is a small TS extension.
      defChord(ctx, [name, `(${notes.join(',')})`, `(${scale.join(',')})`]);
      if (description) {
        const def = ctx.chordList.get(name);
        if (def) ctx.chordList.set(name, { ...def, description });
      }
    },

    pushCommands(lines: string[]): void {
      // pluginUtils.sendCommands(): tokenize and push with the current
      // line number, all at once so the order is preserved.
      const tokens = lines.map((l) => l.trim().split(/\s+/).filter((w) => w !== ''));
      host.pushTokens(tokens, tokens.map(() => ctx.lineno));
    },

    pushTokens(tokens: string[][]): void {
      host.pushTokens(tokens, tokens.map(() => ctx.lineno));
    },

    getVar(name: string): string | string[][] {
      return host.getVar(name);
    },

    ensureTrack(name: string): void {
      host.ensureTrack(name);
    },
  };
  void plugin;
  return context;
}

/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Run orchestration: creates the per-run MMAContext, wires the resource
 * loader and groove index into the Parser, and applies the run prelude
 * (default tempo/time signature/credit) that MMA/main.py performs before
 * parsing a song.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { MMAContext, type DebugFlags } from './Context';
import { Parser, type GrooveIndexData } from '../parse/Parser';
import { setChordTabs } from '../parse/ChordLineParser';
import { SourceReader } from '../io/SourceReader';
import { MemoryResources, type MMAResources } from '../io/MMAResources';
import { GrooveIndex } from '../groove/GrooveIndex';
import type { MMASource } from '../api/Results';
import type { MMAOptions } from '../api/Options';
import type { IMMAPlugin } from '../plugin/IMMAPlugin';

export interface MMAConfig {
  /** Resource loader for includes and groove libraries. */
  resources?: MMAResources;
  /** Pre-built groove index, or its JSON form. */
  grooveIndex?: GrooveIndex | GrooveIndexData;
  /** Search roots for `Include`/`Use` (default includes/, lib/stdlib, lib). */
  includePaths?: string[];
  libPaths?: string[];
  /** Plugins available to all runs of this façade. */
  plugins?: IMMAPlugin[];
}

export interface Run {
  ctx: MMAContext;
  parser: Parser;
  resources: MMAResources;
  sourceName: string;
}

/** Create a fresh, independent run from config + call options. */
export function createRun(
  config: MMAConfig,
  options: MMAOptions & { noCredit?: boolean; format?: 0 | 1; barOrder?: boolean } = {},
): Run {
  const debug: DebugFlags = {
    showExpand: options.debug?.expanded,
    pshow: options.debug?.patterns,
    seqshow: options.debug?.sequences,
    printProcessed: options.barOrder,
  };

  const ctx = new MMAContext({
    maxBars: options.maxBars,
    muteTracks: options.muteTracks,
    seed: options.seed,
    debug,
    plugins: [...(config.plugins ?? []), ...(options.plugins ?? [])],
    noCredit: options.noCredit ?? false,
    midiFileType: options.format ?? 1,
  });
  if (options.warnings !== undefined) ctx.rep.warningsEnabled = options.warnings;

  const resources = config.resources ?? new MemoryResources();
  ctx.resources = resources;

  const grooveIndex =
    config.grooveIndex instanceof GrooveIndex
      ? {
          grooves: Object.fromEntries(config.grooveIndex.list().map((g) => [g.name, { file: g.file }])),
          files: undefined,
        }
      : config.grooveIndex;

  const parser = new Parser(ctx, {
    grooveIndex,
    includePaths: config.includePaths,
    libPaths: config.libPaths,
  });

  // -S macro pre-sets (applied before the source is read).
  for (const [name, value] of Object.entries(options.macros ?? {})) {
    parser.expander.setvar([`${name}=${value}`]);
  }

  return { ctx, parser, resources, sourceName: sourceNameOf({ text: '' }) };
}

export function sourceNameOf(source: MMASource): string {
  return typeof source === 'string' ? 'source.mma' : (source.name ?? 'source.mma');
}

export function sourceTextOf(source: MMASource): string {
  return typeof source === 'string' ? source : source.text;
}

/**
 * Port of the MMA/main.py prelude plus the song parse:
 * default tempo and 4/4 time (chord tabs), optional credit text, then
 * the source itself.
 */
export async function runSource(run: Run, source: MMASource): Promise<void> {
  const { ctx, parser } = run;
  const name = sourceNameOf(source);
  run.sourceName = name;

  const meta = ctx.metaTrack();

  // gbl.tempo default (120) - most songs override it.
  meta.addTempo(0, ctx.tempo);
  // MMA.tempo.setTime(['4/4']): sets chordTabs for default 4/4 time.
  setChordTabs(ctx, [1, 2, 3, 4]);

  if (!ctx.noCredit) {
    const base = name.replace(/\.mma$/i, '');
    meta.addTrkName(0, base);
    meta.addText(0, `Created by MMA. Input filename: ${name}`);
  }

  const reader = new SourceReader(ctx, name, sourceTextOf(source));
  await parser.parse(reader);
}

/** Apply -0/-1 sync options (port of MMA/sync.py usage in writeMidiTrack). */
export function applySyncOptions(
  ctx: MMAContext,
  options: { syncAtStart?: boolean; syncAtEnd?: boolean; syncTone?: { note: number; velocity: number } },
): void {
  const tone = options.syncTone ?? { note: 60, velocity: 100 };
  for (const [channel, track] of [...ctx.mtrks.tracks.entries()].sort((a, b) => a[0] - b[0])) {
    if (channel === 0) continue; // meta track
    if (options.syncAtStart) {
      track.addToTrack(0, packNoteOn(track, tone.note, tone.velocity));
      track.addToTrack(1, packNoteOn(track, tone.note, 0));
    }
    if (options.syncAtEnd) {
      track.addToTrack(ctx.tickOffset, packAllNotesOff(track));
    }
  }
}

function packNoteOn(track: { channel: number }, note: number, velocity: number): Uint8Array {
  return new Uint8Array([0x90 | track.channel, note & 0x7f, velocity & 0x7f]);
}

function packAllNotesOff(track: { channel: number }): Uint8Array {
  return new Uint8Array([0xb0 | track.channel, 0x7b, 0]);
}

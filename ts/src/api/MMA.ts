/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * The façade: a browser-first, output-oriented API over the ported
 * engine.  Each MMA instance owns its own MMAContext; creating several
 * instances and running them concurrently is supported (runs on one
 * instance are sequential - a run re-initializes its context).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { MMAError } from '../engine/Errors';
import packageJson from '../../package.json';
import { MMA_UPSTREAM_VERSION } from '../version';
import { createRun, runSource, applySyncOptions, type MMAConfig } from '../engine/RunPipeline';
import { buildSongModel, type SongModel } from './SongModel';
import type { MIDIOptions, MMAOptions } from './Options';
import type { MIDIResult, MMASource, ParseResult } from './Results';
import type { MMAContext } from '../engine/Context';
import type { GrooveDatabase } from '../groove/GrooveDatabase';
import { writeMIDI } from '../midi/MIDIWriter';

export interface MMAConstructorConfig extends MMAConfig {}

export class MMA {
  /** Current run state; replaced at the start of every run. */
  context: MMAContext;

  private readonly config: MMAConstructorConfig;
  private lastModel: SongModel | null = null;

  constructor(config: MMAConstructorConfig = {}) {
    this.config = config;
    this.context = createRun(config, {}).ctx;
  }

  /** Parse a song and return the public model (no MIDI generation). */
  async parse(source: MMASource, options: MMAOptions = {}): Promise<ParseResult> {
    const run = createRun(this.config, options);
    this.context = run.ctx;
    await runSource(run, source);
    const model = buildSongModel(run.ctx, run.sourceName);
    this.lastModel = model;
    return {
      model,
      warnings: [...run.ctx.rep.warnings],
    };
  }

  /** Parse a song and produce a Standard MIDI File. */
  async toMIDI(source: MMASource, options: MIDIOptions = {}): Promise<MIDIResult> {
    this.rejectUnsupported(options);

    const run = createRun(this.config, {
      ...options,
      noCredit: options.noCredit,
      format: options.format,
      barOrder: options.barOrder,
    });
    this.context = run.ctx;
    await runSource(run, source);

    applySyncOptions(run.ctx, options);

    // writeMid.createMIDI: estimated play time in seconds as a comment.
    run.ctx.metaTrack().addText(0, `DURATION: ${Math.trunc(run.ctx.totTime * 60)}`);

    const metaName = run.ctx.mtrks.tracks.get(0)?.trackname ?? '';
    const written = writeMIDI(run.ctx.mtrks, {
      format: options.format ?? run.ctx.midiFileType,
      metaName,
    });

    const model = buildSongModel(run.ctx, run.sourceName);
    this.lastModel = model;

    return {
      bytes: written.bytes,
      basicMIDI: written.basicMIDI,
      model,
      warnings: [...run.ctx.rep.warnings],
      barOrder: options.barOrder ? [...run.ctx.barLabels] : undefined,
    };
  }

  /** Model produced by the last run, if any. */
  getSongModel(): SongModel | null {
    return this.lastModel;
  }

  /**
   * Attach (or replace/remove) the on-demand groove database used by
   * subsequent runs.  Load it first with `GrooveDatabase.load(url)`.
   */
  setGrooveDatabase(database: GrooveDatabase | null): void {
    if (database) this.config.grooveDatabase = database;
    else delete this.config.grooveDatabase;
  }

  /** Version of this TypeScript port and of the upstream Python MMA. */
  version(): { port: string; upstream: string } {
    return { port: packageJson.version, upstream: MMA_UPSTREAM_VERSION };
  }

  private rejectUnsupported(options: MIDIOptions): void {
    if (options.barRange !== undefined) {
      throw new MMAError('barRange is not implemented yet in this TypeScript port (planned milestone M5).');
    }
    if (options.splitOutput !== undefined) {
      throw new MMAError('splitOutput is not implemented yet in this TypeScript port (planned milestone M5).');
    }
  }
}

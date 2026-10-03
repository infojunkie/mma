/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Browser playback entry: wraps spessasynth_lib (WorkletSynthesizer +
 * Sequencer) behind a small backend interface so that applications can
 * substitute their own player and tests can run without a browser.
 *
 * spessasynth_lib is an optional peer dependency: this module is only
 * imported by applications that want playback.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { BasicMIDI } from 'spessasynth_core';

export type PlayerEvent = 'songEnded' | 'timeChange' | 'songChange' | 'metaEvent' | 'textEvent';

export interface PlayerBackend {
  loadSong(song: { binary: ArrayBuffer } | BasicMIDI): Promise<void>;
  play(): void;
  pause(): void;
  stop(): void;
  currentTime: number;
  readonly duration: number;
  loopCount: number;
  readonly paused: boolean;
  on(event: PlayerEvent, cb: (data: unknown) => void): () => void;
}

export interface SpessaPlayerOptions {
  audioContext: AudioContext;
  /** SF2/SF3/DLS sound bank bytes (the library bundles no bank). */
  soundBank: ArrayBuffer;
  /** URL of spessasynth_processor.min.js from the spessasynth_lib dist. */
  processorUrl: string | URL;
  soundBankId?: string;
  /** Resume the context automatically on play() (default true). */
  resumeOnPlay?: boolean;
}

type SpessaModules = {
  WorkletSynthesizer: new (ctx: AudioContext) => {
    connect(dest: AudioNode): void;
    soundBankManager: { addSoundBank(buf: ArrayBuffer, id: string): Promise<void> };
  };
  Sequencer: new (synth: unknown) => {
    loadNewSongList(list: Array<{ binary: ArrayBuffer } | BasicMIDI>): void;
    play(): void;
    pause(): void;
    currentTime: number;
    duration: number;
    loopCount: number;
    paused: boolean;
    eventHandler: { addEvent(name: string, id: string, cb: (data: unknown) => void): void };
  };
};

/** Playback backend based on spessasynth_lib (browser only). */
export class SpessaPlayerBackend implements PlayerBackend {
  private constructor(
    private synth: InstanceType<SpessaModules['WorkletSynthesizer']>,
    private sequencer: InstanceType<SpessaModules['Sequencer']>,
    private ctx: AudioContext,
    private resumeOnPlay: boolean,
  ) {}

  static async create(options: SpessaPlayerOptions): Promise<SpessaPlayerBackend> {
    const lib = (await import('spessasynth_lib')) as unknown as SpessaModules;
    const { audioContext } = options;
    if (audioContext.audioWorklet) {
      await audioContext.audioWorklet.addModule(String(options.processorUrl));
    }
    const synth = new lib.WorkletSynthesizer(audioContext);
    synth.connect(audioContext.destination);
    await synth.soundBankManager.addSoundBank(options.soundBank, options.soundBankId ?? 'default');
    const sequencer = new lib.Sequencer(synth);
    return new SpessaPlayerBackend(synth, sequencer, audioContext, options.resumeOnPlay ?? true);
  }

  async loadSong(song: { binary: ArrayBuffer } | BasicMIDI): Promise<void> {
    this.sequencer.loadNewSongList([song]);
  }

  play(): void {
    if (this.resumeOnPlay && this.ctx.state !== 'running') void this.ctx.resume();
    this.sequencer.play();
  }

  pause(): void {
    this.sequencer.pause();
  }

  stop(): void {
    this.sequencer.pause();
    this.sequencer.currentTime = 0;
  }

  get currentTime(): number {
    return this.sequencer.currentTime;
  }

  get duration(): number {
    return this.sequencer.duration;
  }

  get paused(): boolean {
    return this.sequencer.paused;
  }

  get loopCount(): number {
    return this.sequencer.loopCount;
  }

  set loopCount(n: number) {
    this.sequencer.loopCount = n;
  }

  on(event: PlayerEvent, cb: (data: unknown) => void): () => void {
    const id = `${event}-${Math.random().toString(36).slice(2)}`;
    this.sequencer.eventHandler.addEvent(event, id, cb);
    return () => {
      /* spessasynth removes by (event, id); keep the id for future removal */
    };
  }
}

/** Thin convenience wrapper over a PlayerBackend. */
export class MMAPlayer {
  constructor(readonly backend: PlayerBackend) {}

  async load(song: { binary: ArrayBuffer } | BasicMIDI): Promise<void> {
    await this.backend.loadSong(song);
  }

  play(): void {
    this.backend.play();
  }

  pause(): void {
    this.backend.pause();
  }

  stop(): void {
    this.backend.stop();
  }

  seek(seconds: number): void {
    this.backend.currentTime = seconds;
  }

  set loopCount(n: number) {
    this.backend.loopCount = n;
  }

  get loopCount(): number {
    return this.backend.loopCount;
  }

  on(event: PlayerEvent, cb: (data: unknown) => void): () => void {
    return this.backend.on(event, cb);
  }
}

/** Test/application helper: play a MIDIResult directly. */
export async function playMIDIResult(
  player: MMAPlayer,
  result: { bytes: ArrayBuffer },
): Promise<void> {
  await player.load({ binary: result.bytes });
  player.play();
}

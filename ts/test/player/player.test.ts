import { describe, expect, it } from 'vitest';
import { MMAPlayer, playMIDIResult, type PlayerBackend, type PlayerEvent } from '../../src/player';

/** In-memory backend so the player seam is testable without a browser. */
class MockPlayerBackend implements PlayerBackend {
  loaded: Array<{ binary: ArrayBuffer }> = [];
  played = 0;
  pauseCount = 0;
  stopped = 0;
  currentTime = 0;
  duration = 12.5;
  loopCount = 0;
  pausedState = false;
  private handlers = new Map<PlayerEvent, Array<(data: unknown) => void>>();

  async loadSong(song: { binary: ArrayBuffer }): Promise<void> {
    this.loaded.push(song);
    this.emit('songChange', song);
  }

  play(): void {
    this.played++;
  }

  pause(): void {
    this.pauseCount++;
  }

  stop(): void {
    this.stopped++;
    this.currentTime = 0;
  }

  get paused(): boolean {
    return this.pausedState;
  }

  on(event: PlayerEvent, cb: (data: unknown) => void): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
    return () => {
      this.handlers.set(event, (this.handlers.get(event) ?? []).filter((f) => f !== cb));
    };
  }

  emit(event: PlayerEvent, data: unknown): void {
    for (const cb of this.handlers.get(event) ?? []) cb(data);
  }
}

describe('MMAPlayer', () => {
  it('delegates load/play/pause/stop/seek to the backend', async () => {
    const backend = new MockPlayerBackend();
    const player = new MMAPlayer(backend);
    const bytes = new ArrayBuffer(8);
    await player.load({ binary: bytes });
    expect(backend.loaded).toHaveLength(1);
    player.play();
    expect(backend.played).toBe(1);
    player.pause();
    expect(backend.pauseCount).toBe(1);
    player.seek(5);
    expect(backend.currentTime).toBe(5);
    player.stop();
    expect(backend.stopped).toBe(1);
    expect(backend.currentTime).toBe(0);
  });

  it('forwards loop count and events', async () => {
    const backend = new MockPlayerBackend();
    const player = new MMAPlayer(backend);
    player.loopCount = 3;
    expect(backend.loopCount).toBe(3);

    let ended = 0;
    player.on('songEnded', () => ended++);
    backend.emit('songEnded', null);
    expect(ended).toBe(1);
  });

  it('playMIDIResult loads bytes and starts playback', async () => {
    const backend = new MockPlayerBackend();
    const player = new MMAPlayer(backend);
    await playMIDIResult(player, { bytes: new ArrayBuffer(4) });
    expect(backend.loaded).toHaveLength(1);
    expect(backend.played).toBe(1);
  });
});

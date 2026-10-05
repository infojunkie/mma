/**
 * Tuning plugin tests.  The shipped Python plugin is a stub whose
 * entry points echo their arguments; the port preserves that so the
 * parent repo's `tuning.mma` (Plugin Tuning + @Tuning 64 -50) parses
 * and runs unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { MemoryResources } from '../../src/io/MMAResources';
import { Parser } from '../../src/parse/Parser';
import { tuningPlugin } from '../../plugins/tuning';

function makeCtx(song: string): MMAContext {
  const ctx = new MMAContext({ seed: 42, plugins: [tuningPlugin] });
  ctx.resources = new MemoryResources({ 'song.mma': song });
  return ctx;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Tuning plugin', () => {
  it('loads and echoes @Tuning arguments like the Python plugin', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = makeCtx('Plugin Tuning\n@Tuning 64 -50\n');
    await new Parser(ctx).parseFile('song.mma');
    expect(log).toHaveBeenCalledWith('run', "['64', '-50']");
  });

  it('is inert: it adds no MIDI events', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = makeCtx('Time 4\nPlugin Tuning\n@Tuning 64 -50\nC\n');
    await new Parser(ctx).parseFile('song.mma');
    for (const track of ctx.mtrks.tracks.values()) {
      for (const events of track.miditrk.values()) {
        for (const ev of events) {
          expect(ev[0]!).not.toBe(0xf0); // no SysEx from the plugin
        }
      }
    }
  });

  it('exposes trackRun and dataRun entry points like the Python stub', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = new MMAContext();
    const pctx = { context: ctx } as unknown as Parameters<NonNullable<typeof tuningPlugin.trackRun>>[2];
    tuningPlugin.trackRun?.('CHORD', ['x', 'y'], pctx);
    tuningPlugin.dataRun?.(['a', 'b'], pctx);
    expect(log).toHaveBeenCalledWith('trackRun', 'CHORD', "['x', 'y']");
    expect(log).toHaveBeenCalledWith('dataRun', "['a', 'b']");
  });
});

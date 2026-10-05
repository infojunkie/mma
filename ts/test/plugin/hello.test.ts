/**
 * hello plugin tests (port of plugins/hello/plugin.py): run() echoes,
 * trackRun() returns setting strings (octave/voice) and dataRun()
 * prepends Gm.  The render is also covered by the Python-generated
 * golden fixture "feature-hello".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { MemoryResources } from '../../src/io/MMAResources';
import { Parser } from '../../src/parse/Parser';
import type { PluginContext } from '../../src/plugin/IMMAPlugin';
import { helloPlugin } from '../../plugins/hello';

function makeCtx(song: string): MMAContext {
  const ctx = new MMAContext({ seed: 42, plugins: [helloPlugin] });
  ctx.resources = new MemoryResources({ 'song.mma': song });
  return ctx;
}

async function parse(song: string): Promise<MMAContext> {
  const ctx = makeCtx(song);
  await new Parser(ctx).parseFile('song.mma');
  return ctx;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hello plugin', () => {
  it('run() echoes its arguments with file and line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await parse('Plugin hello\n@hello Cm EM G7\n');
    expect(log).toHaveBeenCalledWith('Hello. This is the run() function in the MMA plugin.');
    expect(log).toHaveBeenCalledWith('We are at line 2 in the MMA file song.mma.');
    expect(log).toHaveBeenCalledWith('Args passed are:');
    expect(log).toHaveBeenCalledWith('Cm');
    expect(log).toHaveBeenCalledWith('G7');
  });

  it('trackRun() changes octave and voice through pushed commands', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = await parse(
      'Time 4\nPlugin hello\nChord Sequence {1 1 90 * 4}\nChord @Hello\n',
    );
    const chord = ctx.tnames.get('CHORD')!;
    expect(chord.octave[0]).toBe(72); // 6 * 12
    expect(chord.voice[0]).toBe(26); // JazzGuitar
  });

  it('dataRun() prepends Gm', () => {
    expect(helloPlugin.dataRun!(['A'], {} as PluginContext)).toEqual(['Gm', 'A']);
  });

  it('exposes the Python usage text', () => {
    expect(helloPlugin.help!()).toBe(
      "Usage for the mma hello plugin. \nNot much to say ... I'm just an example.",
    );
  });
});

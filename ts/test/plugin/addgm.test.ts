/**
 * addgm plugin tests (port of plugins/addgm/plugin.py): a data plugin
 * that prepends the chord "Gm" to the line.  The render is also covered
 * by the Python-generated golden fixture "feature-addgm".
 */
import { describe, expect, it } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { MemoryResources } from '../../src/io/MMAResources';
import { Parser } from '../../src/parse/Parser';
import type { PluginContext } from '../../src/plugin/IMMAPlugin';
import { addgmPlugin } from '../../plugins/addgm';

function makeCtx(song: string): MMAContext {
  const ctx = new MMAContext({ seed: 42, plugins: [addgmPlugin] });
  ctx.resources = new MemoryResources({ 'song.mma': song });
  return ctx;
}

function countNotes(ctx: MMAContext): number {
  let notes = 0;
  for (const track of ctx.mtrks.tracks.values()) {
    for (const events of track.miditrk.values()) {
      for (const ev of events) if (ev[0]! >= 0x90 && ev[0]! < 0xa0 && (ev[2] ?? 0) > 0) notes++;
    }
  }
  return notes;
}

describe('addgm plugin', () => {
  it('prepends Gm to the data line', () => {
    expect(addgmPlugin.dataRun!(['A'], {} as PluginContext)).toEqual(['Gm', 'A']);
  });

  it('renders the rewritten data line', async () => {
    const ctx = makeCtx(
      'Time 4\nPlugin addgm\nChord Sequence {1 1 90 * 4}\n@Addgm A\n',
    );
    await new Parser(ctx).parseFile('song.mma');
    expect(ctx.barNum).toBe(1);
    expect(countNotes(ctx)).toBeGreaterThan(0);
  });

  it('exposes the Python usage text', () => {
    expect(addgmPlugin.help!()).toBe('Usage for the mma addgm plugin. ');
  });
});

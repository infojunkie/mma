/**
 * Slash plugin tests.  The expected chord types were produced by the
 * reference Python plugin (musicxml-midi/src/plugins/slash/plugin.py);
 * the `<interval` suffix is the bass note's interval relative to the
 * chord root, as the parent converter's XSL emits it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { MemoryResources } from '../../src/io/MMAResources';
import { Parser } from '../../src/parse/Parser';
import { slashPlugin } from '../../plugins/slash';

function makeCtx(song: string, options: ConstructorParameters<typeof MMAContext>[0] = {}): MMAContext {
  const ctx = new MMAContext({ seed: 42, plugins: [slashPlugin], ...options });
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

describe('Slash plugin', () => {
  const cases: Array<[string, string, number[], number[]]> = [
    ['Dm/F', 'm<-9', [-9, 3, 7], [-9, 2, 3, 5, 7, 8, 10]],
    ['A7/G', '7<-2', [-2, 4, 7, 10], [-2, 2, 4, 5, 7, 9, 10]],
    ['C/E', '<-8', [-8, 4, 7], [-8, 2, 4, 5, 7, 9, 11]],
    ['Ebm/Bb', 'm<-5', [-5, 3, 7], [-5, 2, 3, 5, 7, 8, 10]],
  ];

  for (const [chord, typeName, notes, scale] of cases) {
    it(`@Slash ${chord} defines ${typeName}`, async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const ctx = await parse(`Plugin Slash\n@Slash ${chord}\n`);
      expect(log).toHaveBeenCalledWith(`Defining new chord ${typeName}`);
      expect(ctx.chordList.get(typeName)?.notes).toEqual(notes);
      expect(ctx.chordList.get(typeName)?.scale).toEqual(scale);
    });
  }

  it('defines a type only once', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = await parse('Plugin Slash\n@Slash Dm/F\n@Slash Dm/F\n');
    expect(log).toHaveBeenCalledTimes(1);
    expect(ctx.chordList.has('m<-9')).toBe(true);
  });

  it('renders the plugin-defined chord end to end', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = await parse(
      [
        'Time 4',
        'Plugin Slash',
        '@Slash Dm/F',
        'Begin Chord',
        '  Voice Piano1',
        '  Sequence {1 4 90}',
        'End',
        'Dm<-9',
      ].join('\n'),
    );
    let notes = 0;
    for (const track of ctx.mtrks.tracks.values()) {
      for (const events of track.miditrk.values()) {
        for (const ev of events) if (ev[0]! >= 0x90 && ev[0]! < 0xa0 && (ev[2] ?? 0) > 0) notes++;
      }
    }
    expect(notes).toBeGreaterThan(0);
  });

  it('errors cleanly on unknown bass notes and empty args', async () => {
    await expect(parse('Plugin Slash\n@Slash Dm/zz\n')).rejects.toThrow(/unknown bass note 'zz'/);
    await expect(parse('Plugin Slash\n@Slash\n')).rejects.toThrow(/expecting a chord name/);
  });
});

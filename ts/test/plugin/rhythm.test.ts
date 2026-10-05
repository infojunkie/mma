/**
 * rhythm plugin tests (port of plugins/rhythm/plugin.py): the ASCII tab
 * to sequence conversion (outputs verified against the Python
 * implementation), the queued groove definition and the track form.
 * The render is also covered by the Python-generated golden fixture
 * "feature-rhythm".
 *
 * Note: Python mutates the module-global argument spec in trackRun, so
 * every test uses a fresh plugin instance.
 */
import { describe, expect, it } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import type { PluginContext } from '../../src/plugin/IMMAPlugin';
import { createPluginContext, type PluginContextHost } from '../../src/plugin/PluginContext';
import { createRhythmPlugin, processSequence, RhythmPlugin, zoomNames, zoomTones } from '../../plugins/rhythm';

function setup(getVar?: (name: string) => string | string[][]): {
  ctx: MMAContext;
  pushed: string[][];
  pctx: PluginContext;
  plugin: RhythmPlugin;
} {
  const ctx = new MMAContext({ seed: 1 });
  const pushed: string[][] = [];
  const host: PluginContextHost = {
    pushTokens: (tokens) => {
      pushed.push(...tokens);
    },
    getVar:
      getVar ??
      (() => {
        throw new Error('no macro expected');
      }),
    ensureTrack: () => {},
  };
  const plugin = createRhythmPlugin();
  return { ctx, pushed, pctx: createPluginContext(plugin, ctx, host), plugin };
}

describe('rhythm plugin', () => {
  // Expected values produced by plugins/rhythm/plugin.py process_sequence().
  const cases: Array<[string, number, number, string]> = [
    ['|8---|', 4, 9, '{ 1 0 80 } '],
    ['|--8-|', 4, 9, '{ 3 0 80 } '],
    ['|8888|', 4, 9, '{ 1 0 80; 2 0 80; 3 0 80; 4 0 80 } '],
    ['|8---||8---|', 4, 9, '{ 1 0 80 } / / '],
    ['"|8---|"', 4, 9, '{ 1 0 80 } '],
    ['|--------|', 4, 9, 'Z '],
    ['|-8-8-|', 4, 9, '{ 1.8 0 80; 3.4 0 80 } '],
    ['|8-8-|', 4, 8, '{ 1 0 90; 3 0 90 } '],
    // Python round() is half-to-even: 22.5 -> 22, 67.5 -> 68.
    ['|2|', 4, 8, '{ 1 0 22 } '],
    ['|6|', 4, 8, '{ 1 0 68 } '],
  ];

  for (const [tab, bpm, vol, expected] of cases) {
    it(`processSequence(${tab}, ${bpm}, ${vol})`, () => {
      expect(processSequence(tab, bpm, vol)).toBe(expected);
    });
  }

  it('rejects malformed tabs', () => {
    expect(() => processSequence('abc')).toThrowError('Invalid tab: abc');
  });

  it('defines a groove from instrument/tab pairs', () => {
    const { pushed, pctx, plugin } = setup();
    plugin.run(['Groove=G,', 'Seq=Kick |8---|'], pctx);
    expect(pushed).toEqual([
      ['Begin', 'Drum-Kick'],
      ['Tone', 'KickDrum1'],
      ['Sequence', '{', '1', '0', '80', '}'],
      ['End'],
      ['DefGroove', 'G'],
    ]);
  });

  it('resolves numbered instruments through the Zoom tables', () => {
    const { pushed, pctx, plugin } = setup();
    plugin.run(['Groove=G,', 'Seq=3 |8---|'], pctx);
    expect(zoomNames[2]).toBe('ClosedHat');
    expect(zoomTones[2]).toBe('ClosedHiHat');
    expect(pushed[0]).toEqual(['Begin', 'Drum-ClosedHat']);
    expect(pushed[1]).toEqual(['Tone', 'ClosedHiHat']);
  });

  it('resolves a single-token Seq through a macro variable', () => {
    const { pushed, pctx, plugin } = setup((name) => {
      expect(name).toBe('MYPAT');
      return 'Kick |8---|';
    });
    plugin.run(['Groove=G,', 'Seq=MYPAT'], pctx);
    expect(pushed[0]).toEqual(['Begin', 'Drum-Kick']);
    expect(pushed[4]).toEqual(['DefGroove', 'G']);

    // MSet values arrive as a list of token lists.
    const second = setup(() => [['Kick', '|8---|']]);
    second.plugin.run(['Groove=G,', 'Seq=MYPAT'], second.pctx);
    expect(second.pushed[0]).toEqual(['Begin', 'Drum-Kick']);
  });

  it('applies SeqClear/SeqSize and RTime/RVolume options', () => {
    const { pushed, pctx, plugin } = setup();
    plugin.run(
      ['Groove=G,', 'Seq=Kick |8---|,', 'Clear=1,', 'SeqSize=2,', 'RTime=5,', 'RVolume=10'],
      pctx,
    );
    expect(pushed[0]).toEqual(['SeqClear']);
    expect(pushed[1]).toEqual(['SeqSize', '2']);
    expect(pushed[2]).toEqual(['Begin', 'Drum-Kick']);
    expect(pushed[3]).toEqual(['Tone', 'KickDrum1']);
    expect(pushed[4]).toEqual(['RTime', '5']);
    expect(pushed[5]).toEqual(['RVolume', '10']);
  });

  it('uses the track form with and without a Begin block', () => {
    const first = setup();
    first.plugin.trackRun!('DRUM', ['Seq=|8---|,', 'Bpm=4'], first.pctx);
    expect(first.pushed).toEqual([['DRUM', 'Sequence', '{', '1', '0', '80', '}']]);

    const second = setup();
    second.ctx.beginData = ['Drum'];
    second.plugin.trackRun!('DRUM', ['Seq=|8---|,', 'Bpm=4'], second.pctx);
    expect(second.pushed).toEqual([['Sequence', '{', '1', '0', '80', '}']]);
  });

  it('uses the track form with Define=', () => {
    const { ctx, pushed, pctx, plugin } = setup();
    ctx.beginData = ['Drum'];
    plugin.trackRun!('DRUM', ['Define=P1,', 'Seq=|8---|,', 'Bpm=4'], pctx);
    expect(pushed).toEqual([['Define', 'P1', '1', '0', '80']]);
  });

  it('reports the Python error texts', () => {
    const { pctx, plugin } = setup();
    expect(() => plugin.run(['Groove=G,', 'Seq=Kick |8---|'], pctx)).not.toThrow();

    const level = setup();
    expect(() => level.plugin.run(['Groove=G,', 'Seq=Kick |8---|,', 'Level=0'], level.pctx)).toThrowError(
      'Rhtythm: Level must be 1 .. 9, not 0',
    );

    const odd = setup();
    expect(() => odd.plugin.run(['Groove=G,', 'Seq=Kick |8---| Snare'], odd.pctx)).toThrowError(
      'Rhythm: Seq must have an even number of whitespace separated items',
    );

    const unknown = setup();
    expect(() => unknown.plugin.run(['Groove=G,', 'Bogus=1'], unknown.pctx)).toThrowError(
      'Plugin @rhythm: unexpected argument name Bogus.',
    );

    const missing = setup();
    expect(() => missing.plugin.run(['Groove=G'], missing.pctx)).toThrowError(
      'Plugin @rhythm: no value for argument Seq.',
    );
  });

  it('exposes the Python usage text', () => {
    const { plugin } = setup();
    const help = plugin.help();
    expect(help).toContain('Plugin @rhythm');
    expect(help).toContain('@rhythm Groove, Seq, Bpm, Level, RTime, RVolume, Clear, SeqSize, Debug');
    expect(help).toContain('Track type must be DRUM.');
    expect(help).toContain('Groove to define.');
    expect(help).toContain('This plugin creates percussion patterns using ASCII tabs.');
  });
});

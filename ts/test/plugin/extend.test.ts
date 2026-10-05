/**
 * extend plugin tests (port of plugins/extend/plugin.py): the lines it
 * queues for shortening and lengthening a data line.  The shipped
 * plugins/extend/test.mma is also part of the conformance corpus
 * (Python-generated golden fixture "plugin-extend").
 */
import { describe, expect, it } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { setTime } from '../../src/directives/simple/Tempo';
import type { PluginContext } from '../../src/plugin/IMMAPlugin';
import { createPluginContext, type PluginContextHost } from '../../src/plugin/PluginContext';
import { extendPlugin } from '../../plugins/extend';

function setup(): { ctx: MMAContext; pushed: string[][]; pctx: PluginContext } {
  const ctx = new MMAContext({ seed: 1 });
  const pushed: string[][] = [];
  const host: PluginContextHost = {
    pushTokens: (tokens) => {
      pushed.push(...tokens);
    },
    getVar: () => {
      throw new Error('extend does not use variables');
    },
    ensureTrack: () => {},
  };
  return { ctx, pushed, pctx: createPluginContext(extendPlugin, ctx, host) };
}

describe('extend plugin', () => {
  it('shortens a line like a Truncate', () => {
    const { ctx, pushed, pctx } = setup();
    extendPlugin.run!(['Len=2', 'side=right', '2', 'Am'], pctx);
    expect(ctx.QperBar).toBe(4);
    expect(pushed).toEqual([
      [],
      ['Truncate', 'side=right', '2'],
      ['2', 'Am'],
    ]);
  });

  it('splits 3/4 data into a 4/4 bar plus a Truncate', () => {
    const { ctx, pushed, pctx } = setup();
    setTime(ctx, ['3/4']);
    extendPlugin.run!(['Timesig=4/4', 'Len=4', 'side=2', '3', 'Dm'], pctx);
    expect(pushed).toEqual([
      ['Timesig', '4/4'],
      ['3', 'Dm'],
      ['Truncate', 'side=2', '1'],
      ['3', '/'],
      ['Timesig', '3/4'],
    ]);
  });

  it('splits 4/4 data without a line number', () => {
    const { pushed, pctx } = setup();
    extendPlugin.run!(['Len=6', '2', 'Am'], pctx);
    expect(pushed).toEqual([
      ['2', 'Am'],
      ['Truncate', 'side=1', '2'],
      ['2', '/'],
    ]);
  });

  it('reports the Python error texts', () => {
    const { ctx, pctx } = setup();
    expect(() => extendPlugin.run!(['2', 'Am'], pctx)).toThrowError(
      '@Extend: requires a LEN=x option. x is the new length of bar',
    );
    expect(() => extendPlugin.run!(['Len=4', '2', 'Am'], pctx)).toThrowError(
      '@Extend: Expected the Len= to be different from the current TIME value.',
    );
    expect(() => extendPlugin.run!(['Len=x', '2', 'Am'], pctx)).toThrowError(
      '@Extend LEN option expecting integer',
    );
    expect(() => extendPlugin.run!(['Len=9', '2', 'Am'], pctx)).toThrowError(
      "@Extend: doesn't support lines longer than 2x the current TIME setting.",
    );
    expect(() => extendPlugin.run!(['Len=2', '2', 'Am', '*'], pctx)).toThrowError(
      "@Extend: does not support the '*' multiplier in data lines.",
    );
    expect(() => extendPlugin.run!(['Len=2', '{solo}', 'Am'], pctx)).toThrowError(
      '@Extend: Does not support embedded solo/melody. Use Riff instead.',
    );
    expect(() => extendPlugin.run!(['Len=2', '@x', 'Am'], pctx)).toThrowError(
      /the '@' notation in chord data lines is not supported/,
    );
  });

  it('exposes the Python usage text', () => {
    expect(extendPlugin.help!()).toContain('@Extend len=dd [other options] Chord Data');
    expect(extendPlugin.help!()).toContain('Author: bvdp, 2018/12/25.');
  });
});

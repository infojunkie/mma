/**
 * strumpattern plugin tests (port of plugins/strumpattern/plugin.py):
 * the sequence commands it queues for the plectrum track and its
 * "-Muted" companion, plus the CPython-style '0.4' float formatting.
 * The shipped plugins/strumpattern/test.mma is also part of the
 * conformance corpus (Python-generated golden fixture
 * "plugin-strumpattern").
 */
import { describe, expect, it } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import type { PluginContext } from '../../src/plugin/IMMAPlugin';
import { createPluginContext, type PluginContextHost } from '../../src/plugin/PluginContext';
import {
  createStrumpatternPlugin,
  pyFormat04,
  strumpatternPlugin,
  StrumpatternPlugin,
} from '../../plugins/strumpattern';

function setup(): { ctx: MMAContext; pushed: string[][]; pctx: PluginContext; plugin: StrumpatternPlugin } {
  const ctx = new MMAContext({ seed: 1 });
  const pushed: string[][] = [];
  const plugin = createStrumpatternPlugin();
  const host: PluginContextHost = {
    pushTokens: (tokens) => {
      pushed.push(...tokens);
    },
    getVar: () => {
      throw new Error('strumpattern does not use user variables');
    },
    ensureTrack: () => {
      /* the plugin never allocates tracks itself */
    },
  };
  return { ctx, pushed, pctx: createPluginContext(plugin, ctx, host), plugin };
}

/** The queued commands, one string per line (as addCommand received them). */
function commands(pushed: string[][]): string[] {
  return pushed.map((t) => t.join(' '));
}

describe('strumpattern plugin', () => {
  it('generates the down-up pattern sequence and muted companion', () => {
    const { pushed, pctx, plugin } = setup();
    plugin.trackRun('PLECTRUM', ['dudududu'], pctx);

    expect(commands(pushed)).toEqual([
      'PLECTRUM Sequence {1.0 +5 80; 1.5 -5 80; 2.0 +5 80; 2.5 -5 80; 3.0 +5 80; 3.5 -5 80; 4.0 +5 80; 4.5 -5 80;}',
      'PLECTRUM-Muted SeqClear',
      'PLECTRUM-Muted Copy PLECTRUM',
      'PLECTRUM-Muted Voice MutedGuitar',
      'PLECTRUM-Muted Sequence z',
    ]);
  });

  it('handles dotted patterns, mutes and emphasised strums', () => {
    const { pushed, pctx, plugin } = setup();
    plugin.trackRun('PLECTRUM', ['dm.um.d.u.de.ue.d.u'], pctx);
    const cmds = commands(pushed);
    expect(cmds[0]).toBe(
      'PLECTRUM Sequence {1.0 0 0; 1.5 0 0; 2.0 +5 80; 2.5 -5 80; 3.0 +5 100; 3.5 -5 100; 4.0 +5 80; 4.5 -5 80;}',
    );
    expect(cmds[4]).toBe('PLECTRUM-Muted Sequence {1.0 +5 60; 1.5 -5 60;}');
  });

  it('handles single-string arpeggios and chunks', () => {
    const { pushed, pctx, plugin } = setup();
    plugin.trackRun('PLECTRUM', ['12345654'], pctx);
    expect(commands(pushed)[0]).toBe(
      'PLECTRUM Sequence {1.0 0 1:90; 1.5 0 2:90; 2.0 0 3:90; 2.5 0 4:90; 3.0 0 5:90; 3.5 0 6:90; 4.0 0 5:90; 4.5 0 4:90;}',
    );

    const { pushed: pushed2, pctx: pctx2, plugin: plugin2 } = setup();
    plugin2.trackRun('PLECTRUM', ['x0x0'], pctx2);
    const cmds = commands(pushed2);
    expect(cmds[0]).toBe('PLECTRUM Sequence {1.0 0 0; 2.0 0 0; 3.0 0 0; 4.0 0 0;}');
    expect(cmds[4]).toBe('PLECTRUM-Muted Sequence {1.0 0 60; 3.0 0 60;}');
  });

  it('supports multiple semicolon-separated bars', () => {
    const { pushed, pctx, plugin } = setup();
    plugin.trackRun('PLECTRUM', ['d---d--u;-ud-dudu'], pctx);
    const cmds = commands(pushed);
    expect(cmds[0]).toBe(
      'PLECTRUM Sequence {1.0 +5 80; 3.0 +5 80; 4.5 -5 80;} {1.5 -5 80; 2.0 +5 80; 3.0 +5 80; 3.5 -5 80; 4.0 +5 80; 4.5 -5 80;}',
    );
    expect(cmds[4]).toBe('PLECTRUM-Muted Sequence z z');
  });

  it('accepts positional and named arguments', () => {
    const { pushed, pctx, plugin } = setup();
    plugin.trackRun('PLECTRUM', ['dud,', 'Strum=10,', 'VolumeEmph=90'], pctx);
    expect(commands(pushed)[0]).toBe('PLECTRUM Sequence {1.0 +10 80; 2.333 -10 80; 3.667 +10 80;}');
  });

  it('rejects unknown pattern characters', () => {
    const { pctx, plugin } = setup();
    expect(() => plugin.trackRun('PLECTRUM', ['dq'], pctx)).toThrowError(
      "@strumpattern: unrecognized command in strum pattern: 'q'.",
    );
  });

  it('requires the Pattern argument and the Plectrum track type', () => {
    const { pctx, plugin } = setup();
    expect(() => plugin.trackRun('PLECTRUM', [], pctx)).toThrowError(
      'Plugin @strumpattern: no value for argument Pattern.',
    );
    expect(() => plugin.trackRun('BASS', ['dudu'], pctx)).toThrowError(
      'Plugin @strumpattern: track type must be Plectrum.',
    );
  });

  it('formats beat positions like CPython format(v, "0.4")', () => {
    expect(pyFormat04(1.0)).toBe('1.0');
    expect(pyFormat04(1.5)).toBe('1.5');
    expect(pyFormat04(2.3333333333333335)).toBe('2.333');
    expect(pyFormat04(3.6666666666666665)).toBe('3.667');
    expect(pyFormat04(999.9)).toBe('999.9');
    expect(pyFormat04(999.95)).toBe('1e+03'); // repr '999.95' rounds half-even
    expect(pyFormat04(1234.5)).toBe('1.234e+03');
    expect(pyFormat04(0.000123456)).toBe('0.0001235');
    expect(pyFormat04(1.23456e-5)).toBe('1.235e-05');
    expect(pyFormat04(0.0)).toBe('0.0');
  });

  it('exposes the Python usage text', () => {
    const help = strumpatternPlugin.help!();
    expect(help).toContain('Plugin @strumpattern');
    expect(help).toContain('Sets a strum pattern for Plectrum tracks.');
    expect(help).toContain('Track type must be Plectrum.');
    expect(help).toContain('downward strum');
  });
});

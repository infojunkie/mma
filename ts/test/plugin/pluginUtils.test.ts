/**
 * pluginUtils tests (port of MMA/pluginUtils.py): declared arguments,
 * command-line parsing, track-type checks, the version check, the
 * command queue and the usage-text builder.
 */
import { describe, expect, it, vi } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import type { PluginContext } from '../../src/plugin/IMMAPlugin';
import { PluginSpec } from '../../src/plugin/pluginUtils';

function makeCtx(): MMAContext {
  return new MMAContext({ seed: 1 });
}

function fakePctx(): { pctx: PluginContext; pushed: string[][] } {
  const pushed: string[][] = [];
  const pctx = {
    pushTokens: (tokens: string[][]) => {
      pushed.push(...tokens);
    },
  } as unknown as PluginContext;
  return { pctx, pushed };
}

function makeSpec(): PluginSpec {
  const pu = new PluginSpec('demo');
  pu.setDescription('A demo plugin.');
  pu.setAuthor('Written by Tester.');
  pu.addArgument('Groove', null, 'Groove to define.');
  pu.addArgument('Seq', null, 'Sequence tab.');
  pu.addArgument('Bpm', '4', 'Beats per bar.');
  return pu;
}

describe('pluginUtils', () => {
  it('parses comma-separated positional arguments and applies defaults', () => {
    const pu = makeSpec();
    const ctx = makeCtx();
    expect(pu.parseCommandLine(ctx, ['Rock,', 'Kick |8|'])).toEqual({
      Groove: 'Rock',
      Seq: 'Kick |8|',
      Bpm: '4',
    });
  });

  it('parses name=value arguments, with or without spaces', () => {
    const pu = makeSpec();
    const ctx = makeCtx();
    expect(pu.parseCommandLine(ctx, ['Groove=Rock,', 'Seq=Kick |8|,', 'Bpm=3'])).toEqual({
      Groove: 'Rock',
      Seq: 'Kick |8|',
      Bpm: '3',
    });
    expect(pu.parseCommandLine(ctx, ['Groove = Rock,', 'Seq = X,', 'Bpm = 3'])).toEqual({
      Groove: 'Rock',
      Seq: 'X',
      Bpm: '3',
    });
  });

  it('reports unknown names with the Python text', () => {
    const pu = makeSpec();
    expect(() => pu.parseCommandLine(makeCtx(), ['Bogus=1'])).toThrowError(
      'Plugin @demo: unexpected argument name Bogus.',
    );
  });

  it('upper-cases unknown names when allowUnknown is set', () => {
    const pu = makeSpec();
    const res = pu.parseCommandLine(makeCtx(), ['Rock,', 'Tabs,', 'Bogus=1'], true);
    expect(res['BOGUS']).toBe('1');
  });

  it('rejects positional after named and excess positionals', () => {
    const pu = makeSpec();
    expect(() => pu.parseCommandLine(makeCtx(), ['Groove=Rock,', 'Seq'])).toThrowError(
      'Plugin @demo: positional argument after named argument is not allowed.',
    );
    expect(() => pu.parseCommandLine(makeCtx(), ['a,b,c,d'])).toThrowError(
      'Plugin @demo: unexpected argument provided (d).',
    );
  });

  it('prints the usage and errors for a missing value', () => {
    const pu = makeSpec();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => pu.parseCommandLine(makeCtx(), ['Rock,'])).toThrowError(
      'Plugin @demo: no value for argument Seq.',
    );
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain('Plugin @demo');
    log.mockRestore();
  });

  it('checks track types', () => {
    const pu = makeSpec();
    pu.setTrackType('Solo');
    const ctx = makeCtx();
    expect(() => pu.checkTrackType(ctx, 'SOLO-FOO')).not.toThrow();
    expect(() => pu.checkTrackType(ctx, 'Solo')).not.toThrow();
    expect(() => pu.checkTrackType(ctx, 'BASS')).toThrowError(
      'Plugin @demo: track type must be Solo.',
    );

    pu.setTrackType('Bass', 'Walk');
    expect(() => pu.checkTrackType(ctx, 'Bass-Foo')).not.toThrow();
    expect(() => pu.checkTrackType(ctx, 'DRUM')).toThrowError(
      'Plugin @demo: track type must be one of Bass or Walk.',
    );
    expect(pu.getTrackType('BASS-FOO')).toBe('BASS');
  });

  it('checks the minimum MMA version', () => {
    const pu = makeSpec();
    const ctx = makeCtx();
    expect(() => pu.setMinMMAVersion(ctx, 15, 12)).not.toThrow();
    expect(() => pu.setMinMMAVersion(ctx, 25, 5)).not.toThrow(); // 25.05.3
    expect(() => pu.setMinMMAVersion(ctx, 99, 0)).toThrowError(
      'Plugin requires MMA version 99.00 or newer.',
    );
    expect(() => pu.setMinMMAVersion(ctx, 25, 6)).toThrowError(
      'Plugin requires MMA version 25.06 or newer.',
    );
  });

  it('queues commands and sends them tokenized', () => {
    const pu = makeSpec();
    const { pctx, pushed } = fakePctx();
    pu.addCommand('One two  three');
    pu.addCommand(['Three four']);
    pu.sendCommands(pctx);
    expect(pushed).toEqual([
      ['One', 'two', 'three'],
      ['Three', 'four'],
    ]);
    expect(pu.commands).toEqual([]); // queue is cleared
  });

  it('builds the Python usage text', () => {
    const pu = makeSpec();
    pu.setPluginDoc('Doc for %NAME%.\nSecond line.');
    pu.setTrackType('Drum');
    const text = pu.printUsage();
    const lines = text.split('\n');
    const trimmed = lines.map((l) => l.trim());
    expect(lines[0]).toBe('Plugin @demo');
    expect(lines[1]).toBe('Written by Tester.');
    expect(trimmed).toContain('A demo plugin.');
    expect(trimmed).toContain('SYNOPSIS');
    expect(trimmed).toContain('Track @demo Groove, Seq, Bpm');
    expect(trimmed).toContain('Track type must be Drum.');
    expect(trimmed).toContain('ARGUMENTS');
    expect(trimmed).toContain('Groove');
    expect(trimmed).toContain('Seq');
    expect(trimmed).toContain('Bpm (default: 4)');
    expect(trimmed).toContain('You can also use name=value syntax, like Call (see MMA documents).');
    expect(trimmed).toContain('Doc for @demo.');
    expect(trimmed).toContain('Second line.');
    // Argument docs and the name=value note are indented.
    expect(lines).toContain('    You can also use name=value syntax, like Call (see MMA documents).');
  });

  it('uses the synopsis verbatim when set', () => {
    const pu = makeSpec();
    pu.setSynopsis('@demo Foo, Bar');
    const text = pu.printUsage();
    expect(text).toContain('@demo Foo, Bar');
    expect(text).not.toContain('Track @demo Groove');
  });
});

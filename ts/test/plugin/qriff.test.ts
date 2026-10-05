/**
 * qriff plugin tests (port of plugins/qriff/plugin.py): the three riff
 * lines it queues and the -qFlat/-qSharp helper tracks it allocates.
 * The shipped plugins/qriff/test.mma is also part of the conformance
 * corpus (Python-generated golden fixture "plugin-qriff").
 */
import { describe, expect, it } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { trackAlloc } from '../../src/parse/TrackAlloc';
import '../../src/model/tracks/index'; // side effect: register track classes
import type { PluginContext } from '../../src/plugin/IMMAPlugin';
import { createPluginContext, type PluginContextHost } from '../../src/plugin/PluginContext';
import { createQriffPlugin, qriffPlugin, QriffPlugin } from '../../plugins/qriff';

function setup(): { ctx: MMAContext; pushed: string[][]; pctx: PluginContext; plugin: QriffPlugin } {
  const ctx = new MMAContext({ seed: 1 });
  trackAlloc(ctx, 'SOLO', true);
  const pushed: string[][] = [];
  const plugin = createQriffPlugin();
  const host: PluginContextHost = {
    pushTokens: (tokens) => {
      pushed.push(...tokens);
    },
    getVar: () => {
      throw new Error('qriff does not use variables');
    },
    ensureTrack: (name) => {
      trackAlloc(ctx, name, false);
    },
  };
  return { ctx, pushed, pctx: createPluginContext(plugin, ctx, host), plugin };
}

describe('qriff plugin', () => {
  it('splits a quarter-tone riff into normal/flat/sharp lines', () => {
    const { ctx, pushed, pctx, plugin } = setup();
    plugin.trackRun('SOLO', ['4a;a*;a#;a#*;'], pctx);

    expect(pushed).toEqual([
      // The generated helper tracks and their pitch-band setup.
      ['SOLO-qFlat', 'Copy', 'SOLO'],
      ['SOLO-qSharp', 'Copy', 'SOLO'],
      ['SOLO-qFlat', 'MidiNote', 'PB', '0', '-2048'],
      ['SOLO-qSharp', 'MidiNote', 'PB', '0', '2048'],
      ['After', 'Bar=EOF', 'SOLO-qFlat', 'MidiNote', 'PB', '0', '0'],
      ['After', 'Bar=EOF', 'SOLO-qSharp', 'MidiNote', 'PB', '0', '0'],
      ['SOLO', 'Riff', '4a;r;a#;r;'],
      ['SOLO-qFlat', 'Riff', '4r;r;r;r;'],
      ['SOLO-qSharp', 'Riff', '4r;a;r;a#;'],
    ]);
    // ensureTrack created the exact-case helper tracks (as Python does).
    expect(ctx.tnames.has('SOLO-qFlat')).toBe(true);
    expect(ctx.tnames.has('SOLO-qSharp')).toBe(true);
  });

  it('only emits the riff lines on later calls', () => {
    const { pushed, pctx, plugin } = setup();
    plugin.trackRun('SOLO', ['4a;'], pctx);
    pushed.length = 0;
    plugin.trackRun('SOLO', ['8b%;'], pctx);
    expect(pushed).toEqual([
      ['SOLO', 'Riff', '8r;'],
      ['SOLO-qFlat', 'Riff', '8b;'],
      ['SOLO-qSharp', 'Riff', '8r;'],
    ]);
  });

  it('checks the track type', () => {
    const { ctx, pctx, plugin } = setup();
    trackAlloc(ctx, 'BASS', true);
    expect(() => plugin.trackRun('BASS', ['4a;'], pctx)).toThrowError(
      'Plugin @qriff: track type must be Solo.',
    );
  });

  it('exposes the Python usage text', () => {
    const help = qriffPlugin.help!();
    expect(help).toContain('Plugin @qriff');
    expect(help).toContain('Separate quarter tone solo riff lines into 3 parts.');
    expect(help).toContain('Track type must be Solo.');
    expect(help).toContain('QRiff ... convert a solo line into quarter tones.');
  });
});

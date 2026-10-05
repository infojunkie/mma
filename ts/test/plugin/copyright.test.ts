/**
 * copyright plugin tests (port of plugins/copyright/plugin.py):
 * argument parsing and the MidiCopyright command it queues.  The render
 * is also covered by the Python-generated golden fixture
 * "feature-copyright".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { MemoryResources } from '../../src/io/MMAResources';
import { Parser } from '../../src/parse/Parser';
import { copyrightPlugin } from '../../plugins/copyright';

function makeCtx(song: string): MMAContext {
  const ctx = new MMAContext({ seed: 42, plugins: [copyrightPlugin] });
  ctx.resources = new MemoryResources({ 'song.mma': song });
  return ctx;
}

async function parse(song: string): Promise<MMAContext> {
  const ctx = makeCtx(song);
  await new Parser(ctx).parseFile('song.mma');
  return ctx;
}

/** Decoded text of all events in the meta track (latin1 is enough here). */
function metaEvents(ctx: MMAContext): string[] {
  const out: string[] = [];
  for (const events of ctx.metaTrack().miditrk.values()) {
    for (const ev of events) out.push(new TextDecoder('latin1').decode(ev));
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('copyright plugin', () => {
  it('queues MidiCopyright from name=value arguments', async () => {
    const ctx = await parse('Time 4\nPlugin copyright\n@copyright Year=2024, Author=Jane\nC\n');
    expect(metaEvents(ctx).some((e) => e.includes('(C) 2024 Jane'))).toBe(true);
  });

  it('uses the declared defaults (author and the current year)', async () => {
    const ctx = await parse('Time 4\nPlugin copyright\n@copyright\nC\n');
    const year = String(new Date().getFullYear());
    expect(metaEvents(ctx).some((e) => e.includes(`(C) ${year} Johan Vromans`))).toBe(true);
  });

  it('reports argument errors with the Python texts', async () => {
    await expect(parse('Plugin copyright\n@copyright Bogus=1\n')).rejects.toThrowError(
      'Plugin @copyright: unexpected argument name Bogus.',
    );
    await expect(parse('Plugin copyright\n@copyright Author=Jane, 2024\n')).rejects.toThrowError(
      'Plugin @copyright: positional argument after named argument is not allowed.',
    );
  });

  it('exposes a usage text built by pluginUtils', () => {
    const help = copyrightPlugin.help!();
    expect(help).toContain('Plugin @copyright');
    expect(help).toContain('Adds a copyright notice to the MIDI.');
    expect(help).toContain('Author (default: Johan Vromans)');
    expect(help).toContain('Year (default:');
  });
});

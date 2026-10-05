/**
 * AFTER directive tests (port of MMA/after.py).
 *
 * The event-level results are covered by the Python-generated golden
 * fixture test/api/conformance.test.ts ("feature-after"); these unit
 * tests pin the triggers, the queueing semantics and the exact error
 * texts, which were verified against the reference implementation.
 *
 * Note the upstream quirk replicated here: after.py assigns `dat.bar`
 * inside the `if opt < 1:` error branch, so `Bar=<n>` events are stored
 * with bar=None and never fire ("feature-after" pins this too).
 */
import { describe, expect, it, vi } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { MemoryResources } from '../../src/io/MMAResources';
import { Parser } from '../../src/parse/Parser';

function makeCtx(song: string): MMAContext {
  const ctx = new MMAContext({ seed: 42 });
  ctx.resources = new MemoryResources({ 'song.mma': song });
  return ctx;
}

async function parse(song: string): Promise<MMAContext> {
  const ctx = makeCtx(song);
  await new Parser(ctx).parseFile('song.mma');
  return ctx;
}

describe('AFTER directive', () => {
  it('Count= queues a command for a later bar', async () => {
    const ctx = await parse('Time 4\nAfter Count=2 Volume FF\nC\nC\nC\n');
    expect(ctx.volume.volume).toBe(1.6); // FF applied before bar 3
    expect(ctx.barNum).toBe(3);
  });

  it('Repeat= re-fires at the given interval until removed', async () => {
    const fired = await parse('Time 4\nAfter Repeat=2 Id=X Volume FF\nC\nC\nC\n');
    expect(fired.volume.volume).toBe(1.6);

    const removed = await parse(
      'Time 4\nAfter Repeat=2 Id=X Volume FF\nC\nAfter Remove=X\nC\nC\nC\n',
    );
    expect(removed.volume.volume).toBe(1.0); // removed before bar 2
    expect(removed.rep.warnings).toEqual([]);
  });

  it('Bar=EOF appends the command to the end of the file', async () => {
    const ctx = await parse('Time 4\nAfter Bar=EOF Volume FF\nC\n');
    expect(ctx.volume.volume).toBe(1.6);
  });

  it('Bar=<n> is inert (upstream after.py bug)', async () => {
    const ctx = await parse('Time 4\nAfter Bar=2 Volume FF\nC\nC\nC\n');
    expect(ctx.volume.volume).toBe(1.0);
  });

  it('check(recurse=True) executes Repeat/Count events inside a * repeat', async () => {
    const ctx = makeCtx('Time 4\nAfter Count=2 Volume FF\nC * 3\n');
    const parser = new Parser(ctx);
    const spy = vi.spyOn(parser, 'parseText');
    await parser.parseFile('song.mma');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe('Volume FF');
    expect(ctx.volume.volume).toBe(1.6);
    expect(ctx.barNum).toBe(3);
  });

  it('Remove deletes matching events and warns when none are found', async () => {
    const ctx = await parse('Time 4\nAfter Remove=NOPE Count=1 Foo\nC\n');
    expect(ctx.rep.warnings.map((w) => w.message)).toEqual([
      'After: Remove is ignoring other options/cmds in line.',
      'After: No events with ID=NOPE found to delete.',
    ]);
  });

  it('reports the Python error texts', async () => {
    await expect(parse('After Bar=0 Foo\n')).rejects.toThrowError(
      "After: Destination bar must be positive, not '0'.",
    );
    await expect(parse('After Repeat=0 Foo\n')).rejects.toThrowError(
      "After: Repeat value must be positive, not '0'.",
    );
    await expect(parse('After Count=0 Foo\n')).rejects.toThrowError(
      "After: Count must be positive, not '0'.",
    );
    await expect(parse('After Baz=1 Foo\n')).rejects.toThrowError(
      "After: Unknown option 'BAZ'.",
    );
    await expect(parse('After Count=1\n')).rejects.toThrowError(
      "After: No command given. It's needed.",
    );
    await expect(parse('After Print Testing\n')).rejects.toThrowError(
      "After: need one of 'Count', 'Bar', or 'Repeat'. Options must be listed before the command!",
    );
    await expect(parse('After Print Testing Repeat=1\n')).rejects.toThrowError(
      "After: need one of 'Count', 'Bar', or 'Repeat'. Options must be listed before the command!",
    );
    await expect(parse('After Bar=1 Count=1 Print x\n')).rejects.toThrowError(
      "After: Options conflict; can't combine Bar & Count.",
    );
  });
});

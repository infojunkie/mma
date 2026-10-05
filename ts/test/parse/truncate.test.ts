/**
 * TRUNCATE directive tests (port of MMA/truncate.py).
 *
 * The event-level results are covered by the Python-generated golden
 * fixture test/api/conformance.test.ts ("feature-truncate"); these unit
 * tests pin the parser state, the option handling and the exact error
 * texts, which were verified against the reference implementation.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { MemoryResources } from '../../src/io/MMAResources';
import { Parser } from '../../src/parse/Parser';
import { countDown, setTruncate } from '../../src/model/features/Truncate';
import { trackHooks } from '../../src/model/tracks/hooks';

function makeCtx(files: Record<string, string>, options: ConstructorParameters<typeof MMAContext>[0] = {}): MMAContext {
  const ctx = new MMAContext({ seed: 42, ...options });
  ctx.resources = new MemoryResources(files);
  return ctx;
}

async function parse(song: string): Promise<MMAContext> {
  const ctx = makeCtx({ 'song.mma': song });
  await new Parser(ctx).parseFile('song.mma');
  return ctx;
}

beforeEach(() => {
  // The truncate state is shared with the track layer (as in Python's
  // module globals); reset it so tests stay independent.
  trackHooks.truncate = { length: 0, side: 0, count: null };
});

describe('TRUNCATE directive', () => {
  it('shortens the bar and counts down', async () => {
    const ctx = await parse('Time 4\nC\nTruncate 2\nC\nC\n');
    expect(ctx.tickOffset).toBe(768 + 384 + 768);
    expect(ctx.barPtrs.get(1)).toEqual(['', 0, 767]);
    expect(ctx.barPtrs.get(2)).toEqual(['', 768, 1151]);
    expect(ctx.barPtrs.get(3)).toEqual(['', 1152, 1919]);
    expect(trackHooks.truncate.length).toBe(0); // cleared after use
  });

  it('honours Count= for several bars', async () => {
    const ctx = await parse('Time 4\nTruncate 2 Count=2\nC\nC\nC\n');
    expect(ctx.tickOffset).toBe(384 + 384 + 768);
    expect(trackHooks.truncate.length).toBe(0);
  });

  it('sets side from Left/Right and a numeric beat', () => {
    const ctx = makeCtx({});

    setTruncate(ctx, ['2']);
    expect(trackHooks.truncate).toEqual({ length: 384, side: 0, count: 1 });

    setTruncate(ctx, ['2', 'Side=Right']);
    expect(trackHooks.truncate.side).toBe(768 - 384);

    setTruncate(ctx, ['2', 'Side=Left']);
    expect(trackHooks.truncate.side).toBe(0);

    setTruncate(ctx, ['1', 'Side=3']);
    expect(trackHooks.truncate.side).toBe(2 * 192);

    setTruncate(ctx, ['1', 'side=3.5']);
    expect(trackHooks.truncate.side).toBe(Math.trunc(2.5 * 192));
  });

  it('supports fractional beats and truncates to ticks', () => {
    const ctx = makeCtx({});
    setTruncate(ctx, ['1.5']);
    expect(trackHooks.truncate.length).toBe(288);
  });

  it('countDown clears the state when the count reaches zero', () => {
    const ctx = makeCtx({});
    setTruncate(ctx, ['2', 'Count=2']);
    countDown();
    expect(trackHooks.truncate.length).toBe(384);
    countDown();
    expect(trackHooks.truncate).toEqual({ length: 0, side: 0, count: null });
  });

  it('warns when a setting is still pending', () => {
    const ctx = makeCtx({});
    setTruncate(ctx, ['2']);
    setTruncate(ctx, ['1']);
    expect(ctx.rep.warnings.map((w) => w.message)).toContain(
      'Truncate: option set with value pending, previous setting discarded.',
    );
  });

  it('reports the Python error texts', () => {
    const ctx = makeCtx({});
    expect(() => setTruncate(ctx, [])).toThrowError(
      'Truncate: Beats must be set. Syntax is <beats> [option=value]',
    );
    expect(() => setTruncate(ctx, ['2', '3'])).toThrowError(
      'Truncate: Beats must be set. Syntax is <beats> [option=value]',
    );
    expect(() => setTruncate(ctx, ['0'])).toThrowError(
      "Truncate: Range must be >0 and <=4, not '0.0'.",
    );
    expect(() => setTruncate(ctx, ['4'])).toThrowError(
      "Truncate: Range must be >0 and <=4, not '4.0'.",
    );
    expect(() => setTruncate(ctx, ['x'])).toThrowError('Truncate: Bar length must be value.');
    expect(() => setTruncate(ctx, ['2', 'Count=0'])).toThrowError(
      'Truncate: Bar COUNT must be 1 or greater.',
    );
    expect(() => setTruncate(ctx, ['2', 'Count=x'])).toThrowError(
      'Truncate: Bar COUNT must be integer.',
    );
    expect(() => setTruncate(ctx, ['2', 'Side=abc'])).toThrowError(
      "Truncate: Expecting value, not 'ABC'.",
    );
    expect(() => setTruncate(ctx, ['2', 'Side=5'])).toThrowError(
      "Truncate: Side value of '5' too large.",
    );
    expect(() => setTruncate(ctx, ['2', 'Foo=1'])).toThrowError(
      "Truncate: 'FOO' is an unknown option.",
    );
  });

  it('range-checks against the current TIME', () => {
    const ctx = makeCtx({});
    ctx.QperBar = 3;
    expect(() => setTruncate(ctx, ['3'])).toThrowError(
      "Truncate: Range must be >0 and <=3, not '3.0'.",
    );
    setTruncate(ctx, ['2.5']);
    expect(trackHooks.truncate.length).toBe(480);
  });
});

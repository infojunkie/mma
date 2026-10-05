/**
 * TWEAKS directive tests (port of MMA/tweaks.py).  The per-run defaults
 * live in the model/tracks/Defaults state table; the fixture
 * ts/test/fixtures/features/tweaks.mma is also part of the conformance
 * corpus (Python-generated golden fixture "feature-tweaks").
 */
import { describe, expect, it } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { MemoryResources } from '../../src/io/MMAResources';
import { Parser } from '../../src/parse/Parser';
import { trackAlloc } from '../../src/parse/TrackAlloc';
import { DRUM_KITS_BY_NAME } from '../../src/midi/voices';
import { trackDefaults } from '../../src/model/tracks/Defaults';

function setup(): { ctx: MMAContext; parser: Parser } {
  const ctx = new MMAContext({ seed: 7 });
  ctx.resources = new MemoryResources();
  const parser = new Parser(ctx);
  return { ctx, parser };
}

function tweaks(parser: Parser): (ctx: MMAContext, args: string[]) => void {
  const h = parser.registry.simple.get('TWEAKS');
  if (!h) throw new Error('missing TWEAKS handler');
  return h as (ctx: MMAContext, args: string[]) => void;
}

describe('TWEAKS directive', () => {
  it('sets the default voice used by newly allocated tracks', () => {
    const { ctx, parser } = setup();
    tweaks(parser)(ctx, ['DefaultVoice=Flute']);
    expect(trackDefaults(ctx).defaultVoice).toBe(73);

    const bass = trackAlloc(ctx, 'BASS', true)!;
    expect(bass.voice).toEqual([73]);
  });

  it('sets the default drum kit/tone (DefaultDrum and DefaultTone)', () => {
    const { ctx, parser } = setup();
    // decodeVoice() rejects drum tone names (as Python does), so the tone
    // is given as a number.
    tweaks(parser)(ctx, ['DefaultTone=38']);
    expect(trackDefaults(ctx).defaultDrum).toBe(38);

    tweaks(parser)(ctx, ['DefaultDrum=8.9.22']);
    const drum = trackAlloc(ctx, 'DRUM', true)!;
    expect(trackDefaults(ctx).defaultDrum).toBe((22 << 16) + (9 << 8) + 8);
    expect(drum.voice).toEqual([(22 << 16) + (9 << 8) + 8]);
  });

  it('sets DrumKit by name (with optional KIT suffix) or number', () => {
    const { ctx, parser } = setup();
    tweaks(parser)(ctx, ['DrumKit=JazzKit']);
    expect(trackDefaults(ctx).defaultDrum).toBe(DRUM_KITS_BY_NAME['JAZZ']);

    tweaks(parser)(ctx, ['DrumKit=Rock']);
    expect(trackDefaults(ctx).defaultDrum).toBe(DRUM_KITS_BY_NAME['ROCK']);

    tweaks(parser)(ctx, ['DrumKit=25']);
    expect(trackDefaults(ctx).defaultDrum).toBe(25);

    expect(() => tweaks(parser)(ctx, ['DrumKit=200'])).toThrowError(
      "Tweaks DrumKit: value must be 0..127 not '200'.",
    );
  });

  it('redefines the dim chord from dim3 (Dim=3) and dim7 (Dim=7)', () => {
    const { ctx, parser } = setup();
    const dim3 = ctx.chordList.get('dim3')!;

    tweaks(parser)(ctx, ['Dim=3']);
    const dim = ctx.chordList.get('dim')!;
    expect(dim.notes).toEqual(dim3.notes);
    expect(dim.scale).toEqual(dim3.scale);
    expect(dim.description).toBe('Diminished triad');

    const dim7 = ctx.chordList.get('dim7')!;
    const dim7Copy = { ...dim7, notes: [...dim7.notes], scale: [...dim7.scale] };
    tweaks(parser)(ctx, ['Dim=7']);
    const dimAgain = ctx.chordList.get('dim')!;
    expect(dimAgain.notes).toEqual(dim7.notes);
    expect(dimAgain.description).toBe(dim7.description);
    // The source definition is untouched (Python deepcopies).
    expect(ctx.chordList.get('dim7')).toEqual(dim7Copy);

    expect(() => tweaks(parser)(ctx, ['Dim=5'])).toThrowError(
      "Tweaks: DIM requires '3' or '7' arg, not '5'.",
    );
  });

  it('sets the plectrum groove-reset flag (PlectrumReset)', () => {
    const { ctx, parser } = setup();
    expect(trackDefaults(ctx).plectrumReset).toBe(false);

    tweaks(parser)(ctx, ['PlectrumReset=True']);
    expect(trackDefaults(ctx).plectrumReset).toBe(true);
    tweaks(parser)(ctx, ['PlectrumReset=Off']);
    expect(trackDefaults(ctx).plectrumReset).toBe(false);

    expect(() => tweaks(parser)(ctx, ['PlectrumReset=maybe'])).toThrowError(
      "Tweaks PlectrumReset: Requires True or False, not 'MAYBE'.",
    );
  });

  it('rejects unknown commands and non-pair arguments', () => {
    const { ctx, parser } = setup();
    expect(() => tweaks(parser)(ctx, ['Nope=1'])).toThrowError(
      "Tweaks: 'NOPE' unknown command.",
    );
    expect(() => tweaks(parser)(ctx, ['Foo'])).toThrowError(
      "Tweaks: expecting cmd=opt pairs, not 'Foo'.",
    );
  });
});

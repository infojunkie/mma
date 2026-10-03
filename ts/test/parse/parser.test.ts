import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { MemoryResources } from '../../src/io/MMAResources';
import { Parser } from '../../src/parse/Parser';
import { registerTrackType } from '../../src/parse/TrackAlloc';
import { BaseTrack } from '../../src/model/tracks/BaseTrack';

function makeCtx(files: Record<string, string>, options: ConstructorParameters<typeof MMAContext>[0] = {}): MMAContext {
  const ctx = new MMAContext({ seed: 42, ...options });
  ctx.resources = new MemoryResources(files);
  return ctx;
}

const SONG = `
Time 4
Tempo 120
KeySig C
Begin Chord Define
  P1 1 1 90
End
Chord Sequence P1
1 C
2 G * 2
4 F
`;

describe('Parser main loop', () => {
  it('parses a small song and does the bar bookkeeping', async () => {
    const ctx = makeCtx({ 'song.mma': SONG });
    ctx.debug.printProcessed = true;
    await new Parser(ctx).parseFile('song.mma');

    expect(ctx.barNum).toBe(4);
    expect(ctx.tickOffset).toBe(4 * 768);
    expect(ctx.totTime).toBeCloseTo((4 * (768 / 192)) / 120, 10);
    expect(ctx.barPtrs.get(1)).toEqual(['1', 0, 767]);
    expect(ctx.barPtrs.get(2)).toEqual(['2', 768, 1535]);
    expect(ctx.barPtrs.get(3)).toEqual(['2', 1536, 2303]);
    expect(ctx.barPtrs.get(4)).toEqual(['4', 2304, 3071]);
    expect(ctx.barLabels).toEqual(['1', '2', '2', '4']);

    // The chord track must have produced notes in the MIDI document.
    const { total, perChannel } = ctx.mtrks.eventCount();
    expect(total).toBeGreaterThan(0);
    expect(perChannel.length).toBeGreaterThan(0);
  });

  it('honours the max-bars limit with the Python message', async () => {
    const ctx = makeCtx({ 'song.mma': 'C\nG\nF\n' }, { maxBars: 2 });
    await expect(new Parser(ctx).parseFile('song.mma')).rejects.toThrowError(
      'Capacity exceeded. Maxbar setting is 2. Use -m option',
    );
  });

  it('keeps time/tick state through a TIME change', async () => {
    const ctx = makeCtx({ 'song.mma': 'Time 3/4\nC\n' });
    await new Parser(ctx).parseFile('song.mma');
    expect(ctx.QperBar).toBe(3);
    expect(ctx.barLen).toBe(576);
    expect(ctx.chordTabs).toEqual([0, 192, 384]);
    expect(ctx.tickOffset).toBe(576);
    expect(ctx.timeSig.getAscii()).toBe('3/4');
  });

  it('notes the bar label on repeated bars and resets it otherwise', async () => {
    const ctx = makeCtx({ 'song.mma': '7 C * 2\nC\n' });
    ctx.debug.printProcessed = true;
    await new Parser(ctx).parseFile('song.mma');
    expect(ctx.barLabels).toEqual(['7', '7', '?']);
  });

  it('strips leading zeros from a bar-number label', async () => {
    const ctx = makeCtx({ 'song.mma': '007 C\n' });
    ctx.debug.printProcessed = true;
    await new Parser(ctx).parseFile('song.mma');
    expect(ctx.barLabels).toEqual(['7']);
  });

  it('ignores a bare bar number line', async () => {
    const ctx = makeCtx({ 'song.mma': '1\nC\n' });
    await new Parser(ctx).parseFile('song.mma');
    expect(ctx.barNum).toBe(1);
  });
});

describe('Parser error messages', () => {
  it('rejects an unknown chord name via the chord parser', async () => {
    const ctx = makeCtx({ 'song.mma': 'Zork\n' });
    await expect(new Parser(ctx).parseFile('song.mma')).rejects.toThrowError(
      "Illegal/Unknown chord name: 'Zork'",
    );
  });

  it('rejects an unknown track function', async () => {
    const ctx = makeCtx({ 'song.mma': 'Chord Zork\n' });
    await expect(new Parser(ctx).parseFile('song.mma')).rejects.toThrowError(
      'ZORK is not a CHORD track function.',
    );
  });

  it('rejects a simple command used in the track form', async () => {
    const ctx = makeCtx({ 'song.mma': 'Chord Time 4\n' });
    await expect(new Parser(ctx).parseFile('song.mma')).rejects.toThrowError(
      'TIME is not a track function. Use global form.',
    );
  });

  it('requires an argument after a track name', async () => {
    const ctx = makeCtx({ 'song.mma': 'Chord\n' });
    await expect(new Parser(ctx).parseFile('song.mma')).rejects.toThrowError("Expecting argument after 'CHORD'");
  });

  it('reports unknown data plugins', async () => {
    const ctx = makeCtx({ 'song.mma': '@1 C\n' });
    await expect(new Parser(ctx).parseFile('song.mma')).rejects.toThrowError(
      "Unknown data plugin '@1' called.",
    );
  });

  it('defers solo data with a clear message', async () => {
    const ctx = makeCtx({ 'song.mma': 'C {1 4 60 90}\n' });
    await expect(new Parser(ctx).parseFile('song.mma')).rejects.toThrowError(/Solo data .* not implemented/);
  });

  it('defers lyrics with a clear message', async () => {
    const ctx = makeCtx({ 'song.mma': 'C [hello]\n' });
    await expect(new Parser(ctx).parseFile('song.mma')).rejects.toThrowError(/Lyrics .* not implemented/);
  });

  it('reports unported M1 directives instead of silently ignoring them', async () => {
    const ctx = makeCtx({ 'song.mma': 'After 5\n' });
    await expect(new Parser(ctx).parseFile('song.mma')).rejects.toThrowError(
      'AFTER is not implemented in this milestone (M1).',
    );

    const ctx2 = makeCtx({ 'song.mma': 'Chord Riff B1\n' });
    await expect(new Parser(ctx2).parseFile('song.mma')).rejects.toThrowError(
      'RIFF is not implemented in this milestone (M1).',
    );
  });

  it('reports END without BEGIN', async () => {
    const ctx = makeCtx({ 'song.mma': 'End\n' });
    await expect(new Parser(ctx).parseFile('song.mma')).rejects.toThrowError("No 'BEGIN' for 'END'");
  });

  it('reports BEGIN without arguments', async () => {
    const ctx = makeCtx({ 'song.mma': 'Begin\n' });
    await expect(new Parser(ctx).parseFile('song.mma')).rejects.toThrowError('Use: Begin STUFF');
  });

  it('reports a missing include file', async () => {
    const ctx = makeCtx({ 'song.mma': 'Include nope\n' });
    await expect(new Parser(ctx).parseFile('song.mma')).rejects.toThrowError(
      "Could not find include file 'nope'",
    );
  });
});

describe('Parser file handling', () => {
  it('includes a file and restores the outer reader', async () => {
    const ctx = makeCtx({
      'song.mma': 'Include defs\nC\n',
      'includes/defs.mma': 'Set V 5\n',
    });
    const parser = new Parser(ctx);
    await parser.parseFile('song.mma');
    expect(ctx.barNum).toBe(1);
    expect(parser.expander.expand(['$V'])).toEqual(['5']);
  });

  it('uses a library file and restores the groove state', async () => {
    const ctx = makeCtx({
      'song.mma': 'Use stdpats\nC\n',
      'lib/stdlib/stdpats.mma': 'Begin Chord Define\n  PX 1 1 90\nEnd\n',
    });
    await new Parser(ctx).parseFile('song.mma');
    expect(ctx.barNum).toBe(1);
    expect(ctx.pats.has('CHORD', 'PX')).toBe(true);
  });

  it('defines and selects a groove', async () => {
    const ctx = makeCtx({
      'song.mma': `
Set V 1
DefGroove G1
Set V 2
Groove G1
`.replace(/Set V 2\n/, 'Set V 2\n'),
    });
    await new Parser(ctx).parseFile('song.mma');
    expect(ctx.grooves.currentGroove).toBe('G1');
    expect(ctx.grooves.lastGroove).toBe('G1');
  });

  it('errors on Include/Use inside a Begin block', async () => {
    // With beginData[0] == INCLUDE the line dispatches to the Include
    // handler, which rejects being inside a Begin block (as in Python).
    const ctx = makeCtx({ 'song.mma': 'Begin Include\nC\n' });
    await expect(new Parser(ctx).parseFile('song.mma')).rejects.toThrowError(
      'INCLUDE not permitted in Begin/End block',
    );

    const ctx2 = makeCtx({ 'song.mma': 'Begin Use\nC\n' });
    await expect(new Parser(ctx2).parseFile('song.mma')).rejects.toThrowError(
      'USE not permitted in Begin/End block',
    );
  });
});

describe('Parser parses a real stdlib patterns file', () => {
  it('parses includes/stdpats.mma (Begin/Define/Sequence/If)', async () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const text = readFileSync(`${here}../../../includes/stdpats.mma`, 'utf-8');

    // SCALE/ARPEGGIO/WALK/PLECTRUM are M2 track stubs in the track layer;
    // give them a pattern-only test class so the definitions can be stored.
    class PatternTrack extends BaseTrack {
      override definePattern(name: string, ln: string[]): void {
        this.ctx.pats.set(this.vtype, name.toUpperCase(), ln.join(' '));
      }
    }
    registerTrackType('SCALE', (ctx, name) => new PatternTrack(ctx, name, 'SCALE'));
    registerTrackType('ARPEGGIO', (ctx, name) => new PatternTrack(ctx, name, 'ARPEGGIO'));
    registerTrackType('WALK', (ctx, name) => new PatternTrack(ctx, name, 'WALK'));
    registerTrackType('PLECTRUM', (ctx, name) => new PatternTrack(ctx, name, 'PLECTRUM'));

    const ctx = makeCtx({ 'includes/stdpats.mma': text });
    await new Parser(ctx).parseFile('includes/stdpats.mma');

    expect(ctx.pats.has('DRUM', 'D1')).toBe(true);
    expect(ctx.pats.has('DRUM', 'D1234')).toBe(true);
    expect(ctx.pats.has('BASS', 'B1')).toBe(true);
    expect(ctx.pats.has('CHORD', 'C1234')).toBe(true);
    expect(ctx.pats.has('SCALE', 'SCALE')).toBe(true);
    expect(ctx.pats.has('ARPEGGIO', 'A1')).toBe(true);
    expect(ctx.pats.has('WALK', 'W1234')).toBe(true);
    // The final SwingMode restore must leave swing mode off again.
    expect((ctx.swingMode as { mode: number }).mode).toBe(0);
  });
});

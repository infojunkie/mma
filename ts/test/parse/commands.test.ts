/**
 * Parser-level tests for the commands added in this milestone:
 * DEFCALL/CALL (func.py), DELETE (parse.py), CUT (tempo.py), LYRIC SET
 * plus the $_LYRIC system variable and the leftover-lyrics warning.  The
 * happy paths for DefCall/Lyric are also covered byte-exactly by the
 * conformance corpus; these tests pin scoping, error messages and the
 * non-MIDI side effects.
 */

import { describe, expect, it } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { MemoryResources } from '../../src/io/MMAResources';
import { Parser } from '../../src/parse/Parser';

function makeCtx(files: Record<string, string>, options: ConstructorParameters<typeof MMAContext>[0] = {}): MMAContext {
  const ctx = new MMAContext({ seed: 42, ...options });
  ctx.resources = new MemoryResources(files);
  return ctx;
}

async function parseSong(text: string): Promise<{ ctx: MMAContext; parser: Parser }> {
  const ctx = makeCtx({ 'song.mma': text });
  const parser = new Parser(ctx);
  await parser.parseFile('song.mma');
  return { ctx, parser };
}

describe('DEFCALL / CALL', () => {
  it('binds positional, named and default parameters and restores locals', async () => {
    const { ctx, parser } = await parseSong(
      [
        'Set Outer keep',
        'DefCall F a, b=2',
        '  Set OutA $A',
        '  Set Outer changed',
        '  Set OutB $B',
        'EndDefCall',
        'Call F hello',
        '',
      ].join('\n'),
    );

    const exp = parser.expander;
    expect(exp.getVar('OUTA')).toBe('hello');
    expect(exp.getVar('OUTB')).toBe('2');
    // Only the params are localized; other variables keep body changes.
    expect(exp.getVar('OUTER')).toBe('changed');
    expect(exp.hasVar('A')).toBe(false);
    expect(exp.hasVar('B')).toBe(false);
  });

  it('uses a named default and DEFAULT declarations', async () => {
    const { parser } = await parseSong(
      [
        'DefCall F a, b',
        '  Default B fallback',
        '  Set OutA $A',
        '  Set OutB $B',
        'EndDefCall',
        'Call F one, two',
        'Call F one',
        'Call F b=named, a=other',
        '',
      ].join('\n'),
    );
    expect(parser.expander.getVar('OUTA')).toBe('other');
    expect(parser.expander.getVar('OUTB')).toBe('named');
  });

  it('nests calls and can call after a redefinition', async () => {
    const { parser } = await parseSong(
      [
        'DefCall Inner x',
        '  Set Acc $X',
        'EndDefCall',
        'DefCall Outer x',
        '  Call Inner $X',
        'EndDefCall',
        'Call Outer deep',
        'DefCall Outer x',
        '  Set Acc2 $X',
        'EndDefCall',
        'Call Outer again',
        '',
      ].join('\n'),
    );
    // The first body ran (ACC), then the redefined body (ACC2).
    expect(parser.expander.getVar('ACC')).toBe('deep');
    expect(parser.expander.getVar('ACC2')).toBe('again');
  });

  it('substitutes UNDEFINED for missing params and honours escaped commas', async () => {
    const { parser } = await parseSong(
      [
        'DefCall F a, b',
        '  Set OutA $A',
        '  Set OutB $B',
        'EndDefCall',
        'Call F one\\,two',
        '',
      ].join('\n'),
    );
    expect(parser.expander.getVar('OUTA')).toBe('one,two');
    expect(parser.expander.getVar('OUTB')).toBe('UNDEFINED');
  });

  it('exposes the feature track variables to macros', async () => {
    const { parser } = await parseSong('Begin Chord\n  Ornament Type=Grace\nEnd\nC\n');
    const exp = parser.expander;
    expect(exp.sysvar('CHORD_ORNAMENT')).toMatch(/^Type=GRACE /);
    expect(exp.sysvar('CHORD_RPITCH')).toBe('None');
    expect(exp.sysvar('CHORD_TRIGGER')).toMatch(/^ Beats=\[\] /);
    expect(exp.sysvar('CHORD_HARMONY')).toBe('None');
  });

  it('reports malformed definitions and calls', async () => {
    await expect(parseSong('DefCall\n')).rejects.toThrowError(/At least one argument/);
    await expect(parseSong('DefCall F$ x\nEndDefCall\n')).rejects.toThrowError(/\$' is not permitted in function name/);
    await expect(parseSong('DefCall F a\$\nEndDefCall\n')).rejects.toThrowError(/\$' is not permitted in paramater name/);
    await expect(parseSong('DefCall F a, a\nEndDefCall\n')).rejects.toThrowError(/duplicate paramater name/);
    await expect(parseSong('DefCall F\n')).rejects.toThrowError(/Reached EOF while looking for EndDefCall/);
    await expect(parseSong('DefCall F a\nEndDefCall\nCall G x\n')).rejects.toThrowError(
      /'G' has not been defined/,
    );
    await expect(parseSong('DefCall F a\nEndDefCall\nCall F c=1\n')).rejects.toThrowError(
      /'\$C' is not a param of 'F'/,
    );
    await expect(parseSong('DefCall F a, b\nEndDefCall\nCall F 1,2,3\n')).rejects.toThrowError(
      /needs 2 params, '3' given/,
    );
  });

  it('warns when a DEFAULT overrides a param-list default', async () => {
    const ctx = makeCtx({
      'song.mma': 'DefCall F a=1\nDefault A 2\nEndDefCall\n',
    });
    await new Parser(ctx).parseFile('song.mma');
    expect(ctx.rep.warnings.map((w) => w.message).join('\n')).toMatch(
      /default value '1' was set in param list\. Overriding with '2'/,
    );
  });
});

describe('DELETE', () => {
  it('frees the channel and removes the track', async () => {
    const ctx = makeCtx({
      'song.mma': [
        'Begin Chord Define',
        '  P1 1 4 90',
        'End',
        'Chord Sequence P1',
        '1 C',
        'Delete Chord',
        '',
      ].join('\n'),
    });
    await new Parser(ctx).parseFile('song.mma');

    expect(ctx.tnames.has('CHORD')).toBe(false);
    expect(ctx.deletedTracks).toContain('CHORD');
    // The auto-assigned channel was freed.
    expect(ctx.midiAvail.filter((n) => n > 0)).toEqual([]);
  });

  it('errors for unknown tracks and empty argument lists', async () => {
    await expect(parseSong('Delete Nope\n')).rejects.toThrowError(/Track 'NOPE' does not exist/);
    await expect(parseSong('Delete\n')).rejects.toThrowError(/Use Delete Track/);
  });
});

describe('CUT', () => {
  function allNotesOff(ctx: MMAContext): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const [ch, tr] of ctx.mtrks.tracks) {
      for (const [tick, evs] of tr.miditrk) {
        for (const e of evs) if ((e[0]! & 0xf0) === 0xb0 && e[1] === 0x7b) out.push([ch, tick]);
      }
    }
    return out;
  }

  const SONG_START = [
    'Begin Chord Define',
    '  P1 1 4 90',
    'End',
    'Chord Sequence P1',
    '1 C',
  ].join('\n');

  it('inserts an all-notes-off on every active channel', async () => {
    const ctx = makeCtx({ 'song.mma': `${SONG_START}\nCut 1\n` });
    await new Parser(ctx).parseFile('song.mma');
    // Bar 1 ends at tick 768; offset 1 beat -> tick 960.
    expect(allNotesOff(ctx)).toEqual([[16, 960]]);
  });

  it('accepts the track form and a negative offset', async () => {
    const ctx = makeCtx({ 'song.mma': `${SONG_START}\nChord Cut -1\n` });
    await new Parser(ctx).parseFile('song.mma');
    expect(allNotesOff(ctx)).toEqual([[16, 576]]);
  });

  it('rejects bad argument counts and offsets before the track start', async () => {
    await expect(parseSong('Cut 1 2\n')).rejects.toThrowError(/Expecting single offset/);
    await expect(
      parseSong(`${SONG_START}\nBeatAdjust -2000\nCut 0\n`),
    ).rejects.toThrowError(/Offset comes before start of track/);
  });
});

describe('LYRIC SET and $_LYRIC', () => {
  it('exposes the setting through the system variable', async () => {
    const { parser } = await parseSong('Lyric Verse=4 Chords=On\n');
    expect(parser.expander.sysvar('LYRIC')).toBe(
      'Event=Lyric Split=Normal Verse=4 Chords=On Transpose=0 CNames=Flat KAR=Off',
    );
    expect(parser.expander.sysvar('LYRIC')).toBe(
      'Event=Lyric Split=Normal Verse=4 Chords=On Transpose=0 CNames=Flat KAR=Off',
    );
  });

  it('feeds pushed SET lyrics into the next data line', async () => {
    const ctx = makeCtx({
      'song.mma': 'Begin Lyric Set\n  [one two]\n  [three four]\nEnd\nC\nLyric Verse=2\nC\n',
    });
    // The first chord line consumes verse 1 ('one two'), the second verse 2.
    await new Parser(ctx).parseFile('song.mma');
    const text: string[] = [];
    for (const evs of ctx.mtrks.meta().miditrk.values()) {
      for (const e of evs) if (e[1] === 0x05) text.push(String.fromCharCode(...e.slice(3)));
    }
    expect(text).toEqual(['one ', 'two ', 'three ', 'four ']);
  });

  it('warns about leftover lyrics at write time', async () => {
    const ctx = makeCtx({ 'song.mma': 'Lyric Set never used\n' });
    await new Parser(ctx).parseFile('song.mma');
    ctx.mtrks.onBeforeWrite?.();
    expect(ctx.rep.warnings.map((w) => w.message)).toContain('Lyrics remaining on stack');
  });
});

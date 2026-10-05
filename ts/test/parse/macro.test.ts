import { afterEach, describe, expect, it, vi } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { MMAError } from '../../src/engine/Errors';
import { MemoryResources } from '../../src/io/MMAResources';
import { SourceReader } from '../../src/io/SourceReader';
import { MacroExpander } from '../../src/parse/MacroExpander';
import { Parser } from '../../src/parse/Parser';
import { trackAlloc } from '../../src/parse/TrackAlloc';
import { getTrack } from '../../src/parse/TrackApi';

function makeExpander(seed = 1): { ctx: MMAContext; exp: MacroExpander } {
  const ctx = new MMAContext({ seed });
  ctx.resources = new MemoryResources();
  return { ctx, exp: new MacroExpander(ctx) };
}

/** Parse a small in-memory song, returning captured console output. */
async function runSong(text: string, ctx?: MMAContext): Promise<{ ctx: MMAContext; logs: string[] }> {
  const context = ctx ?? new MMAContext({ seed: 1 });
  context.resources = new MemoryResources({ 'song.mma': text });
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  try {
    await new Parser(context).parseFile('song.mma');
  } finally {
    spy.mockRestore();
  }
  return { ctx: context, logs };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MacroExpander user variables', () => {
  it('SET joins values with single spaces and + removes them', () => {
    const { exp } = makeExpander();
    exp.setvar(['Foo', 'aaa', 'bbb']);
    expect(exp.expand(['$foo'])).toEqual(['aaa', 'bbb']);
    exp.setvar(['Bar', 'aaa', '+', 'bbb', '+', 'ccc']);
    expect(exp.expand(['$BAR'])).toEqual(['aaabbbccc']);
  });

  it('NSET ignores an existing variable', () => {
    const { exp } = makeExpander();
    exp.setvar(['V', 'one']);
    exp.newsetvar(['V', 'two']);
    expect(exp.expand(['$V'])).toEqual(['one']);
    exp.newsetvar(['W', 'first']);
    expect(exp.expand(['$W'])).toEqual(['first']);
  });

  it('UNSET removes and warns on missing variables', () => {
    const { ctx, exp } = makeExpander();
    exp.setvar(['V', 'x']);
    exp.unsetvar(['V']);
    exp.unsetvar(['V']);
    expect(ctx.rep.warnings.map((w) => w.message)).toEqual([
      "Attempt to UNSET nonexistent variable 'V'",
    ]);
  });

  it('INC and DEC use stof values and normalise 123.0 to 123', () => {
    const { exp } = makeExpander();
    exp.setvar(['N', '10']);
    exp.varinc(['N']);
    expect(exp.expand(['$N'])).toEqual(['11']);
    exp.varinc(['N', '2.5']);
    expect(exp.expand(['$N'])).toEqual(['13.5']);
    exp.vardec(['N']);
    expect(exp.expand(['$N'])).toEqual(['12.5']);
    exp.vardec(['N', '0.5']);
    expect(exp.expand(['$N'])).toEqual(['12']);
  });

  it('INC errors on undefined and internal variables', () => {
    const { exp } = makeExpander();
    expect(() => exp.varinc(['NOPE'])).toThrowError("Variable 'NOPE' not defined");
    exp.setvar(['X', '1']);
    expect(() => exp.varinc(['_TIME'])).toThrowError('Internal variables cannot be modified');
  });

  it('RNDSET picks one of the listed values', () => {
    const { exp } = makeExpander(1234);
    exp.rndvar(['R', 'a', 'b', 'c']);
    const v = exp.expand(['$R'])[0]!;
    expect(['a', 'b', 'c']).toContain(v);
  });

  it('reports undefined user variables with the Python text', () => {
    const { exp } = makeExpander();
    expect(() => exp.expand(['$nope'])).toThrowError("User variable 'NOPE'  has not been defined");
  });

  it('slices with indexes, ranges and the empty-length form', () => {
    const { exp } = makeExpander();
    exp.setvar(['L', 'A', 'B', 'C', 'D']);
    expect(exp.expand(['$L[0]'])).toEqual(['A']);
    expect(exp.expand(['$L[-1]'])).toEqual(['D']);
    expect(exp.expand(['$L[1:3]'])).toEqual(['B', 'C']);
    expect(exp.expand(['$L[]'])).toEqual(['4']);
    expect(exp.expand(['$L[1+1]'])).toEqual(['C']);
    expect(() => exp.expand(['$L[9]'])).toThrowError("Index '9' out of range.");
  });

  it('uses -1 for an undefined variable with an empty slice', () => {
    const { exp } = makeExpander();
    expect(exp.expand(['$UNKNOWN[]'])).toEqual(['-1']);
  });

  it('VEXPAND off/on controls substitution', async () => {
    const { logs } = await runSong(`
Set V 1
Vexpand Off
Print $V
Vexpand On
Print $V
`);
    expect(logs).toEqual(['$V', '1']);
  });
});

describe('MacroExpander system variables', () => {
  it('expands the common globals', async () => {
    const { logs } = await runSong('Print $_TIME $_SEQSIZE $_SEQRND $_VEXPAND $_TRANSPOSE $_BARNUM');
    expect(logs).toEqual(['4 1 Off On 0 1']);
  });

  it('expands $_TIME through IF from a real stdlib file', async () => {
    const text = ['if NE  $_TIME 4', 'Print wrong', 'Else', 'Print right', 'Endif'].join('\n');
    const { logs } = await runSong(text);
    expect(logs).toEqual(['right']);
  });

  it('reports unknown system variables', () => {
    const { exp } = makeExpander();
    expect(() => exp.expand(['$_NOPE'])).toThrowError('Unknown system variable $_NOPE');
    expect(() => exp.expand(['$_NOTATRACK_VOLUME'])).toThrowError(
      'System variable $_NOTATRACK_VOLUME refers to nonexistent track.',
    );
  });
});

describe('MacroExpander math and blocks', () => {
  it('evaluates $() with the safe expression evaluator', () => {
    const { exp } = makeExpander();
    expect(exp.expand(['$(2 + 3 * 4)'])).toEqual(['14']);
    expect(exp.expand(['Print', '$(1 + 2)', 'x'])).toEqual(['Print', '3', 'x']);
    // Nested $() is not supported by Python's delimiter scan either.
    expect(() => exp.expand(['$(($(1+1) * 5))'])).toThrowError("Illegal operation in '($(1+1) * 5)'.");
    expect(() => exp.expand(['$(1 +'])).toThrowError("Unmatched delimiter in '$(1 +'.");
  });

  it('MSET stores lines and pushes the remainder back into the source', async () => {
    const { logs } = await runSong(`
Mset LINES
Print mset-first
Print mset-second
MsetEnd
$LINES
`);
    expect(logs).toEqual(['mset-first', 'mset-second']);
  });

  it('MSET via a directly controlled reader', () => {
    const { ctx, exp } = makeExpander();
    const src = new SourceReader(ctx, 'mem', 'Mset X\nPrint one\nPrint two\nMsetEnd\n');
    ctx.inpath = src;
    expect(src.read()).toEqual(['Mset', 'X']);
    exp.msetvar(['X']);
    expect(src.read()).toBeNull(); // MSetEnd consumed; reader is at EOF
    expect(exp.expand(['$X'])).toEqual(['Print', 'one']);
    expect(src.read()).toEqual(['Print', 'two']);
  });

  it('IF/ELSE/ENDIF picks the right block and supports DEF/NDEF', async () => {
    const { logs } = await runSong(`
Set V yes
If DEF V
Print def-yes
Endif
If NDEF V
Print def-no
Endif
If EQ $V YES
Print eq
Else
Print neq
Endif
`);
    expect(logs).toEqual(['def-yes', 'eq']);
  });

  it('nested IF blocks skip correctly', async () => {
    const { logs } = await runSong(`
If EQ 1 2
If EQ 1 1
Print inner
Endif
Print outer
Else
Print else-branch
Endif
`);
    expect(logs).toEqual(['else-branch']);
  });

  it('REPEAT/REPEATEND repeats the body', async () => {
    const { logs } = await runSong(`
Repeat
Print tick
RepeatEnd 3
`);
    expect(logs).toEqual(['tick', 'tick', 'tick']);
  });

  it('REPEAT with REPEATENDING matches the Python push order', async () => {
    // Verified against MMA.parse.repeat: the ending is played before the
    // final repeat of the main body.
    const { logs } = await runSong(`
Repeat
Print main
RepeatEnding
Print ending
RepeatEnd
`);
    expect(logs).toEqual(['main', 'ending', 'main']);
  });

  it('REPEATEND without REPEAT errors', async () => {
    await expect(runSong('RepeatEnd')).rejects.toThrowError('Repeatend/EndRepeat without Repeat');
  });

  it('ELSE/ENDIF without IF error', async () => {
    await expect(runSong('Else')).rejects.toThrowError('ELSE without IF');
    await expect(runSong('Endif')).rejects.toThrowError('ENDIF without IF');
  });

  it('errors when IF finds EOF before EndIf', async () => {
    await expect(runSong('If EQ 1 1')).rejects.toThrowError('EOF reached while looking for EndIf');
  });

  it('errors when REPEAT finds EOF', async () => {
    await expect(runSong('Repeat\nPrint x')).rejects.toThrowError('EOF encountered processing Repeat');
  });

  it('reports invalid IF usage', () => {
    const { ctx, exp } = makeExpander();
    ctx.inpath = new SourceReader(ctx, 'mem', '');
    expect(() => exp.varIF(['EQ', '1'])).toThrowError('Usage: VARS EQ Value1 Value2');
    expect(() => exp.varIF(['ZORK', '1', '2'])).toThrowError('Usage: IF <CONDITON> ...');
  });
});

describe('MacroExpander parse-time errors', () => {
  it('errors on an empty macro name', () => {
    const { exp } = makeExpander();
    expect(() => exp.expand(['$'])).toThrowError("Illegal macro name '$'.");
  });

  it('reports illegal $() identifiers', () => {
    const { exp } = makeExpander();
    expect(() => exp.expand(['$(evil(1))'])).toThrowError("Illegal/Unknown operator 'evil' in $().");
  });

  it('MMAError carries the file/line location', async () => {
    const ctx = new MMAContext({ seed: 1 });
    ctx.resources = new MemoryResources({ 'song.mma': 'Set A 1\n$NOPE\n' });
    try {
      await new Parser(ctx).parseFile('song.mma');
      expect.unreachable('should throw');
    } catch (e) {
      const err = e as MMAError;
      expect(err.message).toBe("User variable 'NOPE'  has not been defined");
      expect(err.file).toBe('song.mma');
      expect(err.line).toBe(2);
    }
  });
});

describe('MacroExpander track and function system variables', () => {
  it('formats track variables and errors on unknown tracks', () => {
    const { ctx, exp } = makeExpander();
    trackAlloc(ctx, 'CHORD', true);
    const track = getTrack(ctx, 'CHORD');
    track.volume = [1.1];
    track.octave = [60];
    expect(exp.expand(['$_CHORD_VOLUME'])).toEqual(['110']);
    expect(exp.expand(['$_CHORD_OCTAVE'])).toEqual(['5']);
    expect(exp.expand(['$_CHORD_VOLUME[0]'])).toEqual(['110']);
    expect(() => exp.expand(['$_BASS_VOICE'])).toThrowError(
      'System variable $_BASS_VOICE refers to nonexistent track.',
    );
    expect(() => exp.expand(['$_CHORD_ZORK'])).toThrowError('Unknown system track variable CHORD_ZORK');
  });

  it('supports the $_NOTELEN function', () => {
    const { exp } = makeExpander();
    expect(exp.expand(['$_NOTELEN(4)'])).toEqual(['192T']);
    expect(exp.expand(['$_NOTELEN(8)'])).toEqual(['96T']);
  });

  it('formats $_<track>_VOICING for CHORD tracks only', () => {
    const { ctx, exp } = makeExpander();
    trackAlloc(ctx, 'CHORD', true);
    trackAlloc(ctx, 'BASS', true);

    // Unset mode prints like Python's "%s" % None (expand splits on spaces).
    expect(exp.expand(['$_CHORD_VOICING'])).toEqual([
      'Mode=None',
      'Range=12',
      'Center=4',
      'RMove=0',
      'Move=0',
      'Dir=0',
    ]);

    getTrack(ctx, 'CHORD').setVoicing(['MODE=DROP2', 'RANGE=6', 'CENTER=2', 'MOVE=3', 'DIR=1']);
    expect(exp.expand(['$_CHORD_VOICING'])).toEqual([
      'Mode=DROP2',
      'Range=6',
      'Center=2',
      'RMove=0',
      'Move=3',
      'Dir=1',
    ]);

    expect(() => exp.expand(['$_BASS_VOICING'])).toThrowError('Only CHORD tracks have VOICING');
  });

  it('supports StackValue to the push/pull stack', () => {
    const { ctx, exp } = makeExpander();
    exp.stackValue(['one', 'two']);
    expect(exp.expand(['$_STACKVALUE'])).toEqual(['one', 'two']);
    expect(() => exp.expand(['$_STACKVALUE'])).toThrowError('Empty push/pull variable stack');
    void ctx;
  });
});

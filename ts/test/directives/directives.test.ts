import { describe, expect, it, vi } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { MemoryResources } from '../../src/io/MMAResources';
import { GrooveDatabase } from '../../src/groove/GrooveDatabase';
import { Parser } from '../../src/parse/Parser';
import { trackAlloc } from '../../src/parse/TrackAlloc';
import { getTrack } from '../../src/parse/TrackApi';
import { ChordNotes, createChordAdjust } from '../../src/model/ChordNotes';
import { chordEnv } from '../../src/parse/ChordLineParser';

/** Keys of MMA/parse.py's simpleFuncs (103 entries). */
const SIMPLE_NAMES = [
  'ADJUSTVOLUME', 'AFTER', 'ALLGROOVES', 'ALLTRACKS', 'AUTHOR', 'AUTOSOLOTRACKS',
  'BEATADJUST', 'CALL', 'CHANNELPREF', 'CHORDADJUST', 'CMDLINE', 'COMMENT', 'CRESC', 'CUT',
  'DEBUG', 'DEC', 'DECRESC', 'DEFALIAS', 'DEFCHORD', 'DEFCALL', 'DEFGROOVE', 'DELETE', 'DOC',
  'DOCVAR', 'DRUMVOLTR', 'ELSE', 'ENDIF', 'ENDMSET', 'ENDREPEAT', 'EOF', 'ERROR', 'FERMATA',
  'GOTO', 'GROOVE', 'GROOVECLEAR', 'IF', 'IFEND', 'INC', 'INCLUDE', 'KEYSIG', 'LABEL', 'LYRIC',
  'MIDIDEF', 'MIDI', 'MIDICOPYRIGHT', 'MIDICUE', 'MIDIFILE', 'MIDIINC', 'MIDIVOLUME',
  'MIDICRESC', 'MIDIDECRESC', 'CHANNELINIT', 'MIDIMARK', 'MIDISPLIT', 'MIDITEXT', 'MIDITNAME',
  'MMAEND', 'MMASTART', 'MSET', 'MSETEND', 'NEWSET', 'PATCH', 'PLUGIN', 'PRINT', 'PRINTACTIVE',
  'PRINTCHORD', 'REPEAT', 'REPEATEND', 'REPEATENDING', 'RESTART', 'RNDSEED', 'RNDSET', 'SEQ',
  'SEQCLEAR', 'SEQRND', 'SEQRNDWEIGHT', 'SEQSIZE', 'SET', 'SETINCPATH', 'SETLIBPATH',
  'SETMIDIPLAYER', 'SETOUTPATH', 'SETPLUGPATH', 'SETSYNCTONE', 'SHOWVARS', 'STACKVALUE',
  'SWELL', 'SWINGMODE', 'SYNCHRONIZE', 'TEMPO', 'TIME', 'TIMESIG', 'TONETR', 'TRUNCATE',
  'TWEAKS', 'UNSET', 'USE', 'VARCLEAR', 'VEXPAND', 'VOICEVOLTR', 'VOICETR', 'VOLUME',
  'TRANSPOSE',
];

/** Keys of MMA/parse.py's trackFuncs (72 entries). */
const TRACK_NAMES = [
  'ACCENT', 'ARPEGGIATE', 'ARTICULATE', 'CHANNEL', 'CHORDS', 'DUPRIFF', 'MIDIVOLUME',
  'MIDICRESC', 'MIDIDECRESC', 'CHSHARE', 'COMPRESS', 'COPY', 'CRESC', 'CUT', 'DECRESC',
  'DELAY', 'DIRECTION', 'DRUMTYPE', 'DUPROOT', 'FORCEOUT', 'FRETNOISE', 'GROOVE', 'HARMONY',
  'HARMONYONLY', 'HARMONYVOLUME', 'INVERT', 'LIMIT', 'MALLET', 'MIDICLEAR', 'MIDICUE',
  'MIDIDEF', 'MIDIGLIS', 'MIDIPAN', 'MIDISEQ', 'MIDITEXT', 'MIDITNAME', 'MIDIVOICE',
  'MIDIWHEEL', 'MOCTAVE', 'OCTAVE', 'OFF', 'ON', 'ORNAMENT', 'TUNING', 'CAPO', 'SHAPE', 'RANGE',
  'RDURATION', 'RESTART', 'RIFF', 'RSKIP', 'RTIME', 'RVOLUME', 'RPITCH', 'SCALETYPE',
  'SEQCLEAR', 'SEQRND', 'SEQUENCE', 'SEQRNDWEIGHT', 'STRETCH', 'STICKY', 'SWELL', 'TRIGGER',
  'MIDINOTE', 'NOTESPAN', 'STRUM', 'STRUMADD', 'TONE', 'UNIFY', 'VOICE', 'VOICING', 'VOLUME',
  'DEFINE',
];

function setup(): { ctx: MMAContext; parser: Parser } {
  const ctx = new MMAContext({ seed: 7 });
  ctx.resources = new MemoryResources();
  const parser = new Parser(ctx);
  return { ctx, parser };
}

function simple(parser: Parser, name: string): (ctx: MMAContext, args: string[]) => void | Promise<void> {
  const h = parser.registry.simple.get(name);
  if (!h) throw new Error(`missing simple handler ${name}`);
  return h;
}

describe('DirectiveRegistry tables', () => {
  it('registers every Python simpleFuncs name', () => {
    const { parser } = setup();
    const missing = SIMPLE_NAMES.filter((n) => !parser.registry.simple.has(n));
    expect(missing).toEqual([]);
    expect(parser.registry.simple.size).toBe(SIMPLE_NAMES.length);
  });

  it('registers every Python trackFuncs name', () => {
    const { parser } = setup();
    const missing = TRACK_NAMES.filter((n) => !parser.registry.track.has(n));
    expect(missing).toEqual([]);
    expect(parser.registry.track.size).toBe(TRACK_NAMES.length);
  });

  it('throws a clear milestone error for unported commands', () => {
    const { ctx, parser } = setup();
    expect(() => simple(parser, 'AFTER')(ctx, ['5'])).toThrowError(
      'AFTER is not implemented in this milestone (M1).',
    );
    const track = { name: 'CHORD' } as never;
    expect(() => parser.registry.track.get('RIFF')!(ctx, track, ['X'])).toThrowError(
      'RIFF is not implemented in this milestone (M1).',
    );
  });

  it('keeps Python no-ops as no-ops', () => {
    const { ctx, parser } = setup();
    expect(() => simple(parser, 'COMMENT')(ctx, ['anything'])).not.toThrow();
    expect(() => simple(parser, 'LABEL')(ctx, ['x'])).not.toThrow();
  });
});

describe('TIME/TEMPO/TIMESIG/KEYSIG/BEATADJUST', () => {
  it('TIME sets beats, bar length and tabs', () => {
    const { ctx, parser } = setup();
    simple(parser, 'TIME')(ctx, ['3/4']);
    expect(ctx.QperBar).toBe(3);
    expect(ctx.barLen).toBe(576);
    expect(ctx.chordTabs).toEqual([0, 192, 384]);
    expect(ctx.timeSig.getAscii()).toBe('3/4');
  });

  it('TIME supports COMMON/CUT, numeric and Tabs=', () => {
    const { ctx, parser } = setup();
    simple(parser, 'TIME')(ctx, ['COMMON']);
    expect(ctx.QperBar).toBe(4);
    simple(parser, 'TIME')(ctx, ['CUT']);
    expect(ctx.QperBar).toBe(4); // 2/2 is four quarter-note beats
    expect(ctx.chordTabs).toEqual([0, 384]);
    simple(parser, 'TIME')(ctx, ['5', 'Tabs=1,2,3,4,5']);
    expect(ctx.QperBar).toBe(5);
    expect(ctx.chordTabs).toEqual([0, 192, 384, 576, 768]);
  });

  it('TIME rejects bad values and tab lists', () => {
    const { ctx, parser } = setup();
    expect(() => simple(parser, 'TIME')(ctx, ['13'])).toThrowError('Time: Value must be 1..12.');
    expect(() => simple(parser, 'TIME')(ctx, ['3/5'])).toThrowError(
      "Time: Unknown timesignature '3/5'. You may need to set TIME and TIMESIG separately.",
    );
    expect(() => simple(parser, 'TIME')(ctx, ['4', 'Tabs=2,1'])).toThrowError(/must be in order/);
    expect(() => simple(parser, 'TIME')(ctx, ['4', 'Zork=1'])).toThrowError("TIME: Unknown option 'ZORK'.");
  });

  it('TEMPO writes meta tempo events and relative values', () => {
    const { ctx, parser } = setup();
    simple(parser, 'TEMPO')(ctx, ['150']);
    expect(ctx.tempo).toBe(150);
    expect(ctx.mtrks.tempoChanges.map((t) => t.tempo)).toEqual([150]);
    simple(parser, 'TEMPO')(ctx, ['*2']);
    expect(ctx.tempo).toBe(300);
    simple(parser, 'TEMPO')(ctx, ['-50']);
    expect(ctx.tempo).toBe(250);
    expect(() => simple(parser, 'TEMPO')(ctx, ['1'])).toThrowError('Tempo: Value must be greater than 1.');
  });

  it('TEMPO OFFSET and restore-over-bars', () => {
    const { ctx, parser } = setup();
    simple(parser, 'TEMPO')(ctx, ['120', '2']);
    expect(ctx.tempo).toBe(120);
    expect(ctx.mtrks.tempoChanges.length).toBeGreaterThanOrEqual(2);
    simple(parser, 'TEMPO')(ctx, ['100', 'Offset=1']);
    expect(ctx.mtrks.tempoChanges.some((t) => t.tick === ctx.BperQ)).toBe(true);
  });

  it('BEATADJUST moves the tick offset', () => {
    const { ctx, parser } = setup();
    simple(parser, 'BEATADJUST')(ctx, ['2B']);
    expect(ctx.tickOffset).toBe(384);
    expect(ctx.totTime).toBeCloseTo(384 / 192 / 120, 10);
  });

  it('KEYSIG sets the key signature state', () => {
    const { ctx, parser } = setup();
    simple(parser, 'KEYSIG')(ctx, ['Eb']);
    expect(ctx.keySig.getKeysig()).toBe('Eb Major');
    simple(parser, 'KEYSIG')(ctx, ['2b', 'minor']);
    expect(ctx.keySig.getKeysig()).toBe('G Minor');
  });
});

describe('SEQ/SEQSIZE/SEQRND', () => {
  it('SeqSize expands weights and rejects < 1', () => {
    const { ctx, parser } = setup();
    simple(parser, 'SEQSIZE')(ctx, ['4']);
    expect(ctx.seqSize).toBe(4);
    expect(ctx.seqRndWeight).toEqual([1, 1, 1, 1]);
    expect(() => simple(parser, 'SEQSIZE')(ctx, ['0'])).toThrowError(
      "SeqSize: sequence size must be 1 or greater, not '0'.",
    );
  });

  it('SeqRnd on/off and track lists', () => {
    const { ctx, parser } = setup();
    simple(parser, 'SEQRND')(ctx, ['On']);
    expect(ctx.seqRnd).toEqual([1]);
    simple(parser, 'SEQRND')(ctx, ['Off']);
    expect(ctx.seqRnd).toEqual([0]);
    expect(() => simple(parser, 'SEQRND')(ctx, ['BASS'])).toThrowError(
      "SeqRnd: Track 'BASS' does not exist, use [ON, OFF or TrackList ]",
    );
  });

  it('SeqRndWeight validates all-zero lists', () => {
    const { ctx, parser } = setup();
    simple(parser, 'SEQSIZE')(ctx, ['2']);
    simple(parser, 'SEQRNDWEIGHT')(ctx, ['1', '3']);
    expect(ctx.seqRndWeight).toEqual([1, 3]);
    expect(() => simple(parser, 'SEQRNDWEIGHT')(ctx, ['0', '0'])).toThrowError(
      "SeqRndWeight Using all '0's is not permitted.",
    );
  });

  it('Seq resets the sequence point and disables SeqRnd', () => {
    const { ctx, parser } = setup();
    simple(parser, 'SEQSIZE')(ctx, ['4']);
    simple(parser, 'SEQRND')(ctx, ['On']);
    simple(parser, 'SEQ')(ctx, ['3']);
    expect(ctx.seqCount).toBe(2);
    expect(ctx.seqRnd).toEqual([0]);
    expect(ctx.rep.warnings.map((w) => w.message)).toContain('SeqRnd has been disabled by a Seq command');
  });

  it('SeqClear clears sequences but keeps solo/sticky tracks', () => {
    const { ctx, parser } = setup();
    trackAlloc(ctx, 'CHORD', true);
    const chord = getTrack(ctx, 'CHORD');
    chord.sequence = ['x'];
    simple(parser, 'SEQCLEAR')(ctx, []);
    expect(chord.sequence.every((s) => s === null)).toBe(true);
  });
});

describe('grooves, chords and MIDI file options', () => {
  it('DefGroove/DefAlias/Groove round-trip', async () => {
    const { ctx, parser } = setup();
    simple(parser, 'SEQSIZE')(ctx, ['2']);
    simple(parser, 'DEFGROOVE')(ctx, ['MyGroove']);
    simple(parser, 'DEFALIAS')(ctx, ['MyGroove', 'MG']);
    simple(parser, 'SEQSIZE')(ctx, ['4']);
    await simple(parser, 'GROOVE')(ctx, ['MG']);
    expect(ctx.seqSize).toBe(2);
    expect(ctx.grooves.currentGroove).toBe('MYGROOVE');
    expect(ctx.grooves.lastGroove).toBe('MYGROOVE');
    expect(() => simple(parser, 'DEFALIAS')(ctx, ['Nope', 'X'])).toThrowError(
      'DefAlias: Groove Nope has not been defined.',
    );
  });

  it('DefChord adds a chord type visible to ChordNotes', () => {
    const { ctx, parser } = setup();
    simple(parser, 'DEFCHORD')(ctx, ['zork', '(0,5,9)', '(0,5,9,12,14,17,19)']);
    const ch = new ChordNotes(chordEnv(ctx), 'Czork');
    expect(ch.noteList).toEqual([0, 5, 9]);
    expect(() => simple(parser, 'DEFCHORD')(ctx, ['bad', '(1)', '(1,2,3,4,5,6,7)'])).toThrowError(
      "There must be 2..8 notes in a chord, not '1'",
    );
  });

  it('ChordAdjust shifts a pitch and RESET restores it', () => {
    const { ctx, parser } = setup();
    const orig = createChordAdjust();
    simple(parser, 'CHORDADJUST')(ctx, ['C=1']);
    expect(ctx.cdAdjust['C']).toBe(12);
    simple(parser, 'CHORDADJUST')(ctx, ['RESET']);
    expect(ctx.cdAdjust).toEqual(orig);
    expect(() => simple(parser, 'CHORDADJUST')(ctx, ['C=2'])).toThrowError(
      "ChordAdjust: '2' is not a valid octave. Use 1, 0 or -1",
    );
  });

  it('MidiFile stores SMF and running-status flags', () => {
    const { ctx, parser } = setup();
    simple(parser, 'MIDIFILE')(ctx, ['SMF=0', 'RUNNING=0']);
    expect(ctx.midiFileType).toBe(0);
    expect(ctx.runningStatus).toBe(0);
    expect(() => simple(parser, 'MIDIFILE')(ctx, ['SMF=2'])).toThrowError('Use: MIDIFile SMF=0/1');
    expect(() => simple(parser, 'MIDIFILE')(ctx, ['ZORK=1'])).toThrowError(
      'Use: MIDIFile [SMF=0/1] [RUNNING=0/1]',
    );
  });

  it('global Volume, Cresc and Swell fill futureVol', () => {
    const { ctx, parser } = setup();
    simple(parser, 'VOLUME')(ctx, ['ff']);
    expect(ctx.volume.volume).toBeCloseTo(1.6, 10);
    simple(parser, 'VOLUME')(ctx, ['p']);
    simple(parser, 'CRESC')(ctx, ['ff', '3']);
    expect(ctx.volume.futureVol.length).toBe(3);
    expect(ctx.volume.futureVol[0]).toBeCloseTo(0.4, 10);
    expect(ctx.volume.futureVol[2]).toBeCloseTo(1.6, 10);
    simple(parser, 'SWELL')(ctx, ['p', '4']);
    expect(ctx.volume.futureVol.length).toBe(4);
  });

  it('SwingMode updates the note length table', async () => {
    const { ctx, parser } = setup();
    simple(parser, 'SWINGMODE')(ctx, ['Skew=50', 'Notes=16']);
    expect(ctx.noteLenTable['81']).toBe(96);
    expect(ctx.noteLenTable['82']).toBe(96);
    simple(parser, 'SWINGMODE')(ctx, ['Accent=120,80', 'Delay=2,4']);
    const s = ctx.swingMode as { accent1: number; accent2: number; delay1: number; delay2: number };
    expect(s.accent1).toBeCloseTo(1.2, 10);
    expect(s.accent2).toBeCloseTo(0.8, 10);
    expect([s.delay1, s.delay2]).toEqual([2, 4]);
  });

  it('DEBUG updates flags and warning suppression', () => {
    const { ctx, parser } = setup();
    simple(parser, 'DEBUG')(ctx, ['DEBUG=ON', 'WARNINGS=OFF']);
    expect(ctx.rep.debugEnabled).toBe(true);
    expect(ctx.rep.warningsEnabled).toBe(false);
    ctx.warning('silent');
    expect(ctx.rep.warnings.length).toBe(0);
    expect(() => simple(parser, 'DEBUG')(ctx, ['DEBUG=maybe'])).toThrowError(
      'Debug: DEBUG needs ON, 1, OFF, or 0 arg.',
    );
  });

  it('ERROR/GOTO/EOF act on the current reader', async () => {
    const ctx = new MMAContext({ seed: 1 });
    ctx.resources = new MemoryResources({ 'song.mma': 'Error deliberately\n' });
    const parser = new Parser(ctx);
    await expect(parser.parseFile('song.mma')).rejects.toThrowError('User error: deliberately');
  });
});

describe('track directives', () => {
  it('sets the common track options', () => {
    const { ctx, parser } = setup();
    trackAlloc(ctx, 'CHORD', true);
    const track = getTrack(ctx, 'CHORD');
    const call = (name: string, args: string[]): void => {
      parser.registry.track.get(name)!(ctx, track, args);
    };

    call('OCTAVE', ['5']);
    expect(track.octave).toEqual([60]);
    call('VOICE', ['Piano1']);
    expect(track.voice.length).toBe(1);
    call('VOLUME', ['mf']);
    expect(track.volume[0]).toBeCloseTo(1.1, 6);
    call('STICKY', ['On']);
    expect(track.sticky).toBe(true);
    call('OFF', []);
    call('ON', []);
    call('STICKY', ['Off']);
    expect(track.sticky).toBe(false);
    call('ARTICULATE', ['60']);
    expect(track.artic).toEqual([60]);
    call('ACCENT', ['1', '80']);
    call('UNIFY', ['1']);
    call('RANGE', ['1']);
    call('COMPRESS', ['1']);
    call('LIMIT', ['4']);
    call('DUPROOT', ['1']);
    call('INVERT', ['1']);
    call('DELAY', ['20T']);
    call('STRUM', ['50']);
    call('STRUMADD', ['5']);
    call('RSKIP', ['5']);
    call('RTIME', ['-5,5']);
    call('RDURATION', ['90,100']);
    call('RVOLUME', ['90,100']);
    call('SCALETYPE', ['AUTO']);
    call('SEQRND', ['On']);
    expect(track.seqRnd).toBe(true);
    call('SEQRNDWEIGHT', ['1']);
    call('CHANNEL', ['3']);
    expect(track.channel).toBe(3);
    call('NOTESPAN', ['48', '72']);
    expect([track.spanStart, track.spanEnd]).toEqual([48, 72]);
    call('ON', []);
  });

  it('sets drum tone and mallet options on the right track types', () => {
    const { ctx, parser } = setup();
    trackAlloc(ctx, 'DRUM', true);
    const drum = getTrack(ctx, 'DRUM');
    parser.registry.track.get('TONE')!(ctx, drum, ['35']);
    expect(drum.toneList).toEqual([35]);
    expect(() => parser.registry.track.get('MALLET')!(ctx, drum, [])).toThrowError(
      'Use: DRUM Mallet <Option=Value> [...]',
    );
  });

  it('validates args like Python', () => {
    const { ctx, parser } = setup();
    trackAlloc(ctx, 'CHORD', true);
    const track = getTrack(ctx, 'CHORD');
    const call = (name: string, args: string[]): void => {
      parser.registry.track.get(name)!(ctx, track, args);
    };

    expect(() => call('VOLUME', [])).toThrowError('Use: CHORD Volume DYN [...]');
    expect(() => call('OCTAVE', [])).toThrowError('Use: CHORD Octave N [...], (n=0..10)');
    expect(() => call('ON', ['1'])).toThrowError('Use: CHORD ON with no paramater');
    expect(() => call('OFF', ['1'])).toThrowError('Use: CHORD OFF with no paramater');
    expect(() => call('UNIFY', [])).toThrowError('Use CHORD UNIFY 1 [...]');
    expect(() => call('STICKY', [])).toThrowError('Use: CHORD Sticky On/Off');
    expect(() => call('NOTESPAN', ['0', '5'])).toThrowError('Span range must be at least 12');
  });

  it('Define stores a pattern and Sequence selects it', async () => {
    const ctx = new MMAContext({ seed: 3 });
    ctx.resources = new MemoryResources({
      'song.mma': 'Begin Chord Define\n  P1 1 1 90\n  P2 2 1 80\nEnd\nChord Sequence P1 P2\nC\nG\n',
    });
    await new Parser(ctx).parseFile('song.mma');
    expect(ctx.pats.has('CHORD', 'P1')).toBe(true);
    expect(ctx.pats.has('CHORD', 'P2')).toBe(true);
    expect(ctx.barNum).toBe(2);
  });

  it('Sequence rejects unknown patterns and missing definitions', async () => {
    const ctx = new MMAContext({ seed: 3 });
    ctx.resources = new MemoryResources({ 'song.mma': 'Chord Sequence NOPE\n' });
    await expect(new Parser(ctx).parseFile('song.mma')).rejects.toThrowError(
      "Track CHORD does not have pattern 'NOPE'",
    );

    const ctx2 = new MMAContext({ seed: 3 });
    ctx2.resources = new MemoryResources({ 'song.mma': 'Chord Define\n' });
    await expect(new Parser(ctx2).parseFile('song.mma')).rejects.toThrowError(
      'Define is expecting a pattern name',
    );
  });
});

describe('additional M1 behaviours', () => {
  it('Sequence expands {..} definitions into _N patterns', async () => {
    const ctx = new MMAContext({ seed: 5 });
    ctx.resources = new MemoryResources({
      'song.mma': [
        'Begin Chord Define',
        '  P1 1 1 90',
        'End',
        'Chord Sequence {2 1 90} P1',
        'C',
        'G',
      ].join('\n'),
    });
    await new Parser(ctx).parseFile('song.mma');
    expect(ctx.pats.has('CHORD', '_1')).toBe(true);
    expect(ctx.barNum).toBe(2);
  });

  it('Sequence carries a pattern list through long lines ending in ;', async () => {
    const ctx = new MMAContext({ seed: 5 });
    ctx.resources = new MemoryResources({
      'song.mma': [
        'Begin Chord Define',
        '  P1 1 1 90',
        '  P2 2 1 90',
        'End',
        'Chord Sequence P1',
        'C',
      ].join('\n'),
    });
    await new Parser(ctx).parseFile('song.mma');
    expect(ctx.barNum).toBe(1);
  });

  it('Include depth is limited to 50 with the Python message', async () => {
    const ctx = new MMAContext({ seed: 1 });
    ctx.resources = new MemoryResources({ 'includes/loop.mma': 'Include loop\n' });
    await expect(new Parser(ctx).parseFile('includes/loop.mma')).rejects.toThrowError(
      /USE\/INCLUDE recursion error/,
    );
  });

  it('autoloads a groove via the groove index', async () => {
    const ctx = new MMAContext({ seed: 1 });
    ctx.resources = new MemoryResources({
      'song.mma': 'Groove ZZ\nC\n',
      'lib/x.mma': 'Begin Chord Define\n  PZ 1 1 90\nEnd\nDefGroove ZZ\n',
    });
    const parser = new Parser(ctx, {
      grooveDatabase: GrooveDatabase.fromJson({ version: 1, grooves: { ZZ: { file: 'lib/x.mma' } } }),
    });
    await parser.parseFile('song.mma');
    expect(ctx.grooves.currentGroove).toBe('ZZ');
    expect(ctx.pats.has('CHORD', 'PZ')).toBe(true);
    expect(ctx.barNum).toBe(1);
  });

  it('EOF stops reading the current file', async () => {
    const ctx = new MMAContext({ seed: 1 });
    ctx.resources = new MemoryResources({ 'song.mma': 'C\nEof\nG\n' });
    await new Parser(ctx).parseFile('song.mma');
    expect(ctx.barNum).toBe(1);
  });

  it('GOTO jumps to a label', async () => {
    const ctx = new MMAContext({ seed: 1 });
    ctx.resources = new MemoryResources({ 'song.mma': 'Set V 1\nGoto SKIP\nSet V 2\nLabel SKIP\nC\n' });
    const parser = new Parser(ctx);
    await parser.parseFile('song.mma');
    expect(parser.expander.expand(['$V'])).toEqual(['1']);
    expect(ctx.barNum).toBe(1);
  });

  it('IF supports string comparisons, $$vars and ISEMPTY', async () => {
    const ctx = new MMAContext({ seed: 1 });
    ctx.resources = new MemoryResources({
      'song.mma': [
        'Set S Hello',
        'If EQ $$S HELLO',
        'Set R 1',
        'Endif',
        'Set E',
        'If ISEMPTY E',
        'Set R 2',
        'Endif',
        'Print $R',
      ].join('\n'),
    });
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => logs.push(a.map(String).join(' ')));
    try {
      await new Parser(ctx).parseFile('song.mma');
    } finally {
      spy.mockRestore();
    }
    expect(logs).toEqual(['2']);
  });

  it('REPEATEND accepts NoWarn Count', async () => {
    const ctx = new MMAContext({ seed: 1 });
    ctx.resources = new MemoryResources({ 'song.mma': 'Repeat\nPrint x\nRepeatEnd NoWarn 2\n' });
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => logs.push(a.map(String).join(' ')));
    try {
      await new Parser(ctx).parseFile('song.mma');
    } finally {
      spy.mockRestore();
    }
    expect(logs).toEqual(['x', 'x']);
    expect(ctx.rep.warnings).toEqual([]);
  });
});

describe('groove-list progression', () => {
  it('advances through the groove list one bar at a time', async () => {
    const ctx = new MMAContext({ seed: 1 });
    ctx.resources = new MemoryResources({
      'song.mma': ['DefGroove G1', 'DefGroove G2', 'Groove G1 G2', 'C', 'C', 'C', 'C'].join('\n'),
    });
    await new Parser(ctx).parseFile('song.mma');
    expect(ctx.barNum).toBe(4);
    // 4 bars: G2, G1, G2, G1 (nextGroove advances before the next bar).
    expect(ctx.grooves.currentGroove).toBe('G1');
    expect(ctx.grooves.lastGroove).toBe('G2');
  });
});

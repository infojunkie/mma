/**
 * Unit tests for the feature ports that are driven from the parser or the
 * track hooks: ORNAMENT options/state, TRIGGER sequences, RPITCH state and
 * LYRIC extraction/options.  The byte-exact playback of all of these is
 * covered by the Python-oracle fixtures in tracks.test.ts; these tests pin
 * the option strings, skip logic and error paths.
 */

import { describe, expect, it } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { AriaTrack } from '../../src/model/tracks/AriaTrack';
import { BassTrack } from '../../src/model/tracks/BassTrack';
import { DrumTrack } from '../../src/model/tracks/DrumTrack';
import { PlectrumTrack } from '../../src/model/tracks/PlectrumTrack';
import { CTable } from '../../src/model/CTable';
import { ChordNotes, type ChordEnv } from '../../src/model/ChordNotes';
import { PatternEvent, type Pattern } from '../../src/model/PatternEvent';
import { defaultOrnaments, getOrnOpts, setOrnament } from '../../src/model/features/Ornament';
import { doRpitch, rpitchGetOpts, setRPitch } from '../../src/model/features/Rpitch';
import {
  getTriggerOptions,
  makeTriggerSequence,
  setCurrentBarLabel,
  setTrigger,
} from '../../src/model/features/Trigger';
import {
  getLyric,
  lyricExtract,
  lyricLeftovers,
  lyricOption,
  lyricSetting,
} from '../../src/model/features/Lyric';

function makeContext(): MMAContext {
  const ctx = new MMAContext();
  ctx.tempo = 120;
  ctx.QperBar = 4;
  ctx.barLen = ctx.BperQ * ctx.QperBar;
  ctx.seqSize = 4;
  ctx.seqCount = 0;
  ctx.tickOffset = 0;
  return ctx;
}

function chordEnv(ctx: MMAContext): ChordEnv {
  return {
    chordList: ctx.chordList,
    cdAdjust: ctx.cdAdjust,
    keyName: () => [ctx.keySig.kName[0], Boolean(ctx.keySig.kName[1])],
    keyNoteValue: () => ctx.keySig.keyNoteValue,
    rep: ctx.rep,
  };
}

function makeCTable(ctx: MMAContext, name: string, chordName = name): CTable {
  const ct = new CTable();
  ct.name = name;
  ct.chord = new ChordNotes(chordEnv(ctx), chordName);
  ct.chStart = 0;
  ct.chEnd = ctx.barLen;
  return ct;
}

describe('ORNAMENT options', () => {
  it('formats the default option string like Python', () => {
    const ctx = makeContext();
    const track = new BassTrack(ctx, 'BASS');
    expect(getOrnOpts(track)).toBe(
      'Type=NONE Chromatic=OFF Duration=20.0 Count=5 Pad=10.0,10.0 Offset=0 ' +
        'Volume=75.0 RVolume=0,0 Place=ABOVE Beats=ALL Rskip=0 Bars=ALL',
    );
    expect(track.ornaments).toEqual(defaultOrnaments());
  });

  it('formats a fully-set option string like Python', () => {
    const ctx = makeContext();
    const track = new BassTrack(ctx, 'BASS');
    setOrnament(ctx, track, [
      'Type=Grace',
      'Duration=24',
      'Volume=60',
      'Place=Below',
      'Beats=1,3',
      'RVolume=20',
      'Rskip=10',
      'Bars=2,3',
      'Pad=50,20',
      'Offset=10',
      'Count=7',
    ]);
    expect(getOrnOpts(track)).toBe(
      'Type=GRACE Chromatic=OFF Duration=24.0 Count=7 Pad=50.0,20.0 Offset=10.0 ' +
        'Volume=60.0 RVolume=-20.0,20.0 Place=BELOW Beats=1.0,3.0 Rskip=10.0 Bars=2,3',
    );
    expect(track.ornaments.beats).toEqual([0, 2 * ctx.BperQ]);
    expect(track.ornaments.bars).toEqual([1, 2]);
    expect(track.ornaments.count).toBe(7);
  });

  it('turns off with Off/None or with no arguments', () => {
    const ctx = makeContext();
    const track = new BassTrack(ctx, 'BASS');
    setOrnament(ctx, track, ['Type=Grace']);
    setOrnament(ctx, track, ['Off']);
    expect(track.ornaments.type).toBeNull();
    setOrnament(ctx, track, ['Type=Trill']);
    setOrnament(ctx, track, []);
    expect(track.ornaments.type).toBeNull();
  });

  it('rejects invalid tracks and options', () => {
    const ctx = makeContext();
    const drum = new DrumTrack(ctx, 'DRUM');
    expect(() => setOrnament(ctx, drum, ['Type=Grace'])).toThrow(/not valid in DRUM/);

    const bass = new BassTrack(ctx, 'BASS');
    expect(() => setOrnament(ctx, bass, ['Type=Nope'])).toThrow(/unknown type/);
    expect(() => setOrnament(ctx, bass, ['Nope=1'])).toThrow(/unknown option/);
    expect(() => setOrnament(ctx, bass, ['Type=Grace', 'Count=0'])).toThrow(/positive integer/);
    expect(() => setOrnament(ctx, bass, ['Type=Grace', 'Duration=101'])).toThrow(/less that 100/);
    expect(() => setOrnament(ctx, bass, ['Type=Grace', 'Place=Sideways'])).toThrow(/ABOVE, BELOW or RANDOM/);
    expect(() => setOrnament(ctx, bass, ['Type=Grace', 'Volume=0'])).toThrow(/than 0 and less that 1000/);
    expect(() => setOrnament(ctx, bass, ['Type=Grace', 'Rskip=101'])).toThrow(/must be 0 .. 100/);
    expect(() => setOrnament(ctx, bass, ['Type=Grace', 'Offset=1000'])).toThrow(/Ornament Offset/);
    expect(() => setOrnament(ctx, bass, ['Type=Grace', 'Beats=9'])).toThrow(/bar offset/);
  });
});

describe('TRIGGER', () => {
  it('formats options like Python', () => {
    const ctx = makeContext();
    const track = new BassTrack(ctx, 'BASS');
    setTrigger(ctx, track, [
      'Beats=1,3',
      'CNames=C,G',
      'CTonics=C',
      'CTypes=m,7',
      'Bars=2',
      'Count=3',
      'Truncate=True',
      'Override=True',
      'Measures=4,8',
      'Sticky=On',
      'Sequence={1 8 1 90; 2 8 1 80}',
    ]);
    expect(getTriggerOptions(track)).toBe(
      ' Beats=1.0,3.0 CNames=C,G CTypes=m,7 CTonics=C Bars=2 Count=3 ' +
        'Truncate=True Override=True Measures=4,8 Sequence={1 96t 1 90; 2 96t 1 80}',
    );
    expect(track.sticky).toBe(true);
  });

  it('builds BEATS sequences from the pattern', () => {
    const ctx = makeContext();
    const track = new BassTrack(ctx, 'BASS');
    setTrigger(ctx, track, ['Beats=1,3']);
    const pattern = [new PatternEvent(), new PatternEvent()];
    pattern[0]!.offset = 0;
    pattern[1]!.offset = ctx.BperQ * 2;
    // Count defaults to 1, so only the first pattern event is copied.
    const out = makeTriggerSequence(ctx, track, [makeCTable(ctx, 'C')], pattern);
    expect(out.map((e) => e.offset)).toEqual([0, ctx.BperQ * 2]);
  });

  it('builds AUTO and REST sequences from chord changes', () => {
    const ctx = makeContext();
    const track = new BassTrack(ctx, 'BASS');

    // AUTO: new chord names only; '/' entries repeat the name.
    setTrigger(ctx, track, ['Auto']);
    const ctabs = [makeCTable(ctx, 'C'), makeCTable(ctx, 'C'), makeCTable(ctx, 'F')];
    (ctabs[1] as unknown as { lastchord: string }).lastchord = 'C';
    ctabs[1]!.chStart = ctx.BperQ * 2;
    ctabs[1]!.chEnd = ctx.barLen;
    ctabs[2]!.chStart = ctx.BperQ * 3;
    (ctabs[2] as unknown as { lastchord: string }).lastchord = 'C';
    const pattern = [new PatternEvent()];
    const auto = makeTriggerSequence(ctx, track, ctabs, pattern);
    // name changes at C (0) and F (576); the repeated C at 384 is skipped.
    expect(auto.map((e) => e.offset)).toEqual([0, ctx.BperQ * 3]);

    // REST: 'z' chords that follow a non-rest.
    setTrigger(ctx, track, ['Rest']);
    const ztabs = [makeCTable(ctx, 'z', 'C'), makeCTable(ctx, 'z', 'C')];
    ztabs[1]!.chStart = ctx.BperQ * 2;
    ztabs[1]!.chEnd = ctx.barLen;
    (ztabs[1] as unknown as { lastchord: string }).lastchord = 'z';
    const rest = makeTriggerSequence(ctx, track, ztabs, pattern);
    expect(rest.map((e) => e.offset)).toEqual([0]);
  });

  it('honours Bars, Measures and Count', () => {
    const ctx = makeContext();
    const track = new BassTrack(ctx, 'BASS');
    const pattern = [new PatternEvent(), new PatternEvent()];

    setTrigger(ctx, track, ['Beats=1', 'Bars=2', 'Count=1']);
    ctx.seqCount = 0;
    expect(makeTriggerSequence(ctx, track, [makeCTable(ctx, 'C')], pattern)).toEqual([]);
    ctx.seqCount = 1;
    expect(makeTriggerSequence(ctx, track, [makeCTable(ctx, 'C')], pattern)).toHaveLength(1);

    setTrigger(ctx, track, ['Beats=1', 'Measures=12']);
    setCurrentBarLabel(ctx, '8');
    expect(makeTriggerSequence(ctx, track, [makeCTable(ctx, 'C')], pattern)).toEqual([]);
    setCurrentBarLabel(ctx, '12');
    expect(makeTriggerSequence(ctx, track, [makeCTable(ctx, 'C')], pattern)).toHaveLength(1);
  });

  it('truncates overlapping trigger patterns', () => {
    const ctx = makeContext();
    const track = new BassTrack(ctx, 'BASS');
    setTrigger(ctx, track, ['Beats=1,2,3,4', 'Truncate=True']);
    const pattern = [new PatternEvent()];
    pattern[0]!.duration = ctx.barLen;
    const out = makeTriggerSequence(ctx, track, [makeCTable(ctx, 'C')], pattern);
    // Each copy is shortened to the start of the next (or the bar end).
    expect(out.map((e) => e.duration)).toEqual([ctx.BperQ, ctx.BperQ, ctx.BperQ, ctx.BperQ]);
  });

  it('rejects invalid tracks and options', () => {
    const ctx = makeContext();
    const bass = new BassTrack(ctx, 'BASS');
    expect(() => setTrigger(ctx, bass, ['Nope'])).toThrow(/unknown command/);
    expect(() => setTrigger(ctx, bass, ['Beats=1', 'Count=0'])).toThrow(/greater than 0/);
    expect(() => setTrigger(ctx, bass, ['Sequence='])).toThrow(/expecting {patterns...}/);

    const plectrum = new PlectrumTrack(ctx, 'PLECTRUM');
    expect(() => setTrigger(ctx, plectrum, ['Beats=1'])).not.toThrow();
  });

  it('OFF resets the trigger to the empty default', () => {
    const ctx = makeContext();
    const track = new BassTrack(ctx, 'BASS');
    setTrigger(ctx, track, ['Beats=1,3']);
    setTrigger(ctx, track, []);
    expect(track.trigger.mode).toBe('ON');
    expect(track.trigger.beats).toEqual([]);
    expect(() => setTrigger(ctx, track, ['Off', 'Beats=1'])).toThrow(/must be the only arg/);
  });
});

describe('RPITCH', () => {
  it('formats options like Python and applies chromatic offsets', () => {
    const ctx = makeContext();
    const track = new BassTrack(ctx, 'BASS');

    expect(rpitchGetOpts(track)).toBe('None');

    setRPitch(ctx, track, [
      'Scale=Scale',
      'Offsets=-2,3,-4-2',
      'Rate=50',
      'Beats=2,4',
      'Bars=1,3',
    ]);
    expect(rpitchGetOpts(track)).toBe(
      'Rate=50 ScaleType=SCALE Offsets=-2,3,-4,-3,-2,-1,0,1,2 Bars=1,3 Beats=1,3',
    );

    // Chromatic mode adds a random offset when rate/bars/beats match.
    setRPitch(ctx, track, ['Scale=Chromatic', 'Offsets=2', 'Rate=100']);
    expect(doRpitch(ctx, track, 0, 60)).toBe(62);
    ctx.seqCount = 3;
    track.rPitch!.bars = [2];
    expect(doRpitch(ctx, track, 0, 60)).toBe(60); // not in Bars=2
    track.rPitch!.bars = [3];
    track.rPitch!.beats = [ctx.BperQ];
    expect(doRpitch(ctx, track, 0, 60)).toBe(60); // not on Beats=2
    expect(doRpitch(ctx, track, ctx.BperQ, 60)).toBe(62);
  });

  it('normalizes out-of-range notes and skips when mode is off', () => {
    const ctx = makeContext();
    const track = new BassTrack(ctx, 'BASS');
    expect(doRpitch(ctx, track, 0, 60)).toBe(60);

    setRPitch(ctx, track, ['Scale=Chromatic', 'Offsets=5', 'Rate=100']);
    expect(doRpitch(ctx, track, 0, 125)).toBe(118); // 130 wrapped down
    expect(doRpitch(ctx, track, 0, 2)).toBe(7);

    setRPitch(ctx, track, ['Off']);
    expect(track.rPitch).toBeNull();
  });

  it('rejects drums and unknown options; warns for plectrum', () => {
    const ctx = makeContext();
    const drum = new DrumTrack(ctx, 'DRUM');
    expect(() => setRPitch(ctx, drum, ['Offsets=1'])).toThrow(/drum track/);

    const plectrum = new PlectrumTrack(ctx, 'PLECTRUM');
    setRPitch(ctx, plectrum, ['Offsets=1']);
    expect(plectrum.rPitch?.offsets).toEqual([]);

    const bass = new BassTrack(ctx, 'BASS');
    expect(() => setRPitch(ctx, bass, ['Nope=1'])).toThrow(/unknown option/);
  });
});

describe('ARIA', () => {
  it('builds the KEY note list from a minor key signature', () => {
    const ctx = makeContext();
    ctx.keySig.create(['A', 'minor']);
    const track = new AriaTrack(ctx, 'ARIA');
    track.setChannel(['3']);
    track.definePattern('P1', '1 4 90');
    track.sequence = [ctx.pats.get('ARIA', 'P1') as Pattern];
    track.setScaletype(['KEY']);
    track.bar([makeCTable(ctx, 'Cmaj7')]);

    const notes: number[] = [];
    for (const evs of ctx.mtrks.tracks.get(3)!.miditrk.values()) {
      for (const e of evs) if ((e[0]! & 0xf0) === 0x90 && e[2]! > 0) notes.push(e[1]!);
    }
    // ChordNotes('Am') scale list (raw offsets); the default direction
    // [1] steps to index 1 (B flat) which is adjusted into octave 4.
    expect(track.notes.slice(0, 4)).toEqual([-3, -1, 0, 2]);
    expect(notes).toEqual([47]);
  });

  it('sets and expands the deplete list with ScaleType', () => {
    const ctx = makeContext();
    const track = new AriaTrack(ctx, 'ARIA');
    track.setScaletype(['CHROMATIC-', 'SCALE']);
    expect(track.deplete).toEqual([1, 0, 1, 0]);
    expect(track.scaleType).toEqual(['CHROMATIC', 'SCALE', 'CHROMATIC', 'SCALE']);
  });

  it('accepts integer and r-direction lists but rejects out-of-range', () => {
    const ctx = makeContext();
    const track = new AriaTrack(ctx, 'ARIA');
    track.setDirection(['1', '-2', 'rr']);
    expect(track.selectDir).toEqual([1, -2, 'RR']);
    expect(() => track.setDirection(['5'])).toThrow(/args must be 'r' or -4 to 4/);
    expect(() => track.setDirection(['rrrrr'])).toThrow(/too much randomness/);
    expect(() => track.setDirection([])).toThrow(/at least one value/);
  });
});

describe('LYRIC', () => {
  it('formats the setting string like Python', () => {
    const ctx = makeContext();
    expect(lyricSetting(ctx)).toBe(
      'Event=Lyric Split=Normal Verse=1 Chords=Off Transpose=0 CNames=Flat KAR=Off',
    );
    lyricOption(ctx, ['Event=Text', 'Split=Bar', 'Verse=3', 'Chords=On', 'Transpose=2', 'Cnames=Sharp', 'Karmode=Off']);
    expect(lyricSetting(ctx)).toBe(
      'Event=Text Split=Bar Verse=3 Chords=On Transpose=2 CNames=Sharp KAR=Off',
    );
  });

  it('extracts the requested verse and returns the syllables', () => {
    const ctx = makeContext();
    lyricOption(ctx, ['Verse=2']);
    const [ln, lyrics] = lyricExtract(ctx, 'C [hel-lo] [world]', 1);
    expect(ln).toBe('C');
    expect(lyrics).toEqual(['world']);

    const events = ctx.mtrks.meta().miditrk.get(0) ?? [];
    const text = events.filter((e) => e[1] === 0x05).map((e) => String.fromCharCode(...e.slice(3)));
    expect(text).toEqual(['world ']);
  });

  it('consumes pushed LYRIC SET data and reports leftovers', () => {
    const ctx = makeContext();
    lyricOption(ctx, ['Set', 'hello', 'there']);
    lyricOption(ctx, ['Set', 'second']);
    expect(getLyric(ctx).pushedLyrics).toHaveLength(2);

    const [ln, lyrics] = lyricExtract(ctx, 'C', 1);
    expect(ln).toBe('C');
    expect(lyrics).toEqual(['hello', 'there']);
    expect(getLyric(ctx).pushedLyrics).toHaveLength(1);

    lyricLeftovers(ctx);
    expect(ctx.rep.warnings.map((w) => w.message)).toContain('Lyrics remaining on stack');
  });

  it('supports <beat> offsets and bar splitting', () => {
    const ctx = makeContext();
    const [, lyrics] = lyricExtract(ctx, 'C [one<3> two <4>]', 1);
    expect(lyrics).toEqual(['one<3>', 'two', '<4>']);
    let eventCount = 0;
    for (const evs of ctx.mtrks.meta().miditrk.values()) {
      eventCount += evs.filter((e) => e[1] === 0x05).length;
    }
    const ticks = [...ctx.mtrks.meta().miditrk.keys()].sort((a, b) => a - b);
    // 'one' at beat 3 (2*BperQ); 'two' steps by (4-2)/2 beats from there.
    expect(ticks).toEqual([2 * ctx.BperQ, 2 * ctx.BperQ + 128]);
    expect(eventCount).toBe(2);
  });

  it('rejects mismatched brackets and option errors', () => {
    const ctx = makeContext();
    expect(() => lyricExtract(ctx, 'C [oops', 1)).toThrow(/Mismatched \[\]s/);
    expect(() => lyricOption(ctx, ['Event=Both'])).toThrow(/EVENT are TEXT or LYRIC/);
    expect(() => lyricOption(ctx, ['Split=Half'])).toThrow(/SPLIT are BAR or NORMAL/);
    expect(() => lyricOption(ctx, ['Verse=0'])).toThrow(/must be > 0/);
    expect(() => lyricOption(ctx, ['Cnames=Sideways'])).toThrow(/expecting 'Sharp' or 'Flat'/);
    expect(() => lyricOption(ctx, ['Nope=1'])).toThrow(/Usage: Lyric expecting/);
    lyricOption(ctx, ['Set', 'x']);
    expect(() => lyricExtract(ctx, 'C [inline]', 1)).toThrow(/not permitted inline and as LYRIC SET/);
  });
});

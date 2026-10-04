/**
 * Golden-conformance corpus.
 *
 * Every entry here is rendered by both the reference Python MMA
 * (scripts/gen-fixtures.ts -> test/fixtures/golden/<name>.json) and the
 * TypeScript façade; test/api/conformance.test.ts asserts the two event
 * streams are identical.  Only add entries that pass - this list is the
 * milestone gate, not a wish list.
 */

export interface CorpusEntry {
  name: string;
  /** Path relative to the mma repo root. */
  file: string;
  /** Extra CLI args for mma (placed before the song). */
  args?: string[];
  /** Lines prepended to the song (e.g. "RndSeed 1"). */
  prelude?: string;
  /** Working directory for the Python run, relative to the repo root. */
  cwd?: string;
  /** Event kinds ignored on both sides (e.g. Python-only cosmetics). */
  ignoreKinds?: string[];
  /** Resource set for the TS run; default 'library'. */
  resources?: 'm1' | 'library';
}

export const CORPUS: CorpusEntry[] = [
  // --- M1 vertical slice -------------------------------------------------
  { name: 'm1-basic', file: 'ts/test/fixtures/m1/basic.mma', resources: 'm1' },
  { name: 'm1-groove', file: 'ts/test/fixtures/m1/groove-test.mma', cwd: 'ts/test/fixtures/m1', resources: 'm1' },

  // --- M2 gate: stock example songs (added one by one as they become
  // event-identical with the reference implementation).  Songs with no
  // musical data (macro/print demos) are excluded: the Python CLI refuses
  // to write a meta-only MIDI ("No data created"), so they have no oracle.
  // Rvolume/Rskip/Rtime/SeqRnd are random: pin the seed on both sides.
  { name: 'egs-delay-root', file: 'egs/delay/delay-root.mma', prelude: 'RndSeed 1' },
  { name: 'egs-simple-marine-hymn', file: 'egs/simple/marine-hymn.mma', prelude: 'RndSeed 1' },
  { name: 'egs-misc-voicing', file: 'egs/misc/voicing.mma' },
  { name: 'egs-misc-cascade', file: 'egs/misc/cascade.mma', prelude: 'RndSeed 1' },
  { name: 'egs-misc-grooves', file: 'egs/misc/grooves.mma', prelude: 'RndSeed 1' },
  { name: 'egs-rndset-rndchords', file: 'egs/rndset/rndchords.mma', prelude: 'RndSeed 1' },
  { name: 'egs-scales', file: 'egs/scales/scales.mma', prelude: 'RndSeed 1' },

  { name: 'egs-voicing', file: 'egs/voicing/voicing.mma' },

  // --- M2 gate: stock grooves from the shipped libraries -----------------
  // Songs under test/fixtures/grooves/ render one lib groove each; this is
  // what exercises the SCALE/WALK/ARPEGGIO tracks against the oracle.
  ...([
       'SWING',
       'SLOWSWING',
       'SWINGINTRO',
       'POPWALTZ',
       'METRONOME4',
       'METRONOME2-4',
       'BLUES',
       'SALSA',
       'FUNK1',
       'FUNK2',
       '16BEATBALLAD1',
       '16BEATBALLAD2',
       'BASICROCK',
       'BLUEGRASS',
       'TANGO',
       'WALTZ',
       'MARCH',
       'MAMBO',
       'SAMBA',
       'SWINGTRIPLE',
       'SWING2',
       'SOUL',
       'POP',
       'ROCK1',
       'ROCK2',
       'HOUSE',
       'TECHNO',
       'FOLK',
       'MARCH2',
       'POLKA',
       'SKA',
       '60SROCK',
       'JAZZWALTZ',
     ] as const).map(
    (g): CorpusEntry => ({ name: `groove-${g.toLowerCase()}`, file: `ts/test/fixtures/grooves/${g}.mma` }),
  ),
];

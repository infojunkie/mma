/**
 * Golden-conformance corpus.
 *
 * Every entry here is rendered by both the reference Python MMA
 * (scripts/gen-fixtures.ts -> test/fixtures/golden/<name>.json) and the
 * TypeScript façade; test/api/conformance.test.ts asserts the two event
 * streams are identical.  Only add entries that pass - this list is the
 * milestone gate, not a wish list.
 */

import type { IMMAPlugin } from '../../src/plugin/IMMAPlugin';
import { slashPlugin } from '../../plugins/slash';
import { addgmPlugin } from '../../plugins/addgm';
import { copyrightPlugin } from '../../plugins/copyright';
import { extendPlugin } from '../../plugins/extend';
import { helloPlugin } from '../../plugins/hello';
import { qriffPlugin } from '../../plugins/qriff';
import { rhythmPlugin } from '../../plugins/rhythm';

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
  /** Plugins active for the TS run (Python loads them via `Plugin NAME`). */
  plugins?: IMMAPlugin[];
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
  { name: 'egs-arpeggiate-intro', file: 'egs/arpeggiate/intro.mma', prelude: 'RndSeed 1' },
  { name: 'egs-delay-round', file: 'egs/delay/round.mma', prelude: 'RndSeed 1' },
  { name: 'egs-harmony', file: 'egs/harmony/harmony.mma', prelude: 'RndSeed 1' },
  { name: 'egs-solo-drum-sequence', file: 'egs/solo/drum-sequence.mma', prelude: 'RndSeed 1' },
  { name: 'egs-solo-sequence', file: 'egs/solo/solo-sequence.mma', prelude: 'RndSeed 1' },
  { name: 'egs-mid2seq-style', file: 'egs/midi-inc/mid2seq/shes-just-my-style.mma', prelude: 'RndSeed 1' },

  // --- M2 gate: MidiInc imports (egs/midi-inc) ---------------------------
  // The songs open their recorded .mid files cwd-relative, so the Python
  // runs use cwd = the song's directory while the TS run resolves the name
  // against the source file's directory (the corpus test passes entry.file
  // as the source name).
  { name: 'egs-midiinc-frankie2', file: 'egs/midi-inc/frankie2.mma', cwd: 'egs/midi-inc', prelude: 'RndSeed 1' },
  { name: 'egs-midiinc-frankie3', file: 'egs/midi-inc/frankie3.mma', cwd: 'egs/midi-inc', prelude: 'RndSeed 1' },
  { name: 'egs-midiinc-frankie4', file: 'egs/midi-inc/frankie4.mma', cwd: 'egs/midi-inc', prelude: 'RndSeed 1' },
  { name: 'egs-midiinc-solo-seq', file: 'egs/midi-inc/mid2seq/solo-seq.mma', cwd: 'egs/midi-inc/mid2seq', prelude: 'RndSeed 1' },
  { name: 'egs-midiinc-test', file: 'egs/midi-inc/mid2seq/test.mma', cwd: 'egs/midi-inc/mid2seq', prelude: 'RndSeed 1' },
  { name: 'egs-midiinc-rockgroove', file: 'egs/midi-inc/mid2seq/rockgroove.mma', cwd: 'egs/midi-inc/mid2seq', prelude: 'RndSeed 1' },


  { name: 'egs-voicing', file: 'egs/voicing/voicing.mma' },

  // --- M4: core features (Truncate/After) and shipped plugins ------------
  // egs/misc/truncate.mma also needs the (unported) PLECTRUM track via
  // Groove JazzGuitar, so these purpose-built fixtures cover the feature.
  { name: 'feature-truncate', file: 'ts/test/fixtures/features/truncate.mma', prelude: 'RndSeed 1' },
  { name: 'feature-after', file: 'ts/test/fixtures/features/after.mma', prelude: 'RndSeed 1' },
  { name: 'feature-after-recurse', file: 'ts/test/fixtures/features/after-recurse.mma', prelude: 'RndSeed 1' },
  // The plugin test.mma songs: Python finds plugins/<name>/plugin.py from
  // the mma repo root (cwd = default); TS gets the activated plugin object.
  {
    name: 'plugin-extend',
    file: 'plugins/extend/test.mma',
    prelude: 'RndSeed 1',
    plugins: [extendPlugin],
  },
  {
    name: 'plugin-qriff',
    file: 'plugins/qriff/test.mma',
    prelude: 'RndSeed 1',
    plugins: [qriffPlugin],
  },
  // addgm/hello/copyright/rhythm ship no playable test.mma (or none at
  // all), so these fixtures add data lines to make a MIDI oracle possible.
  { name: 'feature-addgm', file: 'ts/test/fixtures/features/addgm.mma', prelude: 'RndSeed 1', plugins: [addgmPlugin] },
  { name: 'feature-hello', file: 'ts/test/fixtures/features/hello.mma', prelude: 'RndSeed 1', plugins: [helloPlugin] },
  {
    name: 'feature-copyright',
    file: 'ts/test/fixtures/features/copyright.mma',
    prelude: 'RndSeed 1',
    plugins: [copyrightPlugin],
  },
  { name: 'feature-rhythm', file: 'ts/test/fixtures/features/rhythm.mma', prelude: 'RndSeed 1', plugins: [rhythmPlugin] },

  // --- M3: songs produced by the MusicXML converter (parent repo) ---------
  // take-five.mma needs the (missing) iRealPro-MediumUpSwing54 groove, and
  // salma-ya-salama.mma needs the Slash data plugin: neither can be
  // rendered by the reference Python in this checkout.
  { name: 'countryblues', file: '../test/data/countryblues.mma', cwd: '..', prelude: 'RndSeed 1' },
  // Uses the parent's iRealPro groove (grooves/irealpro/irealpro.mma).
  {
    name: 'take-five',
    file: '../test/data/take-five.mma',
    cwd: '..',
    prelude: 'RndSeed 1',
    plugins: [slashPlugin],
  },
  // Uses `Plugin Slash` + `@Slash` declarations from the parent converter.
  {
    name: 'salma-ya-salama',
    file: '../test/data/salma-ya-salama.mma',
    cwd: '..',
    prelude: 'RndSeed 1',
    plugins: [slashPlugin],
  },
  {
    name: 'batwanness-beek',
    file: '../test/data/batwanness-beek.mma',
    cwd: '..',
    prelude: 'RndSeed 1',
    plugins: [slashPlugin],
  },
  {
    name: 'maqam-rast',
    file: '../test/data/maqam-rast.mma',
    cwd: '..',
    prelude: 'RndSeed 1',
    plugins: [slashPlugin],
  },
  {
    name: 'jins-rast-intro',
    file: '../test/data/jins-rast-intro.mma',
    cwd: '..',
    prelude: 'RndSeed 1',
    plugins: [slashPlugin],
  },
  {
    name: 'rast-tetrachord',
    file: '../test/data/rast-tetrachord.mma',
    cwd: '..',
    prelude: 'RndSeed 1',
    plugins: [slashPlugin],
  },

  { name: 'delay-solo', file: 'egs/delay/solo.mma', prelude: 'RndSeed 1' },
  { name: 'misc-extended-voice', file: 'egs/misc/extended-voice.mma', prelude: 'RndSeed 1' },
  { name: 'volume-midivolume', file: 'egs/volume/midivolume.mma', prelude: 'RndSeed 1' },
  { name: 'wheel-pianos', file: 'egs/wheel/pianos.mma', prelude: 'RndSeed 1' },
  { name: 'harmony-smile', file: 'egs/harmony/smile.mma', prelude: 'RndSeed 1' },

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

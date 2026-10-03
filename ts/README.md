# @music-i18n/mma — TypeScript Musical MIDI Accompaniment

A browser-first TypeScript implementation of [MMA — Musical MIDI
Accompaniment](http://www.mellowood.ca/mma/), the language for generating
accompaniment MIDI from chord progressions and grooves.

This package is a port of the Python MMA (GPL-2.0-or-later) and is
licensed GPL-3.0-only.

## Design

- **No filesystem.** The library is text-in / bytes-out: songs are
  strings, outputs are `ArrayBuffer`s. Includes and groove libraries are
  resolved through an injectable `MMAResources` (an in-memory map or
  HTTP fetch).
- **Independent façades.** Every `MMA` instance owns its own
  `MMAContext`; module scope holds only immutable tables. You can run
  several instances concurrently.
- **Output-oriented API.** Distinct outputs are distinct methods
  (`parse`, `toMIDI`, `previewGroove`, `grooveJSON`, …); CLI flags that
  tune a method are passed as options structs (`MIDIOptions`,
  `MMAOptions`).
- **MIDI via spessasynth.** Standard MIDI files are produced with
  [`spessasynth_core`](https://www.npmjs.com/package/spessasynth_core);
  browser playback is available through the optional
  `@music-i18n/mma/player` entry, which wraps
  [`spessasynth_lib`](https://www.npmjs.com/package/spessasynth_lib).
- **Plugins are objects.** `IMMAPlugin` mirrors the Python plugin entry
  points (`run`, `trackRun`, `dataRun`, `help`) and plugins are passed
  per call; there is no dynamic loading in the browser.

## Usage

```ts
import { MMA, MemoryResources, GrooveIndex } from '@music-i18n/mma';

const resources = new MemoryResources({
  'lib/stdlib/swing.mma': swingLibText,
});
const mma = new MMA({ resources });

const result = await mma.toMIDI(`
  Time 4
  Groove Swing8
  C
  F
  G7
  C
`, { maxBars: 64, seed: 1 });

// result.bytes      -> ArrayBuffer (Standard MIDI File)
// result.model      -> JSON-serializable song model
// result.warnings   -> collected warnings
```

Browser playback:

```ts
import { MMAPlayer, SpessaPlayerBackend } from '@music-i18n/mma/player';

const backend = await SpessaPlayerBackend.create({
  audioContext,
  soundBank: await (await fetch('/soundfont.sf3')).arrayBuffer(),
  processorUrl: '/spessasynth_processor.min.js',
});
const player = new MMAPlayer(backend);
await player.load({ binary: result.bytes });
player.play();
```

## Assets

The groove libraries (`.mma` files) and `grooves.index.json` live under
`assets/` in the published package. Serve them over HTTP and use
`HttpResources`, or bundle them with `MemoryResources`. Regenerate with
`npm run assets`.

## Development

```bash
npm install
npm test          # vitest: unit + integration + golden conformance
npm run build     # tsup: ESM + .d.ts for . and ./player
npx tsx scripts/gen-fixtures.ts --write   # regenerate Python golden fixtures (needs python3)
```

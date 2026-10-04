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
  (`parse`, `toMIDI`, …); CLI flags that tune a method are passed as
  options structs (`MIDIOptions`, `MMAOptions`).
- **MIDI via spessasynth.** Standard MIDI files are produced with
  [`spessasynth_core`](https://www.npmjs.com/package/spessasynth_core).
  Playback is left to the host application (see the demo).
- **Plugins are objects.** `IMMAPlugin` mirrors the Python plugin entry
  points (`run`, `trackRun`, `dataRun`, `help`) and plugins are passed
  per call; there is no dynamic loading in the browser.
- **Grooves are loaded on demand.** The package ships no groove data.
  Build a compressed groove database from the `.mma` libraries and load
  it at runtime — see below.

## Usage

```ts
import { MMA, GrooveDatabase, MemoryResources } from '@music-i18n/mma';

const mma = new MMA();

// Optional: load the groove database (cached in the browser).
const db = await GrooveDatabase.load('/assets/mma-grooves.db.gz');
mma.setGrooveDatabase(db);            // or: new MMA({ grooveDatabase: db })

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

Songs that need no groove library can run with the built-in empty
resources; `Include`/`Use` files can be supplied per call via
`new MMA({ resources: new MemoryResources({ 'TestLib.mma': text }) })`.

**Text encoding:** `.mma` sources are cp1252 by default (like Python
MMA), and groove files do use non-ASCII characters (`m°`, `vø7`, …). If
you fetch bytes, decode with `decodeMMAText(bytes)` rather than
`Response.text()`, which assumes UTF-8.

### Plain browser page (no bundler)

`dist/index.js` keeps `spessasynth_core` as an external bare import, so a
page without a bundler needs an import map (the demo does exactly this):

```html
<script type="importmap">
  {
    "imports": {
      "spessasynth_core": "https://cdn.jsdelivr.net/npm/spessasynth_core@4.3.22/+esm"
    }
  }
</script>
<script type="module">
  import { MMA } from './node_modules/@music-i18n/mma/dist/index.js';
  const mma = new MMA();
  const result = await mma.toMIDI('Time 4\nC\nF\nG7\nC\n');
</script>
```

## Groove database

One object holds both the groove index (name → file) and the `.mma` file
contents, and doubles as the `MMAResources` loader — so `Groove`, `Use`
and `Include` all resolve inside it. `npm run grooves` packs every `.mma`
file from the MMA libraries (`../lib`, `../../grooves`, `../includes`)
into a single gzipped JSON archive at `assets/mma-grooves.db.gz`
(~0.3 MB / 1,987 grooves).

```ts
const db = await GrooveDatabase.load('/assets/mma-grooves.db.gz');
const mma = new MMA({ grooveDatabase: db });   // or mma.setGrooveDatabase(db)

db.lookup('SWING8');          // { file: 'lib/stdlib/swing.mma', description?: ... }
db.listGrooves('SWING');      // [{ name, file, description }, ...]
```

Databases are **additive** — merge another archive in bulk, or add a
single `.mma` file; later entries override earlier ones:

```ts
await db.add('/more-grooves.db.gz');            // URL, bytes or parsed JSON
db.addGrooveFile('mine/my-groove.mma', mmaText); // returns the names it defines
const snapshot = db.toJson();                    // serialize (incl. contents)
```

- URL loads (in `load` and `add`) are cached with the browser Cache API
  by default: `{ cache: false }` opts out, `cacheName` namespaces.
- Pass bytes directly (`GrooveDatabase.load(arrayBuffer)`), e.g. fetched
  from IndexedDB or bundled by your build.
- An index-only JSON (no `sources`) can be combined with another
  `resources` loader, e.g. via `new MMA({ resources, grooveDatabase })`.

## Demo

A dependency-free demo lives in `demo/`: an editable MMA textarea, a
groove-database loader and playback through spessasynth_lib loaded from
a CDN.

```bash
npm run demo        # builds the library and the groove database, then serves ./ at :8080
# open http://localhost:8080/demo/
```

## Development

```bash
npm install
npm test          # vitest: unit + integration + golden conformance
npm run build     # tsup: ESM + .d.ts
npm run typecheck
npx tsx scripts/gen-fixtures.ts --write   # regenerate Python golden fixtures (needs python3)
npx tsx scripts/check-conformance.ts      # corpus diff report against Python
```

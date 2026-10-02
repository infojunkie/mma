# MMA in the browser — Pyodide test harness

A local web page that loads the wheel built by `uv build` into
[Pyodide](https://pyodide.org/) (CPython in WebAssembly), runs MMA over
`sample.mma`, and plays the generated MIDI with
[spessasynth_lib](https://github.com/spessasus/spessasynth_lib).

It exists to check the *packaged* artifact in an environment that is about as
unlike a Linux shell as it gets: no `subprocess`, no real filesystem, no
terminal. If the wheel works here, the packaging is sound.

## Running it

```sh
cd test
npm install          # once; pulls in spessasynth_lib
npm start            # http://127.0.0.1:8090/
```

`uv build` must have been run in the repository root first — the server serves
the wheel out of `../dist/`. The page bootstraps Pyodide and the SoundFont from
CDNs, so the first load needs network access.

Use `node serve.mjs --port 1234` (or `PORT=1234`) to change the port. The server
binds to `127.0.0.1` only.

## What it does

1. Boots Pyodide from a pinned CDN version.
2. `micropip.install`s the newest wheel in `../dist/`, resolved at runtime via
   `/api/wheel` so nothing has to hardcode a version.
3. Writes the textarea contents into Pyodide's in-memory filesystem, sets
   `sys.argv`, and calls `MMA.cli.main()`.
4. Reads the resulting `.mid` back out and hands the bytes to spessasynth_lib:
   an `AudioWorklet` synthesizer plus a `Sequencer`.

Press **Convert to MIDI** to run and play. Edit the song and press it again to
re-run; **Stop** pauses playback.

## Why the package needed a change

`MMA/player.py` and `MMA/writeMid.py` used to `import subprocess` at module
level, and both are on the import chain that `import MMA.main` pulls in. Pyodide
has no `subprocess`, so nothing imported at all. Each import now sits inside the
one function that uses it, which leaves behaviour on a normal Python unchanged
and makes the published wheel usable from any WASM or embedded interpreter.

## Groove references in `sample.mma`

The sample names its library file explicitly:

```
Groove stdlib/swing:Swing
```

rather than the bare `Groove Swing`. The groove database (`.mmaDB`) is not
shipped in the wheel — it records absolute paths — so bare names have nothing to
resolve against until someone runs `mma -G`. Naming the file works with no
database at all.

## Known limits

- MMA's mainline is module-level code that runs on import, and it reads
  `sys.argv` at that moment. The page works around both by dropping every `MMA`
  module from `sys.modules` before each run. If a second run ever misbehaves,
  reload the page — and please report it.
- Everything lives in memory. Reloading throws the interpreter state away, which
  is also the most reliable reset.
- Audio starts only after you click, because browsers require a user gesture
  before an `AudioContext` may produce sound.
- Options that need a real OS are out of scope here: `-P`/`-V` (external MIDI
  player), `-xTsplit`/`-xCSplit` (re-invoke `mma`), `-g`/`-G` (write a database),
  plugins (they prompt on stdin), and reading from stdin with `-`.

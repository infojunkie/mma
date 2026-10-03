# MMA in the browser

A local web page that loads the wheel built by `uv build` into
[Pyodide](https://pyodide.org/) (CPython in WebAssembly), runs MMA over
`sample.mma`, and plays the generated MIDI with
[spessasynth_lib](https://github.com/spessasus/spessasynth_lib).

It doubles as a check on the *packaged* artifact in an environment about as
unlike a Linux shell as it gets: no `subprocess`, no real filesystem, no
terminal. If the wheel works here, the packaging is sound.

## Running it

```sh
cd web
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

## No bundler

`index.html` carries an import map pointing the bare specifiers
(`spessasynth_lib`, `spessasynth_core`, `stb-vorbis`) at the packages in
`node_modules`, which is why the page needs no build step.

A missing entry there fails only in the browser, as
`Failed to resolve module specifier "..."`. So the server walks the mapped
bundles at startup and prints any specifier they import that the map does not
define, along with a target file that does not exist. If you update
`spessasynth_lib` and the page stops loading, read the server output first — it
will name what to add.

## Why the package needed a change

`MMA/player.py` and `MMA/writeMid.py` used to `import subprocess` at module
level, and both are on the import chain that `import MMA.main` pulls in. Pyodide
has no `subprocess`, so nothing imported at all. Each import now sits inside the
one function that uses it, which leaves behaviour on a normal Python unchanged
and makes the published wheel usable from any WASM or embedded interpreter.

## Grooves

Two libraries are available to the page.

**The wheel's own**, under `MMA/lib` — `stdlib`, `casio`, `zoom`, `pflib`,
`yamaha`, `kara` and `alexis`, 281 `.mma` files in all. The page finds these
automatically, exactly as an installed `mma` does.

**The parent repository's** `musicxml-midi/grooves/`, which is *not* part of the
wheel. The dev server publishes that directory at `/grooves/` and lists it at
`/api/grooves`; the page fetches each `.mma` file at boot, writes it into
Pyodide's filesystem, and puts that directory on MMA's library path
(`MMA_LIBPATH`). So a song can reference them the same way the command line can
once `mmarc` has `SetLibPath ./grooves $_LibPath`:

```
Groove brazil/forro-miranda:Baiao-Miranda
```

Point it somewhere else with `node serve.mjs --grooves /path/to/grooves`. If the
directory is missing the server says so and the page carries on without it —
`sample.mma` does not depend on it.

### Why the file has to be named

Both examples above spell out the library file. The bare form, `Groove Swing`,
needs the groove database that `mma -G` builds, and that is deliberately not
shipped: its keys are absolute paths, so it is only valid in the location it was
built in. Naming the file goes through the library search instead and works with
no database at all.

Anything from the parent's `grooves/` therefore needs the explicit form too,
unless you run `mma -G` yourself. The `.mmaDB` files in that directory are
stale — they name paths from whenever they were built — which is why the server
skips dotfiles and refuses to serve them.

### Watch the metre

A groove file sets its own time signature. `forro-miranda.mma` opens with
`Time 2` / `TimeSig 2/4`, so a song using `Baiao-Miranda` takes at most two
chords per bar; four gives `Too many chords specified in line`.

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

// Runs the locally built MMA wheel under Pyodide and plays the result.
//
// The flow: boot Pyodide -> micropip install the wheel served from /dist ->
// run MMA over the textarea's contents inside the WASM filesystem -> hand the
// resulting MIDI bytes to spessasynth_lib.

import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib';

// Bump both of these together; the version is also the CDN path segment.
const PYODIDE_VERSION = '314.0.7';
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const WORKLET_URL = '/node_modules/spessasynth_lib/dist/spessasynth_processor.min.js';
const SOUNDFONT_URL = 'https://spessasus.github.io/SpessaSynth/soundfonts/GeneralUserGS.sf3';

// Paths inside Pyodide's in-memory filesystem. Nothing here touches a real disk.
const SONG_PATH = '/tmp/sample.mma';
const MIDI_PATH = '/tmp/sample.mid';

// Where the parent repository's extra groove libraries are materialized. The
// wheel ships MMA/lib but not those, so they are copied in at boot and this
// directory is put on MMA's library path.
const GROOVE_ROOT = '/tmp/grooves';

const $ = (id) => document.getElementById(id);

function log(text) {
    const el = $('log');
    el.textContent += String(text).replace(/\s+$/, '') + '\n';
    el.scrollTop = el.scrollHeight;
}

function status(text) {
    $('status').textContent = text;
}

// Python side. Defined once, called on every Run.
//
// MMA's mainline is module-level code in MMA/main.py that executes on import
// and keeps its entire state in module globals, so the only way to run it more
// than once in one interpreter is to drop the modules and let them re-import.
const RUNNER = `
import os, sys

os.environ['MMA_ENCODING'] = 'utf-8'


def run_mma(source, song_path, midi_path):
    """Write SOURCE to song_path and run MMA on it, producing midi_path."""
    for name in [m for m in sys.modules if m == 'MMA' or m.startswith('MMA.')]:
        del sys.modules[name]

    with open(song_path, 'w', encoding='utf-8') as f:
        f.write(source)

    if os.path.exists(midi_path):
        os.remove(midi_path)

    # MMA reads its options from sys.argv at import time, so they must be in
    # place before the import below.
    argv, sys.argv = sys.argv, ['mma', '-f', midi_path, song_path]
    try:
        import MMA.cli
        MMA.cli.main()
    except SystemExit as e:
        # A successful run falls off the end of main.py; errors and the
        # informational modes exit instead.
        if e.code not in (0, None):
            raise RuntimeError('MMA exited with status %s' % e.code) from None
    finally:
        sys.argv = argv
`;

let pyodide;
let runMma;
let audio = null;

async function boot() {
    $('song').value = await (await fetch('./sample.mma')).text();

    status('loading Pyodide…');
    const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`);
    pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
    pyodide.setStdout({ batched: log });
    pyodide.setStderr({ batched: log });

    status('installing micropip…');
    await pyodide.loadPackage('micropip');

    status('installing the wheel…');
    const wheel = await (await fetch('/api/wheel')).json();
    log(`wheel: ${wheel.name}`);
    const url = new URL(wheel.url, location.href).href;
    await pyodide.runPythonAsync(
        `import micropip\nawait micropip.install(${JSON.stringify(url)})`);

    pyodide.runPython(RUNNER);
    runMma = pyodide.globals.get('run_mma');

    await loadGrooves();

    status('ready');
    $('run').disabled = false;
}

/**
 * Copy the parent repository's grooves/ into the Pyodide filesystem and put it
 * on MMA's library path, so songs can reference them the same way the command
 * line does once that directory is configured:
 *
 *     Groove brazil/forro-miranda:Baiao-Miranda
 *
 * They are not in the wheel, so without this the page cannot see them. A
 * missing directory is not an error - the bundled sample does not need it.
 */
async function loadGrooves() {
    let listing;
    try {
        listing = await (await fetch('/api/grooves')).json();
    } catch {
        log('grooves: listing unavailable, continuing without them');
        return;
    }
    if (!listing.available || !listing.files.length) {
        log(`grooves: none found at ${listing.dir}, continuing without them`);
        return;
    }

    let written = 0;
    for (const rel of listing.files) {
        // These paths come from our own server, but never write outside the root.
        if (rel.startsWith('/') || rel.split('/').includes('..')) continue;
        const text = await (await fetch('/grooves/' + rel)).text();
        const path = `${GROOVE_ROOT}/${rel}`;
        pyodide.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
        pyodide.FS.writeFile(path, text);
        written += 1;
    }

    // MMA reads this when it initializes its library paths, which happens on
    // every run, so setting it once here is enough. The wheel's own libraries
    // are appended separately and stay available.
    pyodide.runPython(`import os\nos.environ['MMA_LIBPATH'] = ${JSON.stringify(GROOVE_ROOT)}`);

    log(`grooves: ${written} files from ${listing.dir}`);
}

/** Create the synthesizer, load the SoundFont, and cache it all. */
async function ensureAudio() {
    if (audio) return audio;

    status('loading soundfont…');
    const context = new AudioContext();
    await context.audioWorklet.addModule(WORKLET_URL);

    const synth = new WorkletSynthesizer(context);
    synth.connect(context.destination);

    const soundfont = await (await fetch(SOUNDFONT_URL)).arrayBuffer();
    await synth.soundBankManager.addSoundBank(soundfont, 'main');
    await synth.isReady;

    audio = { context, synth, seq: new Sequencer(synth) };
    return audio;
}

async function run() {
    $('run').disabled = true;
    try {
        status('running MMA…');
        runMma($('song').value, SONG_PATH, MIDI_PATH);

        const midi = pyodide.FS.readFile(MIDI_PATH);
        log(`MIDI: ${midi.length} bytes`);

        // slice() so the ArrayBuffer is exactly this file, not a view over a
        // larger one.
        const { context, seq } = await ensureAudio();
        await context.resume();
        seq.loadNewSongList([{ binary: midi.slice().buffer, fileName: 'sample.mid' }]);
        seq.play();

        $('stop').disabled = false;
        status('playing');
    } catch (e) {
        log('ERROR: ' + (e?.message ?? e));
        status('failed — see the log');
    } finally {
        $('run').disabled = false;
    }
}

$('run').addEventListener('click', run);

$('stop').addEventListener('click', () => {
    if (!audio) return;
    audio.seq.pause();
    audio.seq.currentTime = 0;
    $('stop').disabled = true;
    status('stopped');
});

boot().catch((e) => {
    log('ERROR during startup: ' + (e?.message ?? e));
    status('failed to start');
});

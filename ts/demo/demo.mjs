/**
 * MMA TypeScript demo — no build step.
 *
 * Imports the built library from ../dist and spessasynth_lib from a CDN.
 * Run `npm run demo` (from the package root) which builds the library,
 * builds the groove database and serves the package directory.
 */

const SPESSA_VERSION = '4.3.14';
const SPESSA_LIB_URL = `https://cdn.jsdelivr.net/npm/spessasynth_lib@${SPESSA_VERSION}/+esm`;
const SPESSA_PROCESSOR_URL = `https://cdn.jsdelivr.net/npm/spessasynth_lib@${SPESSA_VERSION}/dist/spessasynth_processor.min.js`;
const SOUNDFONT_URL = 'https://spessasus.github.io/SpessaSynth/soundfonts/GeneralUserGS.sf3';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const sourceEl = $('source');
const playBtn = $('play');
const stopBtn = $('stop');

const log = (msg) => {
  statusEl.textContent = msg;
  console.log(msg);
};

// ---------------------------------------------------------------------------
// Library import (dynamic so a missing dist build gets a clear message)

let MMA;
let GrooveDatabase;
try {
  ({ MMA, GrooveDatabase } = await import('./dist/index.js'));
} catch (e) {
  log(
    `Could not import dist/index.js (${e.message}).\n` +
      'Build it with "npm run build", or just use "npm run demo" which builds everything and serves it.',
  );
  throw e;
}

// ---------------------------------------------------------------------------
// Sample sources

const SAMPLE_URL = './sample.mma';

const GROOVE_PRESET = `// Groove preset — requires the groove database (BLUES comes from
// lib/stdlib/blues.mma inside mma-grooves.db.gz).

Time 4
TimeSig 4 4
Tempo 120
KeySig F

Groove BLUES

F
Bb
F
F
Bb
Bb
F
F
C7
Bb
F
C7
`;

// ---------------------------------------------------------------------------
// Audio (spessasynth_lib from CDN), created lazily on first Play

let audioContext = null;
let synth = null;
let sequencer = null;

async function ensureAudio() {
  if (sequencer) return;
  log('Loading spessasynth_lib and the soundfont (first time only)...');
  const { WorkletSynthesizer, Sequencer } = await import(/* @vite-ignore */ SPESSA_LIB_URL);

  audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule(SPESSA_PROCESSOR_URL);

  synth = new WorkletSynthesizer(audioContext);
  synth.connect(audioContext.destination);

  const soundfont = await (await fetch(SOUNDFONT_URL)).arrayBuffer();
  await synth.soundBankManager.addSoundBank(soundfont, 'main');

  sequencer = new Sequencer(synth);
  sequencer.loopCount = 0;
  sequencer.eventHandler.addEvent('songEnded', 'demo', () => {
    stopBtn.disabled = true;
    playBtn.disabled = false;
    log('Playback finished.');
  });
}

// ---------------------------------------------------------------------------
// Groove database

let database = null;
const mma = new MMA();

async function loadDatabase(url) {
  log(`Loading groove database from ${url} ...`);
  const db = await GrooveDatabase.load(url);
  database = db;
  mma.setGrooveDatabase(db);
  log(`Groove database ready: ${db.grooveCount} grooves (cached by the browser on next visit).`);
  return db;
}

// ---------------------------------------------------------------------------
// Actions

async function render() {
  const result = await mma.toMIDI(sourceEl.value, { maxBars: 200 });
  const bars = result.model.barCount;
  const seconds = (result.bytes.byteLength / 1024).toFixed(1);
  const warnings = result.warnings.length ? ` — ${result.warnings.length} warning(s): ${result.warnings[0].message}` : '';
  log(`Rendered ${bars} bars (${seconds} KB of MIDI)${warnings}`);
  return result;
}

async function play() {
  playBtn.disabled = true;
  try {
    await ensureAudio();
    const result = await render();
    await audioContext.resume();
    sequencer.loadNewSongList([{ binary: result.bytes }]);
    sequencer.play();
    stopBtn.disabled = false;
    playBtn.disabled = false;
  } catch (e) {
    playBtn.disabled = false;
    log(`Error: ${e.message}`);
    throw e;
  }
}

function stop() {
  if (sequencer) sequencer.pause();
  stopBtn.disabled = true;
}

async function download() {
  const result = await render();
  const blob = new Blob([result.bytes], { type: 'audio/midi' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'demo.mid';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------
// Wiring

playBtn.addEventListener('click', () => void play());
stopBtn.addEventListener('click', stop);
$('download').addEventListener('click', () => void download().catch((e) => log(`Error: ${e.message}`)));
$('preset-blues').addEventListener('click', () => {
  void (async () => {
    sourceEl.value = await (await fetch(SAMPLE_URL)).text();
    log('Loaded the self-contained blues sample.');
  })();
});
$('preset-groove').addEventListener('click', () => {
  sourceEl.value = GROOVE_PRESET;
  log('Loaded the groove preset — press Play (load the database first if you have not).');
});
$('load-db').addEventListener('click', () => {
  void loadDatabase($('db-url').value).catch((e) => log(`Error: ${e.message}`));
});
$('add-file').addEventListener('change', (event) => {
  void (async () => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!database) {
      database = GrooveDatabase.empty();
      mma.setGrooveDatabase(database);
    }
    const names = database.addGrooveFile(file.name, await file.text());
    log(
      names.length
        ? `Added ${file.name}: ${names.join(', ')} (${database.grooveCount} grooves in database).`
        : `Added ${file.name}: no DefGroove found in it.`,
    );
    event.target.value = '';
  })();
});

// Initial content + best-effort database load.
sourceEl.value = await (await fetch(SAMPLE_URL)).text();
log('Ready. Press Play.');
try {
  await loadDatabase($('db-url').value);
} catch {
  log('Ready (groove database not available — the self-contained sample still plays).');
}

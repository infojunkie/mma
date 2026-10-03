// Static server for the Pyodide test page.
//
// Serves three things, so that the page works with no bundler and no copy step:
//
//   /               the page itself (this directory)
//   /node_modules/  the spessasynth_lib ESM builds, which index.html maps by
//                   bare specifier in its import map
//   /dist/          the wheel that `uv build` wrote to the repository's dist/
//
//   /api/wheel      JSON pointing at the newest wheel, so the page never has
//                   to hardcode a version number
//
// Usage:
//   node serve.mjs [--port 8090]

import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// resolve() strips the trailing separator that fileURLToPath leaves on a
// directory URL; without that, the containment check in within() compares
// against "test//" and rejects every request.
const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const REPO = resolve(HERE, '..');

const argv = process.argv.slice(2);
const portFlag = argv.indexOf('--port');
const PORT = Number(portFlag === -1 ? (process.env.PORT ?? 8090) : argv[portFlag + 1]);
const HOST = '127.0.0.1';

// The parent repository's extra groove libraries (musicxml-midi/grooves). They
// are not part of the wheel, so the page copies them in at boot and puts the
// directory on MMA's library path.
const groovesFlag = argv.indexOf('--grooves');
const GROOVES = resolve(groovesFlag === -1 ? join(REPO, '..', 'grooves') : argv[groovesFlag + 1]);
const GROOVES_URL = '/grooves/';

const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mid': 'audio/midi',
  '.mma': 'text/plain; charset=utf-8',
  '.sf2': 'application/octet-stream',
  '.sf3': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.whl': 'application/octet-stream',
};

// URL prefix -> directory on disk
const MOUNTS = {
  '/node_modules/': join(HERE, 'node_modules'),
  '/dist/': join(REPO, 'dist'),
  [GROOVES_URL]: GROOVES,
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

/** Resolve `rel` (starting with '/') under `root`, refusing to escape it. */
function within(root, rel) {
  const path = resolve(root, '.' + rel);
  return path === root || path.startsWith(root + sep) ? path : null;
}

/** Every bare module specifier in `source` (i.e. not relative and not a URL). */
function bareSpecifiers(source) {
  const found = new Set();
  const re = /(?:from|import)\s*\(?\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(source))) {
    const spec = m[1];
    if (!/^[./]/.test(spec) && !/^[a-z][a-z0-9+.-]*:/i.test(spec)) found.add(spec);
  }
  return found;
}

/**
 * Check the import map in index.html against what the mapped bundles actually
 * import. A missing entry otherwise shows up only as a "Failed to resolve
 * module specifier" error in the browser console, one dependency at a time.
 */
async function checkImportMap() {
  const problems = [];
  const html = await readFile(join(HERE, 'index.html'), 'utf8');
  const block = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (!block) return ['no import map found in index.html'];

  const map = JSON.parse(block[1]).imports ?? {};

  for (const [specifier, target] of Object.entries(map)) {
    const file = within(HERE, target);
    if (!file) {
      problems.push(`"${specifier}" maps outside the test directory`);
      continue;
    }
    let source;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      problems.push(`"${specifier}" -> ${target} is missing (run npm install)`);
      continue;
    }
    for (const bare of bareSpecifiers(source)) {
      if (!(bare in map)) problems.push(`"${specifier}" imports "${bare}", which the import map does not define`);
    }
  }
  return problems;
}

/**
 * The .mma files under GROOVES, as paths relative to it. The browser cannot
 * walk a URL, so it needs this list to know what to fetch.
 *
 * Dotfiles are skipped, which also drops the .mmaDB databases sitting in that
 * tree: they hold paths from whenever they were built and would only make MMA
 * complain that the directories they name do not exist.
 */
async function grooveFiles() {
  const entries = await readdir(GROOVES, { recursive: true });
  return entries
    .filter((p) => p.endsWith('.mma') && !p.split(sep).some((part) => part.startsWith('.')))
    .sort();
}

async function newestWheel() {
  const wheels = (await readdir(join(REPO, 'dist')))
    .filter((f) => f.endsWith('.whl'))
    .sort();
  if (!wheels.length) throw new Error('no wheel');
  // Filenames sort by version in practice; take the last one.
  return wheels[wheels.length - 1];
}

const server = createServer(async (req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }

  // Never serve dotfiles. The grooves tree contains .mmaDB databases holding
  // absolute paths from whenever they were built; the page must not pick those
  // up, and the listing endpoint skips them for the same reason.
  if (path.split('/').some((part) => part.startsWith('.'))) return send(res, 404, 'Not found');

  if (path === '/api/grooves') {
    // Not an error when the directory is absent: the page runs fine without it.
    try {
      return send(res, 200, JSON.stringify({ available: true, dir: GROOVES, files: await grooveFiles() }), TYPES['.json']);
    } catch {
      return send(res, 200, JSON.stringify({ available: false, dir: GROOVES, files: [] }), TYPES['.json']);
    }
  }

  if (path === '/api/wheel') {
    try {
      const name = await newestWheel();
      return send(res, 200, JSON.stringify({ name, url: '/dist/' + name }), TYPES['.json']);
    } catch {
      return send(res, 404, 'No wheel found in dist/. Run `uv build` in the mma repository first.');
    }
  }

  let root = HERE;
  for (const [prefix, dir] of Object.entries(MOUNTS)) {
    if (path.startsWith(prefix)) {
      root = dir;
      path = path.slice(prefix.length - 1);
      break;
    }
  }

  if (path.endsWith('/')) path += 'index.html';

  const file = within(root, path);
  if (!file) return send(res, 403, 'Forbidden');

  try {
    if (!(await stat(file)).isFile()) return send(res, 404, 'Not found');
    send(res, 200, await readFile(file), TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found: ' + path);
  }
});

server.listen(PORT, HOST, async () => {
  console.log(`MMA Pyodide test page: http://${HOST}:${PORT}/`);
  console.log(`  page:    ${HERE}`);
  console.log(`  wheel:   ${join(REPO, 'dist')}`);
  try {
    const files = await grooveFiles();
    console.log(`  grooves: ${GROOVES} (${files.length} .mma files)`);
  } catch {
    console.log(`  grooves: ${GROOVES} (not found - the page will run without them)`);
  }

  const problems = await checkImportMap();
  if (problems.length) {
    console.warn('\nThe page will fail to load - import map problems:');
    for (const p of problems) console.warn(`  - ${p}`);
  }
});

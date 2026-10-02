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

server.listen(PORT, HOST, () => {
  console.log(`MMA Pyodide test page: http://${HOST}:${PORT}/`);
  console.log(`  page:  ${HERE}`);
  console.log(`  wheel: ${join(REPO, 'dist')}`);
});

#!/usr/bin/env node
/**
 * Build the on-demand groove database: a single gzipped JSON archive
 * containing every .mma file of the MMA libraries plus the groove index
 * (the same shape as `GrooveDatabaseJson` in src/groove/GrooveDatabase.ts).
 *
 * Nothing of this ships inside the npm package; serve the generated
 * assets/mma-grooves.db.gz from your app and load it with
 * GrooveDatabase.load(url).
 *
 * Usage: node scripts/build-grooves.mjs [out.gz]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tsDir = resolve(here, '..');
const mmaRepo = resolve(tsDir, '..');

const out = process.argv[2] ?? join(tsDir, 'assets', 'mma-grooves.db.gz');

/** Strip `//` and block comments (mirrors src/groove/scanGrooves.ts). */
function stripComments(text) {
  const lines = [];
  let inComment = false;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw;
    if (inComment) {
      const end = line.indexOf('*/');
      if (end < 0) continue;
      line = line.slice(end + 2);
      inComment = false;
    }
    line = line.split('//', 1)[0];
    let idx;
    while ((idx = line.indexOf('/*')) >= 0) {
      const end = line.indexOf('*/', idx + 2);
      if (end < 0) {
        line = line.slice(0, idx);
        inComment = true;
        break;
      }
      line = line.slice(0, idx) + line.slice(end + 2);
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** Find `DefGroove NAME [description]` definitions. */
function findGrooveDefs(text) {
  const defs = [];
  for (const line of stripComments(text).split('\n')) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length >= 2 && tokens[0].toUpperCase() === 'DEFGROOVE') {
      defs.push({ name: tokens[1].toUpperCase(), description: tokens.slice(2).join(' ') });
    }
  }
  return defs;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (entry.toLowerCase().endsWith('.mma')) out.push(p);
  }
  return out.sort();
}

function buildArchive(roots) {
  const grooves = {};
  const files = {};
  const sources = {};
  for (const { path: root, label } of roots) {
    for (const file of walk(root)) {
      const id = [label, relative(root, file).split(sep).join('/')].filter(Boolean).join('/');
      const text = readFileSync(file, 'utf-8');
      const defs = findGrooveDefs(text);
      files[id] = defs.map((d) => d.name);
      sources[id] = text;
      for (const def of defs) {
        if (!(def.name in grooves)) {
          // first in search order wins
          grooves[def.name] = def.description
            ? { file: id, description: def.description }
            : { file: id };
        }
      }
    }
  }
  return {
    version: 1,
    generatedBy: '@music-i18n/mma',
    roots: roots.map(({ path: p, label }) => ({ id: label, path: p })),
    grooves,
    files,
    sources,
  };
}

const roots = [];
// Search order matters: Python expands the library paths with stdlib
// first (paths.expandLib), so a name defined in several libraries must
// resolve to stdlib.
for (const [label, path] of [
  ['lib/stdlib', join(mmaRepo, 'lib', 'stdlib')],
  ['lib', join(mmaRepo, 'lib')],
  ['grooves', resolve(mmaRepo, '..', 'grooves')],
  ['includes', join(mmaRepo, 'includes')],
]) {
  if (existsSync(path)) roots.push({ path, label });
}

if (roots.length === 0) {
  console.error('No .mma libraries found; run this from the mma repository.');
  process.exit(1);
}

const archive = buildArchive(roots);
const json = JSON.stringify(archive);
const gz = gzipSync(Buffer.from(json, 'utf-8'), { level: 9 });

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gz);

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(
  `Wrote ${out}: ${Object.keys(archive.grooves).length} grooves, ` +
    `${Object.keys(archive.files).length} files, ${kb(json.length)} JSON -> ${kb(gz.length)} gzipped`,
);

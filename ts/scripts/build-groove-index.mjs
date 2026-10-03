#!/usr/bin/env node
/**
 * Build the portable groove index (replaces Python's pickle .mmaDB).
 *
 * Scans the given .mma roots in search order, strips comments and finds
 * `DefGroove NAME` definitions, then writes a JSON index mapping groove
 * name -> resource file id.  The TS parser later verifies names after
 * parsing, so the scanner only needs to find candidates.
 *
 * Usage: node scripts/build-groove-index.mjs <out.json> <root:label>...
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export function stripComments(text) {
  const out = [];
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
    out.push(line);
  }
  return out.join('\n');
}

export function findGrooveNames(text) {
  const names = [];
  for (const line of stripComments(text).split('\n')) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length >= 2 && tokens[0].toUpperCase() === 'DEFGROOVE') {
      names.push(tokens[1].toUpperCase());
    }
  }
  return names;
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

export function buildIndex(roots) {
  const grooves = {};
  const files = {};
  for (const { path: root, label } of roots) {
    for (const file of walk(root)) {
      const id = [label, relative(root, file).split(sep).join('/')].filter(Boolean).join('/');
      const names = findGrooveNames(readFileSync(file, 'utf-8'));
      files[id] = names;
      for (const name of names) {
        if (!(name in grooves)) grooves[name] = { file: id }; // first in search order wins
      }
    }
  }
  return {
    version: 1,
    generatedBy: '@music-i18n/mma',
    roots: roots.map(({ path: p, label }) => ({ id: label, path: p })),
    grooves,
    files,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out, ...rootArgs] = process.argv.slice(2);
  if (!out || rootArgs.length === 0) {
    console.error('Usage: node scripts/build-groove-index.mjs <out.json> <root:label>...');
    process.exit(1);
  }
  const roots = rootArgs.map((a) => {
    const i = a.lastIndexOf(':');
    return { path: a.slice(0, i), label: a.slice(i + 1) };
  });
  const index = buildIndex(roots);
  writeFileSync(out, JSON.stringify(index, null, 0));
  console.log(`Wrote ${out}: ${Object.keys(index.grooves).length} grooves from ${Object.keys(index.files).length} files`);
}

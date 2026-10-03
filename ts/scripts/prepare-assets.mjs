#!/usr/bin/env node
/**
 * Prepare the browser-loadable groove assets under ts/assets/:
 *   - copy the .mma libraries (../lib and ../../grooves)
 *   - build assets/grooves.index.json (resource ids like "lib/stdlib/swing.mma")
 *
 * The assets directory is gitignored and shipped in the npm tarball; in
 * a browser app it is served as static files and loaded through
 * HttpResources (or bundled by the app into MemoryResources).
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from './build-groove-index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tsDir = resolve(here, '..');
const mmaRepo = resolve(tsDir, '..');
const assets = join(tsDir, 'assets');

rmSync(assets, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });

const roots = [];
const libSrc = join(mmaRepo, 'lib');
if (existsSync(libSrc)) {
  cpSync(libSrc, join(assets, 'lib'), { recursive: true });
  roots.push({ path: join(assets, 'lib'), label: 'lib' });
}
const groovesSrc = resolve(mmaRepo, '..', 'grooves');
if (existsSync(groovesSrc)) {
  cpSync(groovesSrc, join(assets, 'grooves'), { recursive: true });
  roots.push({ path: join(assets, 'grooves'), label: 'grooves' });
}

const index = buildIndex(roots);
writeFileSync(join(assets, 'grooves.index.json'), JSON.stringify(index));
console.log(`Assets ready: ${Object.keys(index.grooves).length} grooves, ${Object.keys(index.files).length} files`);

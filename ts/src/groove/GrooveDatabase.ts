/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Groove database: the groove index (name -> file) and the .mma file
 * contents in one object that also acts as the resource loader for
 * groove files.  The npm package ships no groove data; `npm run grooves`
 * packs every .mma library into a single gzipped JSON archive
 * (~300 KB), which applications serve and load at runtime:
 *
 *   const db = await GrooveDatabase.load('/assets/mma-grooves.db.gz');
 *   const mma = new MMA({ grooveDatabase: db });
 *
 * Databases are additive: merge another archive in bulk, or add a
 * single .mma file:
 *
 *   await db.add('/more-grooves.db.gz');
 *   db.addGrooveFile('mine/my-groove.mma', mmaText);
 *
 * URL loads are cached with the browser Cache API by default, so the
 * second visit costs neither network nor decompression.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { MMAError } from '../engine/Errors';
import { normalizeResourceId, type MMAResources } from '../io/MMAResources';
import { findGrooveDefs } from './scanGrooves';

export interface GrooveEntry {
  /** Resource id of the .mma file defining the groove. */
  file: string;
  description?: string;
}

export interface GrooveRef {
  name: string;
  file: string;
  description?: string;
}

/** Serialized form of a groove database (the archive contents). */
export interface GrooveDatabaseJson {
  version: number;
  generatedBy?: string;
  roots?: Array<{ id: string; path: string }>;
  /** Groove name (uppercase) -> defining file. */
  grooves: Record<string, GrooveEntry>;
  /** Optional listing of file id -> groove names (recomputed by toJson). */
  files?: Record<string, string[]>;
  /** Resource id -> raw .mma text.  Absent in index-only databases. */
  sources?: Record<string, string>;
}

/** Minimal Cache API surface used here (structural, so it is mockable). */
export interface GrooveCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface GrooveCacheStorage {
  open(name: string): Promise<GrooveCache>;
}

export interface GrooveDatabaseLoadOptions {
  /** Cache URL loads with the Cache API (default: true when available). */
  cache?: boolean;
  /** Cache name; defaults to 'mma-grooves'. */
  cacheName?: string;
  /** fetch implementation override (tests, non-browser hosts). */
  fetchFn?: typeof fetch;
  /** CacheStorage override (tests); null disables caching. */
  cacheStorage?: GrooveCacheStorage | null;
}

const DEFAULT_CACHE_NAME = 'mma-grooves';

export class GrooveDatabase implements MMAResources {
  private readonly grooves = new Map<string, GrooveEntry>();
  /** resource id -> .mma text. */
  private readonly sources = new Map<string, string>();
  /** resource id -> groove names it contributed (for replacement bookkeeping). */
  private readonly fileNames = new Map<string, string[]>();
  private roots: Array<{ id: string; path: string }> = [];

  private constructor() {}

  /** An empty database; add files or archives to it. */
  static empty(): GrooveDatabase {
    return new GrooveDatabase();
  }

  /** Build from an already-parsed archive/index object (synchronous). */
  static fromJson(json: GrooveDatabaseJson): GrooveDatabase {
    return GrooveDatabase.empty().addJson(json);
  }

  /**
   * Load a groove database from a URL, raw bytes (optionally gzipped),
   * or an already-parsed object.
   */
  static async load(
    source: string | URL | ArrayBuffer | Uint8Array | GrooveDatabaseJson,
    options: GrooveDatabaseLoadOptions = {},
  ): Promise<GrooveDatabase> {
    return GrooveDatabase.empty().add(source, options);
  }

  /**
   * Merge another database archive into this one: URL, bytes (gzipped or
   * plain JSON) or a parsed object.  Entries with the same file id or
   * groove name override the existing ones.
   */
  async add(
    source: string | URL | ArrayBuffer | Uint8Array | GrooveDatabaseJson,
    options: GrooveDatabaseLoadOptions = {},
  ): Promise<this> {
    if (typeof source === 'string' || source instanceof URL) {
      return this.addJson(await decode(await fetchArchiveBytes(String(source), options)));
    }
    if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
      return this.addJson(await decode(source instanceof Uint8Array ? source : new Uint8Array(source)));
    }
    return this.addJson(source);
  }

  /** Merge one .mma file; returns the groove names it defines. */
  addGrooveFile(id: string, text: string): string[] {
    const key = normalizeResourceId(id);
    const defs = findGrooveDefs(text);
    this.dropFile(key);
    this.sources.set(key, text);
    const names = defs.map((d) => d.name);
    this.fileNames.set(key, names);
    for (const def of defs) {
      const prev = this.grooves.get(def.name);
      const description = def.description || prev?.description;
      this.grooves.set(def.name, description ? { file: key, description } : { file: key });
    }
    return names;
  }

  /** Merge a parsed archive/index object. */
  addJson(json: GrooveDatabaseJson): this {
    if (!json || typeof json !== 'object' || !json.grooves) {
      throw new MMAError('Invalid groove database');
    }
    for (const [id, text] of Object.entries(json.sources ?? {})) {
      this.addGrooveFile(id, text);
    }
    // Entries whose file was embedded above are already registered by
    // addGrooveFile(); only index-only entries (no source text) need to
    // be merged here.
    for (const [name, entry] of Object.entries(json.grooves)) {
      if (this.sources.has(normalizeResourceId(entry.file))) continue;
      const key = name.toUpperCase();
      const prev = this.grooves.get(key);
      const description = entry.description ?? prev?.description;
      this.grooves.set(key, description ? { file: entry.file, description } : { file: entry.file });
    }
    if (json.roots) this.roots = json.roots;
    return this;
  }

  // --- lookups -----------------------------------------------------------

  lookup(name: string): GrooveEntry | null {
    return this.grooves.get(name.toUpperCase()) ?? null;
  }

  /** List grooves, optionally filtered by a name substring. */
  listGrooves(filter?: string): GrooveRef[] {
    const f = filter?.toUpperCase();
    const out: GrooveRef[] = [];
    for (const [name, entry] of this.grooves) {
      if (!f || name.includes(f)) out.push({ name, file: entry.file, description: entry.description });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  get grooveCount(): number {
    return this.grooves.size;
  }

  get fileCount(): number {
    return this.sources.size;
  }

  /** Serialize back to the archive form (including file contents). */
  toJson(): GrooveDatabaseJson {
    const grooves: Record<string, GrooveEntry> = {};
    for (const [name, entry] of [...this.grooves].sort((a, b) => a[0].localeCompare(b[0]))) {
      grooves[name] = { file: entry.file, ...(entry.description ? { description: entry.description } : {}) };
    }
    const files: Record<string, string[]> = {};
    const sources: Record<string, string> = {};
    for (const [id, text] of [...this.sources].sort((a, b) => a[0].localeCompare(b[0]))) {
      files[id] = [...(this.fileNames.get(id) ?? [])];
      sources[id] = text;
    }
    return {
      version: 1,
      generatedBy: '@music-i18n/mma',
      ...(this.roots.length ? { roots: this.roots } : {}),
      grooves,
      files,
      sources,
    };
  }

  // --- MMAResources ------------------------------------------------------

  async load(id: string): Promise<string> {
    const key = normalizeResourceId(id);
    const text = this.sources.get(key);
    if (text === undefined) throw new MMAError(`Resource not found: '${key}'`);
    return text;
  }

  async list(prefix = ''): Promise<string[]> {
    const p = normalizeResourceId(prefix);
    return [...this.sources.keys()].filter((k) => k.startsWith(p)).sort();
  }

  async exists(id: string): Promise<boolean> {
    return this.sources.has(normalizeResourceId(id));
  }

  /** Drop a file and the groove names it contributed. */
  private dropFile(id: string): void {
    const old = this.fileNames.get(id);
    if (old) {
      for (const name of old) {
        if (this.grooves.get(name)?.file === id) this.grooves.delete(name);
      }
    }
    this.fileNames.delete(id);
    this.sources.delete(id);
  }
}

async function decode(bytes: Uint8Array): Promise<GrooveDatabaseJson> {
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return JSON.parse(await gunzipToString(bytes)) as GrooveDatabaseJson;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as GrooveDatabaseJson;
}

async function gunzipToString(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new MMAError('Gzip groove databases require DecompressionStream (browser or Node >= 18)');
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

async function fetchArchiveBytes(url: string, options: GrooveDatabaseLoadOptions): Promise<Uint8Array> {
  const fetchFn = options.fetchFn ?? fetch;
  const cacheStorage =
    options.cacheStorage !== undefined
      ? options.cacheStorage
      : typeof caches !== 'undefined'
        ? (caches as unknown as GrooveCacheStorage)
        : null;
  const useCache = (options.cache ?? true) && cacheStorage !== null;
  const cache = useCache ? await cacheStorage!.open(options.cacheName ?? DEFAULT_CACHE_NAME) : null;

  const request = new Request(url);
  if (cache) {
    const hit = await cache.match(request);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  }

  const res = await fetchFn(url);
  if (!res.ok) throw new MMAError(`Failed to load groove database '${url}': HTTP ${res.status}`);
  if (cache) {
    try {
      await cache.put(request, res.clone());
    } catch {
      // Cache write failures (quota, opaque responses) are not fatal.
    }
  }
  return new Uint8Array(await res.arrayBuffer());
}

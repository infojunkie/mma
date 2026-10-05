/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Browser-first resource loading.  Songs, includes and groove .mma files
 * are text; they come from an in-memory map (bundled assets, tests) or
 * from HTTP (CDN / app server).  There is no filesystem access.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

export interface MMAResources {
  /** Load a text resource by id (path-like, e.g. "lib/stdlib/swing.mma"). */
  load(id: string): Promise<string>;
  /**
   * Load a binary resource (e.g. a .mid file for MidiInc).  Optional:
   * text-only loaders (such as a groove database) omit it, and commands
   * that need binary data report a clear error.
   */
  loadBinary?(id: string): Promise<ArrayBuffer>;
  /** Resource ids under a prefix, for groove indexing/listing. */
  list(prefix?: string): Promise<string[]>;
  /** Cheap existence check; may return false if not known. */
  exists(id: string): Promise<boolean>;
}

/** Normalise resource ids for lookups: backslashes, leading "./". */
export function normalizeResourceId(id: string): string {
  let s = id.replace(/\\/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  return s;
}

export class MemoryResources implements MMAResources {
  private files = new Map<string, string>();
  private binaries = new Map<string, Uint8Array>();

  constructor(files: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(files)) {
      this.files.set(normalizeResourceId(k), v);
    }
  }

  set(id: string, text: string): void {
    this.files.set(normalizeResourceId(id), text);
  }

  /** Register a binary resource (e.g. a .mid file). */
  setBinary(id: string, bytes: Uint8Array): void {
    this.binaries.set(normalizeResourceId(id), bytes);
  }

  async load(id: string): Promise<string> {
    const key = normalizeResourceId(id);
    const text = this.files.get(key);
    if (text === undefined) {
      if (this.binaries.has(key)) throw new Error(`Resource '${key}' is binary; use loadBinary()`);
      throw new Error(`Resource not found: '${key}'`);
    }
    return text;
  }

  async loadBinary(id: string): Promise<ArrayBuffer> {
    const key = normalizeResourceId(id);
    const bytes = this.binaries.get(key) ?? this.binaries.get(key.toLowerCase());
    if (!bytes) {
      if (this.files.has(key)) throw new Error(`Resource '${key}' is text; use load()`);
      throw new Error(`Resource not found: '${key}'`);
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async list(prefix = ''): Promise<string[]> {
    const p = normalizeResourceId(prefix);
    return [...new Set([...this.files.keys(), ...this.binaries.keys()])]
      .filter((k) => k.startsWith(p))
      .sort();
  }

  async exists(id: string): Promise<boolean> {
    const key = normalizeResourceId(id);
    return this.files.has(key) || this.binaries.has(key);
  }
}

/**
 * Tries each resource in order; first hit wins.  Used to implement the
 * lib/include/groove search order.
 */
export class CompositeResources implements MMAResources {
  constructor(private sources: MMAResources[]) {}

  async load(id: string): Promise<string> {
    for (const s of this.sources) {
      try {
        return await s.load(id);
      } catch {
        // try next source
      }
    }
    throw new Error(`Resource not found in any source: '${id}'`);
  }

  async loadBinary(id: string): Promise<ArrayBuffer> {
    for (const s of this.sources) {
      if (!s.loadBinary) continue;
      try {
        return await s.loadBinary(id);
      } catch {
        // try next source
      }
    }
    throw new Error(`Binary resource not found in any source: '${id}'`);
  }

  async list(prefix = ''): Promise<string[]> {
    const out = new Set<string>();
    for (const s of this.sources) {
      for (const id of await s.list(prefix)) out.add(id);
    }
    return [...out].sort();
  }

  async exists(id: string): Promise<boolean> {
    for (const s of this.sources) if (await s.exists(id)) return true;
    return false;
  }
}

/** Prefixes every id with a base path (e.g. a CDN directory). */
export class PrefixedResources implements MMAResources {
  constructor(
    private base: string,
    private inner: MMAResources,
  ) {}

  private prefixed(id: string): string {
    const base = this.base.endsWith('/') ? this.base.slice(0, -1) : this.base;
    return `${base}/${normalizeResourceId(id)}`;
  }

  async load(id: string): Promise<string> {
    return this.inner.load(this.prefixed(id));
  }

  async loadBinary(id: string): Promise<ArrayBuffer> {
    if (!this.inner.loadBinary) throw new Error('The inner loader does not support binary resources');
    return this.inner.loadBinary(this.prefixed(id));
  }

  async list(prefix = ''): Promise<string[]> {
    return this.inner.list(this.prefixed(prefix));
  }

  async exists(id: string): Promise<boolean> {
    return this.inner.exists(this.prefixed(id));
  }
}

/** Browser HTTP loader (fetch + in-memory cache). */
export class HttpResources implements MMAResources {
  private cache = new Map<string, string>();

  constructor(
    private baseUrl: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  private url(id: string): string {
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : this.baseUrl + '/';
    const clean = normalizeResourceId(id).split('/').map(encodeURIComponent).join('/');
    return base + clean;
  }

  async load(id: string): Promise<string> {
    const key = normalizeResourceId(id);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const res = await this.fetchFn(this.url(key));
    if (!res.ok) throw new Error(`Resource not found: '${key}' (${res.status})`);
    const text = await res.text();
    this.cache.set(key, text);
    return text;
  }

  async loadBinary(id: string): Promise<ArrayBuffer> {
    const res = await this.fetchFn(this.url(normalizeResourceId(id)));
    if (!res.ok) throw new Error(`Resource not found: '${id}' (${res.status})`);
    return res.arrayBuffer();
  }

  async list(): Promise<string[]> {
    // HTTP cannot enumerate; the groove index supplies the file list.
    return [];
  }

  async exists(id: string): Promise<boolean> {
    try {
      await this.load(id);
      return true;
    } catch {
      return false;
    }
  }
}

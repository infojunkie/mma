/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Portable replacement for the pickle .mmaDB: a generated JSON index
 * mapping groove names to the resource file that defines them.  The
 * index is a hint - after parsing the file the groove name is verified
 * again, exactly like the Python implementation does.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { GrooveFinder } from './GrooveLibrary';
import type { MMAResources } from '../io/MMAResources';

export interface GrooveRef {
  name: string;
  file: string;
  description?: string;
}

export interface GrooveIndexJson {
  version: number;
  generatedBy?: string;
  roots?: Array<{ id: string; path: string }>;
  /** groove name -> resource file id (and optional description). */
  grooves: Record<string, { file: string; description?: string }>;
  /** resource file id -> groove names defined in it. */
  files?: Record<string, string[]>;
}

export class GrooveIndex {
  private grooves = new Map<string, { file: string; description?: string }>();

  constructor(json?: GrooveIndexJson) {
    if (json) {
      for (const [name, entry] of Object.entries(json.grooves)) {
        this.grooves.set(name.toUpperCase(), entry);
      }
    }
  }

  static fromJson(json: GrooveIndexJson): GrooveIndex {
    return new GrooveIndex(json);
  }

  lookup(name: string): { file: string; description?: string } | null {
    return this.grooves.get(name.toUpperCase()) ?? null;
  }

  list(filter?: string): GrooveRef[] {
    const f = filter?.toUpperCase();
    const out: GrooveRef[] = [];
    for (const [name, entry] of this.grooves) {
      if (!f || name.includes(f)) out.push({ name, file: entry.file, description: entry.description });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  filesFor(file: string): string[] {
    const out: string[] = [];
    for (const [name, entry] of this.grooves) {
      if (entry.file === file) out.push(name);
    }
    return out.sort();
  }

  get size(): number {
    return this.grooves.size;
  }

  /** Build a GrooveFinder for GrooveLibrary.autoload. */
  asFinder(resources: MMAResources): GrooveFinder {
    return async (name: string) => {
      const entry = this.lookup(name);
      if (!entry) return null;
      return { file: entry.file, groove: name.toUpperCase() };
    };
  }

  /** Load an index from a resource id (e.g. "grooves.index.json"). */
  static async load(resources: MMAResources, id = 'grooves.index.json'): Promise<GrooveIndex> {
    const text = await resources.load(id);
    return GrooveIndex.fromJson(JSON.parse(text) as GrooveIndexJson);
  }
}

/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/pluginUtils.py: the per-plugin configuration object
 * (description, arguments, track type, usage text) and the argument /
 * command-line helpers MMA plugins use.
 *
 * Python discovered "the current plugin" by walking the call stack
 * (_getCallerFileName/_getCallerModule) and kept a global registry keyed
 * by filename.  There are no stack frames to inspect here, so each
 * plugin owns a PluginSpec instance and passes it to the helpers; the
 * method names and error texts follow the Python originals.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../engine/Context';
import type { PluginContext } from './IMMAPlugin';
import { MMA_UPSTREAM_VERSION } from '../version';

/** Width used for the usage text (Python: terminal width - 1, 80 -> 79). */
export const DEFAULT_TERM_WIDTH = 79;

/** One declared argument: [name, default, doc].  A null default is required. */
export interface PluginArgument {
  name: string;
  value: string | null;
  doc: string;
}

/** A usage-text line: indent, or [first-indent, continuation-indent]. */
type UsageLine = [number | [number, number], string];

/**
 * Port of pluginUtils._pluginInfo plus the module-level helper functions.
 * The Python plugin name is "@" + the plugin directory name (e.g.
 * "@rhythm"); the constructor accepts it with or without the prefix.
 */
export class PluginSpec {
  readonly name: string;
  description = '';
  synopsis = '';
  author = '';
  /** Track types this plugin applies to; null means "not a track plugin". */
  trackTypes: string[] | null = null;
  readonly args: PluginArgument[] = [];
  doc = '';
  readonly commands: string[] = [];

  constructor(name: string) {
    this.name = name.startsWith('@') ? name : `@${name}`;
  }

  // --- configuration (pluginUtils setters) ------------------------------

  setDescription(descr: string): void {
    this.description = descr;
  }

  setSynopsis(syno: string): void {
    this.synopsis = syno;
  }

  setAuthor(author: string): void {
    this.author = author;
  }

  /** If empty everything is accepted; null marks a non-track plugin. */
  setTrackType(...types: string[]): void {
    this.trackTypes = [...types];
  }

  /** Declare an argument; a null default triggers an error if unspecified. */
  addArgument(name: string, value: string | null, doc: string): void {
    this.args.push({ name, value, doc });
  }

  /** Simple documentation; %NAME% is replaced by the plugin name. */
  setPluginDoc(doc: string): void {
    this.doc = doc.trim();
  }

  /**
   * Port of setMinMMAVersion: error out when the running MMA is older
   * than the requested version.  Python checked at module import; here
   * plugins call it from their entry points (the running context is
   * needed to report the error).
   */
  setMinMMAVersion(ctx: MMAContext, major: number, minor: number): void {
    const version = MMA_UPSTREAM_VERSION;
    const m = /^([0-9]+)\.([0-9]+)\.?(.*)$/.exec(version);
    if (m === null) {
      ctx.error(`Plugin utils: version ${version} not recognized.`);
    }
    const curMajor = Number(m[1]);
    const curMinor = Number(m[2]);

    if (curMajor > major) return;
    if (curMajor === major && curMinor >= minor) return;

    ctx.error(
      `Plugin requires MMA version ${String(major).padStart(2, '0')}.${String(minor).padStart(2, '0')} or newer.`,
    );
  }

  /** Returns the plugin name including the leading '@'. */
  getName(): string {
    return this.name;
  }

  // --- command queue ----------------------------------------------------

  /**
   * Queue commands for sendCommands.  If commands are sent one at a time
   * the result is reversed (each is pushed as the very next command), so
   * they are collected and pushed at the end.
   */
  addCommand(strings: string | string[]): void {
    if (Array.isArray(strings)) this.commands.push(...strings);
    else this.commands.push(strings);
  }

  /** Port of sendCommands: push all queued commands with the current lineno. */
  sendCommands(pctx: PluginContext): void {
    // All values have to be lists of words, not a string per line.
    const ret = this.commands.map((l) => l.split(/\s+/).filter((w) => w !== ''));
    this.commands.length = 0;
    pctx.pushTokens(ret);
  }

  // --- argument parsing -------------------------------------------------

  /**
   * Port of parseCommandLine: positional arguments first, then
   * name=value pairs.  Unknown names are an error unless allowUnknown;
   * a declared argument left without a value prints the usage and errors.
   */
  parseCommandLine(
    ctx: MMAContext,
    line: string[],
    allowUnknown = false,
  ): Record<string, string> {
    let s = line.join(' ');
    const subst: Array<[string, string]> = [
      [' =', '='],
      ['= ', '='],
      ['  ', ' '],
      [', ', ','],
      [' ,', ','],
    ];
    for (const [s1, s2] of subst) {
      while (s.includes(s1)) s = s.split(s1).join(s2);
    }

    const res: Record<string, string | null> = {};
    for (const { name, value } of this.args) res[name] = value;

    let positional = true;
    const parts = s.split(',');
    for (let i = 0; i < parts.length; i++) {
      const value = parts[i]!;
      if (value === '') continue;

      let n: string;
      let v: string;
      if (value.includes('=')) {
        positional = false;
        const eq = value.indexOf('=');
        n = value.slice(0, eq);
        v = value.slice(eq + 1);
        if (!(n in res)) {
          if (!allowUnknown) {
            ctx.error(`Plugin ${this.name}: unexpected argument name ${n}.`);
          } else {
            n = n.toUpperCase();
          }
        }
      } else if (positional) {
        if (i >= this.args.length) {
          ctx.error(`Plugin ${this.name}: unexpected argument provided (${value}).`);
        }
        n = this.args[i]!.name;
        v = value;
      } else {
        ctx.error(`Plugin ${this.name}: positional argument after named argument is not allowed.`);
      }

      res[n] = v;
    }

    for (const k of Object.keys(res)) {
      if (res[k] === null) {
        console.log(this.printUsage());
        ctx.error(`Plugin ${this.name}: no value for argument ${k}.`);
      }
    }

    return res as Record<string, string>;
  }

  // --- track type -------------------------------------------------------

  /** Port of checkTrackType: verify a track name against TRACKTYPES. */
  checkTrackType(ctx: MMAContext, name: string): void {
    if (this.trackTypes === null || this.trackTypes.length === 0) return;

    for (const t of this.trackTypes) {
      if (name.toUpperCase() === t.toUpperCase() || name.toUpperCase().startsWith(t.toUpperCase() + '-')) {
        return;
      }
    }

    if (this.trackTypes.length === 1) {
      ctx.error(`Plugin ${this.name}: track type must be ${this.trackTypes[0]}.`);
    } else {
      ctx.error(
        `Plugin ${this.name}: track type must be one of ` +
          `${this.trackTypes.slice(0, -1).join(', ')} or ${this.trackTypes[this.trackTypes.length - 1]}.`,
      );
    }
  }

  /** Port of getTrackType: base name of a TYPE-NAME track. */
  getTrackType(name: string): string {
    const dash = name.indexOf('-');
    return (dash >= 0 ? name.slice(0, dash) : name).toUpperCase();
  }

  // --- usage text -------------------------------------------------------

  /**
   * Port of printUsage: build the usage text (Python printed it; here it
   * is returned so plugins can expose it as help and tests can assert it).
   */
  printUsage(width: number = DEFAULT_TERM_WIDTH): string {
    const lines: UsageLine[] = [];
    lines.push([0, `Plugin ${this.name}`]);
    if (this.author !== '') lines.push([0, this.author]);
    lines.push([0, '']);
    if (this.description !== '') {
      lines.push([0, this.description]);
      lines.push([0, '']);
    }
    lines.push([0, 'SYNOPSIS']);
    if (this.synopsis !== '') {
      for (const line of this.synopsis.split(/\r\n|\r|\n/)) lines.push([0, line]);
      lines.push([0, '']);
    } else {
      let t = '';
      if (this.trackTypes !== null) t += 'Track ';
      t += this.name + ' ';

      for (const { name } of this.args) t += name + ', ';

      lines.push([[4, 8], t.trim().replace(/,+$/, '')]);
      lines.push([0, '']);
    }

    if (this.trackTypes !== null && this.trackTypes.length > 0) {
      if (this.trackTypes.length === 1) {
        lines.push([4, `Track type must be ${this.trackTypes[0]}.`]);
      } else {
        lines.push([
          4,
          `Track type must be one of ` +
            `${this.trackTypes.slice(0, -1).join(', ')} or ${this.trackTypes[this.trackTypes.length - 1]}.`,
        ]);
      }
      lines.push([0, '']);
    }

    if (this.args.length > 0) {
      lines.push([0, 'ARGUMENTS']);
      lines.push([0, '']);

      for (const { name, value, doc } of this.args) {
        const defvalue = value !== null ? ` (default: ${value})` : '';
        lines.push([4, name + defvalue]);
        lines.push([8, doc]);
        lines.push([0, '']);
      }

      lines.push([4, 'You can also use name=value syntax, like Call (see MMA documents).']);
      lines.push([0, '']);
    }

    lines.push([0, 'DESCRIPTION']);
    lines.push([0, '']);
    for (const l of this.doc.replace(/\r/g, '').replace(/%NAME%/g, this.name).split('\n')) {
      lines.push([4, l]);
    }

    const out: string[] = [];
    for (const [indent, line] of lines) {
      if (line.trim() === '') {
        // Python 3 quirk: the blank-line branch is a bare `print`
        // statement, which only evaluates the builtin (no output).  The
        // reference usage text therefore has no blank lines at all.
        continue;
      }

      let firstindent: number;
      let indent2: number;
      if (Array.isArray(indent)) {
        [firstindent, indent2] = indent;
      } else {
        firstindent = indent;
        indent2 = indent;
      }

      const wrapped = wrapText(line, width - indent2);
      for (let i = 0; i < wrapped.length; i++) {
        const lline = wrapped[i]!;
        if (i === 0 && firstindent !== indent2) {
          out.push(' '.repeat(firstindent) + lline + (wrapped.length > 1 ? ' \\' : ''));
        } else {
          out.push(' '.repeat(indent2) + lline);
        }
      }
    }
    return out.join('\n');
  }
}

/**
 * Greedy word wrap; a small stand-in for Python textwrap.wrap(width)
 * (which this port cannot use).  Breaks overlong words like the default
 * break_long_words=True and, like textwrap, keeps the paragraph's
 * leading whitespace on the first line (which counts toward the width).
 */
function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, Math.trunc(width));
  const leadMatch = /^\s+/.exec(text);
  const lead = leadMatch ? leadMatch[0].replace(/\s/g, ' ') : '';
  const words = text
    .slice(lead.length)
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((s) => s !== '');

  const out: string[] = [];
  let line = lead; // the first line keeps the paragraph's initial whitespace
  const push = (): void => {
    if (line.trim() !== '') out.push(line);
    line = '';
  };

  let atStart = lead !== '';
  for (const word of words) {
    if (atStart) {
      // The initial whitespace is followed directly by the first word.
      line += word;
      atStart = false;
    } else if (line === '') line = word;
    else if (line.length + 1 + word.length <= w) line += ' ' + word;
    else {
      push();
      line = word;
    }
  }
  push();
  return out;
}

/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the line reader in MMA/file.py (class ReadFile): whole-text
 * reading, line continuation, line/block comment stripping, whitespace
 * tokenizing and LABEL/numeric-label handling.  The input text is supplied
 * by the caller; the filesystem helpers locFile()/fixfname() are not
 * ported here.
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version (GPL-2.0-or-later).
 */

export interface SourceReaderHost {
  lineno: number;
  infile: string;
  error(msg: string): never;
  warning(msg: string): void;
}

interface FileData {
  lnum: number;
  data: string[];
  label: string | null;
}

/**
 * Python str.isspace(): Unicode Zs/Zl/Zp plus the WS/B/S bidirectional
 * classes.  JS trim()/String.raw differ slightly (e.g. it strips U+FEFF,
 * which Python keeps), so the Python set is spelled out.
 */
function isPySpace(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (
    (c >= 0x09 && c <= 0x0d) ||
    (c >= 0x1c && c <= 0x1f) ||
    c === 0x20 ||
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

/** Python str.strip() for a line. */
function pyStrip(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isPySpace(s[start])) start++;
  while (end > start && isPySpace(s[end - 1])) end--;
  return s.slice(start, end);
}

/** Python str.split() with no arguments: split on whitespace runs, no empties. */
function pySplit(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && isPySpace(s[i])) i++;
    if (i >= s.length) break;
    const start = i;
    while (i < s.length && !isPySpace(s[i])) i++;
    out.push(s.slice(start, i));
  }
  return out;
}

/** Python str.isdigit(): Nd digits plus superscript/subscript digits. */
const PY_DIGIT = /^[\p{Nd}\u00b2\u00b3\u00b9\u2070\u2074-\u2079\u2080-\u2089]+$/u;

function pyIsDigit(s: string): boolean {
  return PY_DIGIT.test(s);
}

/**
 * Python text-mode readline() with universal newlines: \r\n and lone \r
 * are translated to \n; a trailing newline does not produce an extra
 * readable line (readline() returns '' at EOF, which the scan loop breaks
 * on before counting the line).
 */
function splitSourceLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export class SourceReader {
  readonly fname: string;

  private readonly host: SourceReaderHost;
  private fdata: FileData[] = [];
  private lastline = 0;
  private lineptr = 0;
  private que: (string[] | string)[] = []; // pushed lines; '' is the seed sentinel
  private qnums: number[] = [];

  constructor(host: SourceReaderHost, fname: string, text: string) {
    this.host = host;
    this.fname = fname;
    host.infile = fname;

    const fdata: FileData[] = [];
    const labs: string[] = []; // track label defs, error if duplicate in same file
    const nlabs: string[] = []; // track linenumber label defs
    let inComment = false; // multiline comment flag
    let lcount = 0;
    let label: string | null = null;

    const lines = splitSourceLines(text);
    let li = 0;

    while (li < lines.length) {
      let l = pyStrip(lines[li++]);
      lcount += 1;

      if (!l) continue; // EOF never reaches here; blank lines are just skipped

      // join lines ending in '\' - the strip() makes this the last char
      while (l.endsWith('\\')) {
        const next = li < lines.length ? lines[li++] : '';
        l = l.slice(0, -1) + ' ' + pyStrip(next);
        lcount += 1;
      }

      // input cleanup: convert 0xa0 (non-breakable space) to 0x20 (space)
      l = l.replace(/\u00a0/g, ' ');

      // multiline comments
      if (inComment) {
        if (l.includes('/*')) host.warning("Block comment start '/*' found inside comment.");
        if (l.includes('*/')) {
          l = l.slice(l.indexOf('*/') + 2);
          inComment = false;
        } else {
          continue;
        }
      }

      const lineComment = l.indexOf('//');
      if (lineComment !== -1) l = l.slice(0, lineComment); // strip off line comment

      while (l.includes('/*')) {
        const open = l.indexOf('/*');
        if (l.includes('*/')) {
          const afterOpen = l.slice(open + 2);
          l = l.slice(0, open) + afterOpen.slice(afterOpen.indexOf('*/') + 2);
        } else {
          l = l.slice(0, open);
          inComment = true;
        }
      }

      // Split the remaining line into whitespace-delimited tokens.
      const tokens = pySplit(l);
      if (tokens.length === 0) continue;

      /*
       * Parse out label lines.  Two kinds:
       *   LABEL XXX  (exclusive: duplicates with anything else error)
       *   NNN        (not exclusive: the last one wins)
       * XXX lines are stripped from input; NNN lines stay in the stream.
       */
      if (tokens[0].toUpperCase() === 'LABEL') {
        if (tokens.length !== 2) {
          host.lineno = lcount;
          host.error('Usage: LABEL <string>');
        }
        label = tokens[1].toUpperCase();
        if (label[0] === '$') {
          host.lineno = lcount;
          host.error('Variables are not permitted as labels');
        }
        if (labs.includes(label)) {
          host.lineno = lcount;
          host.error(`Duplicate label specified in line ${lcount}`);
        } else if (nlabs.includes(label)) {
          host.lineno = lcount;
          host.error(`Label '${label}' duplicates line number label`);
        }
        labs.push(label);
      } else if (pyIsDigit(tokens[0])) {
        label = tokens[0];

        if (labs.includes(label)) {
          host.lineno = lcount;
          host.error(`Line number '${label}' duplicates LABEL`);
        }

        if (!nlabs.includes(label)) {
          nlabs.push(label);
        } else {
          for (let i = 0; i < fdata.length; i++) {
            if (fdata[i].label === label) fdata[i].label = '';
          }
        }
      } else {
        label = null;
      }

      // Save the line, line number and (maybe) the label.
      fdata.push({ lnum: lcount, data: tokens, label });
    }

    if (inComment) {
      host.error('Multiline comment (/* */) not terminated.');
    }

    this.fdata = fdata;
    this.lineptr = 0;
    this.lastline = fdata.length;
  }

  /** Move pointer to End of File. */
  toEof(): void {
    this.lineptr = this.lastline + 1;
    this.que = [];
    this.qnums = [];
  }

  /**
   * Do a goto jump.  Pushed lines (que) are dropped; the file data is
   * searched linearly for a matching label and the pointer is set to that
   * index, so the label line itself is read next.
   */
  goto(l: string): void {
    if (!l) {
      this.host.error('No label specified');
    }

    if (this.que.length > 0) {
      // Python clears que only; qnums is left stale (harmless: the next
      // empty-queue push() re-seeds both).
      this.que = [];
    }

    for (let i = 0; i < this.fdata.length; i++) {
      if (this.fdata[i].label === l) {
        this.lineptr = i;
        return;
      }
    }

    this.host.error(`Label '${l}' has not been set`);
  }

  pushEOFline(line: string[]): void {
    this.fdata.push({ lnum: this.host.lineno, data: line, label: '' });
    this.lastline += 1;
  }

  /**
   * Push a list of lines back into the input stream.  Lines are
   * semi-processed (no comments etc.).  Later pushes are consumed first;
   * order within a single push is preserved.  The caller's arrays are
   * reversed and restored, mirroring the Python implementation.
   */
  push(lines: string[][], linenos: number[]): void {
    if (this.que.length === 0) {
      this.que = [''];
      this.qnums = [this.host.lineno];
    }

    lines.reverse();
    for (const line of lines) this.que.push(line);
    lines.reverse();

    linenos.reverse();
    for (const n of linenos) this.qnums.push(n);
    linenos.reverse();
  }

  /**
   * Return the tokens of the next line: queued lines first, then file
   * lines, null at EOF.  Empty queued entries are skipped.
   */
  read(): string[] | null {
    for (;;) {
      if (this.que.length > 0) {
        // Return a queued line if possible.
        const ln = this.que.pop()!;
        this.host.lineno = this.qnums.pop()!;

        if (typeof ln === 'string' || ln.length === 0) continue; // '' sentinel / empty line

        return ln;
      }

      // Return the next line in the file.
      if (this.lineptr >= this.lastline) {
        return null; // EOF
      }

      const entry = this.fdata[this.lineptr];
      this.host.lineno = entry.lnum;
      this.lineptr += 1;

      return entry.data;
    }
  }
}

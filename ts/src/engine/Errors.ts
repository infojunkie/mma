/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/common.py error/warning handling.  The Python code calls
 * sys.exit(1) on errors; a library must not kill the host process, so
 * errors are thrown as MMAError with file/line context.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

export interface WarningRecord {
  message: string;
  file: string;
  line: number;
}

export class MMAError extends Error {
  readonly file: string;
  readonly line: number;

  constructor(message: string, file = '', line = -1) {
    super(message);
    this.name = 'MMAError';
    this.file = file;
    this.line = line;
  }

  /** Format like the Python CLI: "Error: <Line n> <File:f> msg". */
  formatted(): string {
    const line = this.line >= 0 ? `<Line ${this.line}>` : '';
    const file = this.file ? `<File:${this.file}>` : '';
    return `Error: ${line} ${file} ${this.message}`.replace(/\s+/g, ' ').trim();
  }
}

export interface ReporterLocation {
  file: string;
  line: number;
}

/**
 * Collects warnings and turns error() calls into exceptions.  The
 * location provider is wired by MMAContext so messages carry the
 * current source file and line.
 */
export class Reporter {
  readonly warnings: WarningRecord[] = [];
  /** -w: when false, warnings are suppressed (not collected). */
  warningsEnabled = true;
  onWarning?: (w: WarningRecord) => void;
  onDebug?: (msg: string) => void;
  debugEnabled = false;

  private location: () => ReporterLocation = () => ({ file: '', line: -1 });

  setLocationProvider(fn: () => ReporterLocation): void {
    this.location = fn;
  }

  error(msg: string): never {
    const { file, line } = this.location();
    throw new MMAError(msg, file, line);
  }

  warning(msg: string): void {
    if (!this.warningsEnabled) return;
    const { file, line } = this.location();
    const rec: WarningRecord = { message: msg, file, line };
    this.warnings.push(rec);
    this.onWarning?.(rec);
  }

  /** Port of common.dPrint - developer-level tracing. */
  dPrint(msg: string): void {
    if (this.debugEnabled) this.onDebug?.(msg);
  }
}

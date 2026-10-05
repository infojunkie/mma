/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/after.py: after storage, setting and command insertion.
 * An AFTER event injects a command (or chord line) later in the song -
 * at an absolute bar (Bar=), after a number of bars (Count=/Repeat=),
 * or at end-of-file (Bar=EOF, which is queued straight into the reader).
 *
 * Python keeps the event stack in module globals; here the Parser owns
 * an AfterState instance.  The parse loop calls check() before every
 * line and needed()/check(recurse=True) at the end of each repeat of a
 * data line, matching MMA/parse.py.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import { opt2pair, stoi } from '../../util/Common';

interface AfterData {
  /** Destination bar.  'EOF' events are queued into the reader, never stored. */
  bar: number | 'EOF' | null;
  /** What to do (the command tokens). */
  cmd: string[] | null;
  /** Number of times to repeat this event. */
  repeat: number | null;
  /** Number of bars to wait before doing this (unused after create). */
  count: number | null;
  /** Line number of the AFTER directive, for pushback errors. */
  lineno: number;
  /** A name used by the Remove option. */
  id: string | null;
  /** If true this event is done. */
  finished: boolean;
}

export interface AfterCheckOptions {
  /** Port of check(recurse=True): re-parse the queued commands. */
  recurse?: boolean;
  /** Parser entry point used for the recursive re-parse. */
  parseText?: (text: string, fname: string) => Promise<void>;
}

export class AfterState {
  private afterData: AfterData[] = [];
  private afterDataFinished = 0;

  /** Port of after.create: set an After event. */
  create(ctx: MMAContext, input: string[]): void {
    const dat: AfterData = {
      bar: null,
      cmd: null,
      repeat: null,
      count: null,
      lineno: -1,
      id: null,
      finished: false,
    };
    const selected: string[] = [];

    // Python: opt2pair(ln, toupper=False, notoptstop=True).
    const [ln, opts] = opt2pair(input, false, true);
    for (const { option, value } of opts) {
      const cmd = option.toUpperCase();
      if (cmd === 'BAR') {
        if (value.toUpperCase() === 'EOF') {
          dat.bar = 'EOF';
        } else {
          const opt = stoi(ctx.rep, value);
          if (opt < 1) {
            ctx.error(`After: Destination bar must be positive, not '${opt}'.`);
            // Upstream bug: Python's `dat.bar = opt` sits inside this
            // `if opt < 1` block (after the error), so a valid Bar=<n>
            // never records a destination bar and the event is inert.
            // Replicated so renders stay identical to the reference.
            dat.bar = opt;
          }
        }
        selected.push('Bar');
      } else if (cmd === 'REPEAT') {
        const opt = stoi(ctx.rep, value);
        if (opt < 1) {
          ctx.error(`After: Repeat value must be positive, not '${opt}'.`);
        }
        dat.repeat = opt;
        dat.bar = opt + ctx.barNum;
        selected.push('Repeat');
      } else if (cmd === 'COUNT') {
        const opt = stoi(ctx.rep, value);
        if (opt < 1) {
          ctx.error(`After: Count must be positive, not '${opt}'.`);
        }
        dat.count = opt;
        dat.bar = opt + ctx.barNum;
        selected.push('Count');
      } else if (cmd === 'ID') {
        // set a string id for this event (duplicates are fine)
        dat.id = value.toUpperCase();
      } else if (cmd === 'REMOVE') {
        // delete all saved items with id==opt
        let found = false;
        for (const a of this.afterData) {
          if (!a.finished && a.id === value.toUpperCase()) {
            a.finished = true;
            this.afterDataFinished += 1;
            found = true;
          }
        }

        if (opts.length > 1 || ln.length) {
          ctx.warning('After: Remove is ignoring other options/cmds in line.');
        }
        if (!found) {
          ctx.warning(`After: No events with ID=${value} found to delete.`);
        }
        return; // ignore any other commands
      } else {
        ctx.error(`After: Unknown option '${cmd}'.`);
      }
    }

    if (!ln.length) {
      ctx.error("After: No command given. It's needed.");
    }

    if (selected.length === 0) {
      ctx.error(
        "After: need one of 'Count', 'Bar', or 'Repeat'. Options must be listed before the command!",
      );
    }

    if (selected.length > 1) {
      ctx.error(`After: Options conflict; can't combine ${selected.join(' & ')}.`);
    }

    dat.cmd = ln;
    dat.lineno = ctx.lineno;

    if (dat.bar === 'EOF') {
      ctx.inpath!.pushEOFline(dat.cmd);
    } else {
      this.afterData.push(dat); // our stack (actually a list of events)
    }

    ctx.dPrint(`After: Added event '${dat.cmd.join(' ')}' at bar ${dat.bar}.`);
  }

  /**
   * Port of after.check: before reading any input, execute any After
   * events due at the current bar.
   */
  async check(ctx: MMAContext, opts: AfterCheckOptions = {}): Promise<void> {
    if (!this.needed(ctx)) {
      // do a fast stack scan, and (maybe) clean the stack
      return;
    }

    // Gather all the AFTER events for this point in the MMA file
    const stuff: string[][] = [];
    const elns: number[] = [];

    for (const dat of this.afterData) {
      if (!dat.finished && dat.bar === ctx.barNum) {
        stuff.push(dat.cmd!);
        elns.push(dat.lineno);

        // while going through the list of AFTER events mark any ones
        // that need to be repeated for a future point
        if (dat.repeat) {
          dat.bar = ctx.barNum + dat.repeat;
        } else {
          dat.finished = true;
          // Python writes '=+ 1' here (a no-op assignment, not an
          // increment); replicated so the cleanup threshold matches.
          this.afterDataFinished = 1;
        }
      }
    }

    if (!stuff.length) return;

    if (opts.recurse) {
      // note: Python cannot use a plain push here, so it writes a
      // temporary file and re-parses it.  The browser has no filesystem;
      // parseText feeds the same commands straight back into the parser.
      if (!opts.parseText) {
        ctx.error('Internal: After recursion requires a parser callback.');
      }
      const text = stuff.map((a) => a.join(' ')).join('\n');
      await opts.parseText(text, 'MMA_after.mma');
    } else {
      // Push our AFTER command to input.
      ctx.inpath!.push(stuff, elns);
    }
  }

  /**
   * Port of after.needed: check whether it is time to handle an After.
   * Also performs the periodic stack cleanup.
   */
  needed(ctx: MMAContext): boolean {
    // before doing the check, clean up our stack
    if (this.afterDataFinished > 40 && this.afterDataFinished - 1 > this.afterData.length / 2) {
      this.afterData = this.afterData.filter((x) => !x.finished);
      this.afterDataFinished = 0;
    }

    // the actual check: exit on the first needy one found
    for (const dat of this.afterData) {
      if (!dat.finished && dat.bar === ctx.barNum) return true;
    }

    return false;
  }
}

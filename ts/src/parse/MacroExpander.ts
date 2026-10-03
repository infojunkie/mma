/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/macro.py: user variables ($VAR), system variables ($_SYSTEM),
 * slicing, $() math evaluation, SET/NSET/MSET/INC/DEC/RNDSET/UNSET/VEXPAND
 * and the source-re-reading commands IF/ELSE/ENDIF, REPEAT and MSET blocks.
 *
 * Python kept the state in module globals and a singleton class; here the
 * state (vars, expandMode, pushstack) lives on the instance so several MMA
 * runs can coexist.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../engine/Context';
import { stof, stoi } from '../util/Common';
import { safeEval } from './Expression';
import { pyStr, formatFloat, PyValue } from '../engine/PyValue';
import { getNoteLen } from '../model/NoteLen';
import { VOICE_TABLE, DRUM_TABLE } from '../midi/voices';
import { voice2tup } from '../midi/VoiceValue';
import type { TrackApi } from './TrackApi';

/** A user variable is either a simple string (SET) or a list of lines (MSET). */
type MacroValue = string | string[][];

export interface MacroExpanderOptions {
  /**
   * Browser port hook for IF EXISTS/ISDIR/ISFILE.  Python used the local
   * filesystem; without a host implementation those tests error clearly.
   */
  fileTest?: (op: 'EXISTS' | 'ISDIR' | 'ISFILE', path: string) => boolean;
  /** $_SWINGMODE (MMA/swing.py settings()). */
  swingModeString?: () => string;
  /** $_DEBUG / $_LASTDEBUG (MMA/debug.py getFlags/getLFlags). */
  debugFlags?: (last: boolean) => string;
}

export class MacroExpander {
  private vars = new Map<string, MacroValue>();
  private expandMode = true;
  private pushstack: string[] = [];

  constructor(
    private readonly ctx: MMAContext,
    private readonly opts: MacroExpanderOptions = {},
  ) {}

  // ---------------------------------------------------------------------
  // SET/NSET/MSET/UNSET/INC/DEC/RNDSET/VEXPAND

  /** Port of Macros.clear (VARCLEAR). */
  clear(ln: string[]): void {
    if (ln.length) this.ctx.error('VarClear does not take an argument.');
    this.vars.clear();
    this.ctx.dPrint('All variable definitions cleared.');
  }

  /** Port of Macros.stackValue (STACKVALUE). */
  stackValue(ln: string[]): void {
    this.pushstack.push(ln.join(' '));
  }

  /** Helper: validate a variable name (Macros.getvname). */
  private getvname(v: string): string {
    if (v[0] === '$' || v[0] === '_') {
      this.ctx.error("Variable names cannot start with a '$' or '_'");
    }
    if (v.includes('[') || v.includes(']')) {
      this.ctx.error('Variable names cannot contain [ or ] characters.');
    }
    return v.toUpperCase();
  }

  /** Port of Macros.rndvar (RNDSET). */
  rndvar(ln: string[]): void {
    if (ln.length < 2) {
      this.ctx.error('Use: RndSet Variable_Name <list of possible values>');
    }
    const v = this.getvname(ln[0]!);
    this.vars.set(v, this.ctx.rng.choice(ln.slice(1)));
    this.ctx.dPrint(`Variable $${v} randomly set to '${this.vars.get(v)}'`);
  }

  /** Port of Macros.newsetvar (NSET). */
  newsetvar(ln: string[]): void {
    if (!ln.length) this.ctx.error('Use: NSET VARIABLE_NAME [Value] [[+] [Value]]');
    if (this.vars.has(this.getvname(ln[0]!))) return;
    this.setvar(ln);
  }

  /** Port of Macros.setvar (SET). */
  setvar(input: string[]): void {
    const ln = [...input];
    if (ln.length < 1) this.ctx.error('Use: SET VARIABLE_NAME [Value] [[+] [Value]]');
    const v = this.getvname(ln.shift()!);

    let t = '';
    let addSpace = 0;
    for (const a of ln) {
      if (a === '+') {
        addSpace = 0;
        continue;
      }
      if (addSpace) t += ' ';
      t += a;
      addSpace = 1;
    }
    this.vars.set(v, t);
    this.ctx.dPrint(`Variable $${v} == '${t}'`);
  }

  /** Port of Macros.msetvar (MSET): read lines until MSetEnd. */
  msetvar(ln: string[]): void {
    if (ln.length !== 1) this.ctx.error('Use: MSET VARIABLE_NAME <lines> MsetEnd');
    const v = this.getvname(ln[0]!);

    const lm: string[][] = [];
    for (;;) {
      const l = this.ctx.inpath!.read();
      if (!l) this.ctx.error('Reached EOF while looking for MSetEnd');
      const cmd = l[0]!.toUpperCase();
      if (cmd === 'MSETEND' || cmd === 'ENDMSET') {
        if (l.length > 1) this.ctx.error('No arguments permitted for MSetEnd/EndMSet');
        break;
      }
      lm.push(l);
    }
    this.vars.set(v, lm);
  }

  /** Port of Macros.unsetvar (UNSET). */
  unsetvar(ln: string[]): void {
    if (ln.length !== 1) this.ctx.error('Use: UNSET Variable');
    const v = ln[0]!.toUpperCase();
    if (v[0] === '_') this.ctx.error('Internal variables cannot be deleted or modified');
    if (this.vars.has(v)) {
      this.vars.delete(v);
      this.ctx.dPrint(`Variable '${v}' UNSET`);
    } else {
      this.ctx.warning(`Attempt to UNSET nonexistent variable '${v}'`);
    }
  }

  /** Port of Macros.vexpand (VEXPAND). */
  vexpand(ln: string[]): void {
    const cmd = ln.length === 1 ? ln[0]!.toUpperCase() : '';
    if (cmd === 'ON') {
      this.expandMode = true;
      this.ctx.dPrint('Variable expansion ON');
    } else if (cmd === 'OFF') {
      this.expandMode = false;
      this.ctx.dPrint('Variable expansion OFF');
    } else {
      this.ctx.error('Use: Vexpand ON/Off');
    }
  }

  /** Port of Macros.varinc (INC). */
  varinc(ln: string[]): void {
    let inc: number;
    if (ln.length === 1) inc = 1;
    else if (ln.length === 2) inc = stof(this.ctx.rep, ln[1]!, `Expecting a value (not ${ln[1]}) for Inc`);
    else return this.ctx.error('Usage: INC Variable [value]');

    const v = ln[0]!.toUpperCase();
    if (v[0] === '_') this.ctx.error('Internal variables cannot be modified');
    if (!this.vars.has(v)) this.ctx.error(`Variable '${v}' not defined`);

    const cur = this.vars.get(v);
    if (typeof cur !== 'string') this.ctx.error(`Variable '${v}' not defined`);
    let vl = stof(this.ctx.rep, cur, 'Variable must be a value to increment') + inc;
    if (vl === Math.trunc(vl)) vl = Math.trunc(vl);
    this.vars.set(v, String(vl));
    this.ctx.dPrint(`Variable '${v}' INC to ${this.vars.get(v)}`);
  }

  /** Port of Macros.vardec (DEC). */
  vardec(ln: string[]): void {
    let dec: number;
    if (ln.length === 1) dec = 1;
    else if (ln.length === 2) dec = stof(this.ctx.rep, ln[1]!, `Expecting a value (not ${ln[1]}) for Inc`);
    else return this.ctx.error('Usage: DEC Variable [value]');

    const v = ln[0]!.toUpperCase();
    if (v[0] === '_') this.ctx.error('Internal variables cannot be modified');
    if (!this.vars.has(v)) this.ctx.error(`Variable '${v}' not defined`);

    const cur = this.vars.get(v);
    if (typeof cur !== 'string') this.ctx.error(`Variable '${v}' not defined`);
    let vl = stof(this.ctx.rep, cur, 'Variable must be a value to decrement') - dec;
    if (vl === Math.trunc(vl)) vl = Math.trunc(vl);
    this.vars.set(v, String(vl));
    this.ctx.dPrint(`Variable '${v}' DEC to ${this.vars.get(v)}`);
  }

  /** Port of Macros.showvars (SHOWVARS). */
  showvars(ln: string[]): void {
    if (ln.length) {
      for (const a of ln) {
        const u = a.toUpperCase();
        if (this.vars.has(u)) console.log(`$${u}: ${this.valueToString(this.vars.get(u)!)}`);
        else console.log(`$${u} - not defined`);
      }
    } else {
      console.log('User variables defined:');
      const kys = [...this.vars.keys()].sort();
      let mx = 0;
      for (const a of kys) if (a.length > mx) mx = a.length;
      mx += 2;
      for (const a of kys) {
        console.log(`     ${('$' + a).padEnd(mx)}  ${this.valueToString(this.vars.get(a)!)}`);
      }
    }
  }

  private valueToString(v: MacroValue): string {
    if (typeof v === 'string') return v;
    return v.map((line) => line.join(' ')).join('\n');
  }

  // ---------------------------------------------------------------------
  // IF/ELSE/ENDIF (varIF)

  /** Port of Macros.varIF. */
  varIF(ln: string[]): void {
    const expandV = (l0: string): [string, number | null] => {
      let l = l0.toUpperCase();
      if (l.slice(0, 2) === '$$') {
        l = l.slice(2);
        if (!this.vars.has(l)) this.ctx.error(`String Variable '${l}' does not exist`);
        const val = this.vars.get(l)!;
        l = typeof val === 'string' ? val : this.valueToString(val);
      }
      let v: number | null;
      try {
        v = Number(l);
        if (Number.isNaN(v)) throw new Error('nan');
      } catch {
        try {
          v = stoi(this.ctx.rep, l);
        } catch {
          v = null;
        }
      }
      return [l.toUpperCase(), v];
    };

    const readblk = (): { cmd: string; q: string[][]; qnum: number[] } => {
      const q: string[][] = [];
      const qnum: number[] = [];
      let nesting = 0;
      for (;;) {
        const l = this.ctx.inpath!.read();
        if (!l) this.ctx.error('EOF reached while looking for EndIf');
        const cmd = l[0]!.toUpperCase();
        if (cmd === 'IF') nesting += 1;
        if (cmd === 'IFEND' || cmd === 'ENDIF' || cmd === 'ELSE') {
          if (l.length > 1) this.ctx.error('No arguments permitted for IfEnd/EndIf/Else');
          if (!nesting) return { cmd, q, qnum };
          if (cmd !== 'ELSE') nesting -= 1;
        }
        q.push(l);
        qnum.push(this.ctx.lineno);
      }
    };

    if (ln.length < 2) this.ctx.error('Usage: IF <Operator> ');
    const action = ln[0]!.toUpperCase();

    let compare: boolean;

    // 1. unary options: DEF, NDEF, ISEMPTY, ISNOTEMPTY
    if (action === 'DEF' || action === 'NDEF' || action === 'ISEMPTY' || action === 'ISNOTEMPTY') {
      if (ln.length !== 2) this.ctx.error(`Usage: IF ${action} VariableName`);
      const v = ln[1]!.toUpperCase();

      if (action === 'DEF') compare = this.vars.has(v);
      else if (action === 'NDEF') compare = !this.vars.has(v);
      else {
        let val: string;
        if (v.startsWith('_')) val = this.sysvar(v.slice(1));
        else if (!this.vars.has(v)) return this.ctx.error(`Variable '${v}' has not been created`);
        else val = this.valueToString(this.vars.get(v)!);
        compare = action === 'ISEMPTY' ? val === '' : val !== '';
      }

      // 2. file operations
    } else if (action === 'EXISTS' || action === 'ISDIR' || action === 'ISFILE') {
      if (!this.opts.fileTest) {
        this.ctx.error(`IF ${action} is not implemented in this milestone (no filesystem in the browser port).`);
      }
      compare = this.opts.fileTest(action as 'EXISTS' | 'ISDIR' | 'ISFILE', ln[1]!);

      // 3. binary ops
    } else if (['LT', '<', 'LE', '<=', 'EQ', '==', 'GE', '>=', 'GT', '>', 'NE', '!='].includes(action)) {
      if (ln.length !== 3) this.ctx.error(`Usage: VARS ${action} Value1 Value2`);
      const [s1, v1] = expandV(ln[1]!);
      const [s2, v2] = expandV(ln[2]!);

      const a: number | string = v1 === null || v2 === null ? s1 : v1;
      const b: number | string = v1 === null || v2 === null ? s2 : v2;

      switch (action) {
        case 'LT':
        case '<':
          compare = a < b;
          break;
        case 'LE':
        case '<=':
          compare = a <= b;
          break;
        case 'EQ':
        case '==':
          compare = a === b;
          break;
        case 'GE':
        case '>=':
          compare = a >= b;
          break;
        case 'GT':
        case '>':
          compare = a > b;
          break;
        default:
          compare = a !== b;
          break;
      }
    } else {
      return this.ctx.error('Usage: IF <CONDITON> ...');
    }

    let block = readblk();

    if (block.cmd === 'ELSE') {
      const q1 = readblk();
      if (q1.cmd === 'ELSE') this.ctx.error('Only one ELSE is permitted in IF construct');
      if (!compare) {
        compare = true;
        block = q1;
      }
    }

    if (compare) this.ctx.inpath!.push(block.q, block.qnum);
  }

  // ---------------------------------------------------------------------
  // REPEAT / REPEATEND / REPEATENDING

  /** Port of parse.repeat (REPEAT command). */
  repeat(ln: string[]): void {
    if (ln.length) this.ctx.error('REPEAT takes no arguments');

    const repeatChunk = (): { q: string[][]; qnum: number[]; act: string; rest: string[] } => {
      const q: string[][] = [];
      const qnum: number[] = [];
      let nesting = 0;
      for (;;) {
        const l = this.ctx.inpath!.read();
        if (!l) this.ctx.error('EOF encountered processing Repeat');
        const act = l[0]!.toUpperCase();
        if (act === 'REPEAT') nesting += 1;
        else if ((act === 'REPEATEND' || act === 'ENDREPEAT') && nesting) nesting -= 1;
        else if (act === 'REPEATENDING' && nesting) {
          // pass
        } else if (act === 'REPEATEND' || act === 'ENDREPEAT' || act === 'REPEATENDING') {
          return { q, qnum, act, rest: l.slice(1) };
        }
        q.push(l);
        qnum.push(this.ctx.lineno);
      }
    };

    const stack: string[][] = [];
    const stacknum: number[] = [];
    let ending = 0;

    let chunk = repeatChunk();
    const main = chunk.q;
    const mainnum = chunk.qnum;

    for (;;) {
      if (chunk.act === 'REPEATEND' || chunk.act === 'ENDREPEAT') {
        let count = 0;
        let warn = 1;
        if (chunk.rest.length) {
          let l = this.expand([...chunk.rest]);
          if (l.length === 2) {
            l = l.map((x) => x.toUpperCase());
            if (l.includes('NOWARN')) {
              l = l.filter((x) => x !== 'NOWARN');
              warn = 0;
            }
          } else {
            warn = 1;
          }
          if (l.length !== 1) this.ctx.error(`${chunk.act}: Use [NoWarn] Count`);
          count = stoi(this.ctx.rep, l[0]!, `${chunk.act} takes an integer arg`);

          if (count === 2 && warn) {
            this.ctx.warning(`${chunk.act} count of 2 duplicates default. Did you mean 3 or more?`);
          } else if (count === 1 && warn) {
            this.ctx.warning(`${chunk.act} count of 1 means NO REPEAT`);
          } else if (count === 0 && warn) {
            this.ctx.warning(`${chunk.act} count of 0, Skipping entire repeated section`);
          } else if (count < 0) {
            this.ctx.error(`${chunk.act} count must be 0 or greater`);
          } else if (count > 10 && warn) {
            this.ctx.warning(`${count} is a large value for ${chunk.act}`);
          }
        } else {
          count = 2;
        }

        if (!ending) count += 1;
        for (let c = 0; c < count - 1; c++) {
          stack.push(...main);
          stacknum.push(...mainnum);
        }
        this.ctx.inpath!.push(stack, stacknum);
        break;
      } else if (chunk.act === 'REPEATENDING') {
        ending = 1;
        let count = 0;
        let warn = 1;
        if (chunk.rest.length) {
          let l = this.expand([...chunk.rest]);
          if (l.length === 2) {
            l = l.map((x) => x.toUpperCase());
            if (l.includes('NOWARN')) {
              l = l.filter((x) => x !== 'NOWARN');
              warn = 0;
            }
          } else {
            warn = 1;
          }
          if (l.length !== 1) this.ctx.error('REPEATENDING: Use [NoWarn] Count');
          count = stoi(this.ctx.rep, l[0]!, 'RepeatEnding takes an integer arg');
          if (count < 0) {
            this.ctx.error(`RepeatEnding count must be postive, not '${count}'`);
          } else if (count === 0 && warn) {
            this.ctx.warning('RepeatEnding count of 0, skipping section');
          } else if (count === 1 && warn) {
            this.ctx.warning('RepeatEnding count of 1 duplicates default');
          } else if (count > 10 && warn) {
            this.ctx.warning(`${count} is a large value for RepeatEnding`);
          }
        } else {
          count = 1;
        }

        chunk = repeatChunk();
        for (let c = 0; c < count; c++) {
          stack.push(...main);
          stacknum.push(...mainnum);
          stack.push(...chunk.q);
          stacknum.push(...chunk.qnum);
        }
      } else {
        this.ctx.error('Unexpected line in REPEAT');
      }
    }
  }

  // ---------------------------------------------------------------------
  // Expansion

  /** Port of Macros.expand: substitute all $VAR/$_SYS and $() math. */
  expand(input: string[]): string[] {
    let l = [...input];
    if (!this.expandMode) return l;

    let gotmath = 0;
    let sliceVar: string | null = null;

    for (;;) {
      let sub = 0;
      for (let i = 0; i < l.length; i++) {
        let s = l[i]!;
        if (s.length > 0 && s[0] === '$') {
          s = s.slice(1).toUpperCase();
          if (!s) this.ctx.error(`Illegal macro name '${l[i]}'.`);

          const frst = s[0]!;
          if (frst === '$') continue; // $$ - handled by the IF clause
          if (frst === '(') {
            gotmath = 1;
            continue;
          }

          if (s.endsWith(']')) {
            const x = s.lastIndexOf('[');
            if (!x) {
              this.ctx.error(`No matching for '[' for trailing ']' in variable '${s}'.`);
            }
            sliceVar = s.slice(x + 1, -1);
            s = s.slice(0, x);
            // Empty slice returns the length of the list; other slices are
            // evaluated by sliceVariable.
          } else {
            sliceVar = null;
          }

          let ex: MacroValue;
          if (frst === '_') {
            ex = this.sysvar(s.slice(1));
          } else if (this.vars.has(s)) {
            ex = this.vars.get(s)!;
          } else if (sliceVar === '') {
            l = [...l.slice(0, i), '-1', ...l.slice(i + 1)];
            sub = 1;
            sliceVar = null;
            break;
          } else {
            this.ctx.error(`User variable '${s}'  has not been defined`);
          }

          let tokens: string[];
          if (typeof ex === 'string') {
            let words = ex.split(/\s+/).filter((w) => w !== '');
            if (sliceVar !== null) {
              words = this.sliceVariable(words, sliceVar) as string[];
              sliceVar = null;
            }
            tokens = words;
          } else {
            let lines = ex;
            if (sliceVar !== null) {
              lines = this.sliceVariable(lines, sliceVar) as string[][];
              sliceVar = null;
            }
            if (lines.length) {
              this.ctx.inpath!.push(lines.slice(1), new Array(lines.length - 1).fill(this.ctx.lineno));
              tokens = lines[0]!;
            } else {
              tokens = [];
            }
          }

          l = [...l.slice(0, i), ...tokens, ...l.slice(i + 1)];
          sub = 1;
          break;
        }
      }
      if (!sub) break;
    }

    // All macros are expanded; now check for $() math.
    if (gotmath) {
      l = [l.join(' ')];

      for (;;) {
        const s1 = l[0]!.indexOf('$(');
        if (s1 < 0) break;
        // find trailing )
        let nest = 0;
        let s2 = s1 + 2;
        const max = l[0]!.length;
        for (;;) {
          if (l[0]![s2] === '(') nest += 1;
          if (l[0]![s2] === ')') {
            if (!nest) break;
            nest -= 1;
          }
          s2 += 1;
          if (s2 >= max) this.ctx.error(`Unmatched delimiter in '${l[0]}'.`);
        }
        const value: PyValue = safeEval(l[0]!.slice(s1 + 2, s2).trim(), {
          randint: (a: number, b: number) => this.ctx.rng.randint(a, b),
          error: (msg: string) => this.ctx.rep.error(msg),
        });
        l = [l[0]!.slice(0, s1) + pyStr(value) + l[0]!.slice(s2 + 1)];
      }

      l = l[0]!.split(/\s+/).filter((w) => w !== '');
    }

    return l;
  }

  /**
   * Port of sliceVariable: evaluate the p[<slice>] expression used in
   * $VAR[...] notation.  Returns a list; a plain index is wrapped.
   */
  private sliceVariable(p: string[] | string[][], sl: string): string[] | string[][] {
    if (sl === '') return [String(p.length)];

    const genericError: () => never = () =>
      this.ctx.error(`Index error '${sl}' in '${pythonRepr(p)}' Check the array being sliced.`);

    const parts = sl.split(':');
    if (parts.length > 3) genericError();

    const evalPart = (text: string): number | null => {
      const t = text.trim();
      if (t === '') return null;
      try {
        const v = safeEval(t, {
          randint: (a: number, b: number) => this.ctx.rng.randint(a, b),
          error: (msg: string) => this.ctx.rep.error(msg),
        });
        if (typeof v === 'object' && v !== null && 'value' in v) {
          return Math.trunc((v as { value: number }).value);
        }
      } catch {
        genericError();
      }
      genericError();
    };

    if (parts.length === 1) {
      const idx = evalPart(sl);
      if (idx === null) genericError();
      const arr = p as Array<string | string[]>;
      const i = idx! < 0 ? idx! + arr.length : idx!;
      if (i < 0 || i >= arr.length) this.ctx.error(`Index '${sl}' out of range.`);
      return [arr[i]!] as string[] | string[][];
    }

    const start = evalPart(parts[0]!);
    const stop = evalPart(parts[1]!);
    const step = parts.length === 3 ? (evalPart(parts[2]!) ?? 1) : 1;
    if (step === 0) genericError();

    const len = p.length;
    const lower = step > 0 ? 0 : -1;
    const upper = step > 0 ? len : len - 1;

    let s: number;
    if (start === null) s = step < 0 ? upper : lower;
    else {
      s = start;
      if (s < 0) s += len;
      if (s < lower) s = lower;
      else if (s > upper) s = upper;
    }

    let e: number;
    if (stop === null) e = step < 0 ? lower : upper;
    else {
      e = stop;
      if (e < 0) e += len;
      if (e < lower) e = lower;
      else if (e > upper) e = upper;
    }

    const out: Array<string | string[]> = [];
    if (step > 0) for (let i = s; i < e; i += step) out.push(p[i]!);
    else for (let i = s; i > e; i += step) out.push(p[i]!);
    return out as string[] | string[][];
  }

  // ---------------------------------------------------------------------
  // System variables

  /** Port of Macros.sysvar. */
  sysvar(name: string): string {
    const m = /^([^(]+)\((.*)\)$/.exec(name);
    if (m) return this.sysfun(m[1]!, m[2]!);

    const ctx = this.ctx;

    switch (name) {
      case 'CHORDADJUST':
        return Object.keys(ctx.cdAdjust)
          .sort()
          .map((a) => `${a}=${ctx.cdAdjust[a]}`)
          .join(' ');

      case 'FILENAME':
        return ctx.infile;

      case 'FILEPATH':
        return ctx.infile;

      case 'SONGPATH':
        return ctx.infile;

      case 'KEYSIG':
        return ctx.keySig.getKeysig();

      case 'TIME':
        return String(ctx.QperBar);

      case 'CTABS':
        return ctx.chordTabs.map((x) => floatStr(x / ctx.BperQ + 1)).join(',');

      case 'TIMESIG':
        return ctx.timeSig.getAscii();

      case 'TEMPO': {
        let tmp = ctx.tempo;
        for (const tc of ctx.mtrks.tempoChanges) {
          if (tc.tick > ctx.tickOffset) break;
          tmp = tc.tempo;
        }
        return String(tmp);
      }

      case 'OFFSET':
      case 'TICKPOS':
        return String(ctx.tickOffset);

      case 'SONGFILENAME':
        return ctx.infile;

      case 'VOLUME':
        return String(Math.trunc(ctx.volume.volume * 100));

      case 'VOLUMERATIO':
        return floatStr(ctx.volume.vTRatio * 100);

      case 'LASTVOLUME':
        return String(Math.trunc(ctx.volume.lastVolume * 100));

      case 'GROOVE':
        return ctx.grooves.currentGroove;

      case 'GROOVELIST':
        return [...ctx.grooves.glist.keys()].sort().join(' ');

      case 'TRACKLIST':
        return [...ctx.tnames.keys()].sort().join(' ');

      case 'LASTGROOVE':
        return ctx.grooves.lastGroove;

      case 'PLUGINS':
      case 'TRACKPLUGINS':
      case 'DATAPLUGINS':
        return ctx.plugins.map((p) => p.name).join(' ');

      case 'SEQ':
        return String(ctx.seqCount);

      case 'SEQRND':
        if (ctx.seqRnd[0] === 0) return 'Off';
        if (ctx.seqRnd[0] === 1) return 'On';
        return ctx.seqRnd.slice(1).join(' ');

      case 'SEQSIZE':
        return String(ctx.seqSize);

      case 'SWINGMODE':
        return this.opts.swingModeString ? this.opts.swingModeString() : '';

      case 'TRANSPOSE':
        return String(ctx.transpose);

      case 'STACKVALUE':
        if (!this.pushstack.length) this.ctx.error('Empty push/pull variable stack');
        return this.pushstack.pop()!;

      case 'DEBUG':
        if (this.opts.debugFlags) return this.opts.debugFlags(false);
        return `Debug=${ctx.debug.debug ? 1 : 0}`;

      case 'LASTDEBUG':
        if (this.opts.debugFlags) return this.opts.debugFlags(true);
        return `Debug=${ctx.debug.debug ? 1 : 0}`;

      case 'VEXPAND':
        return this.expandMode ? 'On' : 'Off';

      case 'MIDIPLAYER':
        return '';
      case 'MIDISPLIT':
        return '';
      case 'MIDIASSIGNS':
        return [...ctx.midiAssigns.entries()]
          .sort((a, b) => a[0] - b[0])
          .filter(([, n]) => n.length)
          .map(([c, n]) => `${c}=${n.join(',')}`)
          .join(' ');

      case 'SEQRNDWEIGHT':
        return ctx.seqRndWeight.join(' ');

      case 'AUTOLIBPATH':
      case 'LIBPATH':
      case 'INCPATH':
      case 'PLUGPATH':
      case 'OUTPATH':
      case 'MMAPATH':
        return '';
      case 'PWD':
        return '';

      case 'VOICETR':
        return ctx.vtable
          .entries()
          .map(([k, v]) => `${k}=${v}`)
          .join(' ');
      case 'TONETR':
        return ctx.dtable
          .entries()
          .map(([k, v]) => `${k}=${v}`)
          .join(' ');

      case 'BARNUM':
        return String(ctx.barNum + 1);
      case 'LINENUM':
        return String(ctx.lineno);

      case 'DATEYEAR':
        return String(new Date().getFullYear());
      case 'DATEDATE': {
        const d = new Date();
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      }
      case 'DATETIME': {
        const d = new Date();
        return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
      }

      default:
        break;
    }

    // Track variables ... these are in format TRACKNAME_VAR
    const a = name.lastIndexOf('_');
    if (a === -1) this.ctx.error(`Unknown system variable $_${name}`);

    const tname = name.slice(0, a);
    const func = name.slice(a + 1);

    const track = ctx.tnames.get(tname);
    if (!track) this.ctx.error(`System variable $_${name} refers to nonexistent track.`);

    return this.trackSysvar(track as unknown as TrackApi, func, name);
  }

  /** Track-variable formatting (macro.py track section). */
  private trackSysvar(t: TrackApi, func: string, full: string): string {
    switch (func) {
      case 'ACCENT': {
        const r: string[] = [];
        for (const s of t.accent as Array<Array<[number, number]>>) {
          r.push('{');
          for (const [b, v] of s) {
            r.push(pyG(b / this.ctx.BperQ + 1));
            r.push(String(Math.trunc(v * 100)));
          }
          r.push('}');
        }
        return r.join(' ');
      }

      case 'ARTICULATE':
        return t.artic.join(' ');
      case 'CHANNEL':
        return String(t.channel);
      case 'COMPRESS':
        return t.compress.join(' ');
      case 'DELAY':
        return t.delay.join(' ');
      case 'DIRECTION':
        return t.direction.join(' ');
      case 'INVERT':
        return t.invert.join(' ');
      case 'LIMIT':
        return `${t.chordLimit[0]} mode=${t.chordLimit[1]}`;
      case 'MIDIVOLUME':
        return String(t.cVolume);
      case 'OCTAVE':
        return t.octave.map((i) => String(Math.trunc(i / 12))).join(' ');
      case 'MOCTAVE':
        return t.octave.map((i) => String(Math.trunc(i / 12) - 1)).join(' ');
      case 'RANGE':
        return t.chordRange.join(' ');
      case 'RSKIP': {
        let m = '';
        if (t.rSkipBeats.length) {
          m = `Beats=${t.rSkipBeats.map((x) => pyG(x / this.ctx.BperQ + 1)).join(',')} `;
        }
        m += t.rSkip.map((i) => String(Math.trunc(i * 100))).join(' ');
        return m;
      }
      case 'RDURATION':
        return t.rDuration
          .map(([a1, a2]) => {
            const x = Math.trunc(a1 * 100);
            const y = Math.trunc(a2 * 100);
            return x === y ? String(Math.abs(x)) : `${x},${y}`;
          })
          .join(' ');
      case 'RTIME':
        return t.rTime
          .map(([a1, a2]) => (a1 === a2 ? String(Math.abs(a1)) : `${a1},${a2}`))
          .join(' ');
      case 'RVOLUME':
        return t.rVolume
          .map(([a1, a2]) => {
            const x = Math.trunc(a1 * 100);
            const y = Math.trunc(a2 * 100);
            return x === y ? String(Math.abs(x)) : `${x},${y}`;
          })
          .join(' ');

      case 'SEQUENCE': {
        const tmp: string[] = [];
        for (let i = 0; i < this.ctx.seqSize; i++) {
          tmp.push(`{${t.formatPattern(t.sequence[i])}}`);
        }
        return tmp.join(' ');
      }

      case 'SEQRND':
        return t.seqRnd ? 'On' : 'Off';
      case 'SEQRNDWEIGHT':
        return t.seqRndWeight.join(' ');
      case 'SPAN':
        return `${t.spanStart} ${t.spanEnd}`;
      case 'STICKY':
        return t.sticky ? 'True' : 'False';
      case 'STRUM':
        return t.strum
          .map((v) => (v === null ? '0' : v[0] === v[1] ? String(v[0]) : `${v[0]},${v[1]}`))
          .join(' ');
      case 'STRUMADD':
        return t.strumAdd.join(' ');
      case 'TONE': {
        const td = t as unknown as { drumType?: boolean; drumTone?: number };
        if (t.vtype === 'MELODY' || t.vtype === 'SOLO') {
          if (!td.drumType) this.ctx.error('Melody/Solo tracks must be DRUMTYPE for tone.');
          return drumValueToName(td.drumTone ?? 0);
        }
        if (t.vtype !== 'DRUM') this.ctx.error(`Tracktype ${t.vtype} doesn't have TONE`);
        return t.toneList.map((a) => drumValueToName(a)).join(' ');
      }
      case 'UNIFY':
        return t.unify.join(' ');
      case 'VOICE':
        return t.voice.map((a) => voiceValueToName(a)).join(' ');
      case 'VOLUME':
        return t.volume.map((a) => String(Math.trunc(a * 100))).join(' ');
      default:
        this.ctx.error(`Unknown system track variable ${full}`);
    }
  }

  /** Port of Macros.sysfun. */
  private sysfun(func: string, arg: string): string {
    if (func === 'NOTELEN') {
      return `${getNoteLen(this.ctx.rep, this.ctx.noteLenTable, arg)}T`;
    }
    if (func === 'ENV') {
      this.ctx.error('$_ENV() is not available in the browser port.');
    }
    this.ctx.error(`Unknown system function ${func}`);
  }
}

// -------------------------------------------------------------------------
// Python formatting helpers

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Python str() of a float (used for e.g. CTABS and VOLUMERATIO). */
function floatStr(v: number): string {
  return formatFloat(v);
}

/** Python '%g' formatting (6 significant digits, trailing zeros stripped). */
export function pyG(v: number): string {
  if (v === 0) return '0';
  const out = v.toPrecision(6);
  if (out.includes('e')) {
    const [mant, exp] = out.split('e') as [string, string];
    const m = mant!.includes('.') ? mant!.replace(/0+$/, '').replace(/\.$/, '') : mant!;
    const e = parseInt(exp!, 10);
    return `${m}e${e >= 0 ? '+' : '-'}${String(Math.abs(e)).padStart(2, '0')}`;
  }
  return out.includes('.') ? out.replace(/0+$/, '').replace(/\.$/, '') : out;
}

/** Python repr() of a list of strings (error messages). */
function pythonRepr(p: string[] | string[][]): string {
  return '[' + (p as Array<string | string[]>).map((x) => (typeof x === 'string' ? `'${x}'` : pythonRepr(x))).join(', ') + ']';
}

/** Port of midiC.valueToInst - instrument value to name. */
export function voiceValueToName(val: number): string {
  const name = VOICE_TABLE[val];
  if (name !== null && name !== undefined) return name;
  if (Number.isInteger(val)) {
    const [v, lsb, msb] = voice2tup(val);
    let s = `${v}.${lsb}.${msb}`;
    if (s.endsWith('.0')) s = s.slice(0, -2);
    if (s.endsWith('.0')) s = s.slice(0, -2);
    return s;
  }
  return 'ERROR';
}

/** Port of midiC.valueToDrum - drum value to name. */
export function drumValueToName(val: number): string {
  const name = DRUM_TABLE[val];
  if (name !== null && name !== undefined) return name;
  return String(val);
}

/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/func.py - DefCall/Call simple function/subroutine calls.
 * The body is stored as raw token lines at definition time and pushed
 * back into the reader at call time, with parameters bound through the
 * $StackValue mechanism (macro.py STACKVALUE).  Python kept funcList as
 * a module global; here it is per MMAContext.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 *
 * Original Python module by Bob van der Poel <bob@mellowood.ca>;
 * recursion-stack code by Ignazio Di Napoli.
 */

import type { MMAContext } from '../../engine/Context';
import type { MacroExpander } from '../../parse/MacroExpander';

class Funcs {
  constructor(
    readonly params: string[],
    readonly body: string[][],
    readonly defaults: Array<string | null>,
    readonly lineN: number,
    readonly fname: string,
  ) {}
}

const funcLists = new WeakMap<MMAContext, Map<string, Funcs>>();

function funcList(ctx: MMAContext): Map<string, Funcs> {
  let m = funcLists.get(ctx);
  if (!m) {
    m = new Map();
    funcLists.set(ctx, m);
  }
  return m;
}

/** Port of func.defCall: define a function. */
export function defCall(ctx: MMAContext, l: string[]): void {
  if (l.length < 1) {
    ctx.rep.error('DefCall: At least one argument (name) is needed.');
  }

  const lineN = ctx.lineno;

  // Grab 1st arg.  This is the function name.
  const fname = l[0]!.trim().toUpperCase();
  if (fname.includes('$')) {
    ctx.rep.error("DefCall: '$' is not permitted in function name.");
  }

  // The params are split into words.  Join together just so we can take
  // it apart again.  Needed to use ',' delimiters; read from the inside
  // out: replace '\,' with chr(255), join with spaces (skip func name),
  // split up at ','.
  const p = l.slice(1).join(' ').replace(/\\,/g, '\xff').split(',');

  // Convert the param names so they have a leading '$'.  The '$' is not
  // permitted in a param name.
  const params: string[] = [];
  const defaults: Array<string | null> = [];
  for (const a0 of p) {
    let a = a0.trim().replace(/\xff/g, ',');
    if (!a) continue;
    let d: string | null;
    if (a.includes('=')) {
      const i = a.indexOf('=');
      d = a.slice(i + 1).trim();
      a = a.slice(0, i).trim();
    } else {
      d = null;
    }
    if (a.includes('$')) {
      ctx.rep.error("DefCall: '$' is not permitted in paramater name.");
    }
    a = '$' + a;
    if (params.includes(a.toUpperCase())) {
      ctx.rep.error(`DefCall: '${a}' is a duplicate paramater name.`);
    }

    params.push(a.toUpperCase());
    defaults.push(d);
  }

  const body: string[][] = [];
  for (;;) {
    const ln = ctx.inpath!.read();
    if (!ln) {
      ctx.rep.error('DefCall: Reached EOF while looking for EndDefCall.');
    }
    const cmd = ln[0]!.toUpperCase();
    if (cmd === 'DEFCALLEND' || cmd === 'ENDDEFCALL') {
      if (ln.length > 1) {
        ctx.rep.error('DefCall: No arguments permitted for DefCallEnd/EndDefCall.');
      } else {
        break;
      }
    }
    if (cmd === 'DEFAULT') {
      if (ln.length < 2) {
        ctx.rep.error('Default: Requires at least one argument.');
      }
      const a = '$' + ln[1]!.trim().toUpperCase();
      let d = '';
      if (ln.length >= 2) {
        d = ln.slice(2).join(' ');
      }
      const i = params.indexOf(a);
      if (i < 0) {
        ctx.rep.error(`DefCall Default: param '${a}' does not exist in '${fname}'.`);
      }
      if (defaults[i]) {
        ctx.rep.warning(
          `DefCall Default: param '${a}' default value '${defaults[i]}' was set in param list.` +
            ` Overriding with '${d}'.`,
        );
      }
      defaults[i] = d;
      continue;
    }

    body.push(ln);
  }

  funcList(ctx).set(fname, new Funcs(params, body, defaults, lineN, ctx.infile));
  ctx.dPrint(
    `DefCall: Created function '${fname}': ${params.map((a) => a.slice(1)).join(', ')}`,
  );
}

/** Port of func.callFunction: call a function. */
export function callFunction(ctx: MMAContext, expander: MacroExpander, l: string[]): void {
  if (l.length < 1) {
    ctx.rep.error('DefCall: At least one argument (name) is needed.');
  }

  const fname = l[0]!.trim().toUpperCase();

  const list = funcList(ctx);
  if (!list.has(fname)) {
    ctx.rep.error(`Call: '${fname}' has not been defined.`);
  }
  const fn = list.get(fname)!;

  // Convert any escaped '\,' into $ff ... see explanation in defCall()
  const p = l.slice(1).join(' ').replace(/\\,/g, '\xff').split(',');

  // Validate calling params
  const params = fn.params;

  const callParams: string[] = [];
  let usingDefaults = false;
  const namedParams: Record<string, string> = {};
  for (const a0 of p) {
    const a = a0.trim().replace(/\xff/g, ','); // commas restored
    if (a) {
      // new list of params
      if (a.includes('=')) {
        usingDefaults = true;
        const i = a.indexOf('=');
        const an = '$' + a.slice(0, i).trim().toUpperCase();
        const d = a.slice(i + 1).trim();
        if (!params.includes(an)) {
          ctx.rep.error(`Call: '${an}' is not a param of '${fname}'.`);
        }
        namedParams[an] = d;
      } else if (usingDefaults) {
        ctx.rep.error('Call: cannot use a non-named param after a named one.');
      } else {
        callParams.push(a);
      }
    }
  }

  if (usingDefaults || params.length !== callParams.length) {
    const s = callParams.length;
    for (let i = 0; i < params.length - s; i++) {
      const prm = params[i + s]!;
      if (prm in namedParams) {
        callParams.push(namedParams[prm]!);
      } else {
        let d = fn.defaults[i + s];
        if (d === null || d === undefined) {
          // error("Call: '%s' has no default for '%s'." % (fname, p))
          d = 'UNDEFINED';
        }
        callParams.push(d);
      }
    }
  }

  if (params.length !== callParams.length) {
    ctx.rep.error(
      `Call: Function '${fname}' needs ${params.length} params, '${callParams.length}' given.`,
    );
  }

  // First, push the current values on the stack.  To avoid pushing
  // non-existent values, NewSet is called before pushing.  Then set
  // parameters as global values.  At the end of the function, stack
  // values are restored.  This way the parameters become local.
  const existingParams = params.filter((name) => expander.hasVar(name.slice(1)));
  const pushStack = existingParams.map((name) => ['StackValue', name]);
  const sets = params.map((name, i) => ['Set', name.slice(1), callParams[i]!]);
  const body = fn.body;
  const popStack = [...existingParams].reverse().map((name) => ['Set', name.slice(1), '$_StackValue']);
  const unset = params.filter((name) => !expander.hasVar(name.slice(1))).map((name) => ['UnSet', name.slice(1)]);

  const fullbody = [...pushStack, ...sets, ...body, ...popStack, ...unset];

  // push the converted body lines into the input stream
  ctx.inpath!.push(fullbody, fullbody.map(() => ctx.lineno));

  ctx.dPrint(`Call: function '${fname}' expanded.`);
}

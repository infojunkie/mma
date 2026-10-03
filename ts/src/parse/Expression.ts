/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/safe_eval.py and the $() math evaluation in macro.py.
 * Python's eval() is replaced by a hand-written parser/evaluator that
 * implements the Python expression subset reachable through the
 * safeCmds whitelist: numerics, strings, lists, comparisons, boolean
 * operators, subscripts/slices, list comprehensions and the whitelisted
 * functions/methods.  No JS eval/Function is used (CSP-safe).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { PyNum, PyValue, pyEquals, pyRound, pyStr, pyTruthy, formatFloat } from '../engine/PyValue';
import { MMAError } from '../engine/Errors';

export interface ExpressionHost {
  randint(a: number, b: number): number;
  error(msg: string): never;
}

/** safeCmds from safe_eval.py - identifiers longer than 1 char must be listed. */
const SAFE_CMDS = new Set([
  'ceil', 'fabs', 'floor', 'exp', 'log', 'log10', 'pow',
  'sqrt', 'acos', 'asin', 'atan', 'atan2', 'cos', 'hypot',
  'sin', 'tan', 'degrees', 'radians', 'cosh', 'sinh',
  'int', 'in', '.join', 'str', '.split', 'for', 'randint', 'round',
]);

/**
 * Evaluate an MMA $() expression.  Mirrors safeEval(): a token-level
 * whitelist check first, then evaluation with Python semantics.
 */
export function safeEval(expr: string, host: ExpressionHost): PyValue {
  for (const t of expr.split(/([a-zA-Z_.]+|.)/)) {
    if (t.length > 1 && !SAFE_CMDS.has(t)) {
      host.error(`Illegal/Unknown operator '${t}' in $().`);
    }
  }
  try {
    const ast = new ExpressionParser(expr).parse();
    return evaluate(ast, [new Map()], host);
  } catch {
    host.error(`Illegal operation in '${expr}'.`);
  }
}

/** Internal: evaluate without the "Illegal operation" wrapper (debugging/tests). */
export function debugEval(expr: string, host: ExpressionHost): PyValue {
  const ast = new ExpressionParser(expr).parse();
  return evaluate(ast, [new Map()], host);
}

// ---- AST ------------------------------------------------------------------

type Node =
  | { k: 'num'; v: PyNum }
  | { k: 'str'; v: string }
  | { k: 'name'; v: string }
  | { k: 'list'; items: Node[] }
  | { k: 'tuple'; items: Node[] }
  | { k: 'comprehension'; body: Node; clauses: Clause[] }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'unary'; op: string; v: Node }
  | { k: 'compare'; first: Node; ops: string[]; rest: Node[] }
  | { k: 'bool'; op: 'and' | 'or'; l: Node; r: Node }
  | { k: 'not'; v: Node }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'method'; obj: Node; name: string; args: Node[] }
  | { k: 'attr'; obj: Node; name: string }
  | { k: 'index'; obj: Node; index: Node }
  | { k: 'slice'; obj: Node; start?: Node; stop?: Node; step?: Node };

interface Clause {
  name: string;
  iter: Node;
  ifs: Node[];
}

type Env = Array<Map<string, PyValue>>;

// ---- tokenizer ------------------------------------------------------------

type TokenType = 'num' | 'str' | 'name' | 'op' | 'eof';
interface Token {
  type: TokenType;
  value: string;
  int?: boolean;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(expr[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(expr.slice(i))!;
      const text = m[0];
      tokens.push({ type: 'num', value: text, int: !/[.eE]/.test(text) });
      i += text.length;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let out = '';
      i++;
      let closed = false;
      while (i < expr.length) {
        const c = expr[i]!;
        if (c === '\\') {
          const n = expr[i + 1];
          if (n === undefined) break;
          out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n;
          i += 2;
          continue;
        }
        if (c === ch) {
          i++;
          closed = true;
          break;
        }
        out += c;
        i++;
      }
      if (!closed) throw new MMAError('unterminated string');
      tokens.push({ type: 'str', value: out });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expr.slice(i))!;
      tokens.push({ type: 'name', value: m[0] });
      i += m[0].length;
      continue;
    }
    const two = expr.slice(i, i + 2);
    if (['**', '//', '<=', '>=', '==', '!=', '<<', '>>'].includes(two)) {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }
    if ('+-*/%<>=()[],:.|^&~'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    throw new MMAError(`unexpected character '${ch}'`);
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

// ---- parser (builds AST) --------------------------------------------------

class ExpressionParser {
  private tokens: Token[];
  private pos = 0;

  constructor(expr: string) {
    this.tokens = tokenize(expr);
  }

  parse(): Node {
    const n = this.parseOr();
    if (this.peek().type !== 'eof') this.fail();
    return n;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const t = this.tokens[this.pos]!;
    if (t.type !== 'eof') this.pos++;
    return t;
  }

  private accept(value: string): boolean {
    const t = this.peek();
    if ((t.type === 'op' || t.type === 'name') && t.value === value) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expect(value: string): void {
    if (!this.accept(value)) this.fail();
  }

  private fail(): never {
    throw new MMAError('expression syntax error');
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.accept('or')) {
      left = { k: 'bool', op: 'or', l: left, r: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.accept('and')) {
      left = { k: 'bool', op: 'and', l: left, r: this.parseNot() };
    }
    return left;
  }

  private parseNot(): Node {
    if (this.accept('not')) {
      return { k: 'not', v: this.parseNot() };
    }
    return this.parseComparison();
  }

  private static readonly COMPARE_OPS = new Set(['<', '>', '<=', '>=', '==', '!=']);

  private parseComparison(): Node {
    const first = this.parseBitOr();
    const ops: string[] = [];
    const rest: Node[] = [];
    for (;;) {
      const t = this.peek();
      let op: string | undefined;
      if (t.type === 'op' && ExpressionParser.COMPARE_OPS.has(t.value)) op = t.value;
      else if (t.type === 'name' && t.value === 'in') op = 'in';
      else if (t.type === 'name' && t.value === 'not' && this.peek(1).value === 'in') op = 'not in';
      if (op === undefined) break;
      this.pos += op === 'not in' ? 2 : 1;
      ops.push(op);
      rest.push(this.parseBitOr());
    }
    if (ops.length === 0) return first;
    return { k: 'compare', first, ops, rest };
  }

  private parseBitOr(): Node {
    let left = this.parseBitXor();
    while (this.peek().value === '|' && this.peek().type === 'op') {
      this.next();
      left = { k: 'bin', op: '|', l: left, r: this.parseBitXor() };
    }
    return left;
  }

  private parseBitXor(): Node {
    let left = this.parseBitAnd();
    while (this.accept('^')) {
      left = { k: 'bin', op: '^', l: left, r: this.parseBitAnd() };
    }
    return left;
  }

  private parseBitAnd(): Node {
    let left = this.parseShift();
    while (this.peek().type === 'op' && this.peek().value === '&') {
      this.next();
      left = { k: 'bin', op: '&', l: left, r: this.parseShift() };
    }
    return left;
  }

  private parseShift(): Node {
    let left = this.parseArith();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'op' || (t.value !== '<<' && t.value !== '>>')) break;
      this.next();
      left = { k: 'bin', op: t.value, l: left, r: this.parseArith() };
    }
    return left;
  }

  private parseArith(): Node {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'op' || (t.value !== '+' && t.value !== '-')) break;
      this.next();
      left = { k: 'bin', op: t.value, l: left, r: this.parseTerm() };
    }
    return left;
  }

  private parseTerm(): Node {
    let left = this.parseFactor();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'op' || !['*', '/', '//', '%'].includes(t.value)) break;
      this.next();
      left = { k: 'bin', op: t.value, l: left, r: this.parseFactor() };
    }
    return left;
  }

  private parseFactor(): Node {
    const t = this.peek();
    if (t.type === 'op' && (t.value === '-' || t.value === '+' || t.value === '~')) {
      this.next();
      return { k: 'unary', op: t.value, v: this.parseFactor() };
    }
    return this.parsePower();
  }

  private parsePower(): Node {
    const base = this.parsePostfix();
    if (this.accept('**')) {
      return { k: 'bin', op: '**', l: base, r: this.parseFactor() };
    }
    return base;
  }

  private parsePostfix(): Node {
    const head = this.peek();
    let node: Node;
    if (head.type === 'name' && CALLABLES.has(head.value) && this.peek(1).value === '(' && this.peek(1).type === 'op') {
      this.next();
      this.next();
      node = { k: 'call', name: head.value, args: this.parseArgs(')') };
    } else {
      node = this.parseAtom();
    }
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && t.value === '(') {
        this.next();
        const args = this.parseArgs(')');
        if (node.k === 'name') node = { k: 'call', name: node.v, args };
        else if (node.k === 'attr') node = { k: 'method', obj: node.obj, name: node.name, args };
        else this.fail();
      } else if (t.type === 'op' && t.value === '[') {
        this.next();
        node = this.parseSubscript(node);
      } else if (t.type === 'op' && t.value === '.') {
        this.next();
        const name = this.next();
        if (name.type !== 'name') this.fail();
        node = { k: 'attr', obj: node, name: name.value };
      } else {
        break;
      }
    }
    return node;
  }

  private parseArgs(close: string): Node[] {
    const args: Node[] = [];
    if (this.accept(close)) return args;
    for (;;) {
      args.push(this.parseOr());
      if (this.accept(close)) return args;
      this.expect(',');
      if (this.accept(close)) return args;
    }
  }

  private parseSubscript(obj: Node): Node {
    let start: Node | undefined;
    let stop: Node | undefined;
    let step: Node | undefined;
    if (this.accept(']')) this.fail();
    if (!this.accept(':')) {
      start = this.parseOr();
      if (this.accept(']')) return { k: 'index', obj, index: start };
      this.expect(':');
    }
    if (this.accept(']')) return { k: 'slice', obj, start };
    if (this.accept(':')) {
      if (!this.accept(']')) {
        step = this.parseOr();
        this.expect(']');
      }
      return { k: 'slice', obj, start, step };
    }
    stop = this.parseOr();
    if (this.accept(']')) return { k: 'slice', obj, start, stop };
    this.expect(':');
    if (!this.accept(']')) {
      step = this.parseOr();
      this.expect(']');
    }
    return { k: 'slice', obj, start, stop, step };
  }

  private parseAtom(): Node {
    const t = this.next();
    if (t.type === 'num') return { k: 'num', v: new PyNum(Number(t.value), t.int === true) };
    if (t.type === 'str') return { k: 'str', v: t.value };
    if (t.type === 'name') return { k: 'name', v: t.value };
    if (t.type === 'op' && t.value === '(') {
      const v = this.parseOr();
      this.expect(')');
      return v;
    }
    if (t.type === 'op' && t.value === '[') {
      return this.parseList();
    }
    this.fail();
  }

  private parseList(): Node {
    if (this.accept(']')) return { k: 'list', items: [] };
    const first = this.parseOr();
    if (this.accept('for')) {
      return this.parseComprehension(first);
    }
    const items = [first];
    while (this.accept(',')) {
      if (this.accept(']')) return { k: 'list', items };
      items.push(this.parseOr());
    }
    this.expect(']');
    return { k: 'list', items };
  }

  private parseComprehension(body: Node): Node {
    const clauses: Clause[] = [];
    for (;;) {
      const name = this.next();
      if (name.type !== 'name') this.fail();
      this.expect('in');
      const iter = this.parseOr();
      const ifs: Node[] = [];
      while (this.accept('if')) ifs.push(this.parseOr());
      clauses.push({ name: name.value, iter, ifs });
      if (!this.accept('for')) break;
    }
    this.expect(']');
    return { k: 'comprehension', body, clauses };
  }
}

// ---- evaluator ------------------------------------------------------------

function evaluate(node: Node, env: Env, host: ExpressionHost): PyValue {
  switch (node.k) {
    case 'num':
      return node.v;
    case 'str':
      return node.v;
    case 'name': {
      const v = lookup(node.v, env);
      if (v === undefined) {
        if (node.v === 'True') return true;
        if (node.v === 'False') return false;
        throw new MMAError(`name '${node.v}' is not defined`);
      }
      return v;
    }
    case 'list':
      return node.items.map((n) => evaluate(n, env, host));
    case 'tuple':
      return node.items.map((n) => evaluate(n, env, host));
    case 'comprehension': {
      const out: PyValue[] = [];
      const walk = (i: number): void => {
        if (i === node.clauses.length) {
          out.push(evaluate(node.body, env, host));
          return;
        }
        const clause = node.clauses[i]!;
        const iterable = evaluate(clause.iter, env, host);
        const seq: PyValue[] = typeof iterable === 'string' ? [...iterable] : Array.isArray(iterable) ? iterable : [];
        env.push(new Map());
        for (const item of seq) {
          env[env.length - 1]!.set(clause.name, item);
          if (clause.ifs.every((c) => pyTruthy(evaluate(c, env, host)))) walk(i + 1);
        }
        env.pop();
      };
      walk(0);
      return out;
    }
    case 'bool': {
      const l = evaluate(node.l, env, host);
      if (node.op === 'and') return pyTruthy(l) ? evaluate(node.r, env, host) : l;
      return pyTruthy(l) ? l : evaluate(node.r, env, host);
    }
    case 'not':
      return !pyTruthy(evaluate(node.v, env, host));
    case 'unary': {
      const v = evaluate(node.v, env, host);
      if (node.op === '-') return negValue(v);
      if (node.op === '+') return v instanceof PyNum ? v : raise('bad operand type for unary +');
      return PyNum.int(~asInt(v));
    }
    case 'bin': {
      const a = evaluate(node.l, env, host);
      const b = evaluate(node.r, env, host);
      switch (node.op) {
        case '+':
          return addValue(a, b);
        case '-':
          return subValue(a, b);
        case '*':
          return mulValue(a, b);
        case '/':
          return divValue(a, b);
        case '//':
          return floorDivValue(a, b);
        case '%':
          return modValue(a, b);
        case '**':
          return powValue(a, b);
        case '|':
          return PyNum.int(asInt(a) | asInt(b));
        case '^':
          return PyNum.int(asInt(a) ^ asInt(b));
        case '&':
          return PyNum.int(asInt(a) & asInt(b));
        case '<<':
          return PyNum.int(asInt(a) << asInt(b));
        default:
          return PyNum.int(asInt(a) >> asInt(b));
      }
    }
    case 'compare': {
      let left = evaluate(node.first, env, host);
      for (let i = 0; i < node.ops.length; i++) {
        const right = evaluate(node.rest[i]!, env, host);
        const op = node.ops[i]!;
        let ok: boolean;
        if (op === 'in' || op === 'not in') {
          const inResult = pyIn(left, right);
          ok = op === 'in' ? inResult : !inResult;
        } else {
          ok = compareValue(op, left, right);
        }
        if (!ok) return false;
        left = right;
      }
      return true;
    }
    case 'call':
      return callFunction(node.name, node.args.map((a) => evaluate(a, env, host)), host);
    case 'method': {
      const obj = evaluate(node.obj, env, host);
      const args = node.args.map((a) => evaluate(a, env, host));
      return callMethod(obj, node.name, args);
    }
    case 'attr':
      throw new MMAError(`attribute access '.${node.name}' is not permitted`);
    case 'index':
      return subscriptValue(evaluate(node.obj, env, host), evaluate(node.index, env, host));
    case 'slice': {
      const obj = evaluate(node.obj, env, host);
      const start = node.start === undefined ? undefined : asInt(evaluate(node.start, env, host));
      const stop = node.stop === undefined ? undefined : asInt(evaluate(node.stop, env, host));
      const step = node.step === undefined ? undefined : asInt(evaluate(node.step, env, host));
      return sliceValue(obj, start, stop, step);
    }
  }
}

function lookup(name: string, env: Env): PyValue | undefined {
  for (let i = env.length - 1; i >= 0; i--) {
    const v = env[i]!.get(name);
    if (v !== undefined) return v;
  }
  return undefined;
}

function raise(msg: string): never {
  throw new MMAError(msg);
}

function pyIn(needle: PyValue, haystack: PyValue): boolean {
  if (Array.isArray(haystack)) return haystack.some((item) => pyEquals(needle, item));
  if (typeof haystack === 'string') {
    if (typeof needle !== 'string') raise('in <string> requires string left operand');
    return haystack.includes(needle);
  }
  raise(`argument of type '${typeof haystack}' is not iterable`);
}

// ---- Python value operations ---------------------------------------------

function asNum(v: PyValue): PyNum {
  if (v instanceof PyNum) return v;
  raise(`expected number, got ${typeof v}`);
}

function asInt(v: PyValue): number {
  return asNum(v).value;
}

function numResult(a: PyNum, b: PyNum, value: number): PyNum {
  return a.isInt && b.isInt ? PyNum.int(value) : PyNum.float(value);
}

function addValue(a: PyValue, b: PyValue): PyValue {
  if (a instanceof PyNum && b instanceof PyNum) return numResult(a, b, a.value + b.value);
  if (typeof a === 'string' && typeof b === 'string') return a + b;
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  raise('unsupported operand type(s) for +');
}

function subValue(a: PyValue, b: PyValue): PyValue {
  const x = asNum(a);
  const y = asNum(b);
  return numResult(x, y, x.value - y.value);
}

function mulValue(a: PyValue, b: PyValue): PyValue {
  if (a instanceof PyNum && b instanceof PyNum) return numResult(a, b, a.value * b.value);
  if (typeof a === 'string' && b instanceof PyNum && b.isInt) return a.repeat(Math.max(0, b.value));
  if (a instanceof PyNum && a.isInt && typeof b === 'string') return b.repeat(Math.max(0, a.value));
  if (Array.isArray(a) && b instanceof PyNum && b.isInt) {
    const out: PyValue[] = [];
    for (let i = 0; i < Math.max(0, b.value); i++) out.push(...a);
    return out;
  }
  if (a instanceof PyNum && a.isInt && Array.isArray(b)) return mulValue(b, a);
  raise('unsupported operand type(s) for *');
}

function divValue(a: PyValue, b: PyValue): PyValue {
  const x = asNum(a);
  const y = asNum(b);
  if (y.value === 0) raise('division by zero');
  return PyNum.float(x.value / y.value);
}

function floorDivValue(a: PyValue, b: PyValue): PyValue {
  const x = asNum(a);
  const y = asNum(b);
  if (y.value === 0) raise('division by zero');
  return numResult(x, y, Math.floor(x.value / y.value));
}

function modValue(a: PyValue, b: PyValue): PyValue {
  const x = asNum(a);
  const y = asNum(b);
  if (y.value === 0) raise('division by zero');
  let r = x.value % y.value;
  // Python modulo takes the sign of the divisor.
  if (r !== 0 && (r < 0) !== (y.value < 0)) r += y.value;
  return numResult(x, y, r);
}

function powValue(a: PyValue, b: PyValue): PyValue {
  const x = asNum(a);
  const y = asNum(b);
  if (x.value === 0 && y.value < 0) raise('zero to a negative power');
  const v = Math.pow(x.value, y.value);
  if (x.isInt && y.isInt && y.value >= 0 && Number.isFinite(v)) return PyNum.int(v);
  return PyNum.float(v);
}

function negValue(v: PyValue): PyValue {
  const n = asNum(v);
  return n.isInt ? PyNum.int(-n.value) : PyNum.float(-n.value);
}

function compareValue(op: string, a: PyValue, b: PyValue): boolean {
  if (op === '==' || op === '!=') {
    const eq = pyEquals(a, b);
    return op === '==' ? eq : !eq;
  }
  // Coerce booleans to numbers, as Python's bool is an int subclass.
  const x = typeof a === 'boolean' ? PyNum.int(a ? 1 : 0) : a;
  const y = typeof b === 'boolean' ? PyNum.int(b ? 1 : 0) : b;
  let cmp: number;
  if (x instanceof PyNum && y instanceof PyNum) cmp = x.value < y.value ? -1 : x.value > y.value ? 1 : 0;
  else if (typeof x === 'string' && typeof y === 'string') cmp = x < y ? -1 : x > y ? 1 : 0;
  else raise('unorderable types');
  switch (op) {
    case '<':
      return cmp < 0;
    case '<=':
      return cmp <= 0;
    case '>':
      return cmp > 0;
    default:
      return cmp >= 0;
  }
}

function subscriptValue(obj: PyValue, index: PyValue): PyValue {
  if (!(index instanceof PyNum) || !index.isInt) raise('indices must be integers');
  if (typeof obj === 'string' || Array.isArray(obj)) {
    const i = index.value;
    const idx = i < 0 ? i + obj.length : i;
    if (idx < 0 || idx >= obj.length) raise('index out of range');
    return obj[idx]!;
  }
  raise('not subscriptable');
}

function sliceValue(obj: PyValue, rawStart?: number, rawStop?: number, step = 1): PyValue {
  if (typeof obj !== 'string' && !Array.isArray(obj)) raise('not subscriptable');
  if (step === 0) raise('slice step cannot be zero');
  const length = obj.length;
  const lower = step > 0 ? 0 : -1;
  const upper = step > 0 ? length : length - 1;

  let start: number;
  if (rawStart === undefined) start = step < 0 ? upper : lower;
  else {
    start = rawStart;
    if (start < 0) start += length;
    if (start < lower) start = lower;
    else if (start > upper) start = upper;
  }

  let stop: number;
  if (rawStop === undefined) stop = step < 0 ? lower : upper;
  else {
    stop = rawStop;
    if (stop < 0) stop += length;
    if (stop < lower) stop = lower;
    else if (stop > upper) stop = upper;
  }

  const out: PyValue[] = [];
  if (step > 0) for (let i = start; i < stop; i += step) out.push(obj[i]!);
  else for (let i = start; i > stop; i += step) out.push(obj[i]!);
  return typeof obj === 'string' ? out.join('') : out;
}

// ---- whitelisted calls ----------------------------------------------------

const MATH_FUNCS: Record<string, (...a: number[]) => number> = {
  ceil: Math.ceil,
  fabs: Math.abs,
  floor: Math.floor,
  exp: Math.exp,
  log: Math.log,
  log10: Math.log10,
  pow: Math.pow,
  sqrt: Math.sqrt,
  acos: Math.acos,
  asin: Math.asin,
  atan: Math.atan,
  atan2: Math.atan2,
  cos: Math.cos,
  hypot: Math.hypot,
  sin: Math.sin,
  tan: Math.tan,
  degrees: (x) => (x * 180) / Math.PI,
  radians: (x) => (x * Math.PI) / 180,
  cosh: Math.cosh,
  sinh: Math.sinh,
};

/** Names that may be called directly: the math whitelist plus int/str/round/randint. */
const CALLABLES = new Set<string>([...Object.keys(MATH_FUNCS), 'int', 'str', 'round', 'randint']);

export function callFunction(name: string, args: PyValue[], host: ExpressionHost): PyValue {
  if (name in MATH_FUNCS) {
    const nums = args.map((a) => asNumRaw(a));
    const v = MATH_FUNCS[name]!(...nums);
    if (Number.isNaN(v)) raise('math domain error');
    // CPython math functions raise for out-of-domain inputs.
    if (!Number.isFinite(v) && Number.isFinite(nums[0] ?? 0)) raise('math domain error');
    // math.ceil()/math.floor() return ints in Python 3.
    if (name === 'ceil' || name === 'floor') return PyNum.int(v);
    return PyNum.float(v);
  }
  switch (name) {
    case 'int': {
      const v = args[0];
      if (v instanceof PyNum) return PyNum.int(v.value);
      if (typeof v === 'boolean') return PyNum.int(v ? 1 : 0);
      if (typeof v === 'string') {
        const t = v.trim();
        if (!/^[+-]?\d+$/.test(t)) raise('invalid literal for int()');
        return PyNum.int(parseInt(t, 10));
      }
      raise('int() argument must be a string or a number');
    }
    case 'str':
      return pyStr(args[0]!);
    case 'round': {
      const v = asNumRaw(args[0]!);
      if (args.length > 1) return pyRound(v, asIntRaw(args[1]!));
      return pyRound(v);
    }
    case 'randint':
      return PyNum.int(host.randint(asIntRaw(args[0]!), asIntRaw(args[1]!)));
    default:
      raise(`unknown function '${name}'`);
  }
}

function callMethod(obj: PyValue, name: string, args: PyValue[]): PyValue {
  if (typeof obj !== 'string') raise(`${name}() requires a string`);
  if (name === 'split') {
    const sep = args[0];
    const maxsplit = args[1];
    const limit = maxsplit === undefined ? -1 : asInt(maxsplit);
    if (sep === undefined) {
      // Python str.split() with no args: split on runs of whitespace.
      const trimmed = obj.trim();
      if (trimmed === '') return [];
      const parts = trimmed.split(/\s+/);
      return limit < 0 ? parts : parts.slice(0, limit);
    }
    if (typeof sep !== 'string') raise('split() separator must be a string');
    if (limit < 0) return obj.split(sep);
    return splitLimit(obj, sep, limit);
  }
  if (name === 'join') {
    const iterable = args[0];
    if (!Array.isArray(iterable)) raise('join() requires an iterable');
    return iterable.map((v) => (typeof v === 'string' ? v : raise('join() items must be strings'))).join(obj);
  }
  raise(`attribute access '.${name}' is not permitted`);
}

function splitLimit(s: string, sep: string, limit: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (out.length < limit) {
    const i = rest.indexOf(sep);
    if (i < 0) break;
    out.push(rest.slice(0, i));
    rest = rest.slice(i + sep.length);
  }
  out.push(rest);
  return out;
}

function asNumRaw(v: PyValue): number {
  if (v instanceof PyNum) return v.value;
  if (typeof v === 'boolean') return v ? 1 : 0;
  raise('expected number');
}

function asIntRaw(v: PyValue): number {
  return Math.trunc(asNumRaw(v));
}

export type { Node as ExpressionNode };
export { formatFloat };

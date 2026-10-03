import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { safeEval } from '../../src/parse/Expression';
import { pyStr } from '../../src/engine/PyValue';
import { MMAError } from '../../src/engine/Errors';

const fixtures: Record<string, string> = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/python/expressions.json', import.meta.url)), 'utf-8'),
);

const host = {
  randint: (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1)),
  error(msg: string): never {
    throw new MMAError(msg);
  },
};

describe('safeEval ($() expressions)', () => {
  for (const [expr, expected] of Object.entries(fixtures)) {
    if (expected === '<error>') {
      it(`rejects ${expr}`, () => {
        expect(() => safeEval(expr, host)).toThrow(MMAError);
      });
    } else {
      it(`${expr} -> ${expected}`, () => {
        expect(pyStr(safeEval(expr, host))).toBe(expected);
      });
    }
  }

  it('uses the injected randint for reproducibility', () => {
    const fixed = { ...host, randint: () => 42 };
    expect(pyStr(safeEval('randint(1, 10)', fixed))).toBe('42');
  });

  it('reports the whitelist error for unknown identifiers', () => {
    try {
      safeEval('unknown(1)', host);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as MMAError).message).toBe("Illegal/Unknown operator 'unknown' in $().");
    }
  });
});

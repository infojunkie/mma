#!/usr/bin/env python3
"""Generate golden fixtures for the TypeScript $() expression evaluator.

Uses the original Python MMA safeEval as the oracle.  Walks up to the
mma repo root, stubs the __main__ globals that MMA.gbl expects, and
prints JSON mapping expression -> str(safeEval(expression)).

Run: python3 ts/test/tools/gen_expression_fixtures.py > ts/test/fixtures/python/expressions.json
"""

import contextlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MMA_DIR = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, MMA_DIR)

import __main__

__main__.MMAdir = MMA_DIR
__main__.platform = "Linux"

from MMA.safe_eval import safeEval  # noqa: E402

EXPRESSIONS = [
    # arithmetic and precedence
    "1 + 2 * 3",
    "(1 + 2) * 3",
    "1 + 2 * 3 - 4 / 2",
    "7 / 2",
    "7 // 2",
    "10 // 3.0",
    "7 % 3",
    "-7 % 3",
    "2 ** 10",
    "2 ** -1",
    "44 * 3.2",
    "int(44 * 3.2)",
    "1e4",
    "1.5e-3",
    "0.1 + 0.2",
    "True + 1",
    "False == 0",
    "not 0",
    "0 or 3",
    "1 and 2",
    # round / int / str
    "round(2.5)",
    "round(3.5)",
    "round(-2.5)",
    "round(3.14159, 2)",
    "int('42')",
    "int(3.9)",
    "int(-3.9)",
    "str(42)",
    "str(3.0)",
    "str(2000.0)",
    # strings and lists
    "'a b  c'.split()",
    "' 90 91 '.split()",
    "'1,2,3'.split(',')",
    "' '.join(['a','b','c'])",
    "' '.join([str(int(x)+10) for x in '1 2 3'.split()])",
    "[str(int(x)+10) for x in '1 2 3'.split()]",
    "'ab' * 3",
    "[1,2,3][-1]",
    "'abcdef'[1:4]",
    "'abcdef'[::-1]",
    "'abcdef'[::2]",
    "'abc' + 'def'",
    "'HELLO'.lower()",
    # comparisons
    "1 < 2 < 3",
    "1 < 2 > 3",
    "'a' < 'b'",
    "1 == 1.0",
    "2 in [1,2,3]",
    "'a' in 'abc'",
    # math functions
    "ceil(1.2)",
    "floor(-1.2)",
    "sqrt(16)",
    "log10(1000)",
    "hypot(3,4)",
    "degrees(3.141592653589793)",
    "pow(2, 8)",
    # real MMA idioms (variables substituted)
    "5 - 1",
    "4 * 60000 / 120",
    "round(4 * 60000 / 120)",
    "int(90 * .8)",
    "int([90][0] * .8)",
]


def main():
    out = {}
    for e in EXPRESSIONS:
        with contextlib.redirect_stdout(sys.stderr):
            try:
                out[e] = str(safeEval(e))
            except SystemExit:
                out[e] = "<error>"
    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

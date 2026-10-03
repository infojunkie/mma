#!/usr/bin/env python3
"""Generate golden fixture for the MMA built-in chord table.

Uses the original Python MMA/chordtable.py as the oracle.  Walks up to
the mma repo root, stubs the __main__ globals that MMA.gbl expects, and
prints JSON mapping chord name -> {notes, scale, description}.  The
resulting dict is the module-level `chordlist` after the alias loop has
run, so it includes both the base chords and all their synonyms.

Run: python3 ts/test/tools/gen_chordtable_fixtures.py > ts/test/fixtures/python/chordtable.json
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MMA_DIR = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, MMA_DIR)

import __main__

__main__.MMAdir = MMA_DIR
__main__.platform = "Linux"

from MMA.chordtable import chordlist  # noqa: E402


def main():
    out = {
        name: {
            "notes": list(notes),
            "scale": list(scale),
            "description": doc if doc is not None else "",
        }
        for name, (notes, scale, doc) in chordlist.items()
    }
    json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

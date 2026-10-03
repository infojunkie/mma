#!/usr/bin/env python3
"""Generate golden fixtures for the TypeScript chord-line parser.

Uses the original Python MMA parseCL.py as the oracle.  Walks up to the
mma repo root, stubs the __main__ globals that MMA.gbl expects, sets the
default chord tabs and calls parseChordLine() for each case.  Each case
is a list of chord-data lines (token lists); bars are parsed in order so
that the 'last chord' continuation state is exercised.

Output JSON:
{
  "cases": [
    {"lines": [["C", "/", "G", "/"]],
     "bars": [[ {name, chStart, chEnd, z-flags, chord:{...}}, ... ]],
     "error": "..." | null}
  ]
}

Run: python3 ts/test/tools/gen_chordline_fixtures.py > ts/test/fixtures/python/chordlines.json
"""

import contextlib
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MMA_DIR = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, MMA_DIR)

import __main__

__main__.MMAdir = MMA_DIR
__main__.platform = "Linux"

from MMA import gbl  # noqa: E402
from MMA import parseCL  # noqa: E402
import MMA.chords  # noqa: E402,F401  (parseCL expects the main module to import it)
import MMA.truncate  # noqa: E402,F401  (parseCL reads MMA.truncate.length)

gbl.BperQ = 192
gbl.QperBar = 4
gbl.barLen = 768
parseCL.setChordTabs([1, 2, 3, 4])

CASES = [
    [["C"]],
    [["C", "/", "G", "/"]],
    [["C", "-", "-", "-"]],
    [["/"]],
    [["z"]],
    [["z!"]],
    [["zB"]],
    [["Cz"]],
    [["CzB"]],
    [["z", "C"]],
    [["Cm@3.2"]],
    [["C", "Cm@3.2"]],
    [["C@2", "F@4"]],
    [["C", "D@2", "F@4"]],
    [["C", "C@2", "F@4"]],
    [["C7", "F", "G7"]],
    [["C", "D", "E", "F", "G"]],
    [["C@4.5"]],
    [["C", "G@4.5"]],
    [["C", "G@4.5", "A@4"]],
    [["C@7"]],
    [["C@0.5"]],
    [["Cz", "/"]],
    [["Cz", "z"]],
    [["CzB", "z"]],
    [["C/", "z"]],
    [["C", "z", "-", "zD"]],
    [["C", "C", "G"]],
    [["@1", "C"]],
]


def dump_ctable(ct):
    ch = ct.chord
    return {
        "name": ct.name,
        "chStart": ct.chStart,
        "chEnd": ct.chEnd,
        "chordZ": bool(ct.chordZ),
        "arpeggioZ": bool(ct.arpeggioZ),
        "walkZ": bool(ct.walkZ),
        "drumZ": bool(ct.drumZ),
        "bassZ": bool(ct.bassZ),
        "scaleZ": bool(ct.scaleZ),
        "ariaZ": bool(ct.ariaZ),
        "plectrumZ": bool(ct.plectrumZ),
        "chord": {
            "tonic": getattr(ch, "tonic", None),
            "chordType": getattr(ch, "chordType", None),
            "rootNote": getattr(ch, "rootNote", None),
            "noteListLen": getattr(ch, "noteListLen", 0),
            "noteList": list(getattr(ch, "noteList", [])),
            "bnoteList": list(getattr(ch, "bnoteList", [])),
            "scaleList": list(getattr(ch, "scaleList", [])),
        },
    }


def main():
    out = {"cases": []}
    for lines in CASES:
        parseCL.lastChord = None
        entry = {"lines": lines, "bars": [], "error": None}
        stderr = io.StringIO()
        stdout = io.StringIO()
        try:
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                for line in lines:
                    ct = parseCL.parseChordLine(list(line))
                    entry["bars"].append([dump_ctable(c) for c in ct])
        except SystemExit:
            msg = (stderr.getvalue() + "\n" + stdout.getvalue()).strip()
            if msg.startswith("Error:"):
                msg = msg[len("Error:"):].strip()
            # Strip the "<Line n> <File:f>" prefix if present.
            parts = msg.split()
            while parts and (parts[0].startswith("<Line") or parts[0] == "<File:" or parts[0].endswith(">")):
                parts.pop(0)
            entry["error"] = " ".join(parts)
        out["cases"].append(entry)
    json.dump(out, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

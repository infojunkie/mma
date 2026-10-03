#!/usr/bin/env python3
"""Generate a golden fixture for the TypeScript MIDI voice/drum/controller tables.

Uses the original Python MMA tables (MMA/miditables.py) and the name -> value
converters (MMA/midiC.py) as the oracle.  Walks up to the mma repo root, stubs
the __main__ globals that MMA.gbl expects, and prints JSON containing the full
tables (index bases exactly as in Python) plus name -> value maps produced by
calling instToValue()/drumToValue()/ctrlToValue() on every entry, on lowercase
variants, and on a set of edge-case probes.

Run: python3 ts/test/tools/gen_miditables_fixtures.py > ts/test/fixtures/python/miditables.json
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MMA_DIR = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, MMA_DIR)

import __main__  # noqa: E402

__main__.MMAdir = MMA_DIR
__main__.platform = "Linux"

from MMA.miditables import (  # noqa: E402
    NONETONE,
    ctrlInx,
    ctrlNames,
    drumInx,
    drumKits,
    drumNames,
    voiceInx,
    voiceNames,
)
from MMA.midiC import ctrlToValue, drumToValue, instToValue  # noqa: E402


def table(mapping, size):
    """Dense list with explicit None holes, indexed by the Python dict key."""
    return [mapping.get(i) for i in range(size)]


def reverse_by_value(mapping):
    """Value-indexed list; on duplicate values the later dict entry wins
    (same convention as Python's reverse dict comprehensions)."""
    out = [None] * (max(mapping.values()) + 1)
    for name, value in mapping.items():
        out[value] = name
    return out


def call_map(fn, names):
    """{name: fn(name)} for every name, original case plus lowercase variant."""
    out = {}
    for n in names:
        out[n] = fn(n)
        out[n.lower()] = fn(n.lower())
    return dict(sorted(out.items()))


# Strings that exercise drumToValue()'s int(name, 0)/int(name) parsing paths.
DRUM_PROBES = [
    "27", "87", "0", "1", "127", "128", "-1", "-0", "+34", " 34 ",
    "0x30", "0x22", "0o40", "0b11011", "010", "00", "000", "0_0", "0_1",
    "3.5", "1_0", "_10", "10_", "", "  ", "9999999999999999999999999",
]

# instToValue()/ctrlToValue() do no numeric or whitespace handling; probes
# document that (in particular instToValue("  Piano1  ") must not match).
INST_PROBES = [
    "Piano1", "piano1", "PIANO1", "None", "none", "NONE",
    "distortonguitar", "DISTORTONGUITAR", "NoSuchVoice", "0", "34",
    "  Piano1  ", "", "Applause/Noise", "applause/noise", "gunshot",
]

CTRL_PROBES = [
    "Bank", "bank", "Portamento", "portamento", "Sustain", "NoSuchCtrl", "0", "",
]


def main():
    out = {
        # Python's NONETONE sentinel ((127 << 16) + (127 < 8) + 127 == 8323199).
        "nonetone": NONETONE,
        # Index base 0: MIDI program number 0..127.
        "voice_table": table(voiceNames, 128),
        # Index base 27: MIDI note number 27..87 (0..26 are None).
        "drum_table": table(drumNames, 88),
        # Index base 0: controller number 0..127.
        "controller_table": table(ctrlNames, 128),
        # Index base 0: drum-kit program number 0..69.
        "drum_kits_array": reverse_by_value(drumKits),
        "drum_kits": dict(sorted(drumKits.items())),
        "voice_inx": dict(sorted(voiceInx.items())),
        "drum_inx": dict(sorted(drumInx.items())),
        "ctrl_inx": dict(sorted(ctrlInx.items())),
        "inst_to_value": call_map(instToValue, voiceNames.values()),
        "drum_to_value": call_map(drumToValue, drumNames.values()),
        "ctrl_to_value": call_map(ctrlToValue, ctrlNames.values()),
        "inst_to_value_probes": {p: instToValue(p) for p in INST_PROBES},
        "drum_to_value_probes": {p: drumToValue(p) for p in DRUM_PROBES},
        "ctrl_to_value_probes": {p: ctrlToValue(p) for p in CTRL_PROBES},
    }
    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

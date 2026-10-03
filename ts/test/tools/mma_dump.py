#!/usr/bin/env python3
"""Run a song through the reference Python MMA and dump its internal state.

Usage:
    python3 mma_dump.py <mma-args...> <songfile>

Runs MMA exactly like the CLI (including -f out.mid), then dumps the
final gbl state, track settings, patterns and the packed MIDI tracks as
JSON on stdout.  Used to generate golden fixtures for the TypeScript
port; the Python source tree is never modified.
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


def hexdump_mtrks(mtrks):
    out = {}
    for ch in sorted(mtrks.keys()):
        tr = mtrks[ch]
        events = {}
        for tick in sorted(tr.miditrk.keys()):
            evs = tr.miditrk[tick]
            if evs:
                events[str(tick)] = [bytes(e).hex() for e in evs]
        out[str(ch)] = events
    return out


def main():
    argv = sys.argv[1:]
    out_file = None
    if "--out" in argv:
        i = argv.index("--out")
        out_file = argv[i + 1]
        del argv[i : i + 2]
    sys.argv = ["mma.py", "-II"] + argv

    try:
        import MMA.main  # noqa: F401  (runs the program)
    except SystemExit:
        pass

    # Import only after MMA.main so the package's circular imports are
    # resolved in the normal order.
    import MMA.gbl as gbl
    import MMA.pat as pat
    import MMA.parseCL as parseCL
    import MMA.midi as midi

    # Patterns are keyed by (vtype, name); sequence entries are pointers,
    # so dump the pattern store instead of per-track sequences.
    patterns = {}
    for (vtype, name), p in pat.pats.items():
        patterns["%s:%s" % (vtype, name)] = format_pattern(p)

    tracks = {}
    for name, t in gbl.tnames.items():
        tracks[name] = {
            "vtype": t.vtype,
            "channel": t.channel,
            "sticky": bool(t.sticky),
            "octave": list(t.octave),
            "volume": [float(v) for v in t.volume],
            "voice": list(t.voice),
            "artic": list(t.artic),
        }

    bar_ptrs = {}
    for k, v in gbl.barPtrs.items():
        label, start, end = v
        bar_ptrs[str(k)] = [label, int(start), int(end)]

    dump = {
        "state": {
            "barNum": gbl.barNum,
            "tickOffset": gbl.tickOffset,
            "seqSize": gbl.seqSize,
            "QperBar": gbl.QperBar,
            "barLen": gbl.barLen,
            "tempo": gbl.tempo,
            "transpose": gbl.transpose,
            "midiFileType": gbl.midiFileType,
            "barLabels": list(gbl.barLabels),
            "barPtrs": bar_ptrs,
            "chordTabs": list(parseCL.chordTabs),
            "tempoChanges": [[int(a), b] for a, b in midi.tempoChanges],
            "tracks": tracks,
            "patterns": patterns,
            "mtrks": hexdump_mtrks(gbl.mtrks),
        }
    }
    if out_file:
        with open(out_file, "w") as f:
            json.dump(dump, f)
    else:
        json.dump(dump, sys.stdout)


def format_pattern(pat):
    """Best-effort text form of a pattern for fixtures."""
    if isinstance(pat, str):
        return pat
    out = []
    for p in pat:
        fields = []
        for a in ("offset", "duration", "vol"):
            if hasattr(p, a):
                v = getattr(p, a)
                fields.append("%s=%s" % (a, v))
        out.append(";".join(fields))
    return " ".join(out)


if __name__ == "__main__":
    with contextlib.redirect_stdout(sys.stderr):
        main()

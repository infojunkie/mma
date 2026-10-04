#!/usr/bin/env python3
"""Generate golden fixtures for the TypeScript track/pattern engine.

Uses the original Python MMA track classes (MMA/pat.py, patChord.py,
patBass.py, patDrum.py) as the oracle.  The parser is bypassed: we set up
gbl state exactly as parse.py does around a bar, build CTable entries by
hand, and call track.bar(ctable) directly.

Run:
    python3 ts/test/tools/gen_track_fixtures.py > ts/test/fixtures/python/tracks.json
"""

import contextlib
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MMA_DIR = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, MMA_DIR)

import __main__

__main__.MMAdir = MMA_DIR
__main__.platform = "Linux"

# MMA.parse first: pat.py, alloc.py and grooves.py have circular imports
# that only resolve when parse is imported before the track modules.
import MMA.parse  # noqa: E402
import MMA.swing  # noqa: E402

from MMA import gbl, pat  # noqa: E402
from MMA.chords import ChordNotes  # noqa: E402
from MMA.parseCL import CTable  # noqa: E402
from MMA.patChord import Chord  # noqa: E402
from MMA.patBass import Bass  # noqa: E402
from MMA.patDrum import Drum  # noqa: E402
from MMA.patArpeggio import Arpeggio  # noqa: E402
from MMA.patScale import Scale  # noqa: E402
from MMA.patWalk import Walk  # noqa: E402

TRACKS = {
    "CHORD": Chord,
    "BASS": Bass,
    "DRUM": Drum,
    "ARPEGGIO": Arpeggio,
    "SCALE": Scale,
    "WALK": Walk,
}


def reset_gbl():
    gbl.QperBar = 4
    gbl.barLen = gbl.BperQ * gbl.QperBar
    gbl.seqSize = 1
    gbl.seqCount = 0
    gbl.tickOffset = 0
    gbl.transpose = 0
    gbl.mtrks.clear()
    gbl.tnames.clear()
    gbl.midiAssigns = {c: [] for c in range(17)}
    gbl.midiAvail = [0] * 17
    gbl.midiChPrefs.clear()


def plain(v):
    """JSON-safe plain data (tuples become lists)."""
    if isinstance(v, dict):
        return {k: plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [plain(x) for x in v]
    return v


def make_ctable(chord_name, start, end):
    ct = CTable()
    ct.name = chord_name
    ct.chord = ChordNotes(chord_name)
    ct.chStart = start
    ct.chEnd = end
    return ct


def dump_channel(channel):
    """Events of a channel as [[tick, hex, hex, ...], ...]."""
    tr = gbl.mtrks.get(channel)
    if tr is None:
        return []
    out = []
    for tick in sorted(tr.miditrk):
        out.append([tick] + [bytes(e).hex() for e in tr.miditrk[tick]])
    return out


DEFAULT_KEYS = [
    ("artic", lambda t: t.artic),
    ("chord", lambda t: t.chord),
    ("chordLimit", lambda t: t.chordLimit),
    ("chordRange", lambda t: t.chordRange),
    ("compress", lambda t: t.compress),
    ("delay", lambda t: t.delay),
    ("direction", lambda t: t.direction),
    ("dupRoot", lambda t: t.dupRoot),
    ("harmonyVolume", lambda t: t.harmonyVolume),
    ("invert", lambda t: t.invert),
    ("mallet", lambda t: t.mallet),
    ("malletDecay", lambda t: t.malletDecay),
    ("octave", lambda t: t.octave),
    ("rDuration", lambda t: t.rDuration),
    ("rSkip", lambda t: t.rSkip),
    ("rSkipBeats", lambda t: t.rSkipBeats),
    ("rTime", lambda t: t.rTime),
    ("rVolume", lambda t: t.rVolume),
    ("seqRnd", lambda t: t.seqRnd),
    ("seqRndWeight", lambda t: t.seqRndWeight),
    ("sequence", lambda t: t.sequence),
    ("spanEnd", lambda t: t.spanEnd),
    ("spanStart", lambda t: t.spanStart),
    ("strum", lambda t: t.strum),
    ("strumAdd", lambda t: t.strumAdd),
    ("toneList", lambda t: getattr(t, "toneList", None)),
    ("unify", lambda t: t.unify),
    ("voice", lambda t: t.voice),
    ("volume", lambda t: t.volume),
]


def dump_defaults(vtype):
    reset_gbl()
    t = TRACKS[vtype](vtype)
    return {k: plain(f(t)) for k, f in DEFAULT_KEYS}


def run_bar_case(vtype, pattern, channel, chord_names, setup=(), seed=None, swing=None,
                 patterns=None, seqrnd=False):
    reset_gbl()
    if seed is not None:
        # Same MT19937 stream as the TypeScript MMARandom (CPython seed()).
        random.seed(seed)
    saved_swing = MMA.swing.gsettings()
    if swing:
        MMA.swing.swingMode(swing)
    t = TRACKS[vtype](vtype)
    t.setChannel(str(channel))

    if patterns:
        for i, p in enumerate(patterns):
            t.definePattern("TEST%d" % (i + 1), p)
        t.sequence = [pat.pats[(vtype, "TEST%d" % (i + 1))] for i in range(len(patterns))]
    else:
        t.definePattern("TEST", pattern)
        t.sequence = [pat.pats[(vtype, "TEST")]]

    nbars = len(chord_names)
    gbl.seqSize = nbars
    t.setSeqSize()
    if seqrnd:
        t.seqRnd = True

    for method, args in setup:
        getattr(t, method)(*args)

    for bar, cname in enumerate(chord_names):
        gbl.seqCount = bar
        gbl.tickOffset = bar * gbl.barLen
        ct = make_ctable(cname, 0, gbl.barLen)
        t.bar([ct])

    # Swing settings are module-global; do not leak into later cases.
    MMA.swing.grestore(saved_swing)

    return {
        "track": vtype,
        "pattern": pattern,
        "chords": chord_names,
        "channel": t.channel,
        "setup": [[m, list(a)] for m, a in setup],
        "seed": seed,
        "swing": swing,
        "patterns": patterns,
        "seqrnd": seqrnd,
        "events": dump_channel(t.channel),
    }


def run_multi_chord_case(vtype, pattern, channel, bars, setup=(), seed=None):
    """Like run_bar_case() but each bar holds several chords.

    `bars` is a list of bars; each bar is a list of (chord, start beat,
    start of the next chord) tuples - a simplified parseChordLine output.
    """
    reset_gbl()
    if seed is not None:
        random.seed(seed)
    t = TRACKS[vtype](vtype)
    t.setChannel(str(channel))
    t.definePattern("TEST", pattern)
    t.sequence = [pat.pats[(vtype, "TEST")]]

    gbl.seqSize = len(bars)
    t.setSeqSize()
    for method, args in setup:
        getattr(t, method)(*args)

    for b, specs in enumerate(bars):
        gbl.seqCount = b
        gbl.tickOffset = b * gbl.barLen
        tabs = [
            make_ctable(name, int((start - 1) * gbl.BperQ), int((end - 1) * gbl.BperQ))
            for name, start, end in specs
        ]
        t.bar(tabs)

    return {
        "track": vtype,
        "pattern": pattern,
        "chords": [],
        "chordTabs": [[list(c) for c in bar] for bar in bars],
        "channel": t.channel,
        "setup": [[m, list(a)] for m, a in setup],
        "seed": seed,
        "swing": None,
        "events": dump_channel(t.channel),
    }


def generate():
    out = {
        "defaults": {v: dump_defaults(v) for v in TRACKS},
        "bars": {},
    }

    out["bars"]["chord_basic"] = run_bar_case("CHORD", "1 4 90", 3, ["C"])
    out["bars"]["chord_volumes"] = run_bar_case("CHORD", "1 4 90 70 60", 3, ["Cmaj7"])
    out["bars"]["chord_two_bars"] = run_bar_case("CHORD", "1 4 90; 3 4 80", 3, ["C", "F"])
    out["bars"]["bass_basic"] = run_bar_case("BASS", "1 4 1 90", 4, ["C"])
    out["bars"]["bass_notes"] = run_bar_case("BASS", "1 4 1 90; 3 4 5# 80", 4, ["C", "F"])
    out["bars"]["drum_basic"] = run_bar_case("DRUM", "1 4 90", 10, ["C"])
    out["bars"]["drum_beats"] = run_bar_case("DRUM", "1 4 90; 2 4 60; 3 4 80; 4 4 100", 10, ["C"])

    # Feature coverage: setup commands applied before the bar.
    out["bars"]["chord_strum"] = run_bar_case(
        "CHORD", "1 4 90 80 70", 3, ["C7"], setup=[("setStrum", (["20"],))]
    )
    out["bars"]["chord_dup_root"] = run_bar_case(
        "CHORD", "1 4 90", 3, ["C"], setup=[("setDupRoot", (["1"],))]
    )
    out["bars"]["chord_limit"] = run_bar_case(
        "CHORD", "1 4 90 80 70 60", 3, ["Cmaj7"],
        setup=[("setChordLimit", (["4", "DROP=1", "FORCE=TRUE"],))],
    )
    out["bars"]["chord_voicing_drop2"] = run_bar_case(
        "CHORD", "1 4 90", 3, ["Cmaj7"], setup=[("setVoicing", (["MODE=DROP2"],))]
    )
    out["bars"]["chord_voicing_key"] = run_bar_case(
        "CHORD", "1 4 90", 3, ["Cmaj7"], setup=[("setVoicing", (["MODE=KEY"],))]
    )
    out["bars"]["chord_accent"] = run_bar_case(
        "CHORD", "1 4 90; 3 4 90", 3, ["C"], setup=[("setAccent", (["1", "10"],))]
    )
    out["bars"]["chord_artic_volume"] = run_bar_case(
        "CHORD", "1 4 90", 3, ["C"],
        setup=[("setArtic", (["50"],)), ("setVolume", (["p"],)), ("setOctave", (["3"],))],
    )
    out["bars"]["bass_modifiers"] = run_bar_case(
        "BASS", "1 4 2+ 90; 3 4 9b- 80", 4, ["C"]
    )
    out["bars"]["bass_two_chords"] = run_multi_chord_case(
        "BASS", "1 4 1 90; 3 4 1 90", 4, [[("C", 1, 3), ("F", 3, 5)]]
    )
    out["bars"]["chord_two_chords"] = run_multi_chord_case(
        "CHORD", "1 4 90; 3 4 80", 3, [[("C", 1, 3), ("G", 3, 5)]]
    )
    out["bars"]["bass_rskip_beats"] = run_bar_case(
        "BASS", "1 4 1 90; 3 4 1 90", 4, ["C"],
        setup=[("setRSkip", (["99", "BEATS=3"],))], seed=1,
    )
    out["bars"]["bass_rvolume"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"], setup=[("setRVolume", (["-20,20"],))], seed=2
    )
    out["bars"]["chord_strum_random"] = run_bar_case(
        "CHORD", "1 4 90 80 70", 3, ["C7"], setup=[("setStrum", (["10,30"],))], seed=3
    )
    out["bars"]["drum_artic"] = run_bar_case(
        "DRUM", "1 4 90; 3 4 90", 10, ["C"], setup=[("setArtic", (["50"],))]
    )
    out["bars"]["drum_swing"] = run_bar_case(
        "DRUM", "1 8 90; 2 8 80; 2+8 8 70", 10, ["C"], swing=["ON", "SKEW=60"]
    )
    out["bars"]["bass_cresc"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C", "C", "C", "C"],
        setup=[("setCresc", (1, ["pp", "4"]))],
    )
    out["bars"]["bass_seqrnd"] = run_bar_case(
        "BASS", "", 4, ["C", "C", "C", "C"], seed=4, seqrnd=True,
        patterns=["1 4 1 90", "3 4 1 90"],
    )
    out["bars"]["chord_direction_down"] = run_bar_case(
        "CHORD", "1 4 90 80 70", 3, ["C7"],
        setup=[("setStrum", (["20"],)), ("setDirection", (["DOWN"],))],
    )

    # ---------------------------------------------------------------- ARP
    out["bars"]["arp_basic"] = run_bar_case("ARPEGGIO", "1 4 90", 5, ["C"])
    out["bars"]["arp_beats"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 2 4 80; 3 4 80; 4 4 70", 5, ["Cmaj7"]
    )
    out["bars"]["arp_two_bars"] = run_bar_case("ARPEGGIO", "1 4 90; 3 4 80", 5, ["C", "F"])
    out["bars"]["arp_up"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 5, ["C"],
        setup=[("setDirection", (["UP"],))],
    )
    out["bars"]["arp_down"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 5, ["C7"],
        setup=[("setDirection", (["DOWN"],))],
    )
    out["bars"]["arp_random"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 5, ["C"],
        setup=[("setDirection", (["RANDOM"],))], seed=5,
    )
    out["bars"]["arp_range_2"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 3 4 80", 5, ["Cmaj7"],
        setup=[("setRange", (["2"],))],
    )
    out["bars"]["arp_range_fraction"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 3 4 80", 5, ["Cmaj7"],
        setup=[("setRange", (["1.5"],))],
    )
    out["bars"]["arp_invert"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 3 4 80", 5, ["Cmaj7"],
        setup=[("setInvert", (["1"],))],
    )
    out["bars"]["arp_compress"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 3 4 80", 5, ["Cmaj7"],
        setup=[("setCompress", (["TRUE"],))],
    )
    out["bars"]["arp_limit"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 3 4 80", 5, ["Cmaj7"],
        setup=[("setChordLimit", (["4", "DROP=1", "FORCE=TRUE"],))],
    )
    out["bars"]["arp_octave_volume"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 3 4 80", 5, ["C"],
        setup=[("setOctave", (["5"],)), ("setVolume", (["pp"],))],
    )
    out["bars"]["arp_artic_rtime"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 3 4 80", 5, ["C"],
        setup=[("setArtic", (["50"],)), ("setRTime", (["-10,10"],))], seed=6,
    )
    out["bars"]["arp_rskip"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 3 4 80", 5, ["C"],
        setup=[("setRSkip", (["99", "BEATS=3"],))], seed=7,
    )
    out["bars"]["arp_restart"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 3 4 80", 5, ["C", "F"],
        setup=[("setDirection", (["DOWN"],)), ("restart", ())],
    )
    out["bars"]["arp_two_chords"] = run_multi_chord_case(
        "ARPEGGIO", "1 4 90; 3 4 80", 5, [[("C", 1, 3), ("F", 3, 5)]]
    )

    # -------------------------------------------------------------- SCALE
    out["bars"]["scale_basic"] = run_bar_case("SCALE", "1 1 90", 6, ["C"])
    out["bars"]["scale_beats"] = run_bar_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80; 4 4 70", 6, ["Cmaj7"]
    )
    out["bars"]["scale_chromatic"] = run_bar_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 6, ["C"],
        setup=[("setScaletype", (["CHROMATIC"],))],
    )
    out["bars"]["scale_chord_type"] = run_bar_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80", 6, ["Cmaj7"],
        setup=[("setScaletype", (["CHORD"],))],
    )
    out["bars"]["scale_type_scale"] = run_bar_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80", 6, ["Cm7"],
        setup=[("setScaletype", (["SCALE"],))],
    )
    out["bars"]["scale_up"] = run_bar_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 6, ["C"],
        setup=[("setDirection", (["UP"],))],
    )
    out["bars"]["scale_down"] = run_bar_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 6, ["C"],
        setup=[("setDirection", (["DOWN"],))],
    )
    out["bars"]["scale_both"] = run_bar_case(
        "SCALE",
        "1 8 90; 1+8 8 80; 2 8 80; 2+8 8 70; 3 8 80; 3+8 8 80; 4 8 80; 4+8 8 70",
        6, ["C"], setup=[("setDirection", (["BOTH"],))],
    )
    out["bars"]["scale_random"] = run_bar_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 6, ["C"],
        setup=[("setDirection", (["RANDOM"],))], seed=8,
    )
    out["bars"]["scale_range_2"] = run_bar_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 6, ["C"],
        setup=[("setRange", (["2"],))],
    )
    out["bars"]["scale_range_fraction"] = run_bar_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80", 6, ["C"],
        setup=[("setRange", (["1.5"],))],
    )
    out["bars"]["scale_two_bars"] = run_bar_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 6, ["C", "F"]
    )
    out["bars"]["scale_slash"] = run_bar_case("SCALE", "1 4 90; 3 4 80", 6, ["C/G"])
    out["bars"]["scale_octave_voice"] = run_bar_case(
        "SCALE", "1 4 90; 3 4 80", 6, ["C"],
        setup=[("setOctave", (["5"],)), ("setVoice", (["Flute"],))],
    )
    out["bars"]["scale_artic_rtime_volume"] = run_bar_case(
        "SCALE", "1 4 90; 3 4 80", 6, ["C"],
        setup=[("setArtic", (["50"],)), ("setRTime", (["-10,10"],)), ("setVolume", (["p"],))],
        seed=9,
    )
    out["bars"]["scale_rskip"] = run_bar_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 6, ["C"],
        setup=[("setRSkip", (["99", "BEATS=2"],))], seed=10,
    )
    out["bars"]["scale_restart"] = run_bar_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 6, ["C", "F"],
        setup=[("setDirection", (["DOWN"],)), ("restart", ())],
    )
    out["bars"]["scale_two_chords"] = run_multi_chord_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 6,
        [[("C", 1, 3), ("G", 3, 5)]],
    )
    out["bars"]["scale_seqtypes"] = run_bar_case(
        "SCALE", "1 4 90; 3 4 80", 6, ["C", "C"],
        setup=[("setScaletype", (["CHROMATIC", "SCALE"],))],
    )

    # --------------------------------------------------------------- WALK
    # WALK always draws from the RNG (beat-1 root preference and step
    # choice), so every case is seeded.
    out["bars"]["walk_basic"] = run_bar_case("WALK", "1 4 90", 7, ["C"], seed=11)
    out["bars"]["walk_beats"] = run_bar_case(
        "WALK", "1 4 90; 2 4 80; 3 4 80; 4 4 70", 7, ["Cmaj7"], seed=12
    )
    out["bars"]["walk_up"] = run_bar_case(
        "WALK", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 7, ["C"],
        setup=[("setDirection", (["UP"],))], seed=13,
    )
    out["bars"]["walk_down"] = run_bar_case(
        "WALK", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 7, ["C"],
        setup=[("setDirection", (["DOWN"],))], seed=14,
    )
    out["bars"]["walk_random"] = run_bar_case(
        "WALK", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 7, ["C"],
        setup=[("setDirection", (["RANDOM"],))], seed=15,
    )
    out["bars"]["walk_two_bars"] = run_bar_case(
        "WALK", "1 4 90; 3 4 80", 7, ["C", "F"], seed=16
    )
    out["bars"]["walk_octave_volume"] = run_bar_case(
        "WALK", "1 4 90; 3 4 80", 7, ["C"],
        setup=[("setOctave", (["5"],)), ("setVolume", (["pp"],))], seed=17,
    )
    out["bars"]["walk_artic_rtime"] = run_bar_case(
        "WALK", "1 4 90; 3 4 80", 7, ["C"],
        setup=[("setArtic", (["50"],)), ("setRTime", (["-10,10"],))], seed=18,
    )
    out["bars"]["walk_rskip"] = run_bar_case(
        "WALK", "1 4 90; 3 4 80", 7, ["C"],
        setup=[("setRSkip", (["99", "BEATS=3"],))], seed=19,
    )
    out["bars"]["walk_restart"] = run_bar_case(
        "WALK", "1 4 90; 3 4 80", 7, ["C", "F"],
        setup=[("restart", ())], seed=20,
    )
    out["bars"]["walk_two_chords"] = run_multi_chord_case(
        "WALK", "1 4 90; 3 4 80", 7, [[("C", 1, 3), ("F", 3, 5)]], seed=21
    )

    return out


def main():
    # MMA's warning() writes to stdout; keep it out of the JSON fixture.
    with contextlib.redirect_stdout(sys.stderr):
        out = generate()
    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

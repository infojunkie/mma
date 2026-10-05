#!/usr/bin/env python3
"""Generate golden fixtures for the TypeScript track/pattern engine.

Uses the original Python MMA track classes (MMA/pat.py, patChord.py,
patBass.py, patDrum.py, patPlectrum.py, ...) as the oracle.  The parser is
bypassed: we set up gbl state exactly as parse.py does around a bar, build
CTable entries by hand, and call track.bar(ctable) directly.

Run:
    python3 ts/test/tools/gen_track_fixtures.py > ts/test/fixtures/python/tracks.json
"""

import contextlib
import copy
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
import MMA.harmony  # noqa: E402
import MMA.ornament  # noqa: E402
import MMA.rpitch  # noqa: E402
import MMA.trigger  # noqa: E402

from MMA import gbl, pat  # noqa: E402
from MMA.chords import ChordNotes  # noqa: E402
from MMA.parseCL import CTable  # noqa: E402
from MMA.patChord import Chord  # noqa: E402
from MMA.patBass import Bass  # noqa: E402
from MMA.patDrum import Drum  # noqa: E402
from MMA.patArpeggio import Arpeggio  # noqa: E402
from MMA.patScale import Scale  # noqa: E402
from MMA.patWalk import Walk  # noqa: E402
from MMA.patPlectrum import Plectrum  # noqa: E402
from MMA.patSolo import Melody, Solo  # noqa: E402
from MMA.patAria import Aria  # noqa: E402

TRACKS = {
    "CHORD": Chord,
    "BASS": Bass,
    "DRUM": Drum,
    "ARPEGGIO": Arpeggio,
    "SCALE": Scale,
    "WALK": Walk,
    "MELODY": Melody,
    "SOLO": Solo,
    "PLECTRUM": Plectrum,
    "ARIA": Aria,
}

SETTER_TRACKS = dict(TRACKS)

# Some setters live in modules and take the track as self (parse.py calls
# them directly); rpitch/trigger look the track up by name in gbl.tnames.
# These need a shim so the fixtures can drive them by method name.
def _shim_ornament(t, ln):
    MMA.ornament.setOrnament(t, ln)


def _shim_rpitch(t, ln):
    gbl.tnames[t.name] = t
    MMA.rpitch.setRPitch(t.name, ln)


def _shim_trigger(t, ln):
    gbl.tnames[t.name] = t
    MMA.trigger.setTrigger(t.name, ln)


MODULE_SETTERS = {
    "setHarmony": MMA.harmony.setHarmony,
    "setHarmonyOnly": MMA.harmony.setHarmonyOnly,
    "setHarmonyVolume": MMA.harmony.setHarmonyVolume,
    "setOrnament": _shim_ornament,
    "setRPitch": _shim_rpitch,
    "setTrigger": _shim_trigger,
}


def apply_setup(t, setup):
    """Apply a fixture setup list; module setters need the shim."""
    for method, args in setup:
        if method in MODULE_SETTERS:
            MODULE_SETTERS[method](t, *args)
        else:
            getattr(t, method)(*args)


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
    ("toneList", lambda t: getattr(t, "toneList", None)),
    ("stretch", lambda t: getattr(t, "stretch", None)),
    ("followChord", lambda t: getattr(t, "followChord", None)),
    ("followKey", lambda t: getattr(t, "followKey", None)),
    ("rootChord", lambda t: getattr(t, "rootChord", None)),
    ("drumType", lambda t: getattr(t, "drumType", None)),
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
                 patterns=None, seqrnd=False, pre_setup=()):
    reset_gbl()
    if seed is not None:
        # Same MT19937 stream as the TypeScript MMARandom (CPython seed()).
        random.seed(seed)
    saved_swing = MMA.swing.gsettings()
    if swing:
        MMA.swing.swingMode(swing)
    t = TRACKS[vtype](vtype)
    if channel is not None:
        t.setChannel(str(channel))

    # pre_setup runs before the pattern is compiled (e.g. a plectrum
    # tuning change, which fixes the number of strings in the pattern).
    pre_setup_record = [[m, copy.deepcopy(list(a))] for m, a in pre_setup]
    apply_setup(t, pre_setup)

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

    # Record the setup args before running them: setPlectrumShape() pops
    # its first argument (the chord name), which would otherwise be lost.
    setup_record = [[m, copy.deepcopy(list(a))] for m, a in setup]
    apply_setup(t, setup)

    for bar, cname in enumerate(chord_names):
        gbl.seqCount = bar
        gbl.tickOffset = bar * gbl.barLen
        ct = make_ctable(cname, 0, gbl.barLen)
        t.bar([ct])

    # Swing settings are module-global; do not leak into later cases.
    MMA.swing.grestore(saved_swing)

    out = {
        "track": vtype,
        "pattern": pattern,
        "chords": chord_names,
        "channel": t.channel,
        "presetChannel": channel is not None,
        "setup": setup_record,
        "seed": seed,
        "swing": swing,
        "patterns": patterns,
        "seqrnd": seqrnd,
        "events": dump_channel(t.channel),
    }
    # Only present when used, so cases without a pre-setup are unchanged.
    if pre_setup_record:
        out["preSetup"] = pre_setup_record
    return out


def run_multi_chord_case(vtype, pattern, channel, bars, setup=(), seed=None):
    """Like run_bar_case() but each bar holds several chords.

    `bars` is a list of bars; each bar is a list of (chord, start beat,
    start of the next chord) tuples - a simplified parseChordLine output.
    """
    reset_gbl()
    if seed is not None:
        random.seed(seed)
    t = TRACKS[vtype](vtype)
    if channel is not None:
        t.setChannel(str(channel))
    t.definePattern("TEST", pattern)
    t.sequence = [pat.pats[(vtype, "TEST")]]

    gbl.seqSize = len(bars)
    t.setSeqSize()
    setup_record = [[m, copy.deepcopy(list(a))] for m, a in setup]
    apply_setup(t, setup)

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
        "presetChannel": channel is not None,
        "setup": setup_record,
        "seed": seed,
        "swing": None,
        "events": dump_channel(t.channel),
    }


def run_harmony_setter_case(vtype, method, args, seqsize=1):
    """Run a harmony setter and record the resulting state and warnings.

    The warning() calls in harmony.py are captured by patching the module
    global; the "list truncated" warning from common.lnExpand() is not
    captured (it lives in common.py), so the cases avoid oversized lists.
    """
    reset_gbl()
    gbl.seqSize = seqsize
    t = SETTER_TRACKS[vtype](vtype)

    captured = []
    orig = MMA.harmony.warning
    MMA.harmony.warning = lambda msg: captured.append(msg)
    try:
        MODULE_SETTERS[method](t, args)
    finally:
        MMA.harmony.warning = orig

    return {
        "track": vtype,
        "method": method,
        "args": list(args),
        "seqsize": seqsize,
        "harmony": plain(t.harmony),
        "harmonyOnly": plain(t.harmonyOnly),
        "harmonyVolume": plain(t.harmonyVolume),
        "warnings": captured,
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

    # ------------------------------------------------------------- HARMONY
    # Chord-derived harmony notes (MMA/harmony.py).  Note that the setters
    # upper-case their arguments, so modes are written lower/mixed case
    # (e.g. 2:Per4 -> 2:PER4); '28Below' only works when passed to
    # harmonize() directly (the Python comparison is case-sensitive).
    out["bars"]["bass_harmony_2"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"], setup=[("setHarmony", (["2"],))]
    )
    out["bars"]["bass_harmony_2above"] = run_bar_case(
        "BASS", "1 4 1 90; 3 4 5 80", 4, ["C"], setup=[("setHarmony", (["2Above"],))]
    )
    out["bars"]["bass_harmony_3"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["Cmaj7"], setup=[("setHarmony", (["3"],))]
    )
    out["bars"]["bass_harmony_38below"] = run_bar_case(
        "BASS", "1 4 1 90; 3 4 5 80", 4, ["C"], setup=[("setHarmony", (["38Below"],))]
    )
    out["bars"]["bass_harmony_3above"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["Cmaj7"], setup=[("setHarmony", (["3Above"],))]
    )
    out["bars"]["bass_harmony_openbelow_openabove"] = run_bar_case(
        "BASS", "1 4 1 90; 3 4 5 80", 4, ["C"],
        setup=[("setHarmony", (["OpenBelow+OpenAbove"],))],
    )
    out["bars"]["bass_harmony_open8below"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"], setup=[("setHarmony", (["Open8Below"],))]
    )
    out["bars"]["bass_harmony_root"] = run_bar_case(
        "BASS", "1 4 1 90; 3 4 5 80", 4, ["C"], setup=[("setHarmony", (["Root"],))]
    )
    out["bars"]["bass_harmony_top"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["Cmaj7"], setup=[("setHarmony", (["Top"],))]
    )
    out["bars"]["bass_harmony_topbelow"] = run_bar_case(
        "BASS", "1 4 5 90", 4, ["C"], setup=[("setHarmony", (["TopBelow"],))]
    )
    out["bars"]["bass_harmony_8above"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"], setup=[("setHarmony", (["8Above"],))]
    )
    out["bars"]["bass_harmony_16below"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"], setup=[("setHarmony", (["16Below"],))]
    )
    out["bars"]["bass_harmony_24above"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"], setup=[("setHarmony", (["24Above"],))]
    )
    out["bars"]["bass_harmony_interval"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"], setup=[("setHarmony", (["2:Per4"],))]
    )
    out["bars"]["bass_harmony_interval_octave"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"], setup=[("setHarmony", (["-1:Per5"],))]
    )
    out["bars"]["bass_harmony_comma"] = run_bar_case(
        "BASS", "1 4 1 90; 3 4 5 80", 4, ["Cmaj7"],
        setup=[("setHarmony", (["2,3,Open"],))], seed=30,
    )
    out["bars"]["bass_harmony_only"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"], setup=[("setHarmonyOnly", (["3"],))]
    )
    out["bars"]["bass_harmony_volume"] = run_bar_case(
        "BASS", "1 4 1 90; 3 4 5 80", 4, ["C"],
        setup=[("setHarmony", (["3"],)), ("setHarmonyVolume", (["50"],))],
    )
    out["bars"]["walk_harmony_open"] = run_bar_case(
        "WALK", "1 4 90; 3 4 80", 7, ["C"], setup=[("setHarmony", (["Open"],))], seed=40
    )
    out["bars"]["walk_harmony_3below"] = run_bar_case(
        "WALK", "1 4 90; 3 4 80", 7, ["Cmaj7"],
        setup=[("setHarmony", (["3Below"],))], seed=41,
    )
    out["bars"]["walk_harmony_rootabove"] = run_bar_case(
        "WALK", "1 4 90; 3 4 80", 7, ["C"],
        setup=[("setHarmony", (["RootAbove"],))], seed=42,
    )
    out["bars"]["arp_harmony_2"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 5, ["C"],
        setup=[("setHarmony", (["2"],))],
    )
    out["bars"]["arp_harmony_open8above"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 3 4 80", 5, ["Cmaj7"],
        setup=[("setHarmony", (["Open8Above"],))],
    )
    out["bars"]["arp_harmony_16above"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 3 4 80", 5, ["C"],
        setup=[("setHarmony", (["16Above"],))],
    )
    out["bars"]["arp_harmony_comma"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 5, ["Cmaj7"],
        setup=[("setHarmony", (["2,3,Root"],))], seed=43,
    )
    out["bars"]["arp_harmony_only_volume"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 3 4 80", 5, ["Cmaj7"],
        setup=[("setHarmonyOnly", (["3"],)), ("setHarmonyVolume", (["50"],))],
    )
    out["bars"]["scale_harmony_3"] = run_bar_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 6, ["C"],
        setup=[("setHarmony", (["3"],))],
    )
    out["bars"]["scale_harmony_openabove"] = run_bar_case(
        "SCALE", "1 4 90; 3 4 80", 6, ["C"], setup=[("setHarmony", (["OpenAbove"],))]
    )
    out["bars"]["scale_harmony_top8above"] = run_bar_case(
        "SCALE", "1 4 90; 3 4 80", 6, ["Cmaj7"], setup=[("setHarmony", (["Top8Above"],))]
    )
    out["bars"]["scale_harmony_comma"] = run_bar_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80; 4 4 80", 6, ["Cmaj7"],
        setup=[("setHarmony", (["2,3,Open"],))], seed=44,
    )
    out["bars"]["scale_harmony_only_volume"] = run_bar_case(
        "SCALE", "1 4 90; 2 4 80; 3 4 80", 6, ["C"],
        setup=[("setHarmonyOnly", (["RootAbove"],)), ("setHarmonyVolume", (["50"],))],
    )

    # ------------------------------------------------------ MELODY / SOLO
    out["bars"]["melody_basic"] = run_bar_case("MELODY", "4c; 4d; 4e; 4f;", 5, ["C"])
    out["bars"]["melody_rests_dots"] = run_bar_case("MELODY", "4.c; 8r; 8; 4e;", 5, ["C"])
    out["bars"]["melody_accidentals"] = run_bar_case("MELODY", "4c+; 4e-; 4g+; 4c;", 5, ["C"])
    out["bars"]["melody_note_names"] = run_bar_case("MELODY", "8c; 8e; 8g; 8b; 8a; 8f; 8d; 8c;", 5, ["C"])
    out["bars"]["melody_chord_notes"] = run_bar_case("MELODY", "2c,e,g; 2d,f,a;", 5, ["C"])
    out["bars"]["melody_options"] = run_bar_case(
        "MELODY",
        "4c <VOLUME=FF>; 4d <ARTICULATE=50>; 4e <OFFSET=2>; 4f <GRACE=2>; 4g <mp>;",
        5,
        ["C"],
    )
    out["bars"]["melody_tilde"] = run_bar_case("MELODY", "1+2.f~;", 5, ["C", "C"])
    out["bars"]["melody_stretch"] = run_bar_case(
        "MELODY", "4c; 4d; 4e;", 5, ["C"], setup=[("setStretch", (["150"],))]
    )
    out["bars"]["melody_follow_chord"] = run_bar_case(
        "MELODY",
        "4c; 4e; 4g; 4c;",
        5,
        ["C", "F", "G"],
        setup=[("setVoicing", (["FOLLOWCHORD=ON", "FOLLOWKEY=OFF", "ROOT=C"],))],
    )
    out["bars"]["melody_follow_key"] = run_bar_case(
        "MELODY",
        "4c; 4e;",
        5,
        ["C", "F"],
        setup=[("setVoicing", (["FOLLOWCHORD=OFF", "FOLLOWKEY=ON"],))],
    )
    out["bars"]["melody_harmony"] = run_bar_case(
        "MELODY", "4c; 4d;", 5, ["C"], setup=[("setHarmony", (["OPENABOVE"],))]
    )
    out["bars"]["melody_harmony_only"] = run_bar_case(
        "MELODY",
        "4c; 4d;",
        5,
        ["C"],
        setup=[("setHarmonyOnly", (["3ABOVE"],)), ("setHarmonyVolume", (["50"],))],
    )
    out["bars"]["melody_drum_type"] = run_bar_case(
        "MELODY",
        "4 SnareDrum1; ; r ; OpenTriangle;",
        None,
        ["C"],
        setup=[("setDrumType", ()), ("setTone", (["SnareDrum1"],))],
    )
    out["bars"]["solo_basic"] = run_bar_case("SOLO", "4c; 4d; 4e;", 5, ["C"])
    out["bars"]["solo_multi_bar"] = run_bar_case(
        "SOLO", "8c; 8d; 8e; 8f; 8g; 8a; 8b; 8c;", 5, ["C", "G"]
    )

    # ---------------------------------------------------------- PLECTRUM
    # Patterns are "offset strum patterns..."; ':90' plucks all strings.
    out["bars"]["plectrum_basic"] = run_bar_case("PLECTRUM", "1 5 :90", 8, ["C"])
    out["bars"]["plectrum_all_strings"] = run_bar_case(
        "PLECTRUM", "1 0 90 80 70 60 50 40", 8, ["C"]
    )
    out["bars"]["plectrum_subset"] = run_bar_case(
        "PLECTRUM", "1 0 1-3:80 6:90", 8, ["C"]
    )
    out["bars"]["plectrum_volume_zero"] = run_bar_case(
        "PLECTRUM", "1 0 90 90 90 0 90 90", 8, ["C"]
    )
    out["bars"]["plectrum_strum_center"] = run_bar_case(
        "PLECTRUM", "1 10 :90", 8, ["C"], setup=[("setStrum", (["CENTER"],))]
    )
    out["bars"]["plectrum_strum_end"] = run_bar_case(
        "PLECTRUM", "1 10 :90", 8, ["C"], setup=[("setStrum", (["End"],))]
    )
    out["bars"]["plectrum_strum_negative"] = run_bar_case(
        "PLECTRUM", "1 -5 :90", 8, ["C"]
    )
    out["bars"]["plectrum_capo"] = run_bar_case(
        "PLECTRUM", "1 0 :90", 8, ["C"], setup=[("setPlectrumCapo", ("2",))]
    )
    out["bars"]["plectrum_tuning"] = run_bar_case(
        "PLECTRUM", "1 0 :90", 8, ["C"],
        setup=[("setPlectrumTuning", (["d-", "a-", "d", "g", "b", "e+"],))],
    )
    out["bars"]["plectrum_shape"] = run_bar_case(
        "PLECTRUM", "1 0 :90", 8, ["C"],
        setup=[("setPlectrumShape", (["C", "0", "1", "0", "2", "3", "-"],))],
    )
    out["bars"]["plectrum_shape_muted"] = run_bar_case(
        "PLECTRUM", "1 5 :90", 8, ["C"],
        setup=[("setPlectrumShape", (["C", "0", "1", "0", "2", "-", "-"],))],
    )
    out["bars"]["plectrum_seventh"] = run_bar_case("PLECTRUM", "1 5 :90", 8, ["C7"])
    out["bars"]["plectrum_ninth"] = run_bar_case("PLECTRUM", "1 5 :90", 8, ["C9"])
    out["bars"]["plectrum_barre"] = run_bar_case("PLECTRUM", "1 0 :90", 8, ["C:5"])
    out["bars"]["plectrum_octave_chord"] = run_bar_case("PLECTRUM", "1 0 :90", 8, ["+C"])
    out["bars"]["plectrum_eight_strings"] = run_bar_case(
        "PLECTRUM", "1 0 :90", 8, ["C"],
        pre_setup=[("setPlectrumTuning", (["e-", "a-", "d", "g", "b", "e+", "a", "d+"],))],
    )
    out["bars"]["plectrum_two_events"] = run_bar_case(
        "PLECTRUM", "1 2 :90; 3 4 6:90 1:50", 8, ["C"]
    )
    out["bars"]["plectrum_two_bars"] = run_bar_case(
        "PLECTRUM", "1 5 :80; 3 5 :60", 8, ["C", "F"]
    )
    out["bars"]["plectrum_groove"] = run_bar_case(
        "PLECTRUM", "1 8 :90", 8, ["C"],
        setup=[
            ("saveGroove", ("G1",)),
            ("setPlectrumTuning", (["d-", "a-", "d", "g", "b", "e+"],)),
            ("setPlectrumCapo", ("5",)),
            ("setStrum", (["Center"],)),
            ("restoreGroove", ("G1",)),
        ],
    )
    out["bars"]["plectrum_two_chords"] = run_multi_chord_case(
        "PLECTRUM", "1 2 :90; 2+2 2 :80", 8, [[("C", 1, 2.5), ("F", 2.5, 5)]]
    )

    # -------------------------------------------------------------- ARIA
    out["bars"]["aria_basic"] = run_bar_case(
        "ARIA", "1 4 90; 2 4 90; 3 4 90; 4 4 90", 3, ["C"]
    )
    out["bars"]["aria_scale"] = run_bar_case(
        "ARIA", "1 4 90; 2 4 90; 3 4 90; 4 4 90", 3, ["Cmaj7"],
        setup=[("setScaletype", (["SCALE"],))],
    )
    out["bars"]["aria_chromatic"] = run_bar_case(
        "ARIA", "1 4 90; 2 4 90; 3 4 90; 4 4 90", 3, ["C"],
        setup=[("setScaletype", (["CHROMATIC"],))],
    )
    out["bars"]["aria_chord"] = run_bar_case(
        "ARIA", "1 4 90; 2 4 90; 3 4 90; 4 4 90", 3, ["Cmaj7"],
        setup=[("setScaletype", (["CHORD"],))],
    )
    out["bars"]["aria_key"] = run_bar_case(
        "ARIA", "1 4 90; 2 4 90; 3 4 90; 4 4 90", 3, ["Cmaj7"],
        setup=[("setScaletype", (["KEY"],))],
    )
    out["bars"]["aria_direction_int"] = run_bar_case(
        "ARIA", "1 4 90; 2 4 90; 3 4 90; 4 4 90", 3, ["C"],
        setup=[("setDirection", (["1", "2", "-3"],))],
    )
    out["bars"]["aria_direction_random"] = run_bar_case(
        "ARIA", "1 4 90; 2 4 90; 3 4 90; 4 4 90", 3, ["C"],
        setup=[("setDirection", (["r", "rr"],))], seed=50,
    )
    out["bars"]["aria_deplete"] = run_bar_case(
        "ARIA", "1 8 90; 1+8 8 90; 2 8 90; 2+8 8 90; 3 8 90; 3+8 8 90; 4 8 90; 4+8 8 90",
        3, ["C"], setup=[("setScaletype", (["CHROMATIC-"],))],
    )
    out["bars"]["aria_range_fraction"] = run_bar_case(
        "ARIA", "1 4 90; 2 4 90; 3 4 90; 4 4 90", 3, ["C"],
        setup=[("setRange", (["1.5"],))],
    )
    out["bars"]["aria_harmony"] = run_bar_case(
        "ARIA", "1 4 90; 2 4 90; 3 4 90; 4 4 90", 3, ["C"],
        setup=[("setHarmony", (["3"],))],
    )
    out["bars"]["aria_two_bars"] = run_bar_case(
        "ARIA", "1 4 90; 2 4 90; 3 4 90; 4 4 90", 3, ["C", "F"]
    )
    out["bars"]["aria_two_chords"] = run_multi_chord_case(
        "ARIA", "1 4 90; 2 4 90; 3 4 90; 4 4 90", 3,
        [[("C", 1, 3), ("G", 3, 5)]],
    )
    out["bars"]["aria_restart"] = run_bar_case(
        "ARIA", "1 4 90; 2 4 90; 3 4 90; 4 4 90", 3, ["Cmaj7"],
        setup=[("setDirection", (["2"],)), ("restart", ())],
    )

    # ---------------------------------------------------------- ORNAMENT
    out["bars"]["orn_grace_bass"] = run_bar_case(
        "BASS", "1 4 1 90; 3 4 5 90", 4, ["C"],
        setup=[("setOrnament", (["Type=Grace", "Duration=30", "Volume=80", "Place=Above"],))],
    )
    out["bars"]["orn_grace_below_chromatic"] = run_bar_case(
        "BASS", "1 4 1 90; 3 4 5 90", 4, ["C"],
        setup=[("setOrnament", (["Type=Grace", "Place=Below", "Chromatic=On"],))],
    )
    out["bars"]["orn_fall_bass"] = run_bar_case(
        "BASS", "1 4 1 90; 3 4 5 90", 4, ["C"],
        setup=[("setOrnament", (["Type=Fall"],))],
    )
    out["bars"]["orn_trill_scale"] = run_bar_case(
        "SCALE", "1 4 90; 3 4 90", 6, ["Cmaj7"],
        setup=[("setOrnament", (["Type=Trill", "Duration=20"],))],
    )
    out["bars"]["orn_mordent_chord"] = run_bar_case(
        "CHORD", "1 4 90", 3, ["C"],
        setup=[("setOrnament", (["Type=Mordent"],))],
    )
    out["bars"]["orn_turn_arpeggio"] = run_bar_case(
        "ARPEGGIO", "1 4 90; 3 4 90", 5, ["Cmaj7"],
        setup=[("setOrnament", (["Type=Turn"],))],
    )
    out["bars"]["orn_3after_scale"] = run_bar_case(
        "SCALE", "1 4 90; 3 4 90", 6, ["Cmaj7"],
        setup=[("setOrnament", (["Type=3After", "Duration=75", "Volume=90"],))],
    )
    out["bars"]["orn_gliss_bass"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"],
        setup=[("setOrnament", (["Type=Gliss", "Count=4", "Duration=50"],))],
    )
    out["bars"]["orn_glissafter_bass"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"],
        setup=[("setOrnament", (["Type=GlissAfter", "Count=3"],))],
    )
    out["bars"]["orn_random_place"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"],
        setup=[("setOrnament", (["Type=Grace", "Place=Random"],))], seed=51,
    )
    out["bars"]["orn_rvolume"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"],
        setup=[("setOrnament", (["Type=Grace", "RVolume=20"],))], seed=52,
    )
    out["bars"]["orn_beats_skip"] = run_bar_case(
        "BASS", "1 4 1 90; 3 4 5 90", 4, ["C"],
        setup=[("setOrnament", (["Type=Grace", "Beats=3"],))],
    )
    out["bars"]["orn_bars_skip"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C", "C"],
        setup=[("setOrnament", (["Type=Grace", "Bars=2"],))],
    )
    out["bars"]["orn_rskip"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"],
        setup=[("setOrnament", (["Type=Grace", "Rskip=99"],))], seed=53,
    )
    out["bars"]["orn_pad"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"],
        setup=[("setOrnament", (["Type=Grace", "Pad=50,20"],))],
    )
    out["bars"]["orn_offset"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"],
        setup=[("setOrnament", (["Type=Grace", "Offset=10"],))],
    )
    out["bars"]["orn_walk"] = run_bar_case(
        "WALK", "1 4 90; 3 4 80", 7, ["C"],
        setup=[("setOrnament", (["Type=Mordent"],))], seed=54,
    )
    out["bars"]["orn_count_clamp"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"],
        setup=[("setOrnament", (["Type=Gliss", "Count=100", "Duration=5"],))],
    )

    # ----------------------------------------------------------- TRIGGER
    out["bars"]["trg_beats_bass"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"],
        setup=[("setTrigger", (["Beats=1,3"],))],
    )
    out["bars"]["trg_beats_count"] = run_bar_case(
        "BASS", "1 4 1 90; 3 4 5 90", 4, ["C"],
        setup=[("setTrigger", (["Beats=1,2","Count=1"],))],
    )
    out["bars"]["trg_sequence"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"],
        setup=[("setTrigger", (["Sequence={1 8 1 90; 2 8 1 80}", "Beats=1,3"],))],
    )
    out["bars"]["trg_truncate"] = run_bar_case(
        "BASS", "1 2 1 90", 4, ["C"],
        setup=[("setTrigger", (["Beats=1,2,3,4", "Truncate=True"],))],
    )
    out["bars"]["trg_auto"] = run_multi_chord_case(
        "BASS", "1 2 1 90", 4, [[("C", 1, 3), ("F", 3, 5)]],
        setup=[("setTrigger", (["Auto"],))],
    )
    # NOTE: Trigger mode REST ('z' chords) is covered by the TypeScript
    # unit tests: Python's ChordNotes('z') has no noteList/scaleList, so a
    # hand-built z ctable cannot drive a track in the oracle harness.
    out["bars"]["trg_cnames"] = run_multi_chord_case(
        "CHORD", "1 2 90", 3, [[("C", 1, 2), ("G", 2, 3), ("F", 3, 5)]],
        setup=[("setTrigger", (["Beats=1,2,3,4", "CNames=C,F"],))],
    )
    out["bars"]["trg_ctonics"] = run_multi_chord_case(
        "CHORD", "1 2 90", 3, [[("C", 1, 2), ("G", 2, 3), ("F", 3, 5)]],
        setup=[("setTrigger", (["Beats=1,2,3,4", "CTonics=C,G"],))],
    )
    out["bars"]["trg_ctypes"] = run_multi_chord_case(
        "CHORD", "1 2 90", 3, [[("C", 1, 2), ("G7", 2, 3), ("F", 3, 5)]],
        setup=[("setTrigger", (["Beats=1,2,3,4", "CTypes=7"],))],
    )
    out["bars"]["trg_bars"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C", "C"],
        setup=[("setTrigger", (["Beats=1", "Bars=2"],))],
    )
    out["bars"]["trg_override"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C", "C"],
        setup=[("setTrigger", (["Beats=1", "Bars=2", "Override=True"],))],
    )

    # ------------------------------------------------------------ RPITCH
    out["bars"]["rp_chromatic"] = run_bar_case(
        "BASS", "1 4 1 90; 3 4 1 90", 4, ["C"],
        setup=[("setRPitch", (["Scale=Chromatic", "Offsets=-2,2", "Rate=100"],))], seed=55,
    )
    out["bars"]["rp_scale"] = run_bar_case(
        "BASS", "1 4 1 90; 3 4 5 90", 4, ["C"],
        setup=[("setRPitch", (["Scale=Scale", "Offsets=-2,3", "Rate=100"],))], seed=56,
    )
    out["bars"]["rp_chord"] = run_bar_case(
        "CHORD", "1 4 90; 3 4 90", 3, ["Cmaj7"],
        setup=[("setRPitch", (["Scale=Chord", "Offsets=1,2", "Rate=100"],))], seed=57,
    )
    out["bars"]["rp_rate_zero"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"],
        setup=[("setRPitch", (["Offsets=5", "Rate=0"],))], seed=58,
    )
    out["bars"]["rp_bars"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C", "C"],
        setup=[("setRPitch", (["Offsets=5", "Rate=100", "Bars=2"],))], seed=59,
    )
    out["bars"]["rp_range_offsets"] = run_bar_case(
        "BASS", "1 4 1 90; 3 4 1 90", 4, ["C"],
        setup=[("setRPitch", (["Scale=Chromatic", "Offsets=-2-2", "Rate=100"],))], seed=60,
    )
    out["bars"]["rp_off"] = run_bar_case(
        "BASS", "1 4 1 90", 4, ["C"],
        setup=[("setRPitch", (["Off"],))],
    )

    # Harmony setters (state + warnings).  CHORD/DRUM ignore the setting
    # with a warning; PLECTRUM ignores only HarmonyVolume.
    out["harmonySetters"] = {
        "bass_set": run_harmony_setter_case("BASS", "setHarmony", ["2"]),
        "bass_set_lower": run_harmony_setter_case("BASS", "setHarmony", ["open8above"]),
        "bass_set_none_dash": run_harmony_setter_case("BASS", "setHarmony", ["-"]),
        "bass_set_none_word": run_harmony_setter_case("BASS", "setHarmony", ["None"]),
        "bass_set_slash": run_harmony_setter_case(
            "BASS", "setHarmony", ["2", "/", "3"], seqsize=4
        ),
        "bass_set_seqsize": run_harmony_setter_case(
            "BASS", "setHarmony", ["2", "3"], seqsize=4
        ),
        "bass_only": run_harmony_setter_case("BASS", "setHarmonyOnly", ["3"]),
        "bass_only_none": run_harmony_setter_case("BASS", "setHarmonyOnly", ["NONE"]),
        "bass_volume": run_harmony_setter_case("BASS", "setHarmonyVolume", ["50"]),
        "bass_volume_zero": run_harmony_setter_case("BASS", "setHarmonyVolume", ["0"]),
        "bass_volume_seqsize": run_harmony_setter_case(
            "BASS", "setHarmonyVolume", ["50", "75"], seqsize=2
        ),
        "chord_set_warn": run_harmony_setter_case("CHORD", "setHarmony", ["3"]),
        "chord_only_warn": run_harmony_setter_case("CHORD", "setHarmonyOnly", ["3"]),
        "drum_set_warn": run_harmony_setter_case("DRUM", "setHarmony", ["3"]),
        "drum_only_warn": run_harmony_setter_case("DRUM", "setHarmonyOnly", ["3"]),
        "drum_volume_warn": run_harmony_setter_case("DRUM", "setHarmonyVolume", ["50"]),
        "plectrum_set": run_harmony_setter_case("PLECTRUM", "setHarmony", ["Open"]),
        "plectrum_volume_warn": run_harmony_setter_case(
            "PLECTRUM", "setHarmonyVolume", ["50"]
        ),
    }

    return out


def main():
    # MMA's warning() writes to stdout; keep it out of the JSON fixture.
    with contextlib.redirect_stdout(sys.stderr):
        out = generate()
    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Generate golden fixtures for the TypeScript MidiInc (MIDI file import) port.

Two kinds of oracle data are dumped from the reference Python MMA:

  * MidiData dumps for a set of real .mid files (several sizes) plus two
    synthetic files: one with text/lyric/program-change events and
    running status, one sparsely populated for the riff bar builder.
    Each file is read with a few reader-option variants (ignorePC,
    octaveAdjust, velocityAdjust, adjustBeats), exactly as
    midiIn.midiinc() sets them.
  * Full ctx.mtrks hex dumps for small MidiInc songs.  Each song is
    written under ts/test/fixtures/midiinc/ and run through mma_dump.py
    (writing a .mid so the DURATION text event both sides add is
    included); the source is embedded in the JSON so the TypeScript test
    replays the same text.

The songs reference the recorded files either repo-relative
(`egs/midi-inc/...`, valid for the Python run with cwd = repo root and
for the TS run against the library resources) or through the fixture
directory (`ts/test/fixtures/midiinc/meta.mid`).

Run:
    python3 ts/test/tools/gen_midiinc_fixtures.py > ts/test/fixtures/python/midiinc.json
"""

import base64
import json
import os
import struct
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TS_DIR = os.path.abspath(os.path.join(HERE, "..", ".."))
MMA_DIR = os.path.abspath(os.path.join(TS_DIR, ".."))
DUMP = os.path.join(HERE, "mma_dump.py")
FIXTURE_DIR = os.path.join(TS_DIR, "test", "fixtures", "midiinc")

# MMA's modules import MMAdir/platform from __main__; set them before the
# first MMA import so the package initializes exactly like mma_dump.py.
import __main__  # noqa: E402

__main__.MMAdir = MMA_DIR
__main__.platform = "Linux"
sys.path.insert(0, MMA_DIR)
from MMA.readmidi import MidiData  # noqa: E402


# ---------------------------------------------------------------------------
# MidiData dumps

# name -> repo-relative path
MIDI_FILES = {
    "drum": "egs/midi-inc/drum.mid",
    "rec2": "egs/midi-inc/rec2.mid",
    "frankie2": "egs/midi-inc/frankie2.mid",
    "countme": "egs/midi-inc/mid2seq/countme.mid",
    "test": "egs/midi-inc/mid2seq/test.mid",
}

# The synthetic file: format 0, division 96 (deliberately different from
# MMA's 192), text + lyric metas, a program change before the first note,
# note-off as 0x80 and as 0x90-velocity-0, a CC and a pitch bend.
VARIANTS = {
    "default": {"ignorePC": True, "octave": 0, "velocity": 100},
    "adjusted": {"ignorePC": False, "octave": 12, "velocity": 70},
    "beats": {"ignorePC": True, "octave": -12, "velocity": 150, "adjust": 0.5},
}


def make_sparse_midi():
    """Build a sparsely populated .mid (format 0, division 96).

    Designed so the RIFF/sequence bar builder has to fill empty bars with
    rests and produce '~' continuations: after the MidiInc beat adjust
    (x2) the notes land in bars 0, 3 and 5 with bar-crossing durations,
    including two crossing notes in the same bar (the multi-~ strip).
    """
    ev = [
        (0, bytes([0x90, 60, 90])),
        (300, bytes([0x80, 60, 0])),
        (100, bytes([0x90, 62, 90])),
        (900, bytes([0x80, 62, 0])),
        (1200, bytes([0x90, 64, 90])),
        (2000, bytes([0x80, 64, 0])),
        (1250, bytes([0x90, 65, 90])),
        (1600, bytes([0x80, 65, 0])),
        (2100, bytes([0x90, 67, 90])),
        (2300, bytes([0x80, 67, 0])),
        (2400, meta(0x2F, b"")),
    ]
    # Events above are sorted by time except for the interleaved pairs;
    # write them in true time order.
    ev.sort(key=lambda x: x[0])
    track = b""
    last = 0
    for ticks, data in ev:
        track += vlq(ticks - last) + data
        last = ticks
    header = b"MThd" + struct.pack(">IHHH", 6, 0, 1, 96)
    chunk = b"MTrk" + struct.pack(">I", len(track)) + track
    return header + chunk


def vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.insert(0, (n & 0x7F) | 0x80)
        n >>= 7
    return bytes(out)


def meta(kind, payload):
    return b"\xff" + bytes([kind]) + vlq(len(payload)) + payload


def make_synthetic_midi():
    """Build the synthetic .mid used for text/lyric/PC reader tests.

    Deliberately exercises running status (the bare data bytes after the
    first note-on), a sysex and a marker (both skipped), a non-ASCII
    cp1252 text byte, program changes before the first note, note-off as
    0x8x and as 0x90-velocity-0, and a note near the top of the range for
    the octave wrap.
    """
    ev = []
    ev.append((0, meta(0x01, b"Hello \xe9")))  # cp1252 e-acute
    ev.append((0, meta(0x05, b"la")))
    ev.append((0, bytes([0xC0, 5])))  # program change, ch 1
    ev.append((0, bytes([0x90, 60, 100])))  # note on
    ev.append((0, bytes([0x3E, 100])))  # running status: note on 62
    ev.append((0, bytes([0x3C, 0])))  # running status: note off 60
    ev.append((0, bytes([0x3E, 0])))  # running status: note off 62
    ev.append((48, b"\xf0\x03\x7e\x7f\xf7"))  # sysex (skipped)
    ev.append((48, meta(0x06, b"MarkerName")))  # marker (skipped)
    ev.append((480, meta(0x01, b"World")))
    ev.append((480, bytes([0x80, 60, 64])))  # note off (0x8x)
    ev.append((480, bytes([0x90, 120, 80])))  # note on near the top
    ev.append((960, bytes([0x90, 120, 0])))  # note off as vel 0
    ev.append((960, bytes([0xB0, 7, 100])))  # control change
    ev.append((1000, bytes([0xE0, 0x00, 0x40])))  # pitch bend
    ev.append((1100, bytes([0xC1, 7])))  # program change, ch 2
    ev.append((1200, meta(0x2F, b"")))
    track = b""
    last = 0
    for ticks, data in ev:
        track += vlq(ticks - last) + data
        last = ticks
    header = b"MThd" + struct.pack(">IHHH", 6, 0, 1, 96)
    chunk = b"MTrk" + struct.pack(">I", len(track)) + track
    return header + chunk


def midi_data_dump(md):
    events = {}
    for ch in range(16):
        if md.events[ch]:
            out = []
            for e in md.events[ch]:
                if isinstance(e[2], int):
                    out.append([e[0], e[1], e[2], e[3]])
                else:
                    out.append([e[0], e[1], list(e[2])])
            events[str(ch)] = out
    return {
        "MidiFormat": md.MidiFormat,
        "numTracks": md.numTracks,
        "beatDivision": md.beatDivision,
        "firstNote": md.firstNote,
        "events": events,
        "textEvents": [[a, b] for a, b in md.textEvents],
        "lyricEvents": [[a, b] for a, b in md.lyricEvents],
    }


def dump_variants(read_bytes):
    out = {}
    for vname, v in VARIANTS.items():
        md = MidiData()
        md.ignorePC = v["ignorePC"]
        md.octaveAdjust = v["octave"]
        md.velocityAdjust = v["velocity"]
        with tempfile.NamedTemporaryFile(prefix="mma-midiinc-", suffix=".mid", delete=False) as f:
            f.write(read_bytes)
            tmp = f.name
        try:
            md.readFile(tmp)
        finally:
            os.unlink(tmp)
        if v.get("adjust"):
            md.adjustBeats(v["adjust"])
        out[vname] = {"options": v, "data": midi_data_dump(md)}
    return out


# ---------------------------------------------------------------------------
# Songs rendered through MMA

SONGS = {}

SONGS["riff-octave"] = """\
// MidiInc fixture: RIFF import with octave adjustment.
RndSeed 1
Time 4
Tempo 120
Begin Solo
    Voice TenorSax
    Octave 5
End
MidiInc File=egs/midi-inc/rec1.mid Solo=1,Riff Volume=70 Octave=-1
C
F * 2
G7
C
z
"""

SONGS["riff-drums"] = """\
// MidiInc fixture: global transpose + riff, then a drum import.
RndSeed 1
Time 4
Tempo 120
Transpose 2
Begin Solo
    Voice TenorSax
End
MidiInc File=egs/midi-inc/rec2.mid Solo=1,Riff Volume=90
Begin Drum
End
MidiInc File=egs/midi-inc/drum.mid Drum=1 Transpose=0 Volume=80 Start=1B End=24B
C
F
G7
C
z
"""

SONGS["sequence"] = """\
// MidiInc fixture: sequence mode from a 384 tick/beat file.
RndSeed 1
Time 4
Tempo 130
SeqSize 4
Solo-Drum DrumType
MidiInc File=egs/midi-inc/mid2seq/countme.mid StripSilence=Off Solo-Drum=10,sequence Start=36 End=52 Volume=60
1 C
2 F
3 G
4 C
"""

SONGS["direct-meta"] = """\
// MidiInc fixture: direct import, text/lyric events and PC handling.
RndSeed 1
Time 4
Tempo 120
Transpose 1
Solo-Clr Voice Clarinet
MidiInc File=ts/test/fixtures/midiinc/meta.mid Text=On Lyric=On Solo=1 Volume=90 Offset=1B IgnorePC=Off
MidiInc File=egs/midi-inc/rec2.mid Solo-Clr=1 Volume=100 Stretch=100
C
F * 2
G7
C
z
"""

SONGS["sparse-bars"] = """\
// MidiInc fixture: sparse import forcing the riff bar filler and '~'
// continuations, in Riff and Sequence mode.
RndSeed 1
Time 4
Tempo 120
SeqSize 8
Solo-Riff Voice Flute
MidiInc File=ts/test/fixtures/midiinc/sparse.mid Solo-Riff=1,Riff
Solo-Seq Voice Trumpet
MidiInc File=ts/test/fixtures/midiinc/sparse.mid Solo-Seq=1,Sequence
C * 8
F
G7
C
z
"""


def run_song(name, source):
    os.makedirs(FIXTURE_DIR, exist_ok=True)
    song_path = os.path.join(FIXTURE_DIR, "%s.mma" % name)
    with open(song_path, "w") as f:
        f.write(source)

    state_path = os.path.join(FIXTURE_DIR, "%s.state.json" % name)
    midi_path = os.path.join(FIXTURE_DIR, "%s.mid" % name)
    proc = subprocess.run(
        [sys.executable, DUMP, "-xNOCREDIT", "-f", midi_path, "--out", state_path, song_path],
        cwd=MMA_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if proc.returncode != 0 or "Error:" in proc.stderr:
        raise RuntimeError("song %s failed:\n%s" % (name, proc.stderr))
    with open(state_path) as f:
        state = json.load(f)["state"]
    # Clean up the run artifacts; the .mma and the .mid fixture stay.
    try:
        os.unlink(state_path)
        os.unlink(midi_path)
    except OSError:
        pass

    return {
        "source": source,
        "tickOffset": state["tickOffset"],
        "mtrks": state["mtrks"],
        "tracks": {
            tname: {"vtype": t["vtype"], "channel": t["channel"]}
            for tname, t in state["tracks"].items()
        },
    }


def main():
    # The synthetic .mid files are also used as resources by the songs.
    os.makedirs(FIXTURE_DIR, exist_ok=True)
    synthetic = {
        "meta": make_synthetic_midi(),
        "sparse": make_sparse_midi(),
    }
    for name, data in synthetic.items():
        with open(os.path.join(FIXTURE_DIR, "%s.mid" % name), "wb") as f:
            f.write(data)

    out = {"midiFiles": {}, "synthetic": {}, "songs": {}}
    for name, path in MIDI_FILES.items():
        with open(os.path.join(MMA_DIR, path), "rb") as f:
            data = f.read()
        out["midiFiles"][name] = {"path": path, "variants": dump_variants(data)}
    for name, data in synthetic.items():
        out["synthetic"][name] = {
            "path": "ts/test/fixtures/midiinc/%s.mid" % name,
            "base64": base64.b64encode(data).decode("ascii"),
            "variants": dump_variants(data),
        }

    for name, source in SONGS.items():
        out["songs"][name] = run_song(name, source)

    json.dump(out, sys.stdout, indent=1, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

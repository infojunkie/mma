#!/usr/bin/env python3
"""Generate golden fixtures for the TypeScript MIDI-directive port.

Runs a set of small, self-contained songs through the reference Python
MMA (MMA/main.py via mma_dump.py) and dumps the packed meta/channel
tracks (tick -> hex events) plus the track/channel bookkeeping.  The
TypeScript port replays the same songs and compares its in-memory
MIDIDocument against this fixture (ts/test/parse/midi.test.ts).

Run:
    python3 ts/test/tools/gen_midi_fixtures.py > ts/test/fixtures/python/midi.json
"""

import base64
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TS_DIR = os.path.abspath(os.path.join(HERE, "..", ".."))
MMA_DIR = os.path.abspath(os.path.join(TS_DIR, ".."))
DUMP = os.path.join(HERE, "mma_dump.py")

SONGS = {}

SONGS["meta"] = """\
Time 4
Tempo 100
KeySig C
MidiText Generated test
MidiTName Meta Test
MidiCopyright (c) 2024 Test
MidiCue Cue text here
MidiMark 1 Marker one
MidiMark 2 Two words label
MidiMark SingleWord
MidiMark 1.5 Fractional offset
MidiMark 0 Multi word label here
Midi 0xF0 0x7E 0x7F 0x09 0x01 0xF7
MidiVolume 8000
ChannelPref CHORD=3
Begin Chord Define
    CH1   1 4 90 ; 2 4 70 ; 3 4 90 ; 4 4 70
End
Begin Chord
    Sequence CH1
    Voice Piano1
End
C
F
"""

SONGS["cresc"] = """\
Time 4
Tempo 120
KeySig C
MidiVolume mp
MidiCresc 4000 8000 1
Begin Chord Define
    CH1   1 4 90
End
Begin Chord
    Sequence CH1
    Voice Piano1
    Channel 3
End
C
MidiDecresc 8000 4000 1
C
MidiCresc 12000 1
C
MidiDecresc STEP=50 12000 3000 2
C
C
"""

SONGS["track-meta"] = """\
Time 4
Tempo 120
KeySig C
Begin Chord Define
    CH1   1 4 90 ; 3 4 80
End
Begin Chord
    Sequence CH1
    Voice Piano1
    Channel 3
    MidiTName Chord track name
    MidiVolume 100
    MidiPan CENTER
    MidiGlis 64
    MidiText Track text event
    MidiCue Track cue event
End
Begin Bass Define
    BA1   1 4 1 90
End
Begin Bass
    Sequence BA1
    Voice AcousticBass
    Channel 4
    MidiPan 10 100 4B
    MidiWheel DURATION=2B START=4000 END=12000 RESET=ON CYCLE=OFF STEP=25
    MidiWheel DURATION=1B START=0 END=16383 RATE=8 CYCLE=ON RESET=OFF
End
Begin Scale Define
    SC1   1 4 90
End
Begin Scale
    Sequence SC1
    Voice Flute
    Channel 6
    MidiWheel SET=CENTER
    MidiWheel SET=8192 RESET
    MidiGlis 0
    MidiVolume mf
End
C
F
"""

SONGS["midinote"] = """\
Time 4
Tempo 120
KeySig C
Transpose 2
Begin Solo Define
    SO1   4c; 4d; 4e; 4f;
End
Begin Solo
    Sequence SO1
    Voice TenorSax
    Channel 5
    Octave 5
End
Solo MidiNote NOTE 1 c 90 4
Solo MidiNote 2 c,d,e 100 8
Solo MidiNote OFFSETS=BEATS DURATION=NOTES NOTE 3 f# 90 4
Solo MidiNote TRANSPOSE=ON NOTE 1 c 80 2
Solo MidiNote TRANSPOSE=OFF OFFSETS=TICKS DURATION=TICKS 0 72 100 96
Solo MidiNote ADJUST=12 VOLUME=50 NOTE 1 g 90 4
Solo MidiNote ADJUST=0 VOLUME=100 OCTAVE=1 NOTE 1 c 90 4
Solo MidiNote ARTICULATE=ON NOTE 4 c 90 4
Solo MidiNote ARTICULATE=OFF OCTAVE=0
Solo MidiNote PB 0 -1802
Solo MidiNote PB 384 2048
Solo MidiNote PBR 4 0,384 0,8191
Solo MidiNote PBR 2 0,96 -8192,0
Solo MidiNote CTRL 192 Volume 100
Solo MidiNote CTRL 192 7 100
Solo MidiNote CHAT 0 64
Solo MidiNote CHATR 4 0,384 0,127
z
"""

SONGS["midinote-drum"] = """\
Time 4
Tempo 120
KeySig C
Begin Drum Define
    DR1   1 4 100
End
Begin Drum
    Sequence DR1
    Tone LowTom1
End
Drum MidiNote NOTE 0 SnareDrum1 100 4
Drum MidiNote 0 42 90 4
Drum MidiNote 1 * 100 4
Drum MidiNote 2 * 100 4
z
"""

SONGS["mdefine"] = """\
Time 4
Tempo 120
KeySig C
MidiDef SWELL1 0 Volume 100 ; 1 Volume 110 ; 2 Volume 120
MidiDef COMBINED SWELL1 ; 3 Volume 60
ChannelInit CHANNELS=14,16 Voice Flute
Begin Chord Define
    CH1   1 4 90
End
Begin Chord
    Sequence CH1
    Channel 14
    MidiSeq { 0 Volume 90 ; 1 Volume 100 }
    MidiVoice { 0 Pan 40 ; 1 Pan 80 }
    MidiClear -
    Volume mp
End
Begin Bass Define
    BA1   1 4 1 90
End
Begin Bass
    Sequence BA1
    Channel 16
    MidiSeq COMBINED
    MidiClear 0 Volume 100
End
C
F
"""


# Songs rendered all the way to a .mid file: these verify the writer's
# structural output (MIDISPLIT expands one channel into per-pitch tracks),
# which event-stream normalization alone cannot see.
MIDI_FILE_SONGS = {}

MIDI_FILE_SONGS["split"] = """\
Time 4
Tempo 120
KeySig C
MidiSplit 14
Begin Chord Define
    CH1   1 4 90 ; 3 4 80
End
Begin Chord
    Sequence CH1
    Channel 14
    Voice Piano1
    MidiTName SplitMe
End
Begin Drum Define
    DR1   1 4 100
End
Begin Drum
    Sequence DR1
    Tone LowTom1
End
C
F
"""


def run_midi_file(name, source):
    """Render one song to a .mid and return it base64-encoded."""
    with tempfile.TemporaryDirectory(prefix="mma-midi-file-") as tmp:
        song_path = os.path.join(tmp, "song.mma")
        midi_path = os.path.join(tmp, "out.mid")
        with open(song_path, "w") as f:
            f.write(source)
        proc = subprocess.run(
            [sys.executable, os.path.join(MMA_DIR, "mma.py"), "-II", "-xNOCREDIT",
             "-f", midi_path, song_path],
            cwd=MMA_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if proc.returncode != 0 or not os.path.exists(midi_path):
            raise RuntimeError("song %s failed:\n%s" % (name, proc.stderr))
        with open(midi_path, "rb") as f:
            return base64.b64encode(f.read()).decode("ascii")


def run_song(name, source):
    """Run one song through mma_dump.py and return its dumped state."""
    with tempfile.TemporaryDirectory(prefix="mma-midi-fixture-") as tmp:
        song_path = os.path.join(tmp, "song.mma")
        state_path = os.path.join(tmp, "state.json")
        midi_path = os.path.join(tmp, "out.mid")
        with open(song_path, "w") as f:
            f.write(source)
        # No -n: the file write adds the DURATION meta text, exactly like
        # the TS façade's toMIDI does, so both dumps include it.
        proc = subprocess.run(
            [sys.executable, DUMP, "-xNOCREDIT", "-f", midi_path, "--out", state_path, song_path],
            cwd=MMA_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        # MMA's error() prints and exits; mma_dump catches SystemExit, so
        # a failed song still exits 0 - detect the message explicitly.
        if proc.returncode != 0 or "Error:" in proc.stderr:
            raise RuntimeError("song %s failed:\n%s" % (name, proc.stderr))
        with open(state_path) as f:
            return json.load(f)["state"]


def main():
    songs = {}
    for name, source in SONGS.items():
        state = run_song(name, source)
        songs[name] = {
            "source": source,
            "tickOffset": state["tickOffset"],
            "mtrks": {ch: evs for ch, evs in state["mtrks"].items() if evs},
            "tracks": {
                tname: {"vtype": t["vtype"], "channel": t["channel"]}
                for tname, t in state["tracks"].items()
            },
        }
    midi_files = {
        name: {"source": source, "midi": run_midi_file(name, source)}
        for name, source in MIDI_FILE_SONGS.items()
    }
    json.dump({"songs": songs, "midiFiles": midi_files}, sys.stdout, indent=1, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

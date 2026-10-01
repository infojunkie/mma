# MMA - Musical MIDI Accompaniment

MMA creates MIDI tracks for a soloist to perform over, from a user-supplied
file containing chords and MMA directives. You describe the harmony and the
style; MMA generates a complete accompaniment — bass, drums, chord stabs,
riffs — as a standard MIDI file.

Written by [Bob van der Poel](http://www.mellowood.ca/mma/). This repository is
a fork maintained for the [musicxml-midi](https://github.com/infojunkie/musicxml-midi)
project.

## Installation

```
pip install musical-midi-accompaniment
```

or, with [uv](https://docs.astral.sh/uv/):

```
uv tool install musical-midi-accompaniment
```

This installs the `mma` command.

## After installing

MMA ships its groove libraries but not the prebuilt lookup database, because
that database records absolute paths. Build it once:

```
mma -G
```

You can skip this if you always name the library file explicitly, e.g.
`Groove stdlib/swing:Swing` instead of `Groove Swing`.

`mma -G` writes `.mmaDB` files into the installed library directories. That
works in a virtualenv, `uv tool` or pipx install, which you own. For a
root-owned system install, either run `mma -G` as root, or point `MMA_LIBPATH`
at a writable copy of the libraries and build the database there.

## Usage

```
mma song.mma                  # generate song.mid
mma -f out.mid song.mma       # choose the output file
mma -n song.mma               # parse only, generate nothing
mma -V song.mma               # generate, then play
mma -v                        # version
mma -Dxh song.mma             # dump the groove definitions as HTML
printf 'Groove Swing\nC Am F G\n' | mma -n -
```

MMA reads its input from a file, or from stdin when the filename is `-`.
Run `mma` with no arguments for the full option list, and see the
[manual](http://www.mellowood.ca/mma/) for the input language.

Configuration lives in an `mmarc` file, searched in the current directory,
`~/.config/mma/mmarc`, `~/.mmarc`, `/usr/local/etc/mmarc` and `/etc/mmarc`.

## Environment variables

| Variable | Purpose |
|---|---|
| `MMA_HOME` | Use a data tree (`lib/`, `includes/`, `plugins/`) at this location instead of the installed one |
| `MMA_LIBPATH` | Extra groove library directories, prepended to the built-in ones (`os.pathsep`-separated) |
| `MMA_INCPATH` | Extra include directories |
| `MMA_PLUGPATH` | Extra plugin directories |
| `MMA_ENCODING` | Input file encoding (default `cp1252`) |
| `MMA_LOGFILE` | Redirect messages and warnings to a file |

## Running from a source checkout

The repository also works in place, without installing:

```
./mma.py song.mma
./mma.py -G
```

## License

GPL-2.0-or-later. Copyright (C) 2002-2021 Bob van der Poel.
See [LICENSE](LICENSE).

`MMA/appdirs.py` is a vendored copy of [appdirs](https://github.com/ActiveState/appdirs)
1.4.1, distributed under the MIT license; its notice is retained in the file.

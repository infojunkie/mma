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

## Building and publishing

Built with [uv](https://docs.astral.sh/uv/) and hatchling. The distribution is
named `musical-midi-accompaniment`; the command it installs is `mma`.

### Build

```
uv build
```

Both artifacts land in `dist/`. `uv build` builds the sdist first and then
builds the wheel *from that sdist*, so the sdist has to stay self-sufficient.

The version lives in `MMA/gbl.py` and is read from there — bump it in that one
place. It must be a valid [PEP 440](https://peps.python.org/pep-0440/) version,
so no leading zeros: upstream writes `25.05.3`, this package publishes `25.5.3`.

The `lib/`, `includes/` and `plugins/` directories sit beside the package in
the repository but are mapped *into* the wheel as `MMA/lib` and friends, which
is where the installed program looks for them. That mapping uses hatchling
`sources` rather than `force-include`, because forced files bypass `exclude`
and `.gitignore` — which would bake this machine's `.mmaDB` groove caches and
their absolute paths into the published wheel.

### Check the artifacts

No credentials needed, and worth doing before every upload:

```
uv tool run twine check --strict dist/*
uv venv /tmp/mma-check
uv pip install --python /tmp/mma-check/bin/python --force-reinstall dist/*.whl
/tmp/mma-check/bin/mma -v
```

Then run something real — a wheel can be structurally valid and still fail to
find its libraries:

```
/tmp/mma-check/bin/mma -G
/tmp/mma-check/bin/mma egs/simple/marine-hymn.mma -f /tmp/out.mid
```

and confirm no local junk got in:

```
unzip -l dist/*.whl | grep -E '\.mmaDB|__pycache__|docs/|egs/'
```

That should print nothing.

### Install from a local build

To get `mma` on your `PATH` without publishing, install the wheel with
`uv tool`:

```
uv tool install dist/*.whl
mma -G
```

This gives the command its own environment under `~/.local/share/uv/tools/`,
which you own, so the one-time `mma -G` write succeeds. Reinstall after a
rebuild with `--reinstall`, and remove it with
`uv tool uninstall musical-midi-accompaniment`.

For development, install the checkout itself so that edits to the Python
modules and to `lib/` take effect immediately:

```
uv tool install --editable .
```

To use it from another project instead of as a standalone tool, install the
wheel into that project's environment (run this from the MMA checkout, and
point `--python` at the other project):

```
uv pip install --python /path/to/project/.venv/bin/python dist/*.whl
```

### Publish

```
UV_PUBLISH_TOKEN=pypi-... uv publish
```

Try TestPyPI first. There is no built-in `testpypi` index, so name the upload
endpoint explicitly:

```
UV_PUBLISH_TOKEN=pypi-... uv publish --publish-url https://test.pypi.org/legacy/ --dry-run
UV_PUBLISH_TOKEN=pypi-... uv publish --publish-url https://test.pypi.org/legacy/
```

`--dry-run` lists what would be uploaded without uploading it. Both forms are
safe to re-run: PyPI skips files it already has.

From GitHub Actions, configure a trusted publisher on PyPI instead of storing a
token, and run a bare `uv publish` with no credentials.

## License

GPL-2.0-or-later. Copyright (C) 2002-2021 Bob van der Poel.
See [LICENSE](LICENSE).

`MMA/appdirs.py` is a vendored copy of [appdirs](https://github.com/ActiveState/appdirs)
1.4.1, distributed under the MIT license; its notice is retained in the file.

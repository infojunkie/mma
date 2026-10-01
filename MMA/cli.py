# cli.py

"""
Entry point for an installed mma.

This module is an integeral part of the program
MMA - Musical Midi Accompaniment.

This program is free software; you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation; either version 2 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, write to the Free Software
Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA

Karim Ratib <karim.ratib@gmail.com>

"""

import os
import platform as _platform
import sys


def _bootstrap():
    """ Publish MMAdir and platform for MMA.gbl, and return the home used.

        This is the job mma.py does when mma is run from a source checkout;
        the modules under MMA/ read both names from __main__. MMA_HOME is
        honoured here as well, so an installed mma can still be pointed at a
        traditional data tree.
    """
    here = os.path.dirname(os.path.abspath(__file__))

    home = os.environ.get('MMA_HOME')
    home = os.path.abspath(home) if home else here

    stub = sys.modules['__main__']
    stub.MMAdir = home
    stub.platform = _platform.system()

    return home


def main():
    """ Entry point for the 'mma' command. """

    _bootstrap()

    # MMA.main is the program mainline: importing it runs the program. It
    # calls sys.exit() itself on every one of its completion paths, so there
    # is no return value to pass on.
    import MMA.main

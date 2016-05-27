# debug.py

"""
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

Bob van der Poel <bob@mellowood.ca>

Some silly functions used by the debug code.

"""

from MMA.macro import macros

def trackSet(track, func):
    """ Print a debug message for functions which set a track setting. 

        track - name of the track (Chord-Sus ... )
        name - the name of the function (Strum, Compress ...)

        By using the macro formatting functions we get consistent output 
         between debug and macro expansion.
    """


    print("Set %s %s: %s" % (track, func, macros.sysvar("%s_%s" % (track, func.upper()))))




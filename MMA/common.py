# common.py

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


These are a collection of miscellaneous routines used in various
parts of MMA. It is safe to load the whole works with:

    from MMA.common import *

without side effects (yeah, right).

"""

from random import randrange
import sys
from . import gbl
from textwrap import wrap

# having the term width is nice for pretty print error/warning
from MMA.termsize import getTerminalSize
termwidth = getTerminalSize()[0]-1
 
def prettyPrint(msg):
    """ Simple formatter for error/warning messages."""

    for a in wrap(msg, termwidth, initial_indent='', subsequent_indent='    '):
        print(a)

def error(msg):
    """ Print an error message and exit.

        If the global line number is >=0 then print the line number
        as well.
    """

    if gbl.lineno >= 0:
        linno = "<Line %d>" % gbl.lineno
    else:
        linno = ''

    if gbl.inpath:
        file = "<File:%s>" % gbl.inpath.fname
    else:
        file = ''

    prettyPrint("Error: %s %s %s" % (linno, file, msg))

    # Parse though the error message and check for illegal characters.
    # Report (first only) if any found.

    for a in msg:
        a = ord(a)
        if a < 0x20 or a >= 0x80:
            print("Corrupt input file? Illegal character 'x%02x' found." % a)
            break

    sys.exit(1)

def warning(msg):
    """ Print warning message and return. """

    if not gbl.noWarn:
        if gbl.lineno >= 0:
            linno = "<Line %d>" % gbl.lineno
        else:
            linno = ''

        if gbl.inpath:
            file = "<File:%s>" % gbl.inpath.fname
        else:
            file = ''

        prettyPrint("Warning: %s %s %s" % (linno, file, msg))

   
def getOffset(ticks, ranLow=None, ranHigh=None):
    """ Calculate a midi offset into a song.

        ticks == offset into the current bar.
        ran   == random adjustment from RTIME

        When calculating the random factor the test ensures
        that a note never starts before the start of the bar.
        This is important ... voice changes, etc. will be
        buggered if we put the voice change after the first
        note-on event.

        CAUTION: If you pass either ranLow or ranHigh make sure
                 both are set. If one has a value and the other
                 is None a crash is ensured. The existing callers
                 are okay (setRtime creates both values).
    """

    p = gbl.tickOffset + int(ticks)     # int() cast is important!

    if ranLow or ranHigh:
        r = randrange(ranLow, ranHigh+1)
        if ticks == 0 and r < 0:
            r = 0
        p += r

    return p


def stoi(s, errmsg=None):
    """ string to integer. """

    try:
        return int(s, 0)
    except ValueError:
        if errmsg:
            error(errmsg)
        else:
            error("Expecting integer value, not %s" % s)


def stof(s, errmsg=None):
    """ String to floating point. """

    try:
        return float(s)
    except:
        try:
            return int(s, 0)
        except ValueError:
            if errmsg:
                error(errmsg)
            else:
                error("Expecting a  value, not %s" % s)


def pextract(s, open, close, onlyone=None, insert=''):
    """ Extract a parenthesized set of substrings.

        s        - original string
        open    - substring start tag \ can be multiple character
        close   - substring end tag   / strings (ie. "<<" or "-->")
        onlyone - optional, if set only the first set is extracted
        insert  - optional, insert string where extraction

        returns ( original sans subs, [subs, ...] )

        eg: pextract( "x{123}{666}y", '{',    '}' )
            Returns:  ( 'xy', [ '123', '666' ] )

    """

    subs = []
    magic = chr(1)
    while 1:
        lstart = s.find(open)
        lend   = s.find(close)

        if lstart > -1 and lstart < lend:
            subs.append(s[lstart + len(open):lend].strip())
            s = s[:lstart] + magic + s[lend+len(close):]
            if onlyone:
                break
        else:
            break

    s = s.replace(magic, insert)
    
    return s.strip(), subs


def seqBump(l):
    """ Expand/contract an existing sequence list to the current seqSize."""

    while len(l) < gbl.seqSize:
        l.extend(l)
    return l[:gbl.seqSize]


def lnExpand(ln, msg):
    """ Validate and expand a list passed to a set command. """
    
    if len(ln) > gbl.seqSize:
        if not gbl.inAllGrooves:
            warning("%s list truncated to %s patterns" % (msg, gbl.seqSize) )
        ln = ln[:gbl.seqSize]

    last = None

    for i, n in enumerate(ln):
        if n == '/':
            if last is None:
                error("%s cannot use a '/' as the first item in list." % msg)
            else:
                ln[i] = last
        else:
            last = n

    return ln


def opt2pair(ln, toupper=0):
    """ Parse a list of options. Separate out "=" option pairs.

        Returns:
           newln - original list stripped of opts
           opts  - list of options. Each option is a tuple(opt, value)

       Note: default is to leave case alone, setting toupper converts everything to upper.
    """

    opts = []
    newln = []

    # Permit the user to use stuff like "Beats = 1 , 3, 4" or "opt1 = 44 opt2 = 99"
    # So, join the line with space delminters, then strip out spaces before/after
    # all '=' and ','. This may bugger up print statements, but they aren't parsed
    # here ... so this should be fine. This might be a cause of future errors!

    # This is very useful when the user wants to use a macro expansion:
    #     Beats = $Macro1 , $Macro2
    # since macros need to have spaces around them.

    ln = ' '.join(ln)
    ln = ln.replace('  ', ' ')  # strip double spaces
    ln = ln.replace('= ', '=')  # spaces after/before =
    ln = ln.replace(' =', '=')
    ln = ln.replace(', ', ',')  # spaces after/before ,
    ln = ln.replace(' ,', ',')
    ln = ln.split()

    for a in ln:
        if toupper:
            a = a.upper()
        try:
            o, v = a.split('=', 1)
            opts.append((o, v))
        except ValueError:   # this means no '='
            newln.append(a)

    return newln, opts

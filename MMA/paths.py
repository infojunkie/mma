# paths.py

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

This module contains functions for setting various path variables.

"""

import os

from . import gbl
from MMA.common import *
import MMA.auto
import MMA.grooves
import MMA.exits

outfile = ''

libPath = []
libDirs = []
incPath = []

plugPath = os.path.join(gbl.MMAdir, "plugins")

mmaStart = []
mmaEnd   = []
mmaRC    = None

def init():
    """ Called from main. In mma.py we checked for known directories and
        inserted the first found 'mma' directory into the sys.path list and
        set MMAdir. Now, set the lib/inc lists.
    """
    
    setLibPath([os.path.join(gbl.MMAdir, 'lib')], user=0)
    if not libPath or not os.path.isdir(libPath[0]):
        print("Warning: Library directory not found (check mma.py).")

    setIncPath([os.path.join(gbl.MMAdir, 'includes')])
    if not incPath or not os.path.isdir(incPath[0]):
        print("Warning: Include directory not found.")


##################################
# Set up the mma start/end paths

def mmastart(ln):
    """ Set/append to the mmastart list. """

    if not ln:
        error("Use: MMAstart FILE [file...]")

    for a in ln:
        gbl.mmaStart.append(MMA.file.fixfname(a))

    if gbl.debug:
        print("MMAstart set to: %s" % gbl.mmaStart)

def mmaend(ln):
    """ Set/append to the mmaend list. """

    if not ln:
        error("Use: MMAend FILE [file...]")

    for a in ln:
        gbl.mmaEnd.append(MMA.file.fixfname(a))

    if gbl.debug:
        print("MMAend set to: %s" % gbl.mmaEnd)

def setRC(f):
    """ Set a rc file from the command line."""
    
    global mmaRC

    mmaRC = f

######################################
# process the RC, mmastart and mmaend files. Called from main.py

def readRC():
    """ Process all RC files. """

    docOption = gbl.createDocs   # Disable doc printing for RC file
    gbl.createDocs = 0

    if mmaRC:
        rcfiles = [mmaRC]
    else:
        rcfiles = ('mmarc', 'c:\\mma\\mmarc', '~/.mmarc', '/usr/local/etc/mmarc', '/etc/mmarc')

    readDone = 0
    for i in rcfiles:
        f = MMA.file.locFile(i, None)
        if f:
            if gbl.showrun:
                print("Reading RC file '%s'" % f)
            MMA.parse.parseFile(f)
            readDone = 1
            break
        else:
            if mmaRC:
                error("Specified init file '%s' not found" % mmaRC)

    if not readDone and gbl.debug:
        gbl.lineno = -1
        warning("No RC file was found or processed")

    gbl.createDocs = docOption   # Restore doc options


def dommaStart():
    """ Process all the mma start files. """

    for f in mmaStart:
        fn = findIncFile(f)
        if not fn:
            warning("MmaStart file '%s' not found/processed" % f)
        else:
            MMA.parse.parseFile(fn)
        gbl.lineno = -1   # reset for real code


def dommaEnd():
    """ Process all the mma end files."""

    for f in mmaStart:
        fn = findIncFile(f)
        if not fn:
            warning("MmaStart file '%s' not found/processed" % f)
        else:
            MMA.parse.parseFile(fn)
        gbl.lineno = -1   # reset for real code


#######################################
# Search the paths for a file.


def findIncFile(fn):
    """ Find an INC file. Returns complete path or NULL."""

    global incPath

    for lib in incPath:
        path = MMA.file.locFile(fn, lib)
        if path:
            return path

    return None


def findLibFile(fn):
    """ Find a LIB file. Returns complete path or NULL."""

    global libDirs

    if not libDirs:
        expandLib()

    for lib in libDirs:
        path = MMA.file.locFile(fn, lib)
        if path:
            return path

    return None


##############################################
# Set up the lib/inc paths

def setLibPath(ln, user=1):
    """ Set the LibPath variable.  """

    global libPath, libDirs
    libPath = []
    libDirs = []

    for l in ln:
        f = MMA.file.fixfname(l)
        libPath.append(f)

    expandLib(user)

    if gbl.debug:
        print("LibPath set: %s" % ' '.join(libPath))


def expandLib(user=0):
    """ Expand the library paths from the list in libdir. """

    global libPath, libDirs

    scount = 0

    # Parse all the lib trees. Root trees are included into our list

    libDirs = []
    for f in libPath:
        for root, dir, files in os.walk(f):
            if root not in libDirs:
                if os.path.basename(root) == 'stdlib':
                    scount += 1
                    if not user:  # system init, stdlib goes first
                        libDirs.insert(0, root)
                    else:
                        libDirs.append(root)
                    continue
                libDirs.append(root)

    if not scount and not user:
        warning("Your library set does not have a 'stdlib'.")

    # forget about previously loaded mma lib databases

    MMA.auto.grooveDB = []

    if gbl.debug:
        print("LibPath expansion set to:", ' '.join(libDirs))


def setIncPath(ln):
    """ Set the IncPath variable.  """

    global incPath
    incPath = []

    for l in ln:
        f = MMA.file.fixfname(l)
        incPath.append(f)

    if gbl.debug:
        print("IncPath set: %s" % ' '.join(incPath))

###########################################
# Output pathname


def setOutPath(ln):
    """ Set the Outpath variable. """

    if not ln:
        gbl.outPath = ""

    elif len(ln) > 1:
        error("Use: SetOutPath PATH")

    else:
        gbl.outPath = MMA.file.fixfname(ln[0])

    if gbl.debug:
        print("OutPath set to '%s'" % gbl.outPath)


def createOutfileName(extension):
    """ Create the output filename.

       Called from the mainline, below and from lyrics karmode.

       If outfile was specified on cmd line then leave it alone.
       Otherwise ...
         1. strip off the extension if it is .mma,
         2. append .mid
   """

    global outfile

    if gbl.playFile and gbl.outfile:
        error("You cannot use the -f option with -P")

    if gbl.outfile:
        outfile = gbl.outfile

    elif gbl.playFile:
        outfile = "MMAtmp%s.mid" % os.getpid()
        MMA.exits.files.append(outfile)

    else:
        outfile, ext = os.path.splitext(gbl.infile)
        if ext != gbl.EXT:
            outfile = gbl.infile
        outfile += extension

    outfile = MMA.file.fixfname(outfile)

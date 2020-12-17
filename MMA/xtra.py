# xtra.py

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

Handle -x options.

"""

from common import *
from . import gbl
import macro
from MMA.lyric import lyric

def checkChords(clist):
    """ Take a list of chords passed on the command line and check them
        for validity.
    """

    gbl.ignoreBadChords=True
    okaylist = []
    for b in clist:
        try:
            MMA.chords.ChordNotes(b)
            okaylist.append(b)
        except:
            continue
    print ("VALID: %s" % ', '.join(okaylist))
    gbl.ignoreBadChords = False

def checkFile(l):
    """ Check a MMA input file an verify chords are valid. """

    # one could read a RC file. Insert MMA.paths.readRC()
    # here, but it's probably a silly thing to do since we
    # really aren't attempting a proper parse ...

    infile = MMA.file.locFile(l, None)  # filename to check
    if not infile:
        error("Input file '%s' not found." % l)
    inpath = MMA.file.ReadFile(infile)
    validChords = []

    while 1:
        curline = inpath.read()
        
        if curline == None:
            break

        # If we want to support macros, begin/end, etc. insert it all
        # here. Caution: it's a deep rabbit hole, best avoided

        # check the chords in the line. All lines must start with a line #
        # if not a line # we just skip to next line.
        if curline[0].isdigit():   # curline is a list 
            l = curline[1:]
            ##  A bar can have an optional repeat count. This must
            ##  be at the end of bar in the form '* xx'. Just strip it
            if len(l) > 1 and l[-2] == '*':
                l = l[:-2]

            # join into a string
            l = ' '.join(l)
            
            # extract/discard RIFFs. Note: Malformed riffs are NOT extracted
            # in real mma code the riff/lyric can appear anywhere ... this
            # so-called parsing code is much more simplistic. Here we cut the
            # line off at the first { or [.
            l  = l.partition('{')[0].partition('[')[0]
                
            l = l.split()  
            
            for c in l:
                if c in (None, '', 'z', '/', '/!'):
                    continue

                if c in validChords:
                    continue
                
                else:
                    try:
                        gbl.ignoreBadChords = True
                        MMA.chords.ChordNotes(c)
                        validChords.append(c)
                        gbl.ignoreBadChords = False
                    except:  # mma printed the error message so keep trucking
                        continue

    # summarize
    print("Valid chords: %s" % ', '.join(sorted(validChords)))
    sys.exit(0)
        
def xoption(opt, args):
    """ Xtra, seldom used, options """
    
    opt = opt.upper()

    if opt == 'NOCREDIT':
        gbl.noCredit = True
        return
        
    elif opt == 'CHORDS':
        # check a list of chords on the cmd line for validity
        if not args:
            MMA.options.usage()
        checkChords(args)
        sys.exit(0)   # don't return ... all we can do is the chords

    elif opt == 'CHECKFILE':
        # check a input file for valid chords
        if len(args) != 1:
            error("-xCheckFile: Exactly one filename required. Use '-xCheckFile <FILENAME>'.")
        checkFile(args[0])
        
    else:
        error("'%s' in an unknown -x option" % opt)
             

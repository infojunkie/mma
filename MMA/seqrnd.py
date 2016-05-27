# seqrnd.py

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

"""

import random

from MMA.common import *

""" SeqRnd variable is a list. The first entry is a flag:(0, 1 or x):
      0 - not set
      1 - set
      2 - set for specific tracks, track list starts at position [1]
"""

seqRnd = [0]       # set if SEQRND has been set
seqRndWeight = [1]


def setseq():
    """ Set up the seqrnd values, called from parse loop.


        returns:
           0...  a random sequence number,
           -1    signals that rndseq is not enabled.

        There are three methods of rndseq. They depend on the first value
        in the list seqRnd[]:

           [0]  not enabled.
           [1]  random selection, keeps all tracks in sync.
           [2]  randomize selected tracks.

        The list seqRndWeight has at least the same number of entries in it
        as there are in the sequence size. By default each will have
        the same value of 1. A list of the valid sequence points is
        generated (ie, if seqsize==4 tmp will be [0,1,2,3]). In addition
        the weights of each entry in tmp[] is adjusted by the weights in
        the seqrndweight[] list.
    """

    if seqRnd[0]:
        r = getrndseq(seqRndWeight)
        if seqRnd[0] == 1:
            gbl.seqCount = r
            r = -1
    else:
        r = -1

    return (r, seqRnd[1:])


def getrndseq(v):
    tmp = []
    for x, i in enumerate(v):
        tmp.extend([x] * i)

    if not len(tmp):
        error("SeqRndWeight has generated an empty list")

    return random.choice(tmp)


## Main parser routines

def setSeqRnd(ln):
    """ Set random order for all tracks. """

    global seqRnd
    
    emsg = "use [ON, OFF or TrackList ]"
    if not ln:
        error("SeqRnd:" + emsg)

    a = ln[0].upper()

    if a in ("ON", "1") and len(ln) == 1:
        seqRnd = [1]

    elif a in ("OFF", "0") and len(ln) == 1:
        seqRnd = [0]

    else:
        seqRnd = [2]
        for a in ln:
            a = a.upper()
            if not a in gbl.tnames:
                error("SeqRnd: Track '%s' does not exist, %s" % (a, emsg))
            if a in seqRnd:
                error("SeqRnd: Duplicate track '%s' specified, %s" % (a, emsg))
            seqRnd.append(a)

    if gbl.debug:
        msg = ["SeqRnd:"]
        if seqRnd[0] == 2:
            for a in seqRnd[1:]:
                msg.append(a)
        elif seqRnd[0] == 1:
            msg.append("On")
        else:
            msg.append("Off")
        print(' '.join(msg))


def getweights(ln, msg):

    ln = lnExpand(ln, msg)

    if not ln:
        error("Use: %s <weight factors>" % msg)

    tmp = []
    for n in ln:
        n = stoi(n)
        if n < 0:
            error("%s: Values must be 0 or greater" % msg)
        tmp.append(n)

    tmp = seqBump(tmp)

    if gbl.debug:
        print("%s: %s" % (msg, ' '.join([str(x) for x in tmp])))

    return tmp


def setSeqRndWeight(ln):
    """ Set global rnd weight. """

    global seqRndWeight

    seqRndWeight = getweights(ln, "SeqRndWeight")

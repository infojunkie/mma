# after.py

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

After storage, setting and command insertion.

"""

from . import gbl
from MMA.common import *

class AfterData:
    def __init__(self):
        self.bar = None
        self.cmd = None
        self.repeat = None
        self.count = None
        self.lineno = -1
        self.id = None

afterData = []

def set(ln):
    """ Set an After event. """

    global afterData

    dat = AfterData()
    selected = []

    ln, opts = opt2pair(ln, toupper=False)

    for cmd, opt in opts:
        cmd = cmd.upper()
        if cmd == 'BAR':
            if opt.upper() == 'EOF':
                dat.bar = 'EOF'
            else:
                opt = stoi(opt)
                if opt < 1:
                    error("After: Destination bar must be positive, not '%s'." % opt)
                    dat.bar = opt
            selected.append('Bar')
                
        elif cmd == 'REPEAT':
            opt = stoi(opt)
            if opt < 1:
                error("After: Repeat value must be positive, not '%s'." % opt)
            dat.repeat = opt
            dat.bar = opt + gbl.barNum 
            selected.append('Repeat')

        elif cmd == 'COUNT':
            opt = stoi(opt)
            if opt < 1:
                error("After: Count must be positive, not '%s'." % opt)
            dat.count = opt
            dat.bar = opt + gbl.barNum 
            selected.append('Count')

        elif cmd == 'ID':   # set a string id for this event. 
            dat.id = opt.upper()

        elif cmd == 'REMOVE':  # delete all saved items with id==opt.
            t=len(afterData)
            afterData = [ x for x in afterData if x.id != opt.upper() ]
            if len(opts) > 1 or ln:
                warning("After: Remove is ignoring other options/cmds in line.")
            if len(afterData) == t:
                warning("After: No events with ID=%s found to delete." % opt)
            return   # ignore any other commands

        else:
            error("After: Unknown option '%s'." % cmd)


    if not ln:
        error("After: No command given. It's needed.")

    if len(selected) == 0:
        error("After: need one of 'Count', 'Bar', or 'Repeat'.")

    if len(selected) > 1:
        error("After: Options conflict; can't combine %s." % ' & '.join(selected))

    dat.cmd  = ln
    dat.lineno = gbl.lineno

    if dat.bar == 'EOF':
         gbl.inpath.pushEOFline(dat.cmd)
    else:
        afterData.append(dat)

    if gbl.debug:
        print("After: Added event '%s' at bar %s." % (' '.join(dat.cmd), dat.bar))

def check():
    """ Before reading any input, we check to see if any AFTER events have been
        created and if we need to process them now. 
    """

    global afterData
    stuff = []
    elns = []

    nn = gbl.barNum
    for dat in afterData:
        if dat.bar == nn:
            stuff.append(dat.cmd)
            elns.append(dat.lineno)
            if dat.repeat:
                dat.bar = gbl.barNum + dat.repeat

    if stuff:
        # Push our AFTER command to input.
        gbl.inpath.push(stuff, elns)

        # delete any discarded AFTER events
        afterData = [ x for x in afterData if x.bar != nn]


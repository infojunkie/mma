# func.py

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

   Define and execute simple function / subroutine calls.

"""

import copy
from . import gbl
import MMA.file
from MMA.common import *

# Storage for our functions 
class Funcs:
    def __init__(self, params, body):
        self.params = params
        self.body = body
        
funcList = {}

########################

def defCall(l):
    """ Define a function.  """

    if len(l) < 1:
        error("DefCall: At least one argument (name) is needed.")
        
    # Grab 1st arg. This is the function name
    fname = l[0].strip().upper()
    
    # The params are split into words. Join together just so we can
    # take it apart again. Needed to use ',' delimiters
    p = ' '.join(l[1:]).split(',')
    
    # Convert the param names so they have a leading '$'. The '$'
    # is not permitted in a param name.
    params = []
    for a in p:
        a = a.strip()
        if not a:
            continue
        if '$' in a:
            error("DefCall: '$' is not permitted in paramater name.")
        a = '$'+a.upper()
        if a in params:
            error("DefCall: '%s' is a duplicate paramater name." % a)
        params.append(a)
    
    body = []
    while 1:
        ln = gbl.inpath.read()
        if not ln:
            error("DefCall: Reached EOF while looking for EndDefCall.")
        cmd = ln[0].upper()
        if cmd in ("DEFCALLEND", 'ENDDEFCALL'):
            if len(ln) > 1:
                error("DefCall: No arguments permitted for DefCallEnd/EndDefCall.")
            else:
                break
        body.append(ln)

    funcList[fname] = Funcs(params, body)
    
    if gbl.debug:
        t = [ a[1:] for a in params]
        print("DefCall: Created function '%s': %s" % (fname, ', '.join(t)))


def callFunction(l):
    """ Call a function. """

    if len(l) < 1:
        error("DefCall: At least one argument (name) is needed.")

    fname = l[0].strip().upper()
    
    if fname not in funcList:
        error("Call: '%s' has not been defined." % fname)

    # Convert any escaped '\,' into $ff
    p = ' '.join(l[1:])
    p = p.replace('\,', chr(255))
                 
    # The params are split into words. Join together just so we can
    # take it apart again. Needed to use ',' delimiters for multi word args
    p = p.split(',')

    # Validate calling params
    callParams = []
    for a in p:
        a = a.strip()
        if a:  # new list of params, commas restored
            callParams.append(a.replace(chr(255), ','))
        
    params = funcList[fname].params

    if len(params) != len(callParams):
           error("Call: Function '%s' needs %s params, '%s' given." % \
                 (fname, len(params), len(callParams)))

    # Insert passed params into the function body.
    body = copy.deepcopy(funcList[fname].body)
    for l in body:
        for i,a in enumerate(l):
            try:
                t = params.index(a.upper())
                l[i] = callParams[t]
            except:
                pass

    # push the converted body lines into the input stream
    gbl.inpath.push(body, [gbl.lineno] * len(body)) 

    if gbl.debug:
        print ("Call: function '%s' expanded." % fname)



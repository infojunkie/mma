# harmony.py

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

from MMA.common import *
import MMA.debug

def setHarmony(self, ln):
    """ Set the harmony. """

    ln = lnExpand(ln, '%s Harmony' % self.name)
    tmp = []

    for n in ln:
        n = n.upper()
        if n in ('-', '0', 'NONE'):
            n = None

        tmp.append(n)

    self.harmony = seqBump(tmp)

    if self.vtype in ('CHORD', 'DRUM'):
        warning("Harmony setting for %s track ignored" % self.vtype)

    if gbl.debug:
        MMA.debug.trackSet(self.name, "Harmony")


def setHarmonyOnly(self, ln):
    """ Set the harmony only. """

    ln = lnExpand(ln, '%s HarmonyOnly' % self.name)
    tmp = []

    for n in ln:
        n = n.upper()
        if n in ('-', '0', 'NONE'):
            n = None

        tmp.append(n)

    self.harmony = seqBump(tmp)
    self.harmonyOnly = seqBump(tmp)

    if self.vtype in ('CHORD', 'DRUM'):
        warning("HarmonyOnly setting for %s track ignored" % self.vtype)

    if gbl.debug:
        MMA.debug.trackSet(self.name, 'HarmonyOnly')


def setHarmonyVolume(self, ln):
    """ Set harmony volume adjustment. """

    ln = lnExpand(ln, '%s HarmonyOnly' % self.name)
    tmp = []

    for n in ln:
        v = stoi(n)

        if v < 0:
            error("HarmonyVolume adjustment must be positive integer")
        tmp.append(v/100.)

    self.harmonyVolume = seqBump(tmp)

    if self.vtype in ('PLECTRUM', 'DRUM'):
        warning("HarmonyVolume adjustment for %s track ignored" % self.vtype)

    if gbl.debug:
        MMA.debug.trackSet(self.name, "HarmonyVolume")


##########################################################

def harmonize(hmode, note, chord):
    """ Get harmony note(s) for given chord. """

    hnotes = []

    for tp in hmode.split('+'):

        if tp in ('2', '2BELOW'):
            hnotes.append(gethnote(note, chord))

        elif tp == '28Below':
            hnotes.append(gethnote(note, chord)-12)

        elif tp == '2ABOVE':
            hnotes.append(gethnote(note, chord)+12)

        elif tp == '28ABOVE':
            hnotes.append(gethnote(note, chord)+24)

        elif tp in ('3', '3BELOW'):
            a = gethnote(note, chord)
            b = gethnote(a, chord)
            hnotes.extend([a, b])

        elif tp == '38BELOW':
            a = gethnote(note, chord)
            b = gethnote(a, chord)
            hnotes.extend([a-12, b-12])

        elif tp == '3ABOVE':
            a = gethnote(note, chord)
            b = gethnote(a, chord)
            hnotes.extend([a+12, b+12])

        elif tp == '38ABOVE':
            a = gethnote(note, chord)
            b = gethnote(a, chord)
            hnotes.extend([a+24, b+24])

        elif tp in ('OPEN', "OPENBELOW"):
            a = gethnote(note, chord)
            hnotes.append(gethnote(a, chord))

        elif tp == 'OPEN8BELOW':
            a = gethnote(note, chord)
            hnotes.append(gethnote(a-12, chord))

        elif tp == 'OPENABOVE':
            a = gethnote(note, chord)
            hnotes.append(gethnote(a, chord) + 12)
 
        elif tp == 'OPEN8ABOVE':
            a = gethnote(note, chord)
            hnotes.append(gethnote(a, chord) + 24)

        elif tp in ('8', '8BELOW'):
            hnotes.append(note - 12)

        elif tp == '8ABOVE':
            hnotes.append(note + 12)

        elif tp in ('16', '16BELOW'):
            hnotes.append(note - (2 * 12))

        elif tp == '16ABOVE':
            hnotes.append(note + (2 * 12))

        elif tp in ('24', '24BELOW'):
            hnotes.append(note - (3 * 12))

        elif tp == '24ABOVE':
            hnotes.append(note + (3 * 12))
        else:
            error("Unknown harmony type '%s'" % tp)

    """ Strip out duplicate notes from harmony list.
        Cute trick here ... using set().
    """

    return list(set(hnotes))


def gethnote(note, chord):
    """ Determine harmony notes for a note based on the chord.

        note - midi value of the note

        chord - list of midi values for the chord


        This routine works by creating a chord list with all
        its notes having a value less than the note (remember, this
        is all MIDI values). We then grab notes from the end of
        the chord until one is found which is less than the original
        note.
    """

    wm = "No harmony note found since no chord, using note " \
         "0 which will sound bad"

    if not chord:        # should never happen!
        warning(wm)
        return 0

    ch = list(chord)    # copy chord and sort
    ch.sort()

    # ensure that the note is in the chord

    while ch[-1] < note:
        for i, n in enumerate(ch):
            ch[i] += 12

    while ch[0] >= note:
        for i, v in enumerate(ch):
            ch[i] -= 12

    # get one lower than the note

    while 1:
        if not ch:            # this probably can't happen
            warning(wm)
            return 0

        h = ch.pop()
        if h < note:
            break

    return h

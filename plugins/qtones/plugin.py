
# qtone. 
# parse a solo note string and break it into 3 lines:
#   line 1 - western notes
#   line 2 - quarter tone flats
#   line 3 - quarter tone sharps

# We import the plugin utilities

from MMA import pluginUtils as pu
import re

# ###################################
# # Documentation and arguments     #
# ###################################

# Minimum MMA required version.
pu.setMinMMAVersion(15, 12)

# A short plugin description.
pu.setDescription("Separated quarter tone solo lines into 3 parts.")

# A short author line.
pu.setAuthor("Written by bvdp.")

# rest of doc is left for later!!!!!!!!!!!!!!!!""")
pu.setPluginDoc("""Docs? What docs?""")
    

# ###################################
# # Entry points                    #
# ###################################

def printUsage():
    pu.printUsage()


# Convert a line like:
#  qtone            4c+;c+**;8b;a%%;b;c+;
# into
#  solo Riff        4c+;4r;8b;r;b;c+;
#  solo-qflat riff  4r;r;8r;a;r;;
#  solo-qsharp riff 4r;c+;8r;;;;


def note2rest(n):
    return re.sub('[abcdefg\+-]+', 'r', '4a+')
    

def run(line):
    """ Entry point. """

    out1 = ["Solo Riff  "]
    out2 = ["Solo-qflat Riff  "]
    out3 = ["Solo-qsharp Riff  "]

    line = ''.join(line)
    for a in line.split(';'):
        if not ']' in a:
            attr, note = ('', a)
        else:
            attr, note = a.split(']', 1)

        # we now have just the note info to worry about. The stuff in []
        # is tucked away in 'attr'.

        if '%%' in note:
            flatNote = attr + note.replace('%%', '')
            normNote = attr + note2rest(note)
            sharpNote = attr + note2rest(note)

        elif '**' in note:
            sharpNote = attr + note.replace('**', '')
            normNote = attr + note2rest(note)
            flatNote = attr + note2rest(note)

        else:
            sharpNote = attr + note2rest(note)
            flatNote = attr + note2rest(note)
            normNote = attr + note


        out1.extend([normNote,  ';' ])
        out2.extend([flatNote,  ';' ])
        out3.extend([sharpNote, ';' ])


    pu.addCommand( ''.join(out1) )
    pu.addCommand( ''.join(out2) )
    pu.addCommand( ''.join(out3) )

    pu.sendCommands()

/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of the command jump tables at the end of MMA/parse.py
 * (simpleFuncs / trackFuncs) into a DirectiveRegistry.  Every name from
 * the Python tables is registered; commands that are not part of this
 * milestone throw a clear error instead of silently doing nothing.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../engine/Context';
import type { MacroExpander } from './MacroExpander';
import { getTrack, type TrackApi } from './TrackApi';
import type { BaseTrack } from '../model/tracks/BaseTrack';
import { trackCopy } from '../directives/track/Copy';
import type { DebugState } from '../directives/simple/Debug';

import { setDebug } from '../directives/simple/Debug';
import { setTime, tempo, beatAdjust } from '../directives/simple/Tempo';
import {
  seq,
  seqClear,
  seqsize,
  setSeqRnd,
  setSeqRndWeight,
} from '../directives/simple/Sequence';
import { defAlias, defGroove, groove, grooveClear, trackGroove } from '../directives/simple/Grooves';
import { chordAdjust, defChord, docAuthor, docNote, docVars, eof, forceError, goto, lnPrint, midiFile, rndseed, transpose } from '../directives/simple/Misc';
import { adjVolume, setCrescendo, setSwell, setVolume } from '../directives/simple/Volume';
import { swingMode } from '../directives/simple/Swing';
import {
  trackAccent,
  trackArtic,
  trackChannel,
  trackChordLimit,
  trackChords,
  trackCompress,
  trackDelay,
  trackDirection,
  trackDupRoot,
  trackInvert,
  trackMallet,
  trackMidiClear,
  trackMidiSeq,
  trackMidiVoice,
  trackMOctave,
  trackOctave,
  trackOff,
  trackOn,
  trackRange,
  trackRduration,
  trackRskip,
  trackRtime,
  trackSticky,
  trackStrum,
  trackStrumAdd,
  trackSpan,
  trackTone,
  trackUnify,
  trackVoice,
  trackVoicing,
  trackVolume,
  trackRvolume,
  trackScaletype,
} from '../directives/track/Track';
import { trackDefPattern, trackSeqClear, trackSeqRnd, trackSeqRndWeight, trackSequence } from '../directives/track/Patterns';

export type SimpleHandler = (ctx: MMAContext, args: string[]) => void | Promise<void>;
export type TrackHandler = (ctx: MMAContext, track: TrackApi, args: string[]) => void | Promise<void>;

/** Services the registry needs from the Parser (file loading). */
export interface DirectiveHost {
  ctx: MMAContext;
  expander: MacroExpander;
  debugState: DebugState;
  /** INCLUDE: resolve and parse a file. */
  includeFile(name: string): Promise<void>;
  /** USE: resolve, push a groove slot, parse and restore. */
  useFile(name: string): Promise<void>;
}

export class DirectiveRegistry {
  readonly simple = new Map<string, SimpleHandler>();
  readonly track = new Map<string, TrackHandler>();

  constructor(private readonly host: DirectiveHost) {
    const ctx = host.ctx;
    const exp = host.expander;

    const notImpl =
      (name: string): SimpleHandler =>
      (c: MMAContext): void => {
        c.error(`${name} is not implemented in this milestone (M1).`);
      };
    const trackNotImpl =
      (name: string): TrackHandler =>
      (c: MMAContext): void => {
        c.error(`${name} is not implemented in this milestone (M1).`);
      };

    const simple = this.simple;
    const register = (name: string, fn: SimpleHandler): void => {
      simple.set(name, fn);
    };

    // --- macros (macro.py) ------------------------------------------------
    register('SET', (c, a) => exp.setvar(a));
    register('NEWSET', (c, a) => exp.newsetvar(a));
    register('MSET', (c, a) => exp.msetvar(a));
    register('UNSET', (c, a) => exp.unsetvar(a));
    register('INC', (c, a) => exp.varinc(a));
    register('DEC', (c, a) => exp.vardec(a));
    register('RNDSET', (c, a) => exp.rndvar(a));
    register('VEXPAND', (c, a) => exp.vexpand(a));
    register('VARCLEAR', (c, a) => exp.clear(a));
    register('SHOWVARS', (c, a) => exp.showvars(a));
    register('STACKVALUE', (c, a) => exp.stackValue(a));
    register('IF', (c, a) => exp.varIF(a));
    register('REPEAT', (c, a) => exp.repeat(a));

    // --- do-nothing / block terminators (parse.py) ------------------------
    register('COMMENT', () => {});
    register('LABEL', () => {});
    register('ENDIF', (c) => c.error('ENDIF without IF'));
    register('IFEND', (c) => c.error('ENDIF without IF'));
    register('ELSE', (c) => c.error('ELSE without IF'));
    register('ENDMSET', (c) => c.error('EndMset/MSetEnd without Mset'));
    register('MSETEND', (c) => c.error('EndMset/MSetEnd without Mset'));
    register('ENDREPEAT', (c) => c.error('Repeatend/EndRepeat without Repeat'));
    register('REPEATEND', (c) => c.error('Repeatend/EndRepeat without Repeat'));
    register('REPEATENDING', (c) => c.error('Repeatending without Repeat'));

    // --- timing (tempo.py) ------------------------------------------------
    register('TIME', (c, a) => setTime(c, a));
    register('TEMPO', (c, a) => tempo(c, a));
    register('BEATADJUST', (c, a) => beatAdjust(c, a));
    register('TIMESIG', (c, a) => c.timeSig.setSig(a));
    register('KEYSIG', (c, a) => c.keySig.create(a));
    register('TRANSPOSE', (c, a) => transpose(c, a));

    // --- sequences (sequence.py / seqrnd.py) ------------------------------
    register('SEQ', (c, a) => seq(c, a));
    register('SEQCLEAR', (c, a) => seqClear(c, a));
    register('SEQSIZE', (c, a) => seqsize(c, a));
    register('SEQRND', (c, a) => setSeqRnd(c, a));
    register('SEQRNDWEIGHT', (c, a) => setSeqRndWeight(c, a));

    // --- grooves (grooves.py) ---------------------------------------------
    register('DEFGROOVE', (c, a) => defGroove(c, a));
    register('DEFALIAS', (c, a) => defAlias(c, a));
    register('GROOVE', (c, a) => groove(c, a));
    register('GROOVECLEAR', (c, a) => grooveClear(c, a));

    // --- files ------------------------------------------------------------
    register('INCLUDE', async (c, a) => {
      if (ctx.beginData.length) c.error('INCLUDE not permitted in Begin/End block');
      if (a.length !== 1) c.error('Use: Include FILE');
      await host.includeFile(a[0]!);
    });
    register('USE', async (c, a) => {
      if (ctx.beginData.length) c.error('USE not permitted in Begin/End block');
      if (a.length !== 1) c.error('Use: Use FILE');
      await host.useFile(a[0]!);
    });

    // --- misc -------------------------------------------------------------
    register('RNDSEED', (c, a) => rndseed(c, a));
    register('PRINT', (c, a) => lnPrint(c, a));
    register('DEBUG', (c, a) => setDebug(c, host.debugState, a));
    register('MIDIFILE', (c, a) => midiFile(c, a));
    register('CHORDADJUST', (c, a) => chordAdjust(c, a));
    register('DEFCHORD', (c, a) => defChord(c, a));
    register('ERROR', (c, a) => forceError(c, a));
    register('GOTO', (c, a) => goto(c, a));
    register('EOF', (c, a) => eof(c, a));
    register('DOC', (c, a) => docNote(c, a));
    register('DOCVAR', (c, a) => docVars(c, a));
    register('AUTHOR', (c, a) => docAuthor(c, a));
    register('SWINGMODE', (c, a) => swingMode(c, a));
    register('VOLUME', (c, a) => setVolume(c, a));
    register('ADJUSTVOLUME', (c, a) => adjVolume(c, a));
    register('CRESC', (c, a) => setCrescendo(c, 1, a));
    register('DECRESC', (c, a) => setCrescendo(c, -1, a));
    register('SWELL', (c, a) => setSwell(c, a));

    // --- simple commands not in this milestone ----------------------------
    for (const name of [
      'AFTER',
      'ALLGROOVES',
      'AUTHOR',
      'AUTOSOLOTRACKS',
      'CALL',
      'CHANNELPREF',
      'CMDLINE',
      'CUT',
      'DEFCALL',
      'DELETE',
      'DOC',
      'DOCVAR',
      'DRUMVOLTR',
      'FERMATA',
      'LYRIC',
      'MIDIDEF',
      'MIDI',
      'MIDICOPYRIGHT',
      'MIDICUE',
      'MIDIINC',
      'MIDIVOLUME',
      'MIDICRESC',
      'MIDIDECRESC',
      'CHANNELINIT',
      'MIDIMARK',
      'MIDISPLIT',
      'MIDITEXT',
      'MIDITNAME',
      'MMAEND',
      'MMASTART',
      'PATCH',
      'PLUGIN',
      'PRINTACTIVE',
      'PRINTCHORD',
      'RESTART',
      'SETINCPATH',
      'SETLIBPATH',
      'SETMIDIPLAYER',
      'SETOUTPATH',
      'SETPLUGPATH',
      'SETSYNCTONE',
      'SYNCHRONIZE',
      'TONETR',
      'TRUNCATE',
      'TWEAKS',
      'VOICEVOLTR',
      'VOICETR',
    ]) {
      if (!simple.has(name)) register(name, notImpl(name));
    }

    // --- track commands ---------------------------------------------------
    const track = this.track;
    const reg = (name: string, fn: TrackHandler): void => {
      track.set(name, fn);
    };

    reg('DEFINE', (c, t, a) => trackDefPattern(c, t, a));
    reg('SEQUENCE', (c, t, a) => trackSequence(c, exp, t, a, host.debugState.seqshow));
    reg('SEQCLEAR', (c, t, a) => trackSeqClear(c, t, a));
    reg('SEQRND', (c, t, a) => trackSeqRnd(c, t, a));
    reg('SEQRNDWEIGHT', (c, t, a) => trackSeqRndWeight(c, t, a));
    reg('GROOVE', (c, t, a) => trackGroove(c, t, a));

    reg('ACCENT', trackAccent);
    reg('ARTICULATE', trackArtic);
    reg('CHANNEL', trackChannel);
    reg('CHORDS', trackChords);
    reg('COMPRESS', trackCompress);
    reg('DELAY', trackDelay);
    reg('DIRECTION', trackDirection);
    reg('DUPROOT', trackDupRoot);
    reg('INVERT', trackInvert);
    reg('LIMIT', trackChordLimit);
    reg('MALLET', trackMallet);
    reg('MIDICLEAR', trackMidiClear);
    reg('MIDISEQ', trackMidiSeq);
    reg('MIDIVOICE', trackMidiVoice);
    reg('MOCTAVE', trackMOctave);
    reg('OCTAVE', trackOctave);
    reg('OFF', trackOff);
    reg('ON', trackOn);
    reg('RANGE', trackRange);
    reg('RDURATION', trackRduration);
    reg('RSKIP', trackRskip);
    reg('RTIME', trackRtime);
    reg('RVOLUME', trackRvolume);
    reg('SCALETYPE', trackScaletype);
    reg('NOTESPAN', trackSpan);
    reg('STRUM', trackStrum);
    reg('STRUMADD', trackStrumAdd);
    reg('STICKY', trackSticky);
    reg('TONE', trackTone);
    reg('UNIFY', trackUnify);
    // Port of parse.allTracks: apply a track command to all tracks of
    // the given types (default: the pattern tracks).
    register('ALLTRACKS', async (c, a) => {
      const types1 = ['BASS', 'CHORD', 'ARPEGGIO', 'SCALE', 'DRUM', 'WALK', 'PLECTRUM'];
      const allTypes = [...types1, 'MELODY', 'SOLO', 'ARIA'];
      if (!a.length) c.error('AllTracks: Requires arguments: [Track | Track-Name] command.');
      let i = 0;
      const ttypes: string[] = [];
      while (i < a.length && allTypes.includes(a[i]!.toUpperCase())) {
        ttypes.push(a[i]!.toUpperCase());
        i += 1;
      }
      if (ttypes.length === 0) ttypes.push(...types1);
      if (i >= a.length) c.error('AllTracks: A command is required after the Track or Track-Name.');
      const cmd = a[i]!.toUpperCase();
      const fn = this.track.get(cmd);
      if (!fn) {
        c.error(`AllTracks: command '${cmd}' doen't exist`);
        return;
      }
      for (const t of c.tnames.values()) {
        if (!ttypes.includes(t.vtype)) continue;
        await fn(c, getTrack(c, t.name), a.slice(i + 1));
      }
    });

    reg('COPY', (c, t, a) => trackCopy(c, t as unknown as BaseTrack, a));
    reg('VOICE', trackVoice);
    reg('VOICING', trackVoicing);
    reg('VOLUME', trackVolume);

    for (const name of [
      'ARPEGGIATE',
      'DUPRIFF',
      'MIDIVOLUME',
      'MIDICRESC',
      'MIDIDECRESC',
      'CHSHARE',
      'CRESC',
      'CUT',
      'DECRESC',
      'DRUMTYPE',
      'FORCEOUT',
      'FRETNOISE',
      'HARMONY',
      'HARMONYONLY',
      'HARMONYVOLUME',
      'MIDICUE',
      'MIDIDEF',
      'MIDIGLIS',
      'MIDIPAN',
      'MIDITEXT',
      'MIDITNAME',
      'MIDIWHEEL',
      'ORNAMENT',
      'TUNING',
      'CAPO',
      'SHAPE',
      'RESTART',
      'RIFF',
      'RPITCH',
      'STRETCH',
      'SWELL',
      'TRIGGER',
      'MIDINOTE',
    ]) {
      reg(name, trackNotImpl(name));
    }
  }
}

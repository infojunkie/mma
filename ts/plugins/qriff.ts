/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * qriff plugin: port of plugins/qriff/plugin.py by bvdp.  Converts a
 * solo/melody riff line with quarter-tone notes (written with '%' for
 * flat and '*' for sharp) into three riff lines: the original track
 * (quarter tones become rests), a "-qFlat" track and a "-qSharp" track.
 *
 * Python keeps `tuningSet` and the two generated track names in module
 * globals; a module-global would leak between MMA runs in the browser,
 * so they live on the plugin object.  Use createQriffPlugin() for a
 * fresh instance (tests), qriffPlugin for the usual singleton.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { IMMAPlugin, PluginContext } from '../src/plugin/IMMAPlugin';
import { PluginSpec } from '../src/plugin/pluginUtils';

/** Replace note information with a single 'r' (rest). */
function note2rest(n: string): string {
  return n.replace(/[abcdefg+#&-]+/g, 'r').replace(/%/g, '').replace(/\*/g, '');
}

export class QriffPlugin implements IMMAPlugin {
  readonly name = 'qriff';
  readonly description = 'Separate quarter tone solo riff lines into 3 parts.';
  readonly author = 'Written by bvdp.';

  private readonly pu = new PluginSpec('qriff');
  private tuningSet = false;
  private fTrack = '';
  private sTrack = '';

  constructor() {
    this.pu.setDescription(this.description);
    this.pu.setAuthor(this.author);
    this.pu.setTrackType('Solo');
    this.pu.addArgument('valid riff data', null, '');
    this.pu.setPluginDoc(`QRiff ... convert a solo line into quarter tones.

This plugin will convert a solo riff line into 3 separate solo lines:
   Solo - the original track. It can be custom name like "Solo-Foo".
          Any quarter tone notes are replaced by rests.
   Solo-qFlat - the quarter tone flat notes.
   Solo-qSharp - the quarter tone sharp notes.

NOTE: Don't try to have chords in your riff line. It doesn't work!
      Use only single notes!!!!

To specify quarter tone flats and sharps use a single '%' or '*'.
`);
  }

  help(): string {
    return this.pu.printUsage();
  }

  private setTuning(trk: string, pctx: PluginContext): void {
    this.fTrack = `${trk}-qFlat`;
    this.sTrack = `${trk}-qSharp`;

    if (this.tuningSet) return;

    // Python checks `if not <name>.upper() in gbl.tnames` before
    // allocating; the map keys are the names as allocated.
    if (!pctx.tracks.has(this.fTrack.toUpperCase())) {
      pctx.ensureTrack(this.fTrack);
      this.pu.addCommand(`${this.fTrack} Copy ${trk}`);
    }

    if (!pctx.tracks.has(this.sTrack.toUpperCase())) {
      pctx.ensureTrack(this.sTrack);
      this.pu.addCommand(`${this.sTrack} Copy ${trk}`);
    }

    this.pu.addCommand(`${this.fTrack} MidiNote PB 0 -2048`);
    this.pu.addCommand(`${this.sTrack} MidiNote PB 0 2048`);
    this.pu.addCommand(`After Bar=EOF ${this.fTrack} MidiNote PB 0 0`);
    this.pu.addCommand(`After Bar=EOF ${this.sTrack} MidiNote PB 0 0`);
    this.pu.sendCommands(pctx);

    this.tuningSet = true;
  }

  trackRun(track: string, args: string[], pctx: PluginContext): void {
    const ctx = pctx.context;

    // Python checks the minimum version at module import.
    this.pu.setMinMMAVersion(ctx, 15, 12);

    // We check if the track type is correct.
    this.pu.checkTrackType(ctx, track);

    // Initialize tracks 2 and 3.
    this.setTuning(track, pctx);

    const out1 = [`${track} Riff  `];
    const out2 = [`${this.fTrack} Riff  `];
    const out3 = [`${this.sTrack} Riff  `];

    const line = args.join('').slice(0, -1);

    for (const a of line.split(';')) {
      let attr: string;
      let note: string;
      if (!a.includes(']')) {
        attr = '';
        note = a;
      } else {
        const idx = a.indexOf(']');
        attr = a.slice(0, idx);
        note = a.slice(idx + 1);
      }

      // We now have just the note info to worry about.  The stuff in []
      // is tucked away in 'attr'.
      let normNote: string;
      let flatNote: string;
      let sharpNote: string;
      if (note.includes('%')) {
        flatNote = attr + note.replace(/%/g, '');
        normNote = attr + note2rest(note);
        sharpNote = attr + note2rest(note);
      } else if (note.includes('*')) {
        sharpNote = attr + note.replace(/\*/g, '');
        normNote = attr + note2rest(note);
        flatNote = attr + note2rest(note);
      } else {
        sharpNote = attr + note2rest(note);
        flatNote = attr + note2rest(note);
        normNote = attr + note;
      }

      out1.push(normNote, ';');
      out2.push(flatNote, ';');
      out3.push(sharpNote, ';');
    }

    this.pu.addCommand(out1.join(''));
    this.pu.addCommand(out2.join(''));
    this.pu.addCommand(out3.join(''));

    if (ctx.debug.debug) {
      console.log(out1.join(''));
      console.log(out2.join(''));
      console.log(out3.join(''));
    }

    this.pu.sendCommands(pctx);
  }
}

export function createQriffPlugin(): QriffPlugin {
  return new QriffPlugin();
}

export const qriffPlugin = new QriffPlugin();

export default qriffPlugin;

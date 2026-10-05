/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/midiIn.py: the MIDIINC command imports a Standard MIDI
 * File into MMA tracks - either as raw events on a track's MIDI channel,
 * as Riff data (MELODY/SOLO tracks), or as a dynamically defined
 * Sequence (sequence mode).
 *
 * File loading goes through the resource layer (ctx.resources): the
 * candidate list mirrors the rest of the engine - the MIDI name is
 * resolved against the directory of the file that issued the command,
 * then as-is.  The Python original opens the path cwd-relative, so a
 * corpus entry runs with cwd set to the song's directory.
 *
 * Original Python module by Bob van der Poel <bob@mellowood.ca>.
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import type { MacroExpander } from '../../parse/MacroExpander';
import { MidiData } from '../../midi/MidiData';
import { packBytes } from '../../midi/ByteWriter';
import { normalizeResourceId } from '../../io/MMAResources';
import { getTF, opt2pair, stof, stoi, stotick } from '../../util/Common';
import { trackAlloc } from '../../model/tracks/alloc';
import { getTrack } from '../../parse/TrackApi';
import { trackSequence } from '../track/Patterns';

/** One parsed CHANNEL=<n>[,riff|,sequence|,print] destination. */
interface ChannelImport {
  track: string;
  /** 0-based MIDI channel. */
  channel: number;
  /** 0 = raw events, 1 = Riff, 2 = Sequence. */
  riffmode: number;
  printriff: boolean;
}

/** Port of MMA/file.fixfname for resource ids (no ~ expansion in a browser). */
function fixfname(f: string): string {
  return f.replace(/\\x20/g, ' ');
}

/** Port of midiIn.midiinc. */
export async function midiInc(
  ctx: MMAContext,
  expander: MacroExpander,
  input: string[],
): Promise<void> {
  let filename = '';
  let doLyric = false;
  let doText = false;
  const channels: ChannelImport[] = [];
  let transpose: number | null = null;
  // Important! Don't use true/1 since positive numbers are meaningful.
  let stripSilence: boolean | number = -1;
  let report = false;
  let istart = 0; // istart/iend are in ticks ...
  let iend = 0xffffff; // ... but are set from options in Beats
  let insertOffset = 0; // where in the current stream to insert
  let verbose = false;
  let octAdjust = 0;
  let velAdjust = 100;
  let ignorePC = true; // ignore imported PC commands before insert point
  let stretch: number | null = null;

  const [notopt, ln] = opt2pair(input);

  if (notopt.length) {
    ctx.error(`MidiInc: Expecting cmd=opt pairs, not '${notopt.join(' ')}'.`);
  }

  for (const { option, value: opt } of ln) {
    const cmd = option.toUpperCase();

    if (cmd === 'FILE') {
      filename = fixfname(opt);
    } else if (cmd === 'VOLUME') {
      velAdjust = stoi(ctx.rep, opt);
    } else if (cmd === 'OCTAVE') {
      octAdjust = stoi(ctx.rep, opt);
      if (octAdjust < -4 || octAdjust > 4) {
        ctx.error(`MidiInc: 'Octave' adjustment must be -4 to 4, not ${opt}`);
      }
      octAdjust *= 12;
    } else if (cmd === 'TRANSPOSE') {
      transpose = stoi(ctx.rep, opt);
      if (transpose < -24 || transpose > 24) {
        ctx.error(`MidiInc: 'Transpose' must be -24 to 24, not ${opt}`);
      }
    } else if (cmd === 'START') {
      istart = stotick(ctx.rep, ctx, opt, 'B', `MidiInc Start: '${opt}' is not recognized.`);
      if (istart < 0) ctx.error("MidiInc: 'Start' must be > 0.");
    } else if (cmd === 'END') {
      iend = stotick(ctx.rep, ctx, opt, 'B', `MidiInc End: '${opt}' is not recognized.`);
      if (iend < 0) ctx.error("MidiInc: 'End' must be > 0.");
    } else if (cmd === 'OFFSET') {
      insertOffset = stotick(ctx.rep, ctx, opt, 'B', `MidiInc Offset: '${opt}' is not recognized.`);
      if (ctx.tickOffset + insertOffset < 0) {
        ctx.error("MidiInc: 'Offset' cannot point before start.");
      }
    } else if (cmd === 'TEXT') {
      doText = getTF(ctx.rep, opt, "MidiInc 'Text'");
    } else if (cmd === 'LYRIC') {
      doLyric = getTF(ctx.rep, opt, "MidiInc 'Lyric'");
    } else if (cmd === 'REPORT') {
      report = getTF(ctx.rep, opt, "MidiInc 'Report'");
    } else if (cmd === 'VERBOSE') {
      verbose = getTF(ctx.rep, opt, "MidiInc 'Verbose'");
    } else if (cmd === 'STRIPSILENCE') {
      const o = opt.toUpperCase();
      if (o === 'OFF' || o === 'FALSE' || o === '0') {
        stripSilence = false;
      } else if (o === 'TRUE' || o === 'ON') {
        stripSilence = -1; // Don't use true; positive values are important
      } else {
        stripSilence = stoi(
          ctx.rep,
          opt,
          `MIdiInc StripSilence= expecting 'value', 'On' or 'Off', not ${opt}`,
        );
      }
    } else if (cmd === 'IGNOREPC') {
      ignorePC = getTF(ctx.rep, opt, "MidiInc 'IgnorePC'");
    } else if (cmd === 'STRETCH') {
      const v = stof(ctx.rep, opt);
      if (v < 1 || v > 500) {
        ctx.error(`MidiInc: 'Stretch' range of 1 to 500, not ${opt}.`);
      }
      stretch = v / 100.0;
    } else {
      // If none of the above matched a CMD we assume it is a trackname.
      // Keep this as the last test!
      trackAlloc(ctx, cmd, false);
      if (!ctx.tnames.has(cmd)) {
        ctx.error(`MidiInc: ${cmd} is not a valid MMA track`);
      }

      const parts = opt.split(',');
      let riffmode = 0;
      let printriff = false;
      let ch: number | undefined;
      for (const o0 of parts) {
        const o = o0.toUpperCase();
        if (o === 'RIFF') {
          riffmode = 1;
        } else if (o === 'SEQUENCE') {
          riffmode = 2;
        } else if (o === 'PRINT') {
          printriff = true;
          if (!riffmode) riffmode = 1;
        } else {
          if (ch !== undefined) {
            ctx.error('MidiInc: Only one channel assignment per track.');
          }
          ch = stoi(ctx.rep, o);
        }
      }

      if (ch === undefined || ch < 1 || ch > 16) {
        ctx.error(`MidiInc: MIDI channel for import must be 1..16, not ${ch ?? 'none'}`);
      }

      channels.push({ track: cmd, channel: ch - 1, riffmode, printriff });
    }
  }

  // If transpose was NOT set, use the global transpose value.  Note the
  // special riff value as well; the riff import does its own adjustment,
  // so this needs to be done BEFORE reading the midi file.
  let riffTranspose: number;
  if (transpose === null) {
    transpose = ctx.transpose;
    riffTranspose = -ctx.transpose;
  } else {
    riffTranspose = 0;
  }
  octAdjust += transpose; // takes care of octave and transpose

  const mf = new MidiData();
  mf.octaveAdjust = octAdjust;
  mf.velocityAdjust = velAdjust;
  mf.ignorePC = ignorePC;

  const bytes = await loadMidiFile(ctx, filename);
  try {
    mf.readFile(bytes, ctx.encoding);
  } catch (e) {
    ctx.error(`MidiInc: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (mf.beatDivision !== ctx.BperQ) {
    ctx.warning(
      `MIDI file '${filename}' tick/beat of ${mf.beatDivision} differs from MMA's ` +
        `${ctx.BperQ}. Will try to compensate`,
    );
    mf.adjustBeats(ctx.BperQ / mf.beatDivision);
  }

  if (report || verbose) {
    // Try to be helpful.
    console.log(`MIDI File ${filename} successfully read.`);
    console.log(`Total Text events: ${mf.textEvents.length}`);
    console.log(`Total Lyric events: ${mf.lyricEvents.length}`);
    console.log('\n');

    for (let ch = 0; ch < mf.events.length; ch++) {
      const evs = mf.events[ch]!;
      if (!evs.length) continue;

      if (verbose && !report) {
        // In verbose mode only list info for tracks we're using.
        let doit = false;
        for (const z of channels) {
          if (z.channel === ch) {
            doit = true;
            break;
          }
        }
        if (!doit) continue;
      }

      let fevent = 0xffffff;
      let fnote = 0xffffff;
      let ncount = 0;
      for (const ev of evs) {
        if (ev.tick < fevent) fevent = ev.tick;
        if (ev.status >> 4 === 0x9) {
          if (ev.tick < fnote) fnote = ev.tick;
          if (ev.data[1]) ncount += 1;
        }
      }
      const msg = [`Channel ${String(ch + 1).padStart(2, ' ')}: First event ${String(fevent).padEnd(8, ' ')}`];
      if (ncount) {
        msg.push(`First Note ${String(fnote).padEnd(8, ' ')} Total Notes ${String(ncount).padEnd(4, ' ')}`);
      }
      console.log(msg.join(' '));
    }

    if (report) {
      // Python prints and then sys.exit(0)s, generating no output at all.
      // A library cannot exit the host process; stop reading the current
      // file instead so no import happens here either.
      console.log('\nNo data generated!');
      ctx.inpath?.toEof();
      return;
    }
  }

  if (!channels.length) {
    if (doLyric || doText) {
      ctx.warning('MidiInc: no import channels specified, only text or lyrics imported');
    } else {
      ctx.error('MidiInc: A channel to import and a destination track must be specified');
    }
  }

  if (istart >= iend || istart < 0 || iend < 0) {
    ctx.error(`MidiInc: Range invalid, start=${istart}, end=${iend}`);
  }

  if (ctx.debug.debug) {
    ctx.dPrint(
      `MidiInc: File=${filename}, Volume=${velAdjust}, Octave=${octAdjust}, ` +
        `Transpose=${transpose}, Lyric=${doLyric}, Text=${doText}, Range=${istart}T..${iend}T ` +
        `StripSilence=${stripSilence}T Offset=${insertOffset}T Verbose=${verbose}`,
    );
    const msg: string[] = [];
    for (const { track, channel, riffmode } of channels) {
      const o = riffmode === 1 ? ',riff' : riffmode === 2 ? ',sequence' : '';
      msg.push(`MidiInc: Channel ${channel + 1}-->${track}${o}`);
    }
    ctx.dPrint(msg.join(' '));
  }

  if (stretch) {
    if (verbose) {
      console.log(`Applying stretch to all events. Deltas will be multiplied by ${stretch}`);
    }

    for (const tr of mf.events) {
      for (const e of tr) e.tick = Math.trunc(e.tick * stretch); // e.tick is the offset
    }
    for (const e of mf.textEvents) e[0] = Math.trunc(e[0] * stretch);
    for (const e of mf.lyricEvents) e[0] = Math.trunc(e[0] * stretch);
  }

  // Midi file parsed, add selected events to mma data.

  if (stripSilence === false) {
    if (verbose) {
      console.log(
        `Firstnote offset was ${mf.firstNote}. Being reset to start of file by StripSilence=Off.`,
      );
    }
    mf.firstNote = 0;
  }

  if (verbose) {
    console.log(`First note offset: ${mf.firstNote}`);
  }

  if (doText) {
    let inst = 0;
    let disc = 0;
    if (verbose) {
      console.log(`Scanning ${mf.textEvents.length} textevents.`);
    }
    for (const [tm, tx] of mf.textEvents) {
      const delta = tm - mf.firstNote;
      if (delta >= istart && delta <= iend) {
        ctx.mtrks.track(0).addText(ctx.tickOffset + insertOffset + delta, tx);
        inst += 1;
      } else {
        disc += 1;
      }
    }
    if (ctx.debug.debug) {
      ctx.dPrint(`MidiInc text events: ${inst} inserted, ${disc} out of range.`);
    }
  }

  if (doLyric) {
    let inst = 0;
    let disc = 0;
    if (verbose) {
      console.log(`Scanning ${mf.lyricEvents.length} LyricEvents.`);
    }
    for (const [tm, tx] of mf.lyricEvents) {
      const delta = tm - mf.firstNote;
      if (delta >= istart && delta <= iend) {
        ctx.mtrks.track(0).addLyric(ctx.tickOffset + insertOffset + delta, tx);
        inst += 1;
      } else {
        disc += 1;
      }
    }
    if (ctx.debug.debug) {
      ctx.dPrint(`MidiInc lyric events: ${inst} inserted, ${disc} out of range.`);
    }
  }

  for (const { track: n, channel: c } of channels) {
    if (!mf.events[c]!.length) {
      ctx.warning(`No data to assign from imported channel ${c + 1} to track ${n}`);
    }
  }

  let inst = 0;
  let disc = 0;

  for (const { track: tr, channel: ch, riffmode, printriff } of channels) {
    const onNotes: number[] = [];
    const t = ctx.tnames.get(tr)!;

    if (t.disable) {
      // Skip if disabled track.
      if (verbose) {
        console.log(`Skipping import of channel ${ch} since track ${tr} is disabled.`);
      }
      continue;
    }

    if (!t.channel) t.setChannel();

    if (riffmode) {
      if (t.vtype !== 'MELODY' && t.vtype !== 'SOLO') {
        ctx.error(`MidiInc: Riff only works on Melody/Solo tracks, not '${t.name}'.`);
      }
    }

    t.clearPending();
    if (t.voice[0] !== t.ssvoice) {
      ctx.mtrks.track(t.channel).addProgChange(ctx.tickOffset + insertOffset, t.voice[0]!, t.ssvoice);
    }

    const channel = t.channel;
    const track = ctx.mtrks.track(channel);

    // Python has `if verbose or 1:` here: the line always prints.
    console.log(
      `Parsing imported file. Channel=${ch} Track=${tr} MIDI Channel=${channel}`,
    );
    if (mf.events[ch]!.length) {
      const evs = mf.events[ch]!;
      console.log(
        ` Total events: ${evs.length}; Event range: ${evs[0]!.tick}T ${evs[evs.length - 1]!.tick}T; ` +
          `Start/End Range: ${istart}T ${iend}T`,
      );
    } else {
      console.log(`No events in Channel ${ch}`);
    }

    // If we're processing midi voice changes (ignorePC=False) and there
    // are events BEFORE the first note, we need to insert them before the
    // notes.  We put them all at the start offset.
    if (!ignorePC) {
      for (const ev of mf.events[ch]!) {
        if (ev.tick > mf.firstNote) break;
        if (ev.status >> 4 === 0xc) {
          track.addToTrack(
            ctx.tickOffset + insertOffset,
            packBytes(ev.status | (channel - 1), ev.data),
          );
          inst += 1;
          disc -= 1;
        }
      }
    }

    let offset = 0;
    const riff: Array<[number, number, number]> = [];
    for (const ev of mf.events[ch]!) {
      const delta = ev.tick - mf.firstNote;

      if (delta >= istart && delta <= iend) {
        if (riffmode) {
          offset = delta - istart;
          const x = ev.status >> 4;
          if (x !== 0x09 && x !== 0x08) continue; // skip non-note events
          const pitch = ev.data[0]!;
          let velocity = ev.data[1]!;
          if (x === 0x8) velocity = 0;
          riff.push([offset, pitch, velocity]);
        } else {
          offset = ctx.tickOffset + insertOffset + (delta - istart);
          // Add note on/off, key pressure, etc.
          track.addToTrack(offset, packBytes(ev.status | (channel - 1), ev.data));

          // Track on/off events to avoid stuck midi notes.
          const x = ev.status >> 4;
          if (x === 0x09 && ev.data[1] && !onNotes.includes(ev.data[0]!)) {
            onNotes.push(ev.data[0]!); // append this pitch to onNotes
          }
          if (
            ((x === 0x09 && !ev.data[1]) || x === 0x08) &&
            onNotes.includes(ev.data[0]!)
          ) {
            onNotes.splice(onNotes.indexOf(ev.data[0]!), 1); // this is now OFF
          }
        }

        inst += 1;
      } else {
        disc += 1;
      }
    }

    if (onNotes.length) {
      for (const x of onNotes) {
        track.addToTrack(offset, packBytes(0x90 | (channel - 1), [x, 0]));
      }
      ctx.warning(
        `MidiINC: Stuck MIDI note(s) '${onNotes.join(', ')}' turned off in ${tr}.`,
      );
    }

    if (riffmode) {
      const evlist = createRiff(ctx, riff, tr, riffTranspose);

      let txt: string[] | null = riffmode === 2 ? [] : null;
      for (const a of [...evlist.keys()].sort((x, y) => x - y)) {
        if (printriff && riffmode === 1) {
          console.log(`${tr} Riff ${evlist.get(a)}`);
        } else if (riffmode === 2) {
          // Sequence mode: create sequence lines and push into input.
          txt!.push(`{${evlist.get(a)}}`);
        } else {
          // Riffmode == 1, printriff == 0: add to the riff stack.
          t.setRiff(evlist.get(a)!);
        }
      }

      if (riffmode === 2 && txt!.length) {
        if (printriff) {
          console.log(`${tr} Sequence ${txt!.join(' ')}`);
        } else {
          trackSequence(ctx, expander, getTrack(ctx, tr), txt!, false);
        }
      }
    }
  }

  if (ctx.debug.debug) {
    ctx.dPrint(`MidiInc events: ${inst} inserted, ${disc} out of range.`);
  }
}

/**
 * Resolve and read a MIDI file through the resource layer.  The candidate
 * list mirrors the engine: the directory of the file that issued the
 * command (the current inpath) first, then the raw name.  Python's
 * readmidi opens the path cwd-relative; corpus entries set cwd to the
 * song's directory so both sides find the same bytes.
 */
async function loadMidiFile(ctx: MMAContext, filename: string): Promise<ArrayBuffer> {
  const res = ctx.resources;
  if (!res) ctx.error('MidiInc: no resource loader is attached to the context');
  if (!res.loadBinary) {
    ctx.error(
      `MidiInc: the resource loader cannot load binary resources; unable to read '${filename}'`,
    );
  }

  const name = normalizeResourceId(fixfname(filename));
  const current = normalizeResourceId(ctx.inpath?.fname ?? ctx.infile);
  const slash = current.lastIndexOf('/');
  const dir = slash >= 0 ? current.slice(0, slash) : '';

  const candidates: string[] = [];
  if (dir && !name.startsWith('/')) candidates.push(normalizeResourceId(`${dir}/${name}`));
  candidates.push(name);

  let lastError = '';
  for (const candidate of candidates) {
    try {
      return await res.loadBinary(candidate);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  ctx.error(`MidiInc: Unable to open MIDI file '${filename}' for reading. (${lastError})`);
}

/**
 * Port of midiIn.createRiff: convert the flat [offset, pitch, velocity]
 * note list into bar-addressed MMA riff strings.
 */
function createRiff(
  ctx: MMAContext,
  riff: Array<[number, number, number]>,
  tname: string,
  riffTranspose: number,
): Map<number, string> {
  const t = ctx.tnames.get(tname);
  if (t?.riff.length) {
    ctx.error(`MidiInc: Data already pending for ${tname}.`);
  }

  // Convert the list of ON values to durations: for every on-event search
  // forward for its off and subtract the two offsets.
  let missed = 0;
  const events: Array<[number, number, number, number]> = [];
  riff.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  for (let i = 0; i < riff.length; i++) {
    let duration: number | null = null;
    const [offset, pitch, velocity] = riff[i]!;
    if (velocity) {
      for (let ti = i; ti < riff.length; ti++) {
        const [off1, pitch1, vel1] = riff[ti]!;
        if (!vel1 && pitch1 === pitch) {
          duration = off1 - offset;
          break;
        }
      }
      if (duration) {
        let p = pitch;
        if (riffTranspose) {
          p += riffTranspose;
          while (p > 127) p -= 12;
          while (p < 0) p += 12;
        }
        events.push([offset, duration, p, velocity]);
      } else {
        missed += 1;
      }
    }
  }

  if (missed) {
    ctx.warning(`MidiInc Riff: conversion missed ${missed} notes in track ${tname}`);
  }

  // We have a list of events: [offset, duration, pitch, velocity]...
  // create yet another list with the events put into bars.
  const tickBar = ctx.barLen;
  const bars = new Map<number, string>();
  for (const [offset, duration, pitch, velocity] of events) {
    const b = Math.floor(offset / tickBar);
    if (!bars.has(b)) bars.set(b, '');
    const eol = (offset % tickBar) + duration > ctx.barLen ? '~;' : ';';
    bars.set(
      b,
      bars.get(b)! + `<Offset=${offset % tickBar}> ${duration}t ${pitch}/${velocity} ${eol}`,
    );
  }

  // Ensure that all bars in the riff pushback data have something.
  // Otherwise the MIDI gets out of sync with the chords (this happens
  // when there are rest bars in the imported data).  We step through and
  // create mma rest bars for the missing ones.
  if (!bars.size) {
    bars.set(0, '4r;');
  }
  const last = Math.max(...bars.keys());
  for (let b = 0; b < last; b++) {
    if (!bars.has(b)) bars.set(b, '4r;');

    while ((bars.get(b)!.match(/~/g) ?? []).length > 1) {
      bars.set(b, bars.get(b)!.replace('~', ''));
    }
  }

  return bars;
}

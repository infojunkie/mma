/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * rhythm plugin: port of plugins/rhythm/plugin.py by Johan Vromans.
 * Creates percussion groove definitions from compact ASCII tabs.
 *
 * Python mutates the module-global argument list in trackRun; here the
 * spec lives on the plugin object, so use createRhythmPlugin() for a
 * fresh instance (tests) or the shared rhythmPlugin singleton.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../src/engine/Context';
import type { IMMAPlugin, PluginContext } from '../src/plugin/IMMAPlugin';
import { pyRound } from '../src/engine/PyValue';
import { PluginSpec } from '../src/plugin/pluginUtils';

/** Instrument names as used by Zoom percussion devices. */
export const zoomNames = [
  'Kick', 'Snare', 'ClosedHat', 'OpenHat',
  'Crash', 'Ride', 'Tom1', 'Tom2',
  'Tom3', 'Stick', 'Bell', 'Maracas',
  'Tambourine', 'LowConga', 'MutHiConga', 'OpenHiConga',
];

/** Corresponding MMA percussion tones. */
export const zoomTones = [
  'KickDrum1', 'SnareDrum1', 'ClosedHiHat', 'OpenHiHat',
  'CrashCymbal1', 'RideCymbal1', 'MidTom1', 'LowTom1',
  'HighTom1', 'SideKick', 'RideBell', 'Maracas',
  'Tambourine', 'LowConga', 'MuteHighConga', 'OpenHighConga',
];

/** Python int(str) for the plugin's integer options. */
function pyInt(ctx: MMAContext, s: string, what: string): number {
  const t = s.trim();
  if (!/^[+-]?[0-9]+$/.test(t)) {
    ctx.error(`Rhythm: ${what} must be an integer, not '${s}'.`);
  }
  return parseInt(t, 10);
}

/** Python "{:f}" (six decimals) with trailing zeros/point stripped. */
function pyFixed(x: number): string {
  return x.toFixed(6).replace(/\.?0+$/, '');
}

/**
 * Produces an MMA sequence string from an ASCII tab.  Port of
 * process_sequence(); exported for tests.
 */
export function processSequence(tab0: string, bpm = 4, vol = 9): string {
  // Volume scale. Scale 1..9 -> 10..90.
  const vscale = 90 / vol;

  let tab = tab0;
  // Just in case we're quoted.
  if (tab[0] === '"' || tab[0] === "'") tab = tab.slice(1);
  if (tab.length && (tab[tab.length - 1] === '"' || tab[tab.length - 1] === "'")) {
    tab = tab.slice(0, -1);
  }

  // Check validity.
  if (tab.length < 3 || tab[0] !== '|' || tab[tab.length - 1] !== '|') {
    throw new Error(`Invalid tab: ${tab}`);
  }

  let prev = '';
  let res = '';

  // Process the bars.
  const re = /([-0-9*]*)\|/g;
  const matches = [...tab.slice(1).matchAll(re)];
  for (const x of matches) {
    const bar = x[1]!;
    const step = bar.length;
    if (step === 0) {
      // Empty bar: repeat previous.  If first: silent bar.
      if (res !== '') {
        res = res + '/ ';
      } else {
        res = 'Z';
      }
      continue;
    }

    // Single asterisk copies existing sequence.
    if (step === 1 && bar === '*') {
      res = res + '* ';
      continue;
    }

    const seqs: string[] = [];
    for (let index = 0; index < bar.length; index++) {
      const char = bar[index]!;
      if (char === '-') continue;
      const t = pyFixed(1 + (index * bpm) / step);
      const value = parseInt(char, 10);
      if (Number.isNaN(value)) {
        throw new Error(`Invalid tab character: ${char}`);
      }
      // Python: round(int(char) * vscale) - banker's rounding.
      seqs.push(`${t} 0 ${pyRound(value * vscale).value}`);
    }

    let seq: string;
    if (seqs.length === 0) {
      // Silent sequence.
      seq = 'Z ';
    } else {
      // Combine.
      seq = '{ ' + seqs.join('; ') + ' } ';
    }

    // Check for copies.
    if (prev === seq) {
      res = res + '/ ';
    } else {
      res = res + seq;
      prev = seq;
    }
  }

  return res;
}

export class RhythmPlugin implements IMMAPlugin {
  readonly name = 'rhythm';
  readonly description = 'Define percussion grooves.';
  readonly author = 'Written by Johan Vromans';

  private readonly pu = new PluginSpec('rhythm');

  constructor() {
    const pu = this.pu;
    pu.setDescription(this.description);
    pu.setAuthor(this.author);
    pu.setTrackType('DRUM');
    pu.setSynopsis(`
    @rhythm Groove, Seq, Bpm, Level, RTime, RVolume, Clear, SeqSize, Debug
  or
    Track @rhythm Seq, Bpm, Level, Debug
  or
    Track @rhythm Define=Pat, Seq, Bpm, Level, Debug

`);

    // These are the arguments for the full (non-track) call.
    // Track usage is a subset.
    // Note that pu.printUsage requires the default values to be strings.
    pu.addArgument('Groove', null, 'Groove to define.');
    pu.addArgument('Seq', null, 'Sequence tab.');
    pu.addArgument('Bpm', '4', 'Beats per bar.');
    pu.addArgument('Level', '9', 'Max volume value.');
    pu.addArgument('RTime', '0', 'Time randomizer.');
    pu.addArgument('RVolume', '0', 'Volume randomizer.');
    pu.addArgument('Clear', '0', 'Issue SeqClear.');
    pu.addArgument('SeqSize', '0', 'Issue SeqSize.');
    pu.addArgument('Debug', '0', 'For debugging.');

    pu.setPluginDoc(`
This plugin creates percussion patterns using ASCII tabs.

See https://github.com/sciurius/mma-plugins/blob/master/rhythm/README.md for extensive documentation.

This plugin has been written by Johan Vromans <jvromans@squirrel.nl>
Version 1.03.
`);
  }

  help(): string {
    return this.pu.printUsage();
  }

  /** Entry point for groove defining. */
  run(args: string[], pctx: PluginContext): void {
    const ctx = pctx.context;
    const pu = this.pu;

    const parsed = pu.parseCommandLine(ctx, args);

    // Mandatory.
    const groove = parsed['Groove']!;
    const seq = parsed['Seq']!;

    // Optional.
    const bpm = pyInt(ctx, parsed['Bpm']!, 'Bpm');
    const level = pyInt(ctx, parsed['Level']!, 'Level');
    const rvol = pyInt(ctx, parsed['RVolume']!, 'RVolume');
    const rtime = pyInt(ctx, parsed['RTime']!, 'RTime');
    const seqsz = pyInt(ctx, parsed['SeqSize']!, 'SeqSize');
    const clear = pyInt(ctx, parsed['Clear']!, 'Clear');
    const debug = pyInt(ctx, parsed['Debug']!, 'Debug');

    // Some checks.
    if (level < 1 || level > 9) {
      ctx.error(`Rhtythm: Level must be 1 .. 9, not ${level}`);
    }

    if (clear) pu.addCommand('SeqClear');
    if (seqsz) pu.addCommand(`SeqSize ${seqsz}`);

    // The sequence data is a series of Instrument Pattern pairs.
    // It may be passed in a macro name.
    let line = seq.split(/\s+/).filter((w) => w !== '');
    if (line.length === 1) {
      // Macro name.
      const value = pctx.getVar(seq.toUpperCase());
      if (Array.isArray(value)) {
        // MSet macro returns a list of lists.  Flatten.
        line = value.flat();
      } else {
        // Single value macro.  Split.
        line = value.split(/\s+/).filter((w) => w !== '');
      }
    }

    if (line.length % 2) {
      ctx.error('Rhythm: Seq must have an even number of whitespace separated items');
    }

    // Process two at a time.
    while (line.length > 1) {
      // Pop off the instrument name.
      let instr = line.shift()!;
      let tone: string;
      if (/^[0-9]+$/.test(instr)) {
        // If it is a number, use the Zoom predefined names.
        const index = Number(instr) - 1;
        if (index < 0 || index >= zoomNames.length) {
          ctx.error(`Rhythm: instrument number ${instr} is out of range.`);
        }
        tone = zoomTones[index]!;
        instr = zoomNames[index]!;
      } else if (zoomNames.includes(instr)) {
        const index = zoomNames.indexOf(instr);
        tone = zoomTones[index]!;
      } else {
        tone = instr;
      }

      // Pop off the sequence data.
      const seqData = line.shift()!;

      pu.addCommand(`Begin Drum-${instr}`);
      pu.addCommand(`  Tone     ${tone}`);
      if (rtime) pu.addCommand(`  RTime    ${rtime}`);
      if (rvol) pu.addCommand(`  RVolume  ${rvol}`);
      pu.addCommand(`  Sequence ${processSequence(seqData, bpm, level)}`);
      pu.addCommand('End');
    }

    pu.addCommand(`DefGroove ${groove}`);
    void debug; // Python's debug print here is commented out.
    pu.sendCommands(pctx);
  }

  /**
   * Entry point for the track plugin.  The track plugin takes a subset
   * of arguments; Python replaces the module argument list here.
   */
  trackRun(track: string, args: string[], pctx: import('../src/plugin/IMMAPlugin').PluginContext): void {
    const ctx = pctx.context;
    const pu = this.pu;

    pu.args.length = 0;
    pu.addArgument('Seq', null, 'Sequence tab.');
    pu.addArgument('Define', '', 'For defining.');
    pu.addArgument('Bpm', '4', 'Beats per bar.');
    pu.addArgument('Level', '9', 'Max volume value.');
    pu.addArgument('Debug', '0', 'For debugging.');
    const parsed = pu.parseCommandLine(ctx, args);

    const seq = parsed['Seq']!;
    const bpm = pyInt(ctx, parsed['Bpm']!, 'Bpm');
    const vol = pyInt(ctx, parsed['Level']!, 'Level');
    const debug = pyInt(ctx, parsed['Debug']!, 'Debug');
    const define = parsed['Define']!;

    let cmd: string;
    if (define === '') {
      cmd = 'Sequence ' + processSequence(seq, bpm, vol);
    } else {
      const seqStr = processSequence(seq, bpm, vol);
      cmd = 'Define ' + define + ' ' + seqStr.slice(2, -2);
    }

    // Hackattack: if we're called from a Begin Drum-Foo then we should
    // not include the track in the resultant command.
    const beginData = ctx.beginData;
    if (beginData.length && beginData[0]!.toUpperCase() === track) {
      // Python's no-op branch.
    } else {
      cmd = track + ' ' + cmd;
    }

    if (debug) console.log('Rhythm: ' + cmd);
    pu.addCommand(cmd);
    pu.sendCommands(pctx);
  }
}

export function createRhythmPlugin(): RhythmPlugin {
  return new RhythmPlugin();
}

export const rhythmPlugin = new RhythmPlugin();

export default rhythmPlugin;

/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * strumpattern plugin: port of plugins/strumpattern/plugin.py by Ignazio
 * Di Napoli <neclepsio@gmail.com>.  Sets a strum pattern on a PLECTRUM
 * track and maintains a companion "<track>-Muted" clone track that plays
 * the muted/chucked strings with the MutedGuitar voice.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { IMMAPlugin, PluginContext } from '../src/plugin/IMMAPlugin';
import { PluginSpec } from '../src/plugin/pluginUtils';
import { formatFloat } from '../src/engine/PyValue';

/**
 * Python's format(v, '0.4'): round the shortest decimal representation to
 * 4 significant digits (ties to even), then print like str() except that
 * fixed notation is used only for decimal exponents -4..2 (always with at
 * least one decimal digit) and scientific notation otherwise.  The plugin
 * only ever formats beat positions between 1 and QperBar.
 */
export function pyFormat04(v: number): string {
  if (!Number.isFinite(v)) return String(v);

  // CPython rounds the shortest repr of the float, not the exact value.
  const s = formatFloat(v);
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(s);
  if (!m) return s;
  const sign = m[1] === '-' ? '-' : '';
  const intPart = m[2]!;
  const frac = m[3] ?? '';
  const ePart = m[4] ? Number(m[4]) : 0;

  let digits: string;
  let exp: number;
  if (/^0+$/.test(intPart)) {
    const idx = frac.search(/[1-9]/);
    if (idx === -1) return `${sign}0.0`;
    exp = -idx - 1 + ePart;
    digits = frac.slice(idx);
  } else {
    digits = intPart + frac;
    exp = intPart.length - 1 + ePart;
  }

  // Round to 4 significant digits, half to even.
  const d: number[] = digits.slice(0, 4).padEnd(4, '0').split('').map(Number);
  const rest = digits.slice(4);
  if (rest.length) {
    const first = rest.charCodeAt(0) - 48;
    let roundUp = first > 5;
    if (first === 5) {
      const tail = /[1-9]/.test(rest.slice(1));
      roundUp = tail || d[3]! % 2 === 1;
    }
    if (roundUp) {
      let i = 3;
      while (i >= 0 && d[i] === 9) {
        d[i] = 0;
        i -= 1;
      }
      if (i < 0) {
        d[0] = 1; // 9999 -> 1000, exponent moves up
        exp += 1;
      } else {
        d[i]! += 1;
      }
    }
  }
  while (d.length > 1 && d[d.length - 1] === 0) d.pop();
  const ds = d.join('');

  if (exp >= -4 && exp <= 2) {
    if (exp >= 0) {
      const intDigits = ds.length <= exp ? ds + '0'.repeat(exp + 1 - ds.length) : ds.slice(0, exp + 1);
      const fracDigits = ds.length <= exp ? '' : ds.slice(exp + 1);
      return `${sign}${intDigits}.${fracDigits === '' ? '0' : fracDigits}`;
    }
    return `${sign}0.${'0'.repeat(-exp - 1)}${ds}`;
  }

  const mm = ds.length > 1 ? `${ds[0]}.${ds.slice(1)}` : ds[0]!;
  const e = (exp >= 0 ? '+' : '-') + String(Math.abs(exp)).padStart(2, '0');
  return `${sign}${mm}e${e}`;
}

export class StrumpatternPlugin implements IMMAPlugin {
  readonly name = 'strumpattern';
  readonly description = 'Sets a strum pattern for Plectrum tracks.';
  readonly author = 'Written by Ignazio Di Napoli <neclepsio@gmail.com>.';

  private readonly pu = new PluginSpec('strumpattern');

  constructor() {
    this.pu.setDescription(this.description);
    this.pu.setAuthor(this.author);
    this.pu.setTrackType('Plectrum');
    this.pu.addArgument('Pattern', null, 'see after');
    this.pu.addArgument('Strum', '5', 'strum value to use in sequence (see Plectrum docs)');
    this.pu.addArgument(
      'Volume',
      '80',
      'volume for strums, can be specified for each string (see Plectrum docs)',
    );
    this.pu.addArgument(
      'VolumeMuted',
      '60',
      'volume for mute, can be specified for each string (see Plectrum docs)',
    );
    this.pu.addArgument(
      'VolumeEmph',
      '100',
      'volume for emphatized strums, can be specified for each string (see Plectrum docs)',
    );
    this.pu.addArgument('VolumePick', '90', 'volume for single string pick');
    this.pu.setPluginDoc(`
The pattern is specified as a string of dot-separed values, that are equally spaced into the bar.
Values can be:
    d   downward strum
    u   upward strum
    de  downward strum with emphasis
    ue  upward strum with emphasis
    dm  downward strum with muted strings
    um  upward strum with muted strings
    x   chunk
    -   do nothing (used to skip to next time division)
If only one-character codes are used, you can avoid dots.
You can specify more bars separed by semicolons (;).

Examples:
    Plectrum %NAME% dudududu
    Plectrum %NAME% dm.um.dm.um.dm.um.dm.um
    Plectrum %NAME% dudududu;12345654
    Plectrum %NAME% dudududu, Strum=10
    Plectrum %NAME% dudududu, 5, 70, 60, 90, 80
    Plectrum %NAME% dudududu, 7, VolumeEmph=90

Each time it's used, %NAME% creates a clone track of the provided one using the voice MutedGuitar for chucks and muted strums.
Its name is the name of the main track with an appended "-Muted", if you need to change it you must do so every time after using %NAME%.

This plugin has been written by Ignazio Di Napoli <neclepsio@gmail.com>.
Version 1.0.
`);
  }

  help(): string {
    return this.pu.printUsage();
  }

  trackRun(track: string, args: string[], pctx: PluginContext): void {
    const ctx = pctx.context;

    // Python checks the minimum version at module import.
    this.pu.setMinMMAVersion(ctx, 15, 12);

    // We check if track type is correct.
    this.pu.checkTrackType(ctx, track);

    // We parse the arguments.  Errors print the correct usage on screen.
    const a = this.pu.parseCommandLine(ctx, args);

    // This is how we access arguments.
    const pattern = a['Pattern']!;
    const strum = a['Strum']!;
    const volumeN = a['Volume']!;
    const volumeM = a['VolumeMuted']!;
    const volumeE = a['VolumeEmph']!;
    const volumeP = a['VolumePick']!;

    // This is the logic for the plugin.
    let allNormal = '';
    let allMuted = '';

    // float(pu.getSysVar('TIME')) in Python; the TIME sysvar is
    // str(gbl.QperBar).
    const time = ctx.QperBar;

    for (const barPattern0 of pattern.split(';')) {
      const barPattern: string[] = barPattern0.includes('.')
        ? barPattern0.toLowerCase().split('.')
        : [...barPattern0.toLowerCase()];

      const strumsNormal: string[] = [];
      const strumsMuted: string[] = [];

      const step = time / barPattern.length;
      for (let i = 0; i < barPattern.length; i++) {
        const c = barPattern[i]!;
        const t = pyFormat04(1 + step * i);

        if (c === 'u') {
          strumsNormal.push(`${t} -${strum} ${volumeN}`);
        } else if (c === 'ue') {
          strumsNormal.push(`${t} -${strum} ${volumeE}`);
        } else if (c === 'um') {
          strumsNormal.push(`${t} 0 0`);
          strumsMuted.push(`${t} -${strum} ${volumeM}`);
        } else if (c === 'd') {
          strumsNormal.push(`${t} +${strum} ${volumeN}`);
        } else if (c === 'de') {
          strumsNormal.push(`${t} +${strum} ${volumeE}`);
        } else if (c === 'dm') {
          strumsNormal.push(`${t} 0 0`);
          strumsMuted.push(`${t} +${strum} ${volumeM}`);
        } else if (c === 'x') {
          strumsNormal.push(`${t} 0 0`);
          strumsMuted.push(`${t} 0 ${volumeM}`);
        } else if (c === '0') {
          strumsNormal.push(`${t} 0 0`);
        } else if (c.replace(/^0+/, '') !== '' && /^[0-9]+$/.test(c)) {
          for (const s of c) {
            strumsNormal.push(`${t} 0 ${s}:${volumeP}`);
          }
        } else if (c === '-') {
          // Do nothing (used to skip to next time division).
        } else {
          ctx.error(`${this.pu.getName()}: unrecognized command in strum pattern: '${c}'.`);
        }
      }

      const barNormal = strumsNormal.length > 0 ? `{${strumsNormal.join('; ')};}` : 'z';
      const barMuted = strumsMuted.length > 0 ? `{${strumsMuted.join('; ')};}` : 'z';

      allNormal += barNormal + ' ';
      allMuted += barMuted + ' ';
    }

    // If the commands are sent one at a time the result is reversed since
    // each is pushed as the very next command to be executed, so save all
    // of them (addCommand) and send at the end (sendCommands).
    this.pu.addCommand(`${track} Sequence ${allNormal}`);
    this.pu.addCommand(`${track}-Muted SeqClear`);
    this.pu.addCommand(`${track}-Muted Copy ${track}`);
    this.pu.addCommand(`${track}-Muted Voice MutedGuitar`);
    this.pu.addCommand(`${track}-Muted Sequence ${allMuted}`);
    this.pu.sendCommands(pctx);
  }
}

export function createStrumpatternPlugin(): StrumpatternPlugin {
  return new StrumpatternPlugin();
}

export const strumpatternPlugin = new StrumpatternPlugin();

export default strumpatternPlugin;

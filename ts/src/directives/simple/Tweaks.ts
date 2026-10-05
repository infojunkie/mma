/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/tweaks.py (TWEAKS): changes the default drum kit/voice used
 * by new tracks, the "dim" chord definition and the plectrum groove-reset
 * behaviour.  Python stored the defaults in the pat/patPlectrum module
 * globals; here they live in the per-run state table (tracks/Defaults.ts).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version (GPL-2.0-or-later).
 */

import type { MMAContext } from '../../engine/Context';
import { DRUM_KITS_BY_NAME } from '../../midi/voices';
import { decodeVoice, type VoiceTranslator } from '../../midi/VoiceValue';
import { getTF, opt2pair, stoi } from '../../util/Common';
import { trackDefaults } from '../../model/tracks/Defaults';

/** The vtable shim used by every decodeVoice() call site. */
function vtableShim(ctx: MMAContext): VoiceTranslator {
  return {
    get: (x) => {
      const v = ctx.vtable.get(x);
      return v === undefined ? x : String(v);
    },
  };
}

/** Port of tweaks.setTweak: option tweaks. */
export function setTweak(ctx: MMAContext, ln: string[]): void {
  const [notopt, pairs] = opt2pair(ln);

  if (notopt.length) {
    ctx.error(`Tweaks: expecting cmd=opt pairs, not '${notopt.join(' ')}'.`);
  }

  for (const { option, value: opt } of pairs) {
    const cmd = option.toUpperCase();

    if (cmd === 'DEFAULTDRUM' || cmd === 'DEFAULTTONE') {
      trackDefaults(ctx).defaultDrum = decodeVoice(ctx.rep, vtableShim(ctx), opt);
    } else if (cmd === 'DEFAULTVOICE') {
      trackDefaults(ctx).defaultVoice = decodeVoice(ctx.rep, vtableShim(ctx), opt);
    } else if (cmd === 'DRUMKIT') {
      let a = opt.toUpperCase();
      if (a.endsWith('KIT')) a = a.slice(0, -3); // optional, end kit name with 'KIT'
      let kit = DRUM_KITS_BY_NAME[a];
      if (kit === undefined) {
        kit = stoi(ctx.rep, a);
        if (kit < 0 || kit > 127) {
          ctx.error(`Tweaks DrumKit: value must be 0..127 not '${kit}'.`);
        }
      }
      trackDefaults(ctx).defaultDrum = kit;
    } else if (cmd === 'DIM') {
      if (opt === '3') {
        // So the description can change (no non-standard notes).
        const dim3 = ctx.chordList.get('dim3');
        if (!dim3) ctx.error("Tweaks DIM: the 'dim3' chord type is not defined.");
        ctx.chordList.set('dim', {
          notes: [...dim3.notes],
          scale: [...dim3.scale],
          description: 'Diminished triad',
        });
      } else if (opt === '7') {
        const dim7 = ctx.chordList.get('dim7');
        if (!dim7) ctx.error("Tweaks DIM: the 'dim7' chord type is not defined.");
        ctx.chordList.set('dim', {
          notes: [...dim7.notes],
          scale: [...dim7.scale],
          description: dim7.description,
        });
      } else {
        ctx.error(`Tweaks: DIM requires '3' or '7' arg, not '${opt}'.`);
      }
    } else if (cmd === 'PLECTRUMRESET') {
      trackDefaults(ctx).plectrumReset = getTF(ctx.rep, opt, 'Tweaks PlectrumReset');
    } else {
      ctx.error(`Tweaks: '${cmd}' unknown command.`);
    }
  }
}

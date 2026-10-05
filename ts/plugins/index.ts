/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * TypeScript ports of the plugins that ship with MMA and the
 * musicxml-midi converter.  Pass them to a run:
 *
 *   import { slashPlugin } from '@music-i18n/mma/plugins/slash';
 *   const result = await mma.toMIDI(song, { plugins: [slashPlugin] });
 *
 * and activate them from MMA source with `Plugin Slash`.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

export { slashPlugin } from './slash';
export { tuningPlugin } from './tuning';
export { addgmPlugin } from './addgm';
export { helloPlugin } from './hello';
export { copyrightPlugin } from './copyright';
export { extendPlugin } from './extend';
export { qriffPlugin, createQriffPlugin, QriffPlugin } from './qriff';
export { rhythmPlugin, createRhythmPlugin, RhythmPlugin, processSequence, zoomNames, zoomTones } from './rhythm';
export {
  strumpatternPlugin,
  createStrumpatternPlugin,
  StrumpatternPlugin,
  pyFormat04,
} from './strumpattern';

export { slashPlugin as default } from './slash';

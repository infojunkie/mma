/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Tuning plugin: port of the Python plugin shipped with the
 * musicxml-midi converter (`src/plugins/tuning/plugin.py`).
 *
 * NOTE: the shipped Python plugin is a stub - its entry points only
 * echo their arguments; the documented behaviour (emit a MIDI MTS
 * SysEx tuning message for `@Tuning Key Delta`) is NOT implemented
 * there.  This port preserves that behaviour so renders stay
 * event-identical to the reference; making the plugin actually tune
 * would change the generated MIDI and is a deliberate separate
 * decision.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { IMMAPlugin } from '../src/plugin/IMMAPlugin';

/** Python's repr of a list of strings: ['a', 'b']. */
function pyList(args: string[]): string {
  return `[${args.map((a) => `'${a}'`).join(', ')}]`;
}

export const tuningPlugin: IMMAPlugin = {
  name: 'Tuning',
  description: 'Define a MIDI tuning in Scala format.',
  author: 'Karim Ratib <karim.ratib@gmail.com> (https://github.com/infojunkie)',
  synopsis: '@Tuning Key Delta',
  help: () =>
    '@Tuning Key Delta\n' +
    '  Key   - MIDI key to tune (0-127)\n' +
    '  Delta - cents difference from the regular 12TET tuning of Key\n' +
    '  (The shipped plugin is a stub; no SysEx is emitted.)',

  run(args) {
    console.log('run', pyList(args));
  },

  trackRun(track, args) {
    console.log('trackRun', track, pyList(args));
  },

  dataRun(args) {
    console.log('dataRun', pyList(args));
  },
};

export default tuningPlugin;

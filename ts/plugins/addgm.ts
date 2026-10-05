/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * addgm plugin: port of plugins/addgm/plugin.py.  A data plugin that
 * prepends the chord "Gm" to a data line.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { IMMAPlugin } from '../src/plugin/IMMAPlugin';

export const addgmPlugin: IMMAPlugin = {
  name: 'addgm',
  description: 'Demo for using the data plugin.',
  help: () => 'Usage for the mma addgm plugin. ',

  dataRun(line) {
    // The plugin converts the plugin-name part of the line to "Gm".
    return ['Gm', ...line];
  },
};

export default addgmPlugin;

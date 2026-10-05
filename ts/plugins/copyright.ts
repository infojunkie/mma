/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * copyright plugin: port of plugins/copyright/plugin.py by Johan
 * Vromans.  Adds a copyright notice to the MIDI output using the
 * MidiCopyright command.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { IMMAPlugin } from '../src/plugin/IMMAPlugin';
import { PluginSpec } from '../src/plugin/pluginUtils';

const author = 'Johan Vromans';

const pu = new PluginSpec('copyright');
pu.setDescription('Adds a copyright notice to the MIDI.');
pu.setAuthor(`Written by ${author}`);
// A default value of null would require specifying the argument.
pu.addArgument('Author', author, 'The name of the copyright holder');
pu.addArgument(
  'Year',
  String(new Date().getFullYear()),
  'The (first) year the copyright is valid',
);
pu.setPluginDoc(`
This plugin adds a copyright notice to the MIDI output using MMA command MidiCopyright.

The copyright notice consists of the copyright symbol, followed by the year and author (the copyright holder). Both \`year' and \`author' are arguments to this plugin.

As suggested by the MIDI specs, \`(C)' is used as copyright symbol.

This plugin has been written by Johan Vromans <jvromans@squirrel.nl>
Version 1.0.
`);

export const copyrightPlugin: IMMAPlugin = {
  name: 'copyright',
  description: 'Adds a copyright notice to the MIDI.',
  author: `Written by ${author}`,
  help: () => pu.printUsage(),

  run(args, pctx) {
    // Python checks the minimum version at module import.
    pu.setMinMMAVersion(pctx.context, 16, 0);

    const parsed = pu.parseCommandLine(pctx.context, args);

    const year = parsed['Year']!;
    const holder = parsed['Author']!;

    // MIDI specs say we should use (C).
    pu.addCommand(`MidiCopyright (C) ${year} ${holder}`);
    pu.sendCommands(pctx);
  },
};

export default copyrightPlugin;

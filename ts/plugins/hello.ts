/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * hello plugin: port of plugins/hello/plugin.py.  The "Hello world" MMA
 * plugin: its run() echoes its arguments, its trackRun() reads track
 * state and returns setting strings to the input, and its dataRun()
 * prepends a "Gm" chord.
 *
 * The Python plugin accesses plugInName['dir'] to print the plugin
 * directory; the browser port has no filesystem-backed plugin path, so
 * that one message shows a placeholder (the rest matches Python).
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { IMMAPlugin } from '../src/plugin/IMMAPlugin';
import { formatFloat } from '../src/engine/PyValue';

export const helloPlugin: IMMAPlugin = {
  name: 'hello',
  description: 'Hello world MMA plugin.',
  help: () =>
    'Usage for the mma hello plugin. \nNot much to say ... I\'m just an example.',

  run(args, pctx) {
    console.log('Hello. This is the run() function in the MMA plugin.');
    console.log(`We are at line ${pctx.line} in the MMA file ${pctx.file}.`);

    if (args.length) {
      console.log('Args passed are:');
      for (const i of args) console.log(i);
    }
  },

  trackRun(name, _args, pctx) {
    console.log('This is the track variant.');
    console.log(`Used as a ${name} command.`);

    const self = pctx.tracks.get(name);
    if (!self) {
      pctx.context.error(`hello: no such track '${name}'.`);
      return; // unreachable; error throws
    }

    console.log("This is the plugin 'hello' located at '(typescript port)'.");
    console.log('One can access methods and variables belonging to the track.');
    console.log(`For example, this is the state for octave list: [${self.octave.join(', ')}]`);
    console.log(
      `Which means our current octave for the track ${self.name} is ${formatFloat(self.octave[0]! / 12)}`,
    );

    console.log('\nFor our last trick, we will return some setting strings to input.');

    const ret = [
      'print If you have used the -e command line option',
      'print you will see that we have changed the octave',
      'print and voicing of the track.',
      `${name} Octave 6`,
      `${name} Voice JazzGuitar`,
    ];

    // All return values have to be lists of words, not a string per line.
    pctx.pushCommands(ret);
  },

  dataRun(line) {
    return ['Gm', ...line];
  },
};

export default helloPlugin;

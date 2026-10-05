/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Plugin runtime: port of MMA/regplug.py without the filesystem.
 * Plugins are objects supplied through the `plugins` option (the
 * browser equivalent of the plugin search path); `Plugin NAME`
 * activates one and registers its `@NAME` entry points, exactly like
 * Python registers them into simpleFuncs/trackFuncs/dataFuncs.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import type { MMAContext } from '../engine/Context';
import { opt2pair } from '../util/Common';
import type { BaseTrack } from '../model/tracks/BaseTrack';
import { createPluginContext, type PluginContextHost } from './PluginContext';
import type { IMMAPlugin, PluginContext } from './IMMAPlugin';

export interface PluginRegistryHost extends PluginContextHost {
  registerSimple(name: string, handler: (ctx: MMAContext, args: string[]) => void | Promise<void>): void;
  registerTrack(
    name: string,
    handler: (ctx: MMAContext, track: BaseTrack, args: string[]) => void | Promise<void>,
  ): void;
  registerData(name: string, handler: (ctx: MMAContext, args: string[]) => string[]): void;
}

export class PluginRegistry {
  /** Activated plugin name (uppercase) -> plugin. */
  private readonly active = new Map<string, IMMAPlugin>();
  /** True once `Plugin Disable=ALL` has run. */
  disabled = false;
  /** Registered data handlers, keyed "@NAME" (uppercase). */
  private readonly dataHandlers = new Map<string, (ctx: MMAContext, args: string[]) => string[]>();

  constructor(
    private readonly ctx: MMAContext,
    private readonly host: PluginRegistryHost,
  ) {}

  /** Plugins available to `Plugin NAME` (the `plugins` option catalog). */
  catalog(): readonly IMMAPlugin[] {
    return this.ctx.plugins;
  }

  find(name: string): IMMAPlugin | undefined {
    const key = name.toUpperCase();
    return this.ctx.plugins.find((p) => p.name.toUpperCase() === key);
  }

  isActive(name: string): boolean {
    return this.active.has(name.toUpperCase());
  }

  /** Port of regplug.plugin(): the PLUGIN directive. */
  load(args: string[]): void {
    if (this.disabled) this.ctx.error('Plugin loading has been disabled.');
    if (!args.length) this.ctx.error('Plugin requires at least one argument (plugin name).');

    const [names, opts] = opt2pair(args, true);
    for (const { option, value } of opts) {
      if (option === 'DISABLE') {
        for (const o of value.split(',')) {
          const a = o.toUpperCase();
          if (a === 'ALL') {
            this.disabled = true;
          } else if (a === 'LOCAL' || a === 'DOT' || a === 'PLUGDIR') {
            // Python's search-path switches have no meaning in the
            // browser (plugins come from the options catalog).
            this.ctx.dPrint(`Plugin: '${a}' has no effect in the browser port.`);
          } else {
            this.ctx.error(`Plugin Disable: '${o}' is an unknown or illegal option.`);
          }
        }
      } else {
        this.ctx.error(`Plugin: '${option}' is an unknown command.`);
      }
    }

    for (const name of names) this.activateByName(name);
  }

  /** regplug.registerPlugin(): activate one plugin and register @NAME. */
  activateByName(rawName: string): void {
    const name = rawName.startsWith('@') ? rawName.slice(1) : rawName;
    const plugin = this.find(name);
    if (!plugin) {
      this.ctx.error(`Plugin: Cannot find plugin '${name}'.`);
    }

    const key = plugin.name.toUpperCase();
    if (this.active.has(key)) {
      this.ctx.warning(`Plugin '${plugin.name}' attempted reload ignored.`);
      return;
    }
    this.active.set(key, plugin);

    const cmdName = `@${key}`;
    const pctx: PluginContext = createPluginContext(plugin, this.ctx, this.host);

    if (typeof plugin.run === 'function') {
      const run = plugin.run.bind(plugin);
      this.host.registerSimple(cmdName, (c, a) => run(a, pctx));
      this.ctx.dPrint(`Plugin: ${cmdName} simple plugin RUN registered.`);
    }
    if (typeof plugin.trackRun === 'function') {
      const trackRun = plugin.trackRun.bind(plugin);
      this.host.registerTrack(cmdName, (c, t, a) => trackRun(t.name, a, pctx));
      this.ctx.dPrint(`Plugin: ${cmdName} track plugin TrackRun registered.`);
    }
    if (typeof plugin.dataRun === 'function') {
      const dataRun = plugin.dataRun.bind(plugin);
      const handler = (c: MMAContext, a: string[]): string[] => dataRun(a, pctx) ?? [];
      this.dataHandlers.set(cmdName, handler);
      this.host.registerData(cmdName, handler);
      this.ctx.dPrint(`Plugin: ${cmdName} data plugin DataRun registered.`);
    }
  }

  /** True when a data handler for `@NAME` (uppercase) is registered. */
  hasData(name: string): boolean {
    return this.dataHandlers.has(name.toUpperCase());
  }

  /** Invoke a data plugin; the return value replaces the chord line. */
  runData(name: string, args: string[]): string[] {
    const handler = this.dataHandlers.get(name.toUpperCase());
    if (!handler) this.ctx.error(`Unknown data plugin '${name}' called.`);
    return handler(this.ctx, args);
  }
}

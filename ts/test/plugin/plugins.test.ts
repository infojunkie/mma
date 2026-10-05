/**
 * Plugin runtime tests (regplug.py / pluginUtils.py port).
 *
 * Plugins are objects passed through the run options; `Plugin NAME`
 * activates one and registers its @NAME entry points into the same
 * directive tables a built-in command would live in.
 */
import { describe, expect, it } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { MemoryResources } from '../../src/io/MMAResources';
import { Parser } from '../../src/parse/Parser';
import type { IMMAPlugin } from '../../src/plugin/IMMAPlugin';

function makeCtx(
  files: Record<string, string> = {},
  options: ConstructorParameters<typeof MMAContext>[0] = {},
): MMAContext {
  const ctx = new MMAContext({ seed: 42, ...options });
  ctx.resources = new MemoryResources(files);
  return ctx;
}

function makePlugin(): { plugin: IMMAPlugin; calls: string[] } {
  const calls: string[] = [];
  const plugin: IMMAPlugin = {
    name: 'Test',
    description: 'test plugin',
    author: 'unit test',
    synopsis: '@Test <arg>',
    help: () => 'Test plugin help',
    run(args, pctx) {
      calls.push(`run:${args.join(' ')}`);
      if (args[0] === 'push') pctx.pushCommands(['C']);
      if (args[0] === 'chord') pctx.defineChord('X1', [0, 4, 7], [0, 2, 4, 5, 7, 9, 11]);
      if (args[0] === 'info') {
        const info = pctx.chord(args[1] ?? 'C');
        calls.push(`info:${info.name}:${info.noteList.join(',')}`);
        calls.push(`file:${pctx.file}`);
      }
    },
    trackRun(track, args, pctx) {
      calls.push(`track:${track}:${args.join(' ')}`);
    },
    dataRun(line, pctx) {
      calls.push(`data:${line.join(' ')}`);
      return ['C'];
    },
  };
  return { plugin, calls };
}

function makeDataPlugin(): { plugin: IMMAPlugin; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    plugin: {
      name: 'Data',
      dataRun(line) {
        calls.push(`data:${line.join(' ')}`);
        return ['C'];
      },
    },
  };
}

async function parseSong(ctx: MMAContext, song: string): Promise<void> {
  await new Parser(ctx).parseFile('song.mma');
  void song;
}

describe('plugin runtime', () => {
  it('activates a plugin and dispatches @NAME simple commands', async () => {
    const { plugin, calls } = makePlugin();
    const ctx = makeCtx({ 'song.mma': 'Plugin Test\n@Test hello world\nC\n' }, { plugins: [plugin] });
    await parseSong(ctx, '');
    expect(calls).toEqual(['run:hello world']);
  });

  it('resolves plugin names case-insensitively and ignores a reload', async () => {
    const { plugin, calls } = makePlugin();
    const ctx = makeCtx({ 'song.mma': 'Plugin test\nPlugin TEST\n@Test a\nC\n' }, { plugins: [plugin] });
    await parseSong(ctx, '');
    expect(calls).toEqual(['run:a']);
    expect(ctx.rep.warnings.map((w) => w.message)).toContain(
      "Plugin 'Test' attempted reload ignored.",
    );
  });

  it('errors on unknown plugins and honours Disable=ALL', async () => {
    const { plugin } = makePlugin();
    await expect(
      parseSong(makeCtx({ 'song.mma': 'Plugin Nope\n' }, { plugins: [plugin] }), ''),
    ).rejects.toThrow(/Cannot find plugin 'NOPE'/);

    await expect(
      parseSong(
        makeCtx({ 'song.mma': 'Plugin Disable=ALL\nPlugin Test\n' }, { plugins: [plugin] }),
        '',
      ),
    ).rejects.toThrow(/Plugin loading has been disabled/);

    await expect(
      parseSong(makeCtx({ 'song.mma': 'Plugin Disable=BOGUS\n' }, { plugins: [plugin] }), ''),
    ).rejects.toThrow(/unknown or illegal option/);
  });

  it('dispatches track-scoped @NAME commands', async () => {
    const { plugin, calls } = makePlugin();
    const ctx = makeCtx(
      { 'song.mma': 'Time 4\nPlugin Test\nChord @Test x y\nC\n' },
      { plugins: [plugin] },
    );
    await parseSong(ctx, '');
    expect(calls).toEqual(['track:CHORD:x y']);
  });

  it('lets a data plugin rewrite the chord line', async () => {
    const { plugin, calls } = makeDataPlugin();
    const ctx = makeCtx(
      { 'song.mma': 'Time 4\nPlugin Data\nBegin Chord Define\n P1 1 1 90\nEnd\nChord Sequence P1\n@Data Dm/F\n' },
      { plugins: [plugin] },
    );
    await parseSong(ctx, '');
    expect(calls).toEqual(['data:Dm/F']);
    expect(ctx.barNum).toBe(1); // the rewritten line was processed as data
  });

  it('errors on unknown data plugins', async () => {
    const ctx = makeCtx({ 'song.mma': 'Time 4\n@Nope x\n' });
    await expect(parseSong(ctx, '')).rejects.toThrow(/Unknown data plugin '@Nope' called/);
  });

  it('pushCommands continues parsing with plugin-supplied lines', async () => {
    const { plugin, calls } = makePlugin();
    const ctx = makeCtx(
      { 'song.mma': 'Time 4\nPlugin Test\nBegin Chord Define\n P1 1 1 90\nEnd\nChord Sequence P1\n@Test push\n' },
      { plugins: [plugin] },
    );
    await parseSong(ctx, '');
    expect(calls).toEqual(['run:push']);
    expect(ctx.barNum).toBe(1); // the pushed "C" line became a bar
  });

  it('defineChord and chord() expose the live chord table', async () => {
    const { plugin, calls } = makePlugin();
    const ctx = makeCtx(
      { 'song.mma': 'Time 4\nPlugin Test\n@Test chord\n@Test info CX1\nCX1\n' },
      { plugins: [plugin] },
    );
    await parseSong(ctx, '');
    // 'X1' is a chord *type*; it is played as a chord name (CX1).
    expect(calls).toContain('info:CX1:0,4,7');
    expect(ctx.chordList.has('X1')).toBe(true);
    expect(ctx.barNum).toBe(1); // the plugin-defined chord type renders a bar
  });
});

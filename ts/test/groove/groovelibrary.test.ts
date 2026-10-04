import { describe, expect, it } from 'vitest';
import { MMAContext } from '../../src/engine/Context';
import { GrooveDatabase } from '../../src/groove/GrooveDatabase';

/** Minimal context with no tracks: groove handling works without them. */
function ctx(): MMAContext {
  return new MMAContext();
}

describe('GrooveLibrary selection', () => {
  it('treats names starting with digits as names, not selection counts', async () => {
    // Regression: `Groove 50sRockIntro` must not be read as "select
    // groove number 50" (Python uses str.isdigit()).
    const c = ctx();
    c.grooves.defineDo(c, '50SROCKINTRO');
    c.grooves.defineDo(c, 'OTHER');
    await c.grooves.select(c, ['50sRockIntro']);
    expect(c.grooves.currentGroove).toBe('50SROCKINTRO');
  });

  it('still supports an explicit selection count before the name list', async () => {
    const c = ctx();
    for (const name of ['ONE', 'TWO', 'THREE']) c.grooves.defineDo(c, name);
    await c.grooves.select(c, ['2', 'ONE', 'TWO', 'THREE']);
    expect(c.grooves.currentGroove).toBe('TWO');
    expect(c.grooves.groovesList).toBeNull(); // selection collapses the list
  });

  it('keeps a multi-name list for per-bar progression', async () => {
    const c = ctx();
    for (const name of ['A', 'B']) c.grooves.defineDo(c, name);
    await c.grooves.select(c, ['A', 'B']);
    expect(c.grooves.currentGroove).toBe('A');
    c.grooves.next(c);
    expect(c.grooves.currentGroove).toBe('B');
    c.grooves.next(c);
    expect(c.grooves.currentGroove).toBe('A');
  });

  it('resolves aliases and autoloads from the database', async () => {
    const c = ctx();
    const db = GrooveDatabase.empty();
    db.addGrooveFile(
      'Remote.mma',
      ['Begin Chord Define', '    R1  1 4 90', 'End', 'Begin Chord', '    Sequence R1', 'End', 'DefGroove RemoteGroove  from the db'].join('\n'),
    );
    c.resources = db;
    c.grooves.finder = async (name) => {
      const hit = db.lookup(name);
      return hit ? { file: hit.file, groove: name.toUpperCase() } : null;
    };
    c.grooves.fileParser = async (file) => {
      // The parser normally handles this; emulate the important part.
      c.grooves.defineDo(c, 'REMOTEGROOVE');
      expect(await db.exists(file)).toBe(true);
    };

    await c.grooves.select(c, ['RemoteGroove']);
    expect(c.grooves.currentGroove).toBe('REMOTEGROOVE');
  });
});

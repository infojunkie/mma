import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { BasicMIDI } from 'spessasynth_core';
import { MMA } from '../../src/api/MMA';
import { MMAError } from '../../src/engine/Errors';
import { GrooveDatabase, type GrooveDatabaseJson } from '../../src/groove/GrooveDatabase';
import { diffEvents, normalizeBasicMIDI } from '../helpers/midiNormalize';
import { loadGolden } from '../helpers/resources';

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/m1/${name}`, import.meta.url)), 'utf-8');

function makeJson(): GrooveDatabaseJson {
  return {
    version: 1,
    generatedBy: 'test',
    grooves: {
      TESTGROOVE: { file: 'TestLib.mma', description: 'A simple test groove.' },
    },
    files: { 'TestLib.mma': ['TESTGROOVE'] },
    sources: {
      'TestLib.mma': fixture('TestLib.mma'),
    },
  };
}

const gz = (text: string): Uint8Array => new Uint8Array(gzipSync(Buffer.from(text, 'utf-8')));

describe('GrooveDatabase', () => {
  it('loads an uncompressed database from bytes', async () => {
    const db = await GrooveDatabase.load(new TextEncoder().encode(JSON.stringify(makeJson())));
    expect(db.grooveCount).toBe(1);
    expect(db.lookup('testgroove')).toEqual({ file: 'TestLib.mma', description: 'A simple test groove.' });
    expect(db.listGrooves()[0]!.name).toBe('TESTGROOVE');
    await expect(db.load('TestLib.mma')).resolves.toContain('DefGroove TestGroove');
  });

  it('loads a gzipped database and renders a song end-to-end', async () => {
    const db = await GrooveDatabase.load(gz(JSON.stringify(makeJson())));
    expect(db.grooveCount).toBe(1);

    const mma = new MMA({ grooveDatabase: db });
    const result = await mma.toMIDI(fixture('groove-test.mma'), { noCredit: true });

    // Same event stream as the on-disk library conformance test.
    const golden = loadGolden('m1-groove');
    const diff = diffEvents(golden.midiEvents, normalizeBasicMIDI(BasicMIDI.fromArrayBuffer(result.bytes)), {
      ignoreKinds: ['trackName'],
    });
    expect(diff, diff ?? '').toBeNull();
  });

  it('adds single .mma files one by one', async () => {
    const db = GrooveDatabase.empty();
    expect(db.grooveCount).toBe(0);

    const names = db.addGrooveFile('mine/MyLib.mma', fixture('TestLib.mma'));
    expect(names).toEqual(['TESTGROOVE']);
    expect(db.lookup('TESTGROOVE')!.file).toBe('mine/MyLib.mma');
    expect(db.fileCount).toBe(1);
    // The file contents are served for Include/Use resolution.
    await expect(db.load('mine/MyLib.mma')).resolves.toContain('DefGroove TestGroove');

    // ... and the added groove renders through the façade.  This song
    // does not `Use` the file; the groove autoload finds it in the db.
    const song = ['Time 4', 'Groove TestGroove', 'C', 'F', 'G7', 'C'].join('\n');
    const result = await new MMA({ grooveDatabase: db }).toMIDI(song, { noCredit: true });
    expect(result.model.barCount).toBe(4);
  });

  it('merges bulk archives, later entries winning', async () => {
    const db = await GrooveDatabase.load(gz(JSON.stringify(makeJson())));

    const second: GrooveDatabaseJson = {
      version: 1,
      grooves: {
        OTHERGROOVE: { file: 'Extra.mma' },
        TESTGROOVE: { file: 'Extra.mma', description: 'overridden' },
      },
      sources: {
        'Extra.mma': [
          'Begin Chord Define',
          '    X1  1 4 90',
          'End',
          'Begin Chord',
          '    Sequence X1',
          'End',
          'DefGroove OtherGroove',
          'DefGroove TestGroove  overridden',
        ].join('\n'),
      },
    };
    await db.add(gz(JSON.stringify(second)));

    expect(db.grooveCount).toBe(2);
    expect(db.lookup('OTHERGROOVE')).toEqual({ file: 'Extra.mma' });
    expect(db.lookup('TESTGROOVE')).toEqual({ file: 'Extra.mma', description: 'overridden' });
    expect(db.fileCount).toBe(2);
  });

  it('replacing a file drops the names it used to define', async () => {
    const db = GrooveDatabase.empty();
    db.addGrooveFile('f.mma', 'DefGroove AAA\nDefGroove BBB');
    expect(db.grooveCount).toBe(2);

    const names = db.addGrooveFile('f.mma', 'DefGroove CCC');
    expect(names).toEqual(['CCC']);
    expect(db.lookup('AAA')).toBeNull();
    expect(db.lookup('BBB')).toBeNull();
    expect(db.lookup('CCC')!.file).toBe('f.mma');
  });

  it('round-trips through toJson', async () => {
    const db = await GrooveDatabase.load(gz(JSON.stringify(makeJson())));
    const reloaded = GrooveDatabase.fromJson(JSON.parse(JSON.stringify(db.toJson())) as GrooveDatabaseJson);
    expect(reloaded.grooveCount).toBe(1);
    expect(reloaded.lookup('TESTGROOVE')).toEqual(db.lookup('TESTGROOVE'));
    await expect(reloaded.load('TestLib.mma')).resolves.toContain('DefGroove TestGroove');
  });

  it('fetches URL loads once and serves the rest from the Cache API', async () => {
    const archive = gz(JSON.stringify(makeJson()));
    const store = new Map<string, ArrayBuffer>();
    let fetches = 0;
    const cacheStorage = {
      open: async () => ({
        match: async (request: Request) => {
          const hit = store.get(request.url);
          return hit ? new Response(hit.slice(0)) : undefined;
        },
        put: async (request: Request, response: Response) => {
          store.set(request.url, await response.arrayBuffer());
        },
      }),
    };
    const fetchFn = (async () => {
      fetches += 1;
      return new Response(archive as unknown as BodyInit, { status: 200 });
    }) as unknown as typeof fetch;

    const first = await GrooveDatabase.load('https://example.test/db.gz', { fetchFn, cacheStorage });
    const second = await GrooveDatabase.load('https://example.test/db.gz', { fetchFn, cacheStorage });

    expect(fetches).toBe(1); // second load came from the cache
    expect(first.grooveCount).toBe(1);
    expect(second.lookup('TESTGROOVE')).toBeTruthy();

    // Cached archives can also be merged in bulk without another fetch.
    const third = GrooveDatabase.empty();
    await third.add('https://example.test/db.gz', { fetchFn, cacheStorage });
    expect(fetches).toBe(1);
    expect(third.grooveCount).toBe(1);
  });

  it('rejects malformed databases and HTTP failures', async () => {
    await expect(GrooveDatabase.load(new TextEncoder().encode('not json'))).rejects.toThrow();
    await expect(GrooveDatabase.load(new TextEncoder().encode('{"version":1}'))).rejects.toThrow(MMAError);
    const fetchFn = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await expect(
      GrooveDatabase.load('https://example.test/missing.gz', { fetchFn, cacheStorage: null }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

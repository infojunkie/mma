import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHORD_TABLE, createChordList } from '../../src/model/chordTable';

interface FixtureEntry {
  notes: number[];
  scale: number[];
  description: string;
}

const fixture: Record<string, FixtureEntry> = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/python/chordtable.json', import.meta.url)), 'utf-8'),
);

describe('CHORD_TABLE (port of MMA/chordtable.py)', () => {
  it('matches the Python chordlist exactly', () => {
    // Names, order and count.
    expect(Object.keys(CHORD_TABLE)).toEqual(Object.keys(fixture));

    for (const [name, expected] of Object.entries(fixture)) {
      expect(CHORD_TABLE[name], `chord '${name}'`).toEqual({
        notes: expected.notes,
        scale: expected.scale,
        description: expected.description,
      });
    }
  });

  it('has one entry per MMA chord type', () => {
    expect(Object.keys(CHORD_TABLE)).toHaveLength(163);
  });

  it('copies alias entries as real copies, not pointers', () => {
    expect(CHORD_TABLE['maj7']).toEqual(CHORD_TABLE['M7']);
    expect(CHORD_TABLE['maj7']).not.toBe(CHORD_TABLE['M7']);
    // Alias doc strings override the target's description.
    expect(CHORD_TABLE['9+'].description).toBe('Recommended notation is "+9" or "9\\#5"');
  });

  it('is immutable', () => {
    expect(Object.isFrozen(CHORD_TABLE)).toBe(true);
    for (const def of Object.values(CHORD_TABLE)) {
      expect(Object.isFrozen(def)).toBe(true);
      expect(Object.isFrozen(def.notes)).toBe(true);
      expect(Object.isFrozen(def.scale)).toBe(true);
    }
  });
});

describe('createChordList', () => {
  it('returns a fresh mutable copy of the table', () => {
    const list = createChordList();
    expect(list).toBeInstanceOf(Map);
    expect(list.size).toBe(Object.keys(CHORD_TABLE).length);
    expect([...list.keys()]).toEqual(Object.keys(CHORD_TABLE));

    const def = list.get('M');
    if (def === undefined) throw new Error("missing chord 'M'");
    expect(def).toEqual(CHORD_TABLE['M']);
    expect(def).not.toBe(CHORD_TABLE['M']);
    expect(def.notes).not.toBe(CHORD_TABLE['M'].notes);
    expect(def.scale).not.toBe(CHORD_TABLE['M'].scale);
  });

  it('is independent: mutating it does not change CHORD_TABLE', () => {
    const before = structuredClone(CHORD_TABLE['M']);

    const list = createChordList();
    const def = list.get('M');
    if (def === undefined) throw new Error("missing chord 'M'");
    def.notes.push(99);
    def.scale[0] = 42;
    def.description = 'changed';
    list.set('brandnew', { notes: [0], scale: [0], description: 'x' });
    list.delete('7');

    expect(CHORD_TABLE['M']).toEqual(before);
    expect(Object.keys(CHORD_TABLE)).toHaveLength(163);
    expect(CHORD_TABLE['brandnew']).toBeUndefined();
    expect(CHORD_TABLE['7']).toBeDefined();

    // A second call still returns the pristine values.
    const again = createChordList();
    expect(again.get('M')).toEqual(before);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MMARandom } from '../../src/engine/Random';

interface SeedVectors {
  random: number[];
  randint: number[];
  randrange: number[];
  choice: string[];
  choices: string[];
  shuffle: number[];
}

const vectors: Record<string, SeedVectors> = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/python/rng.json', import.meta.url)), 'utf-8'),
);

describe('MMARandom (CPython MT19937 compatibility)', () => {
  for (const [seed, expected] of Object.entries(vectors)) {
    it(`matches CPython for seed ${seed}`, () => {
      const rng = new MMARandom(Number(seed));
      expect(expected.random.map(() => rng.random())).toEqual(expected.random);
      expect(expected.randint.map(() => rng.randint(1, 10))).toEqual(expected.randint);
      expect(expected.randrange.map(() => rng.randrange(5, 20, 3))).toEqual(expected.randrange);
      expect(expected.choice.map(() => rng.choice(['a', 'bb', 'ccc', 'dddd']))).toEqual(expected.choice);
      expect(expected.choices.map(() => rng.choices(['x', 'y', 'z'], [1, 3, 6])[0])).toEqual(expected.choices);
      const list = [1, 2, 3, 4, 5, 6, 7, 8];
      rng.shuffle(list);
      expect(list).toEqual(expected.shuffle);
    });
  }

  it('supports getrandbits and default seeding', () => {
    const rng = new MMARandom(42);
    expect(rng.getrandbits(8)).toBeGreaterThanOrEqual(0);
    expect(rng.getrandbits(8)).toBeLessThan(256);
    const unseeded = new MMARandom();
    expect(typeof unseeded.random()).toBe('number');
  });
});

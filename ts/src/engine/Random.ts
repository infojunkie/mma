/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * CPython-compatible MT19937 random generator.  MMA relies on Python's
 * random module for skips, rtime, seqrnd, ornaments and voicing; to
 * reproduce output the generator must match CPython's bit for bit,
 * including its seeding procedure (init_by_array over the absolute
 * value split into 32-bit words) and genrand_res53 for random().
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;

export class MMARandom {
  private mt = new Int32Array(N);
  private mti = N + 1;

  constructor(seed?: number) {
    if (seed !== undefined) this.seed(seed);
  }

  /** Port of CPython _random.Random.seed for integer seeds. */
  seed(a: number): void {
    let n = Math.abs(Math.trunc(a));
    const key: number[] = [];
    if (n === 0) {
      key.push(0);
    } else {
      while (n > 0) {
        key.push(n % 0x100000000);
        n = Math.floor(n / 0x100000000);
      }
    }
    this.initByArray(key);
  }

  /** Port of CPython init_genrand. */
  private initGenrand(s: number): void {
    this.mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = this.mt[i - 1]!;
      this.mt[i] = (Math.imul(1812433253, (prev ^ (prev >>> 30)) >>> 0) + i) | 0;
    }
    this.mti = N;
  }

  /** Port of CPython init_by_array. */
  private initByArray(key: number[]): void {
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    let k = Math.max(N, key.length);
    for (; k; k--) {
      const prev = this.mt[i - 1]!;
      this.mt[i] = (((this.mt[i]! ^ Math.imul(prev ^ (prev >>> 30), 1664525)) + key[j]! + j) | 0);
      i++;
      j++;
      if (i >= N) {
        this.mt[0] = this.mt[N - 1]!;
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (k = N - 1; k; k--) {
      const prev = this.mt[i - 1]!;
      this.mt[i] = ((this.mt[i]! ^ Math.imul(prev ^ (prev >>> 30), 1566083941)) - i) | 0;
      i++;
      if (i >= N) {
        this.mt[0] = this.mt[N - 1]!;
        i = 1;
      }
    }
    this.mt[0] = 0x80000000 | 0;
  }

  /** Port of CPython genrand_int32. */
  genrandInt32(): number {
    let y: number;
    const mag01 = [0, MATRIX_A];

    if (this.mti >= N) {
      let kk: number;
      if (this.mti === N + 1) this.initGenrand(5489);
      for (kk = 0; kk < N - M; kk++) {
        y = (this.mt[kk]! & UPPER_MASK) | (this.mt[kk + 1]! & LOWER_MASK);
        this.mt[kk] = this.mt[kk + M]! ^ (y >>> 1) ^ mag01[y & 0x1]!;
      }
      for (; kk < N - 1; kk++) {
        y = (this.mt[kk]! & UPPER_MASK) | (this.mt[kk + 1]! & LOWER_MASK);
        this.mt[kk] = this.mt[kk + (M - N)]! ^ (y >>> 1) ^ mag01[y & 0x1]!;
      }
      y = (this.mt[N - 1]! & UPPER_MASK) | (this.mt[0]! & LOWER_MASK);
      this.mt[N - 1] = this.mt[M - 1]! ^ (y >>> 1) ^ mag01[y & 0x1]!;
      this.mti = 0;
    }

    y = this.mt[this.mti++]!;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** Python random.getrandbits(k). */
  getrandbits(k: number): number {
    if (k <= 32) return this.genrandInt32() >>> (32 - k);
    let result = 0;
    let shift = 0;
    let remaining = k;
    while (remaining > 0) {
      const take = Math.min(32, remaining);
      const word = this.genrandInt32() >>> (32 - take);
      result += word * Math.pow(2, shift);
      shift += take;
      remaining -= take;
    }
    return result;
  }

  /** Python random.random() - genrand_res53. */
  random(): number {
    const a = this.genrandInt32() >>> 5;
    const b = this.genrandInt32() >>> 6;
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
  }

  /** Python random._randbelow (with getrandbits). */
  private randbelow(n: number): number {
    if (n <= 0) throw new RangeError('randbelow requires n > 0');
    // CPython uses n.bit_length() (not (n-1).bit_length()) on purpose;
    // for powers of two this changes how many draws are consumed.
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** Python random.randrange(start, stop[, step]) with positive step. */
  randrange(start: number, stop?: number, step = 1): number {
    if (stop === undefined) {
      stop = start;
      start = 0;
    }
    const width = stop - start;
    if (step === 1) {
      return start + this.randbelow(width);
    }
    const n = Math.ceil(width / step);
    return start + step * this.randbelow(n);
  }

  /** Python random.randint(a, b). */
  randint(a: number, b: number): number {
    return a + this.randbelow(b - a + 1);
  }

  /** Python random.choice(seq). */
  choice<T>(seq: T[]): T {
    if (seq.length === 0) throw new RangeError('Cannot choose from an empty sequence');
    return seq[this.randbelow(seq.length)]!;
  }

  /** Python random.uniform(a, b). */
  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  /**
   * Python random.choices(population, weights, k) - with cum_weights
   * semantics (MMA's seqrnd passes cumulative weights).
   */
  choices<T>(population: T[], cumWeights: number[], k = 1): T[] {
    if (cumWeights.length !== population.length) {
      throw new RangeError('The number of weights does not match the population');
    }
    const total = cumWeights[cumWeights.length - 1] ?? 0;
    const out: T[] = [];
    for (let i = 0; i < k; i++) {
      const r = this.random() * total;
      // bisect_right(cumWeights, r)
      let lo = 0;
      let hi = cumWeights.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (r >= cumWeights[mid]!) lo = mid + 1;
        else hi = mid;
      }
      out.push(population[lo] ?? population[population.length - 1]!);
    }
    return out;
  }

  /** Python random.shuffle(seq) - in place, Fisher-Yates. */
  shuffle<T>(seq: T[]): void {
    for (let i = seq.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      const tmp = seq[i]!;
      seq[i] = seq[j]!;
      seq[j] = tmp;
    }
  }
}

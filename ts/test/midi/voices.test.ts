import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONTROLLER_INDEX,
  CONTROLLER_TABLE,
  DRUM_INDEX,
  DRUM_KITS,
  DRUM_KITS_BY_NAME,
  DRUM_TABLE,
  NONETONE,
  VOICE_INDEX,
  VOICE_TABLE,
  ctrlToValue,
  drumToValue,
  instToValue,
} from '../../src/midi/voices';

interface MiditablesFixture {
  nonetone: number;
  voice_table: (string | null)[];
  drum_table: (string | null)[];
  controller_table: (string | null)[];
  drum_kits_array: (string | null)[];
  drum_kits: Record<string, number>;
  voice_inx: Record<string, number>;
  drum_inx: Record<string, number>;
  ctrl_inx: Record<string, number>;
  inst_to_value: Record<string, number>;
  drum_to_value: Record<string, number>;
  ctrl_to_value: Record<string, number>;
  inst_to_value_probes: Record<string, number>;
  drum_to_value_probes: Record<string, number>;
  ctrl_to_value_probes: Record<string, number>;
}

const fx: MiditablesFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/python/miditables.json', import.meta.url)), 'utf-8'),
);

function checkCalls(fn: (name: string) => number, expected: Record<string, number>): void {
  for (const [name, value] of Object.entries(expected)) {
    expect(fn(name), `value for ${JSON.stringify(name)}`).toBe(value);
  }
}

describe('midi voice/drum/controller tables (Python MMA oracle)', () => {
  it('NONETONE matches the Python sentinel', () => {
    expect(NONETONE).toBe(fx.nonetone);
    expect(NONETONE).toBe(8323199);
  });

  it('VOICE_TABLE matches voiceNames (index base 0)', () => {
    expect(VOICE_TABLE).toEqual(fx.voice_table);
    expect(VOICE_TABLE).toHaveLength(128);
  });

  it('DRUM_TABLE matches drumNames (index base 27)', () => {
    expect(DRUM_TABLE).toEqual(fx.drum_table);
    expect(DRUM_TABLE).toHaveLength(88);
    expect(DRUM_TABLE[26]).toBeNull();
  });

  it('CONTROLLER_TABLE matches ctrlNames (index base 0)', () => {
    expect(CONTROLLER_TABLE).toEqual(fx.controller_table);
    expect(CONTROLLER_TABLE).toHaveLength(128);
  });

  it('DRUM_KITS and DRUM_KITS_BY_NAME match drumKits', () => {
    expect(DRUM_KITS).toEqual(fx.drum_kits_array);
    expect(DRUM_KITS_BY_NAME).toEqual(fx.drum_kits);
  });

  it('reverse index maps match voiceInx/drumInx/ctrlInx', () => {
    expect(VOICE_INDEX).toEqual(fx.voice_inx);
    expect(DRUM_INDEX).toEqual(fx.drum_inx);
    expect(CONTROLLER_INDEX).toEqual(fx.ctrl_inx);
  });
});

describe('instToValue (Python MMA oracle)', () => {
  it('matches for every voice name (and its lowercase form)', () => {
    checkCalls(instToValue, fx.inst_to_value);
  });

  it('matches edge-case probes including unknown names', () => {
    checkCalls(instToValue, fx.inst_to_value_probes);
  });
});

describe('drumToValue (Python MMA oracle)', () => {
  it('matches for every drum name (and its lowercase form)', () => {
    checkCalls(drumToValue, fx.drum_to_value);
  });

  it('matches numeric/unknown edge-case probes', () => {
    checkCalls(drumToValue, fx.drum_to_value_probes);
  });
});

describe('ctrlToValue (Python MMA oracle)', () => {
  it('matches for every controller name (and its lowercase form)', () => {
    checkCalls(ctrlToValue, fx.ctrl_to_value);
  });

  it('matches edge-case probes including unknown names', () => {
    checkCalls(ctrlToValue, fx.ctrl_to_value_probes);
  });
});

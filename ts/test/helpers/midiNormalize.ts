/**
 * Normalized MIDI event comparison for conformance tests.
 *
 * Python and the TypeScript port may legitimately differ in track
 * layout, running status and delta encoding, so tests compare parsed
 * event records keyed by (channel/meta, tick, kind, data) instead of
 * raw bytes.  Python .mid files are parsed with spessasynth_core's
 * BasicMIDI (available in Node), our own output with the same parser.
 */

import { BasicMIDI, MIDIMessageTypes } from 'spessasynth_core';
import type { MIDIDocument } from '../../src/midi/MIDIDocument';
import { unpackEvent } from '../../src/midi/MIDIWriter';

export interface NormalizedEvent {
  /** MIDI channel (0-based) for voice events; 'meta' for meta/sysex. */
  channel: number | 'meta';
  tick: number;
  kind: string;
  d1: number;
  d2: number;
  text?: string;
}

const META_KINDS: Record<number, string> = {
  [MIDIMessageTypes.text]: 'text',
  [MIDIMessageTypes.copyright]: 'copyright',
  [MIDIMessageTypes.trackName]: 'trackName',
  [MIDIMessageTypes.lyric]: 'lyric',
  [MIDIMessageTypes.marker]: 'marker',
  [MIDIMessageTypes.cuePoint]: 'cue',
  [MIDIMessageTypes.setTempo]: 'tempo',
  [MIDIMessageTypes.timeSignature]: 'timesig',
  [MIDIMessageTypes.keySignature]: 'keysig',
  [MIDIMessageTypes.midiPort]: 'midiPort',
  [MIDIMessageTypes.endOfTrack]: 'endOfTrack',
};

/** Normalize a BasicMIDI (either parsed from Python output or built by us). */
export function normalizeBasicMIDI(midi: BasicMIDI): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  for (const track of midi.tracks) {
    for (const ev of track.events) {
      const rec = normalizeStatus(ev.statusByte, ev.ticks, ev.data);
      if (rec) out.push(rec);
    }
  }
  return sortEvents(out);
}

/** Normalize our own MIDIDocument (packed MMA events). */
export function normalizeDocument(doc: MIDIDocument): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  for (const [ch, track] of doc.tracks) {
    for (const tick of track.offsets()) {
      for (const ev of track.miditrk.get(tick)!) {
        const { statusByte, data } = unpackEvent(ev);
        const mmaChannel = ch === 0 ? 'meta' : ch - 1; // mma channels are 1-based in the document
        const rec = normalizeStatus(statusByte, tick, data, mmaChannel);
        if (rec) out.push(rec);
      }
    }
  }
  return sortEvents(out);
}

function normalizeStatus(
  statusByte: number,
  tick: number,
  data: Uint8Array,
  channelOverride?: number | 'meta',
): NormalizedEvent | null {
  // Meta events use the meta type as status byte (spessasynth convention).
  if (statusByte < 0x80) {
    const kind = META_KINDS[statusByte] ?? `meta:${statusByte}`;
    if (kind === 'endOfTrack' || kind === 'midiPort') return null;
    const d1 = data[0] ?? 0;
    const d2 = data[1] ?? 0;
    const text = isTextKind(kind) ? decodeBytes(data) : undefined;
    return { channel: 'meta', tick, kind, d1, d2, text };
  }
  if (statusByte === 0xf0 || statusByte === 0xf7) {
    return { channel: 'meta', tick, kind: 'sysex', d1: data[0] ?? 0, d2: data[1] ?? 0 };
  }
  const channel = channelOverride !== undefined ? channelOverride : statusByte & 0x0f;
  const type = statusByte & 0xf0;
  const d1 = data[0] ?? 0;
  const d2 = data[1] ?? 0;
  switch (type) {
    case 0x90:
      return { channel, tick, kind: d2 > 0 ? 'noteOn' : 'noteOff', d1, d2 };
    case 0x80:
      return { channel, tick, kind: 'noteOff', d1, d2 };
    case 0xb0:
      return { channel, tick, kind: 'controller', d1, d2 };
    case 0xc0:
      return { channel, tick, kind: 'program', d1, d2 };
    case 0xe0:
      return { channel, tick, kind: 'pitchWheel', d1, d2 };
    case 0xa0:
      return { channel, tick, kind: 'polyPressure', d1, d2 };
    case 0xd0:
      return { channel, tick, kind: 'channelPressure', d1, d2 };
    default:
      return { channel, tick, kind: `event:${type >> 4}`, d1, d2 };
  }
}

function isTextKind(kind: string): boolean {
  return ['text', 'copyright', 'trackName', 'lyric', 'marker', 'cue'].includes(kind);
}

function decodeBytes(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

function sortEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  return events.sort(
    (a, b) =>
      a.tick - b.tick ||
      String(a.channel).localeCompare(String(b.channel)) ||
      a.kind.localeCompare(b.kind) ||
      a.d1 - b.d1 ||
      a.d2 - b.d2,
  );
}

export interface CompareOptions {
  /** Event kinds to drop from both sides (e.g. 'trackName', 'text'). */
  ignoreKinds?: string[];
}

/** Compare two normalized event lists; returns a human-readable diff or null. */
export function diffEvents(
  expected: NormalizedEvent[],
  actual: NormalizedEvent[],
  options: CompareOptions = {},
): string | null {
  const ignore = new Set(options.ignoreKinds ?? []);
  const filter = (evs: NormalizedEvent[]) => evs.filter((e) => !ignore.has(e.kind));
  const a = filter(expected);
  const b = filter(actual);
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y || !sameEvent(x, y)) {
      const fmt = (e?: NormalizedEvent) => (e ? JSON.stringify(e) : '<missing>');
      return `event #${i} differs:\n  python: ${fmt(x)}\n  ts:     ${fmt(y)}`;
    }
  }
  return null;
}

function sameEvent(a: NormalizedEvent, b: NormalizedEvent): boolean {
  return (
    a.tick === b.tick &&
    a.channel === b.channel &&
    a.kind === b.kind &&
    a.d1 === b.d1 &&
    a.d2 === b.d2 &&
    (a.text ?? '') === (b.text ?? '')
  );
}

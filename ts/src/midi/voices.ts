/**
 * MMA - Musical MIDI Accompaniment, TypeScript port.
 *
 * Port of MMA/miditables.py (voice, drum and controller tables) and the
 * name -> value converters in MMA/midiC.py (instToValue, drumToValue,
 * ctrlToValue).
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation; either version 2 of the License, or (at your option)
 * any later version (GPL-2.0-or-later).
 */

/**
 * Python's NONETONE sentinel -- the 127.127.127 "do nothing" voice.  The
 * Python source reads `(127 << 16) + (127 < 8) + 127`, where `<` is a typo
 * for `<<`; since `127 < 8` is False (0) Python computes 8323199 rather than
 * the intended 8323327.  The computed value is reproduced exactly here.
 */
export const NONETONE = (127 << 16) + (127 < 8 ? 1 : 0) + 127;

/**
 * General MIDI instrument names, port of Python's `voiceNames`.
 * Index base 0: VOICE_TABLE[program] for MIDI program 0..127.
 *
 * Python's `voiceNames` dict additionally maps NONETONE -> 'None'; that
 * sentinel is exported separately as NONETONE (see instToValue('None')).
 */
export const VOICE_TABLE: (string | null)[] = [
  'Piano1', 'Piano2', 'Piano3', 'Honky-TonkPiano', 'RhodesPiano', 'EPiano', 'HarpsiChord',
  'Clavinet', 'Celesta', 'Glockenspiel', 'MusicBox', 'Vibraphone', 'Marimba', 'Xylophone',
  'TubularBells', 'Santur', 'Organ1', 'Organ2', 'Organ3', 'ChurchOrgan', 'ReedOrgan',
  'Accordion', 'Harmonica', 'Bandoneon', 'NylonGuitar', 'SteelGuitar', 'JazzGuitar',
  'CleanGuitar', 'MutedGuitar', 'OverDriveGuitar', 'DistortionGuitar', 'GuitarHarmonics',
  'AcousticBass', 'FingeredBass', 'PickedBass', 'FretlessBass', 'SlapBass1', 'SlapBass2',
  'SynthBass1', 'SynthBass2', 'Violin', 'Viola', 'Cello', 'ContraBass', 'TremoloStrings',
  'PizzicatoString', 'OrchestralHarp', 'Timpani', 'Strings', 'SlowStrings', 'SynthStrings1',
  'SynthStrings2', 'ChoirAahs', 'VoiceOohs', 'SynthVox', 'OrchestraHit', 'Trumpet', 'Trombone',
  'Tuba', 'MutedTrumpet', 'FrenchHorn', 'BrassSection', 'SynthBrass1', 'SynthBrass2',
  'SopranoSax', 'AltoSax', 'TenorSax', 'BaritoneSax', 'Oboe', 'EnglishHorn', 'Bassoon',
  'Clarinet', 'Piccolo', 'Flute', 'Recorder', 'PanFlute', 'BottleBlow', 'Shakuhachi', 'Whistle',
  'Ocarina', 'SquareWave', 'SawWave', 'SynCalliope', 'ChifferLead', 'Charang', 'SoloVoice',
  '5thSawWave', 'Bass&Lead', 'Fantasia', 'WarmPad', 'PolySynth', 'SpaceVoice', 'BowedGlass',
  'MetalPad', 'HaloPad', 'SweepPad', 'IceRain', 'SoundTrack', 'Crystal', 'Atmosphere',
  'Brightness', 'Goblins', 'EchoDrops', 'StarTheme', 'Sitar', 'Banjo', 'Shamisen', 'Koto',
  'Kalimba', 'BagPipe', 'Fiddle', 'Shanai', 'TinkleBell', 'AgogoBells', 'SteelDrums',
  'WoodBlock', 'TaikoDrum', 'MelodicTom1', 'SynthDrum', 'ReverseCymbal', 'GuitarFretNoise',
  'BreathNoise', 'SeaShore', 'BirdTweet', 'TelephoneRing', 'HelicopterBlade', 'Applause/Noise',
  'GunShot',
];

/**
 * Standard GM drum tone names, port of Python's `drumNames`.
 * Index base 27: DRUM_TABLE[note] for MIDI note 27..87; entries 0..26 are
 * null because Python's dict has no such keys.
 */
export const DRUM_TABLE: (string | null)[] = [
  null, null, null, null, null, null, null, null, null, null, null, null, null, null, null,
  null, null, null, null, null, null, null, null, null, null, null, null, 'HighQ', 'Slap',
  'ScratchPush', 'ScratchPull', 'Sticks', 'SquareClick', 'MetronomeClick', 'MetronomeBell',
  'KickDrum2', 'KickDrum1', 'SideKick', 'SnareDrum1', 'HandClap', 'SnareDrum2', 'LowTom2',
  'ClosedHiHat', 'LowTom1', 'PedalHiHat', 'MidTom2', 'OpenHiHat', 'MidTom1', 'HighTom2',
  'CrashCymbal1', 'HighTom1', 'RideCymbal1', 'ChineseCymbal', 'RideBell', 'Tambourine',
  'SplashCymbal', 'CowBell', 'CrashCymbal2', 'VibraSlap', 'RideCymbal2', 'HighBongo',
  'LowBongo', 'MuteHighConga', 'OpenHighConga', 'LowConga', 'HighTimbale', 'LowTimbale',
  'HighAgogo', 'LowAgogo', 'Cabasa', 'Maracas', 'ShortHiWhistle', 'LongLowWhistle',
  'ShortGuiro', 'LongGuiro', 'Claves', 'HighWoodBlock', 'LowWoodBlock', 'MuteCuica',
  'OpenCuica', 'MuteTriangle', 'OpenTriangle', 'Shaker', 'JingleBell', 'Belltree', 'Castanets',
  'MuteSurdo', 'OpenSurdo',
];

/**
 * MIDI controller names, port of Python's `ctrlNames`.
 * Index base 0: CONTROLLER_TABLE[controller] for controller number 0..127.
 * Note the duplicate name 'Portamento' at 5 and 65.
 */
export const CONTROLLER_TABLE: (string | null)[] = [
  'Bank', 'Modulation', 'Breath', 'Ctrl3', 'Foot', 'Portamento', 'Data', 'Volume', 'Balance',
  'Ctrl9', 'Pan', 'Expression', 'Effect1', 'Effect2', 'Ctrl14', 'Ctrl15', 'General1',
  'General2', 'General3', 'General4', 'Ctrl20', 'Ctrl21', 'Ctrl22', 'Ctrl23', 'Ctrl24',
  'Ctrl25', 'Ctrl26', 'Ctrl27', 'Ctrl28', 'Ctrl29', 'Ctrl30', 'Ctrl31', 'BankLSB',
  'ModulationLSB', 'BreathLSB', 'Ctrl35', 'FootLSB', 'PortamentoLSB', 'DataLSB', 'VolumeLSB',
  'BalanceLSB', 'Ctrl41', 'PanLSB', 'ExpressionLSB', 'Effect1LSB', 'Effect2LSB', 'Ctrl46',
  'Ctrl47', 'General1LSB', 'General2LSB', 'General3LSB', 'General4LSB', 'Ctrl52', 'Ctrl53',
  'Ctrl54', 'Ctrl55', 'Ctrl56', 'Ctrl57', 'Ctrl58', 'Ctrl59', 'Ctrl60', 'Ctrl61', 'Ctrl62',
  'Ctrl63', 'Sustain', 'Portamento', 'Sostenuto', 'SoftPedal', 'Legato', 'Hold2', 'Variation',
  'Resonance', 'ReleaseTime', 'AttackTime', 'Brightness', 'DecayTime', 'VibratoRate',
  'VibratoDepth', 'VibratoDelay', 'Ctrl79', 'General5', 'General6', 'General7', 'General8',
  'PortamentoCtrl', 'Ctrl85', 'Ctrl86', 'Ctrl87', 'Ctrl88', 'Ctrl89', 'Ctrl90', 'Reverb',
  'Tremolo', 'Chorus', 'Detune', 'Phaser', 'DataInc', 'DataDec', 'NonRegLSB', 'NonRegMSB',
  'RegParLSB', 'RegParMSB', 'Ctrl102', 'Ctrl103', 'Ctrl104', 'Ctrl105', 'Ctrl106', 'Ctrl107',
  'Ctrl108', 'Ctrl109', 'Ctrl110', 'Ctrl111', 'Ctrl112', 'Ctrl113', 'Ctrl114', 'Ctrl115',
  'Ctrl116', 'Ctrl117', 'Ctrl118', 'Ctrl119', 'AllSoundsOff', 'ResetAll', 'LocalCtrl',
  'AllNotesOff', 'OmniOff', 'OmniOn', 'PolyOff', 'PolyOn',
];

/**
 * Named drum kits, port of Python's `drumKits` (which is a name -> value dict).
 * Index base 0: DRUM_KITS[kit] for kit program number 0..69; gaps are null.
 *
 * Because Python's dict has duplicate values (POWER/ROCK at 16, TR808/SYNTH1
 * at 25, ORCHESTRA/CLASSIC at 48) this value-indexed view is lossy.  As in
 * Python's reverse dict comprehensions (voiceInx, drumInx, ctrlInx), the
 * later dict entry wins.  The complete name -> value map is exported as
 * DRUM_KITS_BY_NAME.
 */
export const DRUM_KITS: (string | null)[] = [
  'STANDARD', 'STANDARD2', null, null, null, null, null, null, 'ROOM', null, null, null, null,
  null, null, null, 'ROCK', null, null, null, null, null, null, null, 'ELECTRONIC', 'SYNTH1',
  null, null, null, null, 'SYNTH2', null, 'JAZZ', null, null, null, null, null, null, null,
  'BRUSH', null, null, null, null, null, null, null, 'CLASSIC', null, null, null, null, null,
  null, null, 'SFX', null, null, null, null, null, null, null, 'HIPHOP1', 'HIPHOP2', 'TECHNO1',
  'TECHNO2', 'DANCE1', 'DANCE2',
];

/** Port of Python's `drumKits`: upper-case kit name -> kit program number. */
export const DRUM_KITS_BY_NAME: Readonly<Record<string, number>> = {
  BRUSH: 40, CLASSIC: 48, DANCE1: 68, DANCE2: 69, ELECTRONIC: 24, HIPHOP1: 64,
  HIPHOP2: 65, JAZZ: 32, ORCHESTRA: 48, POWER: 16, ROCK: 16, ROOM: 8, SFX: 56,
  STANDARD: 0, STANDARD2: 1, SYNTH1: 25, SYNTH2: 30, TECHNO1: 66, TECHNO2: 67,
  TR808: 25,
};

/**
 * Port of Python's `voiceInx`: upper-cased instrument name -> program value.
 * Built from VOICE_TABLE (later duplicates win) plus the NONETONE sentinel and
 * Python's "unfortunate spelling error" alias DISTORTONGUITAR.
 */
export const VOICE_INDEX: Readonly<Record<string, number>> = (() => {
  const m: Record<string, number> = {};
  VOICE_TABLE.forEach((n, i) => {
    if (n !== null) m[n.toUpperCase()] = i;
  });
  m['NONE'] = NONETONE;
  m['DISTORTONGUITAR'] = m['DISTORTIONGUITAR'];
  return m;
})();

/** Port of Python's `drumInx`: upper-cased drum tone name -> MIDI note number. */
export const DRUM_INDEX: Readonly<Record<string, number>> = (() => {
  const m: Record<string, number> = {};
  DRUM_TABLE.forEach((n, i) => {
    if (n !== null) m[n.toUpperCase()] = i;
  });
  return m;
})();

/** Port of Python's `ctrlInx`: upper-cased controller name -> controller number. */
export const CONTROLLER_INDEX: Readonly<Record<string, number>> = (() => {
  const m: Record<string, number> = {};
  CONTROLLER_TABLE.forEach((n, i) => {
    if (n !== null) m[n.toUpperCase()] = i;
  });
  return m;
})();

/**
 * ASCII-only port of Python's `int(s)` / `int(s, 0)` returning null where
 * Python raises ValueError.  Accepts surrounding whitespace, an optional
 * +/- sign, underscores between digits and, for base 0, 0x/0o/0b prefixes.
 * Base 0 rejects decimal leading zeros ("010"), except all-zero strings.
 */
function pyInt(s: string, base0: boolean): number | null {
  const t = s.trim();
  if (t === '') return null;

  let body = t;
  let sign = 1;
  if (body[0] === '+' || body[0] === '-') {
    if (body[0] === '-') sign = -1;
    body = body.slice(1);
  }
  if (body === '') return null;

  let radix = 10;
  if (base0 && /^0[xX]/.test(body)) {
    radix = 16;
    body = body.slice(2);
  } else if (base0 && /^0[oO]/.test(body)) {
    radix = 8;
    body = body.slice(2);
  } else if (base0 && /^0[bB]/.test(body)) {
    radix = 2;
    body = body.slice(2);
  }

  const re =
    radix === 16
      ? /^[0-9a-fA-F](?:_?[0-9a-fA-F])*$/
      : radix === 8
        ? /^[0-7](?:_?[0-7])*$/
        : radix === 2
          ? /^[01](?:_?[01])*$/
          : /^[0-9](?:_?[0-9])*$/;
  if (!re.test(body)) return null;

  const digits = body.replace(/_/g, '');
  if (base0 && radix === 10 && digits.length > 1 && digits[0] === '0' && /[1-9]/.test(digits)) {
    return null;
  }
  const value = sign * parseInt(digits, radix);
  // Python ints have no negative zero: int("-0") == 0.
  return value === 0 ? 0 : value;
}

/**
 * MMA's instToValue(): MIDI program number for an instrument name, or -1 for
 * an unknown name.  Lookup is case-insensitive; 'None' yields NONETONE and
 * 'Distortonguitar' is accepted for Python's spelling-error alias.
 */
export function instToValue(name: string): number {
  const v: number | undefined = VOICE_INDEX[name.toUpperCase()];
  return v === undefined ? -1 : v;
}

/**
 * MMA's drumToValue(): MIDI note number for a drum name, or -1 for an unknown
 * name.  As in Python, a string that parses as an integer literal 0..127 is
 * returned as a number (Python then re-parses with `int(name)`, so prefixed
 * forms such as "0x30" fall through to the name lookup and yield -1);
 * otherwise the upper-cased name is looked up in the drum table.
 */
export function drumToValue(name: string): number {
  const i = pyInt(name, true);
  if (i !== null) {
    if (i >= 0 && i <= 127) {
      const dec = pyInt(name, false);
      if (dec !== null) return dec;
      // Python's bare `except:` around `return int(name)` falls through here.
    } else {
      return -1;
    }
  }
  const v: number | undefined = DRUM_INDEX[name.toUpperCase()];
  return v === undefined ? -1 : v;
}

/** MMA's ctrlToValue(): controller number for a controller name, or -1. */
export function ctrlToValue(name: string): number {
  const v: number | undefined = CONTROLLER_INDEX[name.toUpperCase()];
  return v === undefined ? -1 : v;
}

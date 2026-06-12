// AUTO-SYNCED from ambient-art-pack/bgm-engine — DO NOT EDIT in project repos.
// Edit the canonical copy and run bgm-engine/sync.sh.

export type ScaleName =
  | "majorPentatonic"
  | "minorPentatonic"
  | "dorian"
  | "lydian";

export type MappingTarget =
  | "pad.cutoff" // normalized position within pad.filterCutoffHz range
  | "pad.volume" // 0 = volumeDb - 12dB, 1 = volumeDb
  | "melody.density" // scales melody interval: 0 = sparse (2x base), 1 = dense (0.5x base)
  | "melody.octaveBias" // 0 = low octave, 1 = high octave within melody.octaves
  | "texture.volume" // 0 = volumeDb - 12dB, 1 = volumeDb
  | "texture.lfoRate" // normalized position within texture.lfoRateHz range
  | "master.brightness" // 1 = master lowpass open (8kHz), 0 = dark (500Hz)
  | "perc.bpm"; // normalized position within percussion.bpm range

export interface SignalMapping {
  /** key produced by the project's signals adapter, value range 0..1 */
  signal: string;
  target: MappingTarget;
  /** normalized sub-range the signal maps into, e.g. [0.15, 1] */
  range: [number, number];
  curve?: "linear" | "exp";
}

export interface BgmPreset {
  key: string;
  rootNote: string; // e.g. "D2"
  scale: ScaleName;
  masterVolumeDb: number; // engine clamps to <= -14
  reverbDecaySec: number;
  pad: {
    enabled: boolean;
    volumeDb: number;
    synth: "fatsine" | "amsine" | "triangle";
    chordSize: 3 | 4;
    changeEverySec: [number, number];
    attackSec: number;
    releaseSec: number;
    filterCutoffHz: [number, number];
  };
  melody: {
    enabled: boolean;
    volumeDb: number;
    instrument: "bell" | "pluck" | "softsine";
    octaves: [number, number]; // octave numbers, e.g. [4, 5]
    baseIntervalSec: [number, number];
    /** when true, melody notes only fire via engine.triggerEvent() */
    eventTriggered: boolean;
  };
  texture: {
    enabled: boolean;
    volumeDb: number;
    kind: "ocean" | "wind" | "rain" | "hum" | "none";
    lfoRateHz: [number, number];
  };
  percussion: {
    enabled: boolean;
    volumeDb: number;
    kind: "heartbeat" | "softTick" | "none";
    bpm: [number, number];
  };
  mappings: SignalMapping[];
}

export interface BgmDebugState {
  contextState: string;
  seed: string;
  chord: string[];
  signals: Record<string, number>;
  meterDb: number;
}

import type { BgmPreset } from "./engine";

// Quake Globe: deep D minor-pentatonic drone — a slow planetary hum.
// Melody is event-only: bells ring when a new quake appears (bigger = harder),
// and a large recent quake darkens the whole mix.
export const preset: BgmPreset = {
  key: "quake-globe",
  rootNote: "D1",
  scale: "minorPentatonic",
  masterVolumeDb: -16,
  reverbDecaySec: 14,
  pad: {
    enabled: true,
    volumeDb: -14,
    synth: "fatsine",
    chordSize: 3,
    changeEverySec: [30, 55],
    attackSec: 8,
    releaseSec: 14,
    filterCutoffHz: [150, 600],
  },
  melody: {
    enabled: true,
    volumeDb: -20,
    instrument: "bell",
    octaves: [3, 5],
    baseIntervalSec: [8, 20],
    // notes only fire via triggerEvent() when a new quake shows up
    eventTriggered: true,
  },
  texture: {
    enabled: true,
    volumeDb: -18,
    kind: "hum",
    lfoRateHz: [0.03, 0.1],
  },
  percussion: {
    enabled: false,
    volumeDb: -30,
    kind: "none",
    bpm: [0, 0],
  },
  mappings: [
    // more quakes in the last hour → drone swells
    { signal: "quakeRate", target: "pad.volume", range: [0.3, 1] },
    // bigger recent max magnitude → darker, heavier mix (inverted brightness)
    { signal: "recentMaxMag", target: "master.brightness", range: [1, 0.4], curve: "exp" },
  ],
};

// AUTO-SYNCED from ambient-art-pack/bgm-engine — DO NOT EDIT in project repos.
// Edit the canonical copy and run bgm-engine/sync.sh.

import type { ScaleName } from "./types";

// ---------- seeded PRNG ----------

export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG. Same seed → same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "tide-pixels:tokyo:2026-06-12" — same piece+variant+day → same music. */
export function dailySeedString(key: string, variant: string, date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${key}:${variant}:${y}-${m}-${d}`;
}

// ---------- scales & notes ----------

export const SCALES: Record<ScaleName, number[]> = {
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

const NOTE_INDEX: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

/** "D2" → MIDI 38 */
export function noteToMidi(note: string): number {
  const m = note.match(/^([A-G][#b]?)(-?\d+)$/);
  if (!m) throw new Error(`bad note: ${note}`);
  return NOTE_INDEX[m[1]] + (parseInt(m[2], 10) + 1) * 12;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** scale degree (any integer, octave-wrapped) → MIDI relative to root */
export function degreeToMidi(rootMidi: number, scale: ScaleName, degree: number): number {
  const steps = SCALES[scale];
  const n = steps.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return rootMidi + oct * 12 + steps[idx];
}

/** Stacked-thirds chord on a scale degree (always inside the scale → no wrong notes). */
export function chordMidis(
  rootMidi: number,
  scale: ScaleName,
  degree: number,
  size: 3 | 4,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < size; i++) out.push(degreeToMidi(rootMidi, scale, degree + i * 2));
  return out;
}

/**
 * Seeded random walk over chord-root degrees. Stays in a calm diatonic set;
 * moves mostly by small steps so progressions feel intentional, not random.
 */
export function nextChordDegree(current: number, rnd: () => number): number {
  const moves = [-2, -1, -1, 0, 1, 1, 2, 3];
  const next = current + moves[Math.floor(rnd() * moves.length)];
  // keep walk in a band of about one octave of degrees
  if (next < -2) return -1;
  if (next > 5) return 4;
  return next;
}

/** Melody note candidates: chord tones + their scale neighbours, within octave range. */
export function melodyCandidates(
  rootMidi: number,
  scale: ScaleName,
  chordDegree: number,
  chordSize: 3 | 4,
  octaves: [number, number],
  octaveBias: number, // 0..1
): number[] {
  const rootOct = Math.floor(rootMidi / 12) - 1;
  const targetOct = octaves[0] + (octaves[1] - octaves[0]) * octaveBias;
  const lift = Math.round(targetOct - rootOct) * 12;
  const degs: number[] = [];
  for (let i = 0; i < chordSize; i++) {
    const d = chordDegree + i * 2;
    degs.push(d, d + 1); // chord tone + upper neighbour (still in scale)
  }
  return degs.map((d) => degreeToMidi(rootMidi, scale, d) + lift);
}

// ---------- mapping helpers ----------

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function applyCurve(t: number, curve?: "linear" | "exp"): number {
  const c = Math.min(1, Math.max(0, t));
  return curve === "exp" ? c * c : c;
}

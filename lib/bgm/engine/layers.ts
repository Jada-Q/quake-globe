// AUTO-SYNCED from ambient-art-pack/bgm-engine — DO NOT EDIT in project repos.
// Edit the canonical copy and run bgm-engine/sync.sh.

import * as Tone from "tone";
import type { BgmPreset } from "./types";

export interface PadLayer {
  synth: Tone.PolySynth;
  filter: Tone.Filter;
  volume: Tone.Volume;
  dispose(): void;
}

export function makePad(p: BgmPreset["pad"], out: Tone.ToneAudioNode): PadLayer {
  const volume = new Tone.Volume(p.volumeDb).connect(out);
  const filter = new Tone.Filter(p.filterCutoffHz[0], "lowpass").connect(volume);
  const oscType =
    p.synth === "fatsine" ? "fatsine" : p.synth === "amsine" ? "amsine" : "triangle";
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: oscType as never, ...(p.synth === "fatsine" ? { count: 3, spread: 18 } : {}) },
    envelope: {
      attack: p.attackSec,
      decay: 0.1,
      sustain: 1,
      release: p.releaseSec,
    },
  }).connect(filter);
  synth.maxPolyphony = 12; // overlapping chord changes with long releases
  return {
    synth,
    filter,
    volume,
    dispose() {
      synth.dispose();
      filter.dispose();
      volume.dispose();
    },
  };
}

export interface MelodyLayer {
  trigger(freq: number, velocity?: number): void;
  volume: Tone.Volume;
  dispose(): void;
}

export function makeMelody(p: BgmPreset["melody"], out: Tone.ToneAudioNode): MelodyLayer {
  const volume = new Tone.Volume(p.volumeDb).connect(out);
  let synth: { triggerAttackRelease(f: number, d: number, t?: number, v?: number): void; dispose(): void };
  if (p.instrument === "bell") {
    synth = new Tone.FMSynth({
      harmonicity: 3.01,
      modulationIndex: 14,
      oscillator: { type: "sine" },
      modulation: { type: "sine" },
      envelope: { attack: 0.01, decay: 2.2, sustain: 0, release: 3.5 },
      modulationEnvelope: { attack: 0.01, decay: 0.6, sustain: 0, release: 1 },
    }).connect(volume);
  } else if (p.instrument === "pluck") {
    synth = new Tone.PluckSynth({ dampening: 3200, resonance: 0.96 }).connect(volume);
  } else {
    synth = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.8, decay: 1.5, sustain: 0.2, release: 4 },
    }).connect(volume);
  }
  return {
    trigger(freq, velocity = 0.7) {
      synth.triggerAttackRelease(freq, 2.5, undefined, velocity);
    },
    volume,
    dispose() {
      synth.dispose();
      volume.dispose();
    },
  };
}

export interface TextureLayer {
  volume: Tone.Volume;
  lfo: Tone.LFO | null;
  setLfoRate(hz: number): void;
  dispose(): void;
}

export function makeTexture(p: BgmPreset["texture"], out: Tone.ToneAudioNode): TextureLayer {
  const volume = new Tone.Volume(p.volumeDb).connect(out);
  const disposables: { dispose(): void }[] = [volume];
  let lfo: Tone.LFO | null = null;

  if (p.kind !== "none") {
    const noiseType = p.kind === "hum" ? "brown" : "pink";
    const noise = new Tone.Noise(noiseType).start();
    const baseCutoff =
      p.kind === "ocean" ? 700 : p.kind === "wind" ? 1600 : p.kind === "rain" ? 3200 : 220;
    const filter = new Tone.Filter(baseCutoff, "lowpass");
    noise.connect(filter);
    filter.connect(volume);
    // slow swell: LFO on filter cutoff (ocean waves / wind gusts)
    lfo = new Tone.LFO(p.lfoRateHz[0], baseCutoff * 0.45, baseCutoff * 1.6).start();
    lfo.connect(filter.frequency);
    disposables.push(noise, filter, lfo);
  }

  return {
    volume,
    lfo,
    setLfoRate(hz) {
      if (lfo) lfo.frequency.rampTo(hz, 4);
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}

export interface PercussionLayer {
  setBpm(bpm: number): void;
  stop(): void;
  volume: Tone.Volume;
  dispose(): void;
}

export function makePercussion(
  p: BgmPreset["percussion"],
  out: Tone.ToneAudioNode,
): PercussionLayer | null {
  if (!p.enabled || p.kind === "none") return null;
  const volume = new Tone.Volume(p.volumeDb).connect(out);
  const synth =
    p.kind === "heartbeat"
      ? new Tone.MembraneSynth({
          pitchDecay: 0.08,
          octaves: 2,
          envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.4 },
        }).connect(volume)
      : new Tone.NoiseSynth({
          noise: { type: "white" },
          envelope: { attack: 0.001, decay: 0.05, sustain: 0 },
        }).connect(volume);

  let bpm = p.bpm[0];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = true;

  const tick = () => {
    if (!running) return;
    if (p.kind === "heartbeat") {
      (synth as Tone.MembraneSynth).triggerAttackRelease("A1", 0.4);
      // double-beat: lub-dub
      setTimeout(() => {
        if (running) (synth as Tone.MembraneSynth).triggerAttackRelease("G1", 0.3, undefined, 0.6);
      }, 220);
    } else {
      (synth as Tone.NoiseSynth).triggerAttackRelease(0.05);
    }
    timer = setTimeout(tick, (60 / bpm) * 1000);
  };
  timer = setTimeout(tick, 1000);

  return {
    setBpm(v) {
      bpm = Math.max(20, v);
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
    volume,
    dispose() {
      running = false;
      if (timer) clearTimeout(timer);
      synth.dispose();
      volume.dispose();
    },
  };
}

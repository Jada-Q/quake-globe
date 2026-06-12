// AUTO-SYNCED from ambient-art-pack/bgm-engine — DO NOT EDIT in project repos.
// Edit the canonical copy and run bgm-engine/sync.sh.

import * as Tone from "tone";
import type { BgmDebugState, BgmPreset, MappingTarget } from "./types";
import {
  applyCurve,
  chordMidis,
  dailySeedString,
  fnv1a,
  lerp,
  melodyCandidates,
  midiToFreq,
  mulberry32,
  nextChordDegree,
  noteToMidi,
} from "./theory";
import {
  makeMelody,
  makePad,
  makePercussion,
  makeTexture,
  type MelodyLayer,
  type PadLayer,
  type PercussionLayer,
  type TextureLayer,
} from "./layers";

const MASTER_DB_CEILING = -14;
const BRIGHTNESS_HZ: [number, number] = [500, 8000];
const FADE_IN_SEC = 5;

export interface BgmEngineOptions {
  variant?: string;
  /** URL overrides for tuning without code changes (?bgmseed= / ?bgmroot= / ?bgmscale=) */
  seedOverride?: string;
  rootOverride?: string;
  scaleOverride?: BgmPreset["scale"];
}

export class BgmEngine {
  private preset: BgmPreset;
  private opts: BgmEngineOptions;
  private rnd: () => number = Math.random;
  private seedStr = "";
  private rootMidi = 0;

  private running = false;
  private paused = false;
  private timers: ReturnType<typeof setTimeout>[] = [];

  private masterVolume: Tone.Volume | null = null;
  private masterFilter: Tone.Filter | null = null;
  private reverb: Tone.Reverb | null = null;
  private limiter: Tone.Limiter | null = null;
  private meter: Tone.Meter | null = null;

  private pad: PadLayer | null = null;
  private melody: MelodyLayer | null = null;
  private texture: TextureLayer | null = null;
  private perc: PercussionLayer | null = null;

  private chordDegree = 0;
  private currentChord: number[] = [];
  private octaveBias = 0.5;
  private melodyIntervalScale = 1;
  private signals: Record<string, number> = {};

  constructor(preset: BgmPreset, opts: BgmEngineOptions = {}) {
    this.preset = {
      ...preset,
      rootNote: opts.rootOverride ?? preset.rootNote,
      scale: opts.scaleOverride ?? preset.scale,
    };
    this.opts = opts;
  }

  /** Must be called after Tone.start() has resolved (user gesture or trusted context). */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const p = this.preset;

    this.seedStr =
      this.opts.seedOverride ??
      dailySeedString(p.key, this.opts.variant ?? "default", new Date());
    this.rnd = mulberry32(fnv1a(this.seedStr));
    this.rootMidi = noteToMidi(p.rootNote);

    // master chain: layers → filter → reverb → limiter → volume → destination
    this.masterVolume = new Tone.Volume(-60).toDestination();
    this.limiter = new Tone.Limiter(-3).connect(this.masterVolume);
    this.reverb = new Tone.Reverb({ decay: p.reverbDecaySec, wet: 0.4 }).connect(this.limiter);
    this.masterFilter = new Tone.Filter(BRIGHTNESS_HZ[1], "lowpass").connect(this.reverb);
    this.meter = new Tone.Meter({ smoothing: 0.9 });
    this.masterVolume.connect(this.meter);
    await this.reverb.ready;

    if (p.pad.enabled) this.pad = makePad(p.pad, this.masterFilter);
    if (p.melody.enabled) this.melody = makeMelody(p.melody, this.masterFilter);
    if (p.texture.enabled && p.texture.kind !== "none")
      this.texture = makeTexture(p.texture, this.masterFilter);
    this.perc = makePercussion(p.percussion, this.masterFilter);

    // fade in (also masks restarts after the wallpaper app's 10-min reload)
    this.masterVolume.volume.rampTo(Math.min(MASTER_DB_CEILING, p.masterVolumeDb), FADE_IN_SEC);

    this.schedulePad(0.2);
    if (p.melody.enabled && !p.melody.eventTriggered) this.scheduleMelody();
  }

  // ---------- scheduling ----------

  private later(sec: number, fn: () => void): void {
    const t = setTimeout(() => {
      if (this.running) fn();
    }, sec * 1000);
    this.timers.push(t);
    // prune fired timers occasionally
    if (this.timers.length > 50) this.timers = this.timers.slice(-25);
  }

  private schedulePad(delaySec: number): void {
    this.later(delaySec, () => {
      const p = this.preset.pad;
      if (!this.paused && this.pad) {
        this.chordDegree = nextChordDegree(this.chordDegree, this.rnd);
        this.currentChord = chordMidis(
          this.rootMidi,
          this.preset.scale,
          this.chordDegree,
          p.chordSize,
        );
        const holdSec = lerp(p.changeEverySec[0], p.changeEverySec[1], this.rnd());
        const freqs = this.currentChord.map(midiToFreq);
        this.pad.synth.triggerAttackRelease(freqs, holdSec);
        this.schedulePad(holdSec);
        return;
      }
      this.schedulePad(2); // paused: check again soon, don't advance the walk
    });
  }

  private scheduleMelody(): void {
    const m = this.preset.melody;
    const base = lerp(m.baseIntervalSec[0], m.baseIntervalSec[1], this.rnd());
    const interval = Math.max(4, base * this.melodyIntervalScale); // hard floor: stay sparse
    this.later(interval, () => {
      if (!this.paused) this.playMelodyNote();
      this.scheduleMelody();
    });
  }

  private playMelodyNote(velocity = 0.7): void {
    if (!this.melody) return;
    const m = this.preset.melody;
    const candidates = melodyCandidates(
      this.rootMidi,
      this.preset.scale,
      this.chordDegree,
      this.preset.pad.chordSize,
      m.octaves,
      this.octaveBias,
    );
    const freq = midiToFreq(candidates[Math.floor(this.rnd() * candidates.length)]);
    this.melody.trigger(freq, velocity);
  }

  /** Data-event hook (e.g. an earthquake): fires one melody note now. magnitude 0..1 */
  triggerEvent(magnitude = 0.5): void {
    if (!this.running || this.paused) return;
    this.playMelodyNote(0.4 + magnitude * 0.5);
  }

  // ---------- signals ----------

  setSignal(key: string, value: number): void {
    const v = Math.min(1, Math.max(0, value));
    this.signals[key] = v;
    if (!this.running) return;
    for (const map of this.preset.mappings) {
      if (map.signal !== key) continue;
      const t = lerp(map.range[0], map.range[1], applyCurve(v, map.curve));
      this.applyTarget(map.target, t);
    }
  }

  private applyTarget(target: MappingTarget, t: number): void {
    const p = this.preset;
    switch (target) {
      case "pad.cutoff":
        this.pad?.filter.frequency.rampTo(
          lerp(p.pad.filterCutoffHz[0], p.pad.filterCutoffHz[1], t), 8);
        break;
      case "pad.volume":
        this.pad?.volume.volume.rampTo(lerp(p.pad.volumeDb - 12, p.pad.volumeDb, t), 8);
        break;
      case "melody.density":
        this.melodyIntervalScale = lerp(2, 0.5, t);
        break;
      case "melody.octaveBias":
        this.octaveBias = t;
        break;
      case "texture.volume":
        this.texture?.volume.volume.rampTo(
          lerp(p.texture.volumeDb - 12, p.texture.volumeDb, t), 8);
        break;
      case "texture.lfoRate":
        this.texture?.setLfoRate(lerp(p.texture.lfoRateHz[0], p.texture.lfoRateHz[1], t));
        break;
      case "master.brightness":
        this.masterFilter?.frequency.rampTo(
          BRIGHTNESS_HZ[0] * Math.pow(BRIGHTNESS_HZ[1] / BRIGHTNESS_HZ[0], t), 8);
        break;
      case "perc.bpm":
        this.perc?.setBpm(lerp(p.percussion.bpm[0], p.percussion.bpm[1], t));
        break;
    }
  }

  // ---------- lifecycle ----------

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.perc?.stop();
    const raw = Tone.getContext().rawContext as AudioContext;
    if (raw.state === "running") void raw.suspend();
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    const raw = Tone.getContext().rawContext;
    if (raw.state === "suspended") void raw.resume();
  }

  async stop(fadeSec = 1.5): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.masterVolume?.volume.rampTo(-60, fadeSec);
    await new Promise((r) => setTimeout(r, fadeSec * 1000 + 100));
    this.dispose();
  }

  private dispose(): void {
    this.pad?.dispose();
    this.melody?.dispose();
    this.texture?.dispose();
    this.perc?.dispose();
    this.masterFilter?.dispose();
    this.reverb?.dispose();
    this.limiter?.dispose();
    this.meter?.dispose();
    this.masterVolume?.dispose();
    this.pad = this.melody = this.texture = this.perc = null;
    this.masterFilter = this.limiter = this.masterVolume = null;
    this.reverb = null;
    this.meter = null;
  }

  get isRunning(): boolean {
    return this.running;
  }

  getDebug(): BgmDebugState {
    const meterVal = this.meter?.getValue();
    return {
      contextState: Tone.getContext().rawContext.state,
      seed: this.seedStr,
      chord: this.currentChord.map(midiName),
      signals: { ...this.signals },
      meterDb: typeof meterVal === "number" ? Math.round(meterVal * 10) / 10 : -Infinity,
    };
  }
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midiName(m: number): string {
  return `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
}

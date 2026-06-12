// AUTO-SYNCED from ambient-art-pack/bgm-engine — DO NOT EDIT in project repos.
// Edit the canonical copy and run bgm-engine/sync.sh.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { BgmEngine } from "./engine";
import type { BgmDebugState, BgmPreset } from "./types";

export type BgmStatus = "off" | "on" | "blocked";

export interface UseBgmOptions {
  preset: BgmPreset;
  variant?: string;
  /** project adapter: returns normalized 0..1 signals (tideLevel, isNight, ...) */
  getSignals?: () => Record<string, number>;
  signalIntervalMs?: number;
}

export interface UseBgmResult {
  status: BgmStatus;
  /** true when running inside the wallpaper app (?embed=app) — hide all UI */
  embed: boolean;
  debug: BgmDebugState | null;
  toggle: () => void;
  /** fire a one-off melody note from a data event (magnitude 0..1) */
  triggerEvent: (magnitude?: number) => void;
}

const LS_KEY = "bgm";

declare global {
  interface Window {
    __bgmStart?: () => void;
    __bgmPause?: () => void;
    __bgmResume?: () => void;
    /** machine-readable engine state, for the wallpaper app / automated checks */
    __bgmStatus?: () => BgmDebugState | { running: false };
  }
}

export function useBgm(options: UseBgmOptions): UseBgmResult {
  const { preset, variant, getSignals, signalIntervalMs = 30000 } = options;
  const [status, setStatus] = useState<BgmStatus>("off");
  const [embed, setEmbed] = useState(false);
  const [debug, setDebug] = useState<BgmDebugState | null>(null);
  const engineRef = useRef<BgmEngine | null>(null);
  const signalTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const startEngine = useCallback(async () => {
    if (engineRef.current?.isRunning) return;
    const sp = new URLSearchParams(window.location.search);
    const engine = new BgmEngine(optionsRef.current.preset, {
      variant: optionsRef.current.variant,
      seedOverride: sp.get("bgmseed") ?? undefined,
      rootOverride: sp.get("bgmroot") ?? undefined,
      scaleOverride: (sp.get("bgmscale") as BgmPreset["scale"]) ?? undefined,
    });
    engineRef.current = engine;
    await engine.start();
    setStatus("on");

    const push = () => {
      const sig = optionsRef.current.getSignals?.();
      if (sig) for (const [k, v] of Object.entries(sig)) engine.setSignal(k, v);
    };
    push();
    if (signalTimerRef.current) clearInterval(signalTimerRef.current);
    signalTimerRef.current = setInterval(push, optionsRef.current.signalIntervalMs ?? 30000);
  }, []);

  const stopEngine = useCallback(() => {
    if (signalTimerRef.current) clearInterval(signalTimerRef.current);
    signalTimerRef.current = null;
    void engineRef.current?.stop();
    engineRef.current = null;
    setStatus("off");
  }, []);

  const toggle = useCallback(() => {
    if (engineRef.current?.isRunning) {
      localStorage.setItem(LS_KEY, "0");
      stopEngine();
    } else {
      localStorage.setItem(LS_KEY, "1");
      // Tone.start() inside the gesture handler — this IS the user gesture
      void Tone.start().then(startEngine);
    }
  }, [startEngine, stopEngine]);

  // mount: read URL contract, maybe autostart
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const isEmbed = sp.get("embed") === "app";
    setEmbed(isEmbed);
    const bgmParam = sp.get("bgm");
    const wanted =
      bgmParam === "1" || (bgmParam !== "0" && localStorage.getItem(LS_KEY) === "1");
    if (!wanted) return;

    let cancelled = false;
    void (async () => {
      // attempt resume without a gesture (works in WKWebView with the right config,
      // and in browsers where the user has interacted with the origin before)
      const raw = Tone.getContext().rawContext;
      await Promise.race([
        raw.resume().catch(() => undefined),
        new Promise((r) => setTimeout(r, 600)),
      ]);
      if (cancelled) return;
      if (raw.state === "running") {
        void startEngine();
      } else {
        setStatus("blocked");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [startEngine]);

  // blocked → first pointer/key anywhere unblocks (city switch is a full page nav,
  // so this is also the post-navigation recovery path)
  useEffect(() => {
    if (status !== "blocked") return;
    const unblock = () => {
      void Tone.start().then(startEngine);
    };
    window.addEventListener("pointerdown", unblock, { once: true });
    window.addEventListener("keydown", unblock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unblock);
      window.removeEventListener("keydown", unblock);
    };
  }, [status, startEngine]);

  // global hooks for the wallpaper app (Swift evaluateJavaScript)
  useEffect(() => {
    window.__bgmStart = () => {
      void Tone.start().then(startEngine);
    };
    window.__bgmPause = () => engineRef.current?.pause();
    window.__bgmResume = () => engineRef.current?.resume();
    window.__bgmStatus = () =>
      engineRef.current?.isRunning ? engineRef.current.getDebug() : { running: false };
    return () => {
      delete window.__bgmStart;
      delete window.__bgmPause;
      delete window.__bgmResume;
      delete window.__bgmStatus;
    };
  }, [startEngine]);

  // debug panel polling (?bgmdebug=1)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("bgmdebug") !== "1") return;
    const t = setInterval(() => {
      setDebug(engineRef.current?.getDebug() ?? null);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // unmount cleanup
  useEffect(() => stopEngine, [stopEngine]);

  const triggerEvent = useCallback((magnitude = 0.5) => {
    engineRef.current?.triggerEvent(magnitude);
  }, []);

  return { status, embed, debug, toggle, triggerEvent };
}

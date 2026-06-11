"use client";

// Thin React shell for the WebGL toon renderer. Owns: canvas element, the
// shared data hook, and DOM overlays (focus card; intro arrives in step 7).
// All rendering lives in ToonGlobeApp (lib/three/globe-app.ts).

import { useEffect, useRef, useState } from "react";
import { ToonGlobeApp } from "@/lib/three/globe-app";
import { useQuakes, type QuakeStats } from "@/lib/use-quakes";
import type { Quake } from "@/lib/usgs";
import type { Region } from "@/lib/regions";
import ToonBackdrop from "./ToonBackdrop";
import IntroOverlay from "./IntroOverlay";

const INFO_FADE_MS = 250;

interface FocusInfo {
  quake: Quake;
  arrivedAtMs: number;
}

export default function ToonGlobe({
  region,
  minMag,
  embed,
  intro,
  onStatsChange,
}: {
  region: Region;
  minMag: number;
  embed: boolean;
  intro: boolean;
  onStatsChange?: (s: QuakeStats) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<ToonGlobeApp | null>(null);
  const [focusInfo, setFocusInfo] = useState<FocusInfo | null>(null);
  // "showing" → letters up, BEGIN visible; "exiting" → fly-off in flight.
  const [introState, setIntroState] = useState<"showing" | "exiting" | "done">(
    intro ? "showing" : "done",
  );

  const { quakesRef, firstSeenRef, version } = useQuakes({
    region,
    minMag,
    onStatsChange,
  });

  // Mount/unmount the GL app (+ dev-only Tweakpane).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const app = new ToonGlobeApp({
      canvas,
      region,
      embed,
      intro,
      onFocusChange: (quake, arrivedAtMs) => {
        setFocusInfo(quake ? { quake, arrivedAtMs } : null);
      },
    });
    appRef.current = app;
    // The hook may already hold data (region switch remount after a poll).
    app.setQuakes(quakesRef.current, firstSeenRef.current);
    let disposePane: (() => void) | null = null;
    if (process.env.NODE_ENV === "development") {
      (window as unknown as { __toonApp?: ToonGlobeApp }).__toonApp = app;
    }
    if (process.env.NODE_ENV === "development" && !embed) {
      import("@/lib/three/debug-pane").then(async ({ mountDebugPane }) => {
        if (appRef.current === app) disposePane = await mountDebugPane(app);
      });
    }
    return () => {
      appRef.current = null;
      disposePane?.();
      app.dispose();
      setFocusInfo(null);
    };
    // quakesRef/firstSeenRef are stable refs from the hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed, region]);

  // Poll arrived → re-upload instance buffers.
  useEffect(() => {
    appRef.current?.setQuakes(quakesRef.current, firstSeenRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const handleBegin = () => {
    setIntroState("exiting");
    appRef.current?.startIntroExit(() => setIntroState("done"));
  };

  return (
    <>
      <ToonBackdrop />
      <canvas
        ref={canvasRef}
        className={
          "fixed inset-0 h-full w-full " +
          (introState === "done"
            ? "cursor-grab active:cursor-grabbing"
            : "pointer-events-none")
        }
        aria-label={`Quake Globe — ${region.label}`}
      />
      {introState === "showing" ? <IntroOverlay onBegin={handleBegin} /> : null}
      {focusInfo ? <ToonFocusCard info={focusInfo} /> : null}
    </>
  );
}

function ToonFocusCard({ info }: { info: FocusInfo }) {
  const [opacity, setOpacity] = useState(0);
  const { quake } = info;
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpacity(1));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className="pointer-events-none fixed bottom-20 left-1/2 z-30 -translate-x-1/2 select-none text-center md:bottom-24"
      style={{
        opacity,
        transition: `opacity ${INFO_FADE_MS}ms ease-out`,
      }}
    >
      <div className="rounded-md border-2 border-[#22302c] bg-[#efece3] px-4 py-2 text-[#22302c] shadow-[3px_3px_0_rgba(34,48,44,0.35)]">
        <div className="font-serif text-sm font-semibold md:text-base">
          M{quake.mag.toFixed(1)} · {quake.place || "—"}
        </div>
        <div className="mt-0.5 text-[11px] opacity-75 md:text-xs">
          {relativeTime(quake.time_ms)} · depth {quake.depth_km.toFixed(0)} km
          · {formatLocalIso(quake.time_ms)}
        </div>
      </div>
    </div>
  );
}

function relativeTime(timeMs: number): string {
  const diff = Date.now() - timeMs;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function formatLocalIso(timeMs: number): string {
  const d = new Date(timeMs);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

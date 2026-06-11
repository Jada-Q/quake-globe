"use client";

// Thin React shell for the WebGL toon renderer. Owns: canvas element, the
// shared data hook, and DOM overlays (intro / focus card in later steps).
// All rendering lives in ToonGlobeApp (lib/three/globe-app.ts).

import { useEffect, useRef } from "react";
import { ToonGlobeApp } from "@/lib/three/globe-app";
import { useQuakes, type QuakeStats } from "@/lib/use-quakes";
import type { Region } from "@/lib/regions";
import ToonBackdrop from "./ToonBackdrop";

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

  const { quakesRef, firstSeenRef, version } = useQuakes({
    region,
    minMag,
    onStatsChange,
  });

  // Mount/unmount the GL app (+ dev-only Tweakpane).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const app = new ToonGlobeApp({ canvas, region, embed });
    appRef.current = app;
    let disposePane: (() => void) | null = null;
    if (process.env.NODE_ENV === "development" && !embed) {
      import("@/lib/three/debug-pane").then(async ({ mountDebugPane }) => {
        if (appRef.current === app) disposePane = await mountDebugPane(app);
      });
    }
    return () => {
      appRef.current = null;
      disposePane?.();
      app.dispose();
    };
  }, [embed, region]);

  // Data → GPU buffers (quake layer lands in step 5; refs are wired now so
  // the dependency shape is final).
  useEffect(() => {
    void quakesRef;
    void firstSeenRef;
    void intro;
  }, [version, quakesRef, firstSeenRef, intro]);

  return (
    <>
      <ToonBackdrop />
      <canvas
        ref={canvasRef}
        className="fixed inset-0 h-full w-full cursor-grab active:cursor-grabbing"
        aria-label={`Quake Globe — ${region.label}`}
      />
    </>
  );
}

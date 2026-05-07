"use client";

import { useEffect, useRef, useState } from "react";
import { buildGlobeProjection } from "@/lib/projection";
import { getLand } from "@/lib/map";
import { fetchQuakes, filterQuakes, type Quake } from "@/lib/usgs";
import type { Region } from "@/lib/regions";

const POLL_MS = 60_000;
// How long a ring keeps expanding/fading after the canvas first sees the
// quake (wall-clock seconds since component-side firstSeen).
const RING_LIFETIME_MS = 90_000;
// Time after the last user interaction before auto-rotation resumes.
const AUTO_RESUME_MS = 3_000;
// Auto-rotation rate (degrees per RAF frame at ~60fps → ~6°/s, 60s/rev).
const AUTO_LAMBDA_PER_FRAME = 0.1;

interface QuakeStats {
  visibleCount: number;
  largest: Quake | null;
}

export default function QuakeCanvas({
  region,
  minMag,
  onStatsChange,
}: {
  region: Region;
  minMag: number;
  onStatsChange?: (s: QuakeStats) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  // All filtered quakes (by min magnitude — globe shows all globally now).
  const quakesRef = useRef<Map<string, Quake>>(new Map());
  // When this client first saw the quake — drives ring animation.
  const firstSeenRef = useRef<Map<string, number>>(new Map());
  const [, force] = useState(0);

  // Polling — fetch from /api/quakes every 60s.
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    const poll = async () => {
      try {
        const all = await fetchQuakes(ctrl.signal);
        if (cancelled) return;
        const filtered = filterQuakes(all, minMag);
        const now = Date.now();
        const next = new Map<string, Quake>();
        let largest: Quake | null = null;
        for (const q of filtered) {
          next.set(q.id, q);
          if (!firstSeenRef.current.has(q.id)) {
            firstSeenRef.current.set(q.id, now);
          }
          if (!largest || q.mag > largest.mag) largest = q;
        }
        for (const id of firstSeenRef.current.keys()) {
          if (!next.has(id)) firstSeenRef.current.delete(id);
        }
        quakesRef.current = next;
        onStatsChange?.({ visibleCount: next.size, largest });
        force((n) => (n + 1) % 1000);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (process.env.NODE_ENV === "development") {
          // eslint-disable-next-line no-console
          console.warn("usgs", e);
        }
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearInterval(id);
    };
  }, [minMag, onStatsChange]);

  // Reset firstSeen when minMag changes — ring animation should restart for
  // quakes newly entering the visible set.
  useEffect(() => {
    firstSeenRef.current.clear();
  }, [minMag]);

  // RAF render loop + interaction handlers.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const land = getLand();

    // Globe state (region preset feeds the initial values).
    let baseLambda = region.lambda; // current rotation longitude (drifts with auto)
    let userPhi = region.phi; // current tilt (drag adjusts)
    let userScale = region.scale;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartLambda = 0;
    let dragStartPhi = 0;
    // Sentinel: very far in the past, so on page load auto-rotation begins
    // immediately. The 3s `AUTO_RESUME_MS` gate only kicks in AFTER the user
    // touches (mouse / touch / wheel) the canvas at least once.
    let lastInteractionMs = -Infinity;
    // Two-finger pinch state
    let pinchStartDist = 0;
    let pinchStartScale = 1;

    const isLocked = () => !region.autoRotate; // 'japan' / 'americas' / 'europe' lock

    const draw = () => {
      const now = performance.now();
      // Auto-rotate when not dragging, region allows it, and 3s elapsed since
      // last interaction. (For locked regions: never auto-rotate.)
      if (
        !isDragging &&
        region.autoRotate &&
        now - lastInteractionMs > AUTO_RESUME_MS
      ) {
        baseLambda += AUTO_LAMBDA_PER_FRAME;
      }

      const lambda = baseLambda;
      const phi = userPhi;
      const scale = userScale;

      const proj = buildGlobeProjection(w, h, scale, lambda, phi);

      drawBackground(ctx, w, h);
      drawGlobeRim(ctx, w, h, proj.pixelRadius);
      drawSphere(ctx, proj, w, h);
      drawCoastlines(ctx, proj, land);

      const quakes = quakesRef.current;
      const firstSeen = firstSeenRef.current;
      const wallNow = Date.now();

      // Pass 1: persistent dim dots (so location stays markable after ring fades).
      for (const q of quakes.values()) {
        const xy = proj.projection([q.lng, q.lat]);
        if (!xy) continue;
        const front = proj.isFront(q.lng, q.lat);
        const alpha = front ? 0.55 : 0.18;
        ctx.fillStyle = magBaseColor(q.mag, alpha);
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], 1.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Pass 2: rings.
      for (const q of quakes.values()) {
        const seenAt = firstSeen.get(q.id) ?? wallNow;
        const ringAge = wallNow - seenAt;
        if (ringAge >= RING_LIFETIME_MS) continue;

        const xy = proj.projection([q.lng, q.lat]);
        if (!xy) continue;
        const front = proj.isFront(q.lng, q.lat);
        const hemiAlpha = front ? 1.0 : 0.25;

        const t = ringAge / RING_LIFETIME_MS;
        const maxR = 6 + q.mag * 14;
        const r = maxR * t;
        const ringAlpha = 0.85 * (1 - t) * hemiAlpha;

        ctx.strokeStyle = magColor(q.mag, ringAlpha);
        ctx.lineWidth = q.mag >= 5 ? 1.5 : 1;
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], r, 0, Math.PI * 2);
        ctx.stroke();

        // Strong outer glow for very recent (< 60 s) or M≥6 quakes — front only.
        if (front) {
          const wallAge = wallNow - q.time_ms;
          if (wallAge < 60_000 || q.mag >= 6) {
            const glow = ctx.createRadialGradient(
              xy[0],
              xy[1],
              0,
              xy[0],
              xy[1],
              maxR * 1.4,
            );
            const [rr, gg, bb] = magRgb(q.mag);
            const haloAlpha = q.mag >= 6 ? 0.32 : 0.18;
            glow.addColorStop(
              0,
              `rgba(${rr},${gg},${bb},${haloAlpha * (1 - t)})`,
            );
            glow.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(xy[0], xy[1], maxR * 1.4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      drawNoise(ctx, w, h);
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    // Mouse drag — overrides auto-rotation; locked regions still draggable
    // (drag temporarily breaks the lock by writing baseLambda/userPhi).
    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartLambda = baseLambda;
      dragStartPhi = userPhi;
      lastInteractionMs = performance.now();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      // Sensitivity: divide by ~3 of base radius so a full canvas drag is ~120°.
      const sensitivity = 0.4;
      baseLambda = dragStartLambda + dx * sensitivity;
      userPhi = clamp(dragStartPhi + dy * sensitivity, -85, 85);
      lastInteractionMs = performance.now();
    };
    const onMouseUp = () => {
      isDragging = false;
      lastInteractionMs = performance.now();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = 1 - e.deltaY * 0.0015;
      userScale = clamp(userScale * factor, 0.5, 5);
      lastInteractionMs = performance.now();
    };

    // Touch — single touch = drag, two-touch = pinch zoom.
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isDragging = true;
        dragStartX = e.touches[0].clientX;
        dragStartY = e.touches[0].clientY;
        dragStartLambda = baseLambda;
        dragStartPhi = userPhi;
      } else if (e.touches.length === 2) {
        isDragging = false;
        pinchStartDist = touchDist(e.touches);
        pinchStartScale = userScale;
      }
      lastInteractionMs = performance.now();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && isDragging) {
        e.preventDefault();
        const dx = e.touches[0].clientX - dragStartX;
        const dy = e.touches[0].clientY - dragStartY;
        const sensitivity = 0.4;
        baseLambda = dragStartLambda + dx * sensitivity;
        userPhi = clamp(dragStartPhi + dy * sensitivity, -85, 85);
        lastInteractionMs = performance.now();
      } else if (e.touches.length === 2 && pinchStartDist > 0) {
        e.preventDefault();
        const d = touchDist(e.touches);
        const factor = d / pinchStartDist;
        userScale = clamp(pinchStartScale * factor, 0.5, 5);
        lastInteractionMs = performance.now();
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        isDragging = false;
        pinchStartDist = 0;
      }
      lastInteractionMs = performance.now();
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("touchcancel", onTouchEnd);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [region]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 h-full w-full cursor-grab active:cursor-grabbing"
      aria-label={`Quake Globe — ${region.label}`}
    />
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function touchDist(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#0a0e1c");
  grad.addColorStop(1, "#050810");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawGlobeRim(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pixelRadius: number,
): void {
  const cx = w / 2;
  const cy = h / 2;
  // Faint outer halo — gives the sphere a sense of atmosphere.
  const halo = ctx.createRadialGradient(
    cx,
    cy,
    pixelRadius * 0.95,
    cx,
    cy,
    pixelRadius * 1.18,
  );
  halo.addColorStop(0, "rgba(120,160,200,0.10)");
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, pixelRadius * 1.18, 0, Math.PI * 2);
  ctx.fill();
}

function drawSphere(
  ctx: CanvasRenderingContext2D,
  proj: ReturnType<typeof buildGlobeProjection>,
  w: number,
  h: number,
): void {
  const cx = w / 2;
  const cy = h / 2;
  const r = proj.pixelRadius;
  // Radial gradient: top-left bright (the lit hemisphere), bottom-right darker.
  const grad = ctx.createRadialGradient(
    cx - r * 0.35,
    cy - r * 0.35,
    r * 0.05,
    cx,
    cy,
    r,
  );
  grad.addColorStop(0, "rgba(40,55,80,0.85)");
  grad.addColorStop(0.65, "rgba(18,26,42,0.85)");
  grad.addColorStop(1, "rgba(8,12,22,0.95)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawCoastlines(
  ctx: CanvasRenderingContext2D,
  proj: ReturnType<typeof buildGlobeProjection>,
  land: ReturnType<typeof getLand>,
): void {
  // Two passes: first the back hemisphere at low alpha (clipAngle 180 lets
  // d3-geo project all of land but we toggle clipAngle for each pass to
  // separate front from back).
  // Back hemisphere
  proj.projection.clipAngle(180);
  const pathAll = proj.path(ctx);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  pathAll(land);
  ctx.stroke();

  // Front hemisphere — clip to <90° (the visible cap)
  proj.projection.clipAngle(90);
  const pathFront = proj.path(ctx);
  ctx.strokeStyle = "rgba(255,255,255,0.32)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  pathFront(land);
  ctx.stroke();

  // Restore clipAngle to 180 so subsequent quake-marker projection() calls
  // return coordinates for both hemispheres (we apply the alpha ourselves).
  proj.projection.clipAngle(180);
}

function magRgb(mag: number): [number, number, number] {
  if (mag < 3) return [0xf0, 0xe8, 0xd4];
  if (mag < 4) return [0xff, 0xd8, 0x6a];
  if (mag < 5) return [0xff, 0x9f, 0x4a];
  if (mag < 6) return [0xff, 0x5a, 0x3a];
  return [0xd6, 0x2a, 0x3a];
}

function magColor(mag: number, alpha: number): string {
  const [r, g, b] = magRgb(mag);
  return `rgba(${r},${g},${b},${alpha})`;
}

function magBaseColor(mag: number, alpha: number): string {
  const [r, g, b] = magRgb(mag);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawNoise(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  ctx.fillStyle = "rgba(255,255,255,0.012)";
  for (let i = 0; i < 180; i++) {
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
  ctx.fillStyle = "rgba(0,0,0,0.018)";
  for (let i = 0; i < 180; i++) {
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
}

"use client";

import { useEffect, useRef, useState } from "react";
import { buildProjection } from "@/lib/projection";
import { getCoastlineRings } from "@/lib/map";
import { fetchQuakes, filterQuakes, type Quake } from "@/lib/usgs";
import type { Region } from "@/lib/regions";

const POLL_MS = 60_000;
// How long a ring keeps expanding/fading after the canvas first sees the
// quake (wall-clock seconds since component-side firstSeen).
const RING_LIFETIME_MS = 90_000;

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

  // All quakes in the region (filtered server data).
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
        const filtered = filterQuakes(all, region, minMag);
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
        // Drop firstSeen entries no longer in the feed (rolled out of 24h).
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
  }, [region, minMag, onStatsChange]);

  // Reset firstSeen when region/min changes — ring animation should restart
  // for quakes newly entering the visible set.
  useEffect(() => {
    firstSeenRef.current.clear();
  }, [region, minMag]);

  // RAF render loop.
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

    const rings = getCoastlineRings();

    const draw = () => {
      const proj = buildProjection(region, w, h);

      drawBackground(ctx, w, h);
      drawCoastlines(ctx, rings, proj);
      if (region.key !== "world") drawBboxFrame(ctx, proj);

      const now = Date.now();
      const quakes = quakesRef.current;
      const firstSeen = firstSeenRef.current;

      // Pass 1: dim persistent dots (so even after ring fades the location
      // still shows).
      for (const q of quakes.values()) {
        const { x, y } = proj.project(q.lat, q.lng);
        if (!isOnscreen(x, y, w, h)) continue;
        ctx.fillStyle = magBaseColor(q.mag, 0.35);
        ctx.beginPath();
        ctx.arc(x, y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Pass 2: rings (above dots).
      for (const q of quakes.values()) {
        const seenAt = firstSeen.get(q.id) ?? now;
        const ringAge = now - seenAt;
        if (ringAge >= RING_LIFETIME_MS) continue;

        const { x, y } = proj.project(q.lat, q.lng);
        if (!isOnscreen(x, y, w, h)) continue;

        const t = ringAge / RING_LIFETIME_MS; // 0..1
        const maxR = 6 + q.mag * 14;
        const r = maxR * t;
        const alpha = 0.85 * (1 - t);

        ctx.strokeStyle = magColor(q.mag, alpha);
        ctx.lineWidth = q.mag >= 5 ? 1.5 : 1;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();

        // Strong outer glow for very recent (< 60 s) or M≥6 quakes.
        const wallAge = now - q.time_ms;
        if (wallAge < 60_000 || q.mag >= 6) {
          const glow = ctx.createRadialGradient(x, y, 0, x, y, maxR * 1.4);
          const [rr, gg, bb] = magRgb(q.mag);
          const haloAlpha = q.mag >= 6 ? 0.32 : 0.18;
          glow.addColorStop(0, `rgba(${rr},${gg},${bb},${haloAlpha * (1 - t)})`);
          glow.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, maxR * 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      drawNoise(ctx, w, h);
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [region]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 h-full w-full"
      aria-label={`Quake Globe — ${region.label}`}
    />
  );
}

function isOnscreen(x: number, y: number, w: number, h: number): boolean {
  return x >= -200 && x <= w + 200 && y >= -200 && y <= h + 200;
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

function drawCoastlines(
  ctx: CanvasRenderingContext2D,
  rings: Array<Array<[number, number]>>,
  proj: ReturnType<typeof buildProjection>,
): void {
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 0.5;
  for (const ring of rings) {
    if (ring.length < 2) continue;
    ctx.beginPath();
    let prev: { x: number; y: number } | null = null;
    for (let i = 0; i < ring.length; i++) {
      const [lng, lat] = ring[i];
      const p = proj.project(lat, lng);
      // If two consecutive points are very far apart in pixels, the line
      // wrapped the antimeridian — break the path.
      if (prev) {
        const dx = Math.abs(p.x - prev.x);
        if (dx > proj.mapW * 0.5) {
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          prev = p;
          continue;
        }
        ctx.lineTo(p.x, p.y);
      } else {
        ctx.moveTo(p.x, p.y);
      }
      prev = p;
    }
    ctx.stroke();
  }
}

function drawBboxFrame(
  ctx: CanvasRenderingContext2D,
  proj: ReturnType<typeof buildProjection>,
): void {
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(proj.ox, proj.oy, proj.mapW, proj.mapH);
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

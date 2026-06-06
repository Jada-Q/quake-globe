"use client";

import { useEffect, useRef, useState } from "react";
import { buildGlobeProjection } from "@/lib/projection";
import { getLand } from "@/lib/map";
import { fetchQuakes, filterQuakes, type Quake } from "@/lib/usgs";
import { saveLastKnown, loadLastKnown } from "@/lib/last-known";
import type { Region } from "@/lib/regions";

const POLL_MS = 60_000;
// How long a ring keeps expanding/fading after the canvas first sees the
// quake (wall-clock seconds since component-side firstSeen).
const RING_LIFETIME_MS = 90_000;
// Time after the last user interaction before auto-rotation resumes.
const AUTO_RESUME_MS = 3_000;
// Auto-rotation rate (degrees per RAF frame at ~60fps → ~6°/s, 60s/rev).
const AUTO_LAMBDA_PER_FRAME = 0.1;
// Fly-in / fly-back transition durations (ms).
const FLY_IN_MS = 600;
const FLY_BACK_MS = 500;
// After this long with no mouse movement while in focus mode, auto fly back.
// Covers Plash desktop where the user can't easily double-click out.
const FOCUS_AUTO_EXIT_MS = 5_000;
// Info card fade-in duration after fly-in completes.
const INFO_FADE_MS = 250;
// Target zoom on fly-in.
const FOCUS_TARGET_SCALE = 3.0;
const FOCUS_MIN_SCALE_BOOST = 1.8;
const FOCUS_MAX_SCALE = 5.0;

interface QuakeStats {
  visibleCount: number;
  largest: Quake | null;
  /** Which upstream the currently-loaded quakes came from. Drives the
   *  data-source label in the bottom-left overlay. */
  source: "usgs" | "p2p";
  /** True when we asked for P2P but got USGS due to a P2P failure. */
  fallbackFromP2P: boolean;
  /** True when the displayed data is not confirmed-fresh: either the server
   *  served its stale cache, or we hydrated from localStorage after the fetch
   *  failed outright. */
  stale: boolean;
  /** unix ms of when the displayed data was last known fresh — only set when
   *  we hydrated from localStorage (we know the exact save time). null when
   *  the server served recent-ish stale cache (exact age unknown). */
  staleSince: number | null;
}

/**
 * Max ring radius (px) for a given magnitude, scaled inversely by current
 * globe zoom so zoomed-in regions don't drown in oversized rings.
 * sqrt(scale) keeps the relative-to-geography size roughly constant.
 */
function ringRadiusForMag(mag: number, scale: number = 1): number {
  return (6 + mag * 14) / Math.max(1, Math.sqrt(scale));
}

/** Click→quake hit threshold in pixels (uses base size, not scaled). */
function hitThresholdForMag(mag: number): number {
  return Math.max(20, (6 + mag * 14) * 0.6);
}

interface FocusInfo {
  quake: Quake;
  /** performance.now() when the fly-in completed — drives info-card fade. */
  arrivedAtMs: number;
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

  // Focus-mode state (lifted to React so info card can render in DOM).
  const [focusInfo, setFocusInfo] = useState<FocusInfo | null>(null);
  // The RAF loop owns the canonical mutable state via these refs so React
  // re-renders don't tear the animation. setFocusInfo is mirrored from a ref.
  const focusedQuakeRef = useRef<Quake | null>(null);

  // Polling — fetch from /api/quakes every 60s.
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    // Japan view → P2P/JMA (denser, ~M1+). Everywhere else → USGS (global).
    const desiredSource: "usgs" | "p2p" = region.key === "japan" ? "p2p" : "usgs";
    // localStorage slot for the last-known-state cache (per source).
    const lsKey = `quake-globe:last-known:${desiredSource}`;

    // Apply a set of quakes to the canvas + report stats. Shared by the live
    // path and the offline-hydrate path. `freshAt` is the firstSeen timestamp
    // stamped onto NEW ids: live data passes Date.now() so a fresh quake fires
    // a ring; hydrated stale data passes a far-past time so old quakes render
    // as quiet dots — a ring means "a quake just happened", firing it for
    // cached data would be a lie.
    const applyQuakes = (
      all: Quake[],
      meta: {
        source: "usgs" | "p2p";
        fallbackFromP2P: boolean;
        stale: boolean;
        staleSince: number | null;
        freshAt: number;
      },
    ) => {
      const filtered = filterQuakes(all, minMag);
      const next = new Map<string, Quake>();
      let largest: Quake | null = null;
      for (const q of filtered) {
        next.set(q.id, q);
        if (!firstSeenRef.current.has(q.id)) {
          firstSeenRef.current.set(q.id, meta.freshAt);
        }
        if (!largest || q.mag > largest.mag) largest = q;
      }
      for (const id of firstSeenRef.current.keys()) {
        if (!next.has(id)) firstSeenRef.current.delete(id);
      }
      quakesRef.current = next;
      onStatsChange?.({
        visibleCount: next.size,
        largest,
        source: meta.source,
        fallbackFromP2P: meta.fallbackFromP2P,
        stale: meta.stale,
        staleSince: meta.staleSince,
      });
      force((n) => (n + 1) % 1000);
    };

    const poll = async () => {
      try {
        const { quakes: all, fallbackFromP2P, stale } = await fetchQuakes(
          desiredSource,
          ctrl.signal,
        );
        if (cancelled) return;
        // Live success → persist as the new last-known state.
        saveLastKnown(lsKey, all);
        // The actual source is the desired one unless we were told we got
        // a fallback (P2P → USGS), defensive against header drift.
        const actualSource: "usgs" | "p2p" = fallbackFromP2P
          ? "usgs"
          : desiredSource;
        applyQuakes(all, {
          source: actualSource,
          fallbackFromP2P,
          stale,
          staleSince: null,
          freshAt: Date.now(),
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (process.env.NODE_ENV === "development") {
          // eslint-disable-next-line no-console
          console.warn("quakes", e);
        }
        // Fetch failed outright. If we already have data on screen, keep it —
        // a transient blip shouldn't downgrade good live data. Only when we
        // have NOTHING to show (cold start / first load offline) do we hydrate
        // from the last-known cache, so the user sees a populated globe + an
        // honest "last known N ago" marker instead of a misleading empty one.
        if (quakesRef.current.size > 0) return;
        const cached = loadLastKnown<Quake[]>(lsKey);
        if (cancelled || !cached || !Array.isArray(cached.data)) return;
        applyQuakes(cached.data, {
          source: desiredSource,
          fallbackFromP2P: false,
          stale: true,
          staleSince: cached.savedAt,
          // Far in the past → hydrated quakes are quiet dots, not live rings.
          freshAt: cached.savedAt - RING_LIFETIME_MS,
        });
      }
    };

    // Reset stale quakes when source changes — P2P uses "p2p:..." ids and
    // USGS uses native ids, so the maps are mutually exclusive anyway, but
    // resetting avoids briefly mixing sources during a region switch.
    quakesRef.current = new Map();
    firstSeenRef.current = new Map();

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearInterval(id);
    };
  }, [minMag, onStatsChange, region.key]);

  // Reset firstSeen when minMag changes — ring animation should restart for
  // quakes newly entering the visible set.
  useEffect(() => {
    firstSeenRef.current.clear();
  }, [minMag]);

  // Reset focus state when region changes (clicking a switcher dot navigates
  // URL → new Region prop → effect re-runs with fresh state). Also clear the
  // React-side info-card state.
  useEffect(() => {
    setFocusInfo(null);
    focusedQuakeRef.current = null;
  }, [region]);

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

    // Focus-mode state machine — owned entirely by the RAF closure.
    let focusedQuake: Quake | null = null;
    let transitionStartMs: number | null = null;
    let transitionDurationMs = FLY_IN_MS;
    let transitionFrom: { lambda: number; phi: number; scale: number } | null =
      null;
    let transitionTo: { lambda: number; phi: number; scale: number } | null =
      null;
    /** What we transition TO at the end of the current transition: a quake (focus mode) or null (back to free / region preset). */
    let transitionTargetQuake: Quake | null = null;
    // Last mousemove anywhere — drives the 5s auto-exit timer.
    let lastMouseMoveMs = -Infinity;
    // Mobile double-tap detection.
    let lastTapMs = -Infinity;
    let lastTapX = 0;
    let lastTapY = 0;

    const isInTransition = () => transitionStartMs !== null;
    const isInFocusMode = () => focusedQuake !== null;

    /** Snapshot the camera right now — used as fly-back target when exiting focus. */
    const snapshotView = () => ({
      lambda: baseLambda,
      phi: userPhi,
      scale: userScale,
    });
    /** What view we should fly back to when exiting focus mode. */
    const targetForExit = (): {
      lambda: number;
      phi: number;
      scale: number;
    } => {
      // Always return to the region preset view (works for both auto-rotate
      // 'world' / 'pacific-rim' and locked 'japan' / etc).
      return {
        lambda: region.lambda,
        phi: region.phi,
        scale: region.scale,
      };
    };

    const startFlyToQuake = (q: Quake) => {
      const from = snapshotView();
      // d3.geoOrthographic.rotate uses [-lng, -lat] to center (lng, lat).
      const targetLambda = -q.lng;
      const targetPhi = -q.lat;
      const boostedScale = Math.min(
        FOCUS_MAX_SCALE,
        Math.max(FOCUS_TARGET_SCALE, userScale * FOCUS_MIN_SCALE_BOOST),
      );
      transitionFrom = from;
      transitionTo = {
        lambda: targetLambda,
        phi: targetPhi,
        scale: boostedScale,
      };
      transitionTargetQuake = q;
      transitionDurationMs = FLY_IN_MS;
      transitionStartMs = performance.now();
    };

    const startFlyBack = () => {
      const from = snapshotView();
      const to = targetForExit();
      transitionFrom = from;
      transitionTo = to;
      transitionTargetQuake = null;
      transitionDurationMs = FLY_BACK_MS;
      transitionStartMs = performance.now();
      // We clear focus immediately so the info card starts hiding right away
      // (it's React-driven; the RAF closure also clears focusedQuake).
      focusedQuake = null;
      focusedQuakeRef.current = null;
      setFocusInfo(null);
    };

    /** Hit-test a canvas-space click (CSS px) against visible quakes.
     *  Returns the closest within-threshold front-hemisphere quake, biasing
     *  toward larger magnitude on near-ties. */
    const hitTest = (cx: number, cy: number): Quake | null => {
      const proj = buildGlobeProjection(w, h, userScale, baseLambda, userPhi);
      let best: Quake | null = null;
      let bestDist = Infinity;
      let bestMag = -Infinity;
      for (const q of quakesRef.current.values()) {
        // Skip back hemisphere — geoOrthographic still returns coords with
        // clipAngle(180), but we don't want to "click through" the globe.
        if (!proj.isFront(q.lng, q.lat)) continue;
        let xy: [number, number] | null;
        try {
          xy = proj.projection([q.lng, q.lat]) as [number, number] | null;
        } catch {
          continue;
        }
        if (!xy) continue;
        const dx = cx - xy[0];
        const dy = cy - xy[1];
        const dist = Math.hypot(dx, dy);
        const threshold = hitThresholdForMag(q.mag);
        if (dist > threshold) continue;
        // Closest wins; on near-tie (within 6 px), prefer larger magnitude.
        if (
          dist < bestDist - 6 ||
          (Math.abs(dist - bestDist) <= 6 && q.mag > bestMag)
        ) {
          best = q;
          bestDist = dist;
          bestMag = q.mag;
        }
      }
      return best;
    };

    const handleDoubleClickAt = (cssX: number, cssY: number) => {
      // Lock during transition — ignore.
      if (isInTransition()) return;
      const hit = hitTest(cssX, cssY);
      if (hit) {
        startFlyToQuake(hit);
      } else if (isInFocusMode()) {
        // Empty-space dblclick while focused → fly back.
        startFlyBack();
      }
      // Empty-space dblclick when NOT in focus → no-op.
      lastInteractionMs = performance.now();
    };

    const draw = () => {
      const now = performance.now();

      // 1) Transition step.
      if (
        transitionStartMs !== null &&
        transitionFrom &&
        transitionTo
      ) {
        const elapsed = now - transitionStartMs;
        const t = Math.min(1, elapsed / transitionDurationMs);
        // ease-out cubic: t' = 1 - (1-t)^3
        const eased = 1 - Math.pow(1 - t, 3);
        baseLambda = lerp(transitionFrom.lambda, transitionTo.lambda, eased);
        userPhi = lerp(transitionFrom.phi, transitionTo.phi, eased);
        userScale = lerp(transitionFrom.scale, transitionTo.scale, eased);
        if (t >= 1) {
          // Settle on the exact target (avoid float drift).
          baseLambda = transitionTo.lambda;
          userPhi = transitionTo.phi;
          userScale = transitionTo.scale;
          if (transitionTargetQuake) {
            focusedQuake = transitionTargetQuake;
            focusedQuakeRef.current = transitionTargetQuake;
            setFocusInfo({
              quake: transitionTargetQuake,
              arrivedAtMs: now,
            });
          }
          transitionStartMs = null;
          transitionFrom = null;
          transitionTo = null;
          transitionTargetQuake = null;
        }
      } else if (
        focusedQuake !== null &&
        now - lastMouseMoveMs > FOCUS_AUTO_EXIT_MS
      ) {
        // 2) Auto fly-back after 5s of no mouse movement.
        startFlyBack();
      } else if (
        !isDragging &&
        !isInFocusMode() &&
        region.autoRotate &&
        now - lastInteractionMs > AUTO_RESUME_MS
      ) {
        // 3) Existing auto-rotate (only when not focused, not transitioning).
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
        const maxR = ringRadiusForMag(q.mag, scale);
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

      // Focus-mode marker — a soft pulsing reticle on the focused quake so the
      // info card has a clear visual anchor.
      if (focusedQuake) {
        const xy = proj.projection([focusedQuake.lng, focusedQuake.lat]);
        if (xy) {
          const pulse = 0.5 + 0.5 * Math.sin(now / 350);
          ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.25 * pulse})`;
          ctx.lineWidth = 1;
          const baseR = Math.max(14, ringRadiusForMag(focusedQuake.mag, scale) * 0.45);
          ctx.beginPath();
          ctx.arc(xy[0], xy[1], baseR + 2 * pulse, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      drawNoise(ctx, w, h);
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    // Mouse drag — overrides auto-rotation; locked regions still draggable
    // (drag temporarily breaks the lock by writing baseLambda/userPhi).
    const onMouseDown = (e: MouseEvent) => {
      if (isInTransition()) return; // lock during fly-in/out
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartLambda = baseLambda;
      dragStartPhi = userPhi;
      lastInteractionMs = performance.now();
    };
    const onMouseMove = (e: MouseEvent) => {
      lastMouseMoveMs = performance.now();
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

    const onDoubleClick = (e: MouseEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      handleDoubleClickAt(cssX, cssY);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (isInTransition()) return; // lock zoom mid-flight
      const factor = 1 - e.deltaY * 0.0015;
      userScale = clamp(userScale * factor, 0.5, 5);
      lastInteractionMs = performance.now();
    };

    // Touch — single touch = drag, two-touch = pinch zoom.
    // Also: two single touches within 300ms at same location = double-tap.
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const t0 = e.touches[0];
        const tNow = performance.now();
        const dt = tNow - lastTapMs;
        const dx = t0.clientX - lastTapX;
        const dy = t0.clientY - lastTapY;
        const sameSpot = Math.hypot(dx, dy) <= 30;
        if (dt < 300 && sameSpot) {
          // Double-tap. Cancel any in-flight transition? Spec says lock during
          // transition — match that behaviour (ignore double-tap mid-flight).
          if (!isInTransition()) {
            const rect = canvas.getBoundingClientRect();
            handleDoubleClickAt(
              t0.clientX - rect.left,
              t0.clientY - rect.top,
            );
          }
          lastTapMs = -Infinity; // reset so triple-tap doesn't re-trigger
          return;
        }
        lastTapMs = tNow;
        lastTapX = t0.clientX;
        lastTapY = t0.clientY;
        if (isInTransition()) return; // lock drag mid-flight
        isDragging = true;
        dragStartX = t0.clientX;
        dragStartY = t0.clientY;
        dragStartLambda = baseLambda;
        dragStartPhi = userPhi;
      } else if (e.touches.length === 2) {
        // Pinch starts — cancel any in-flight transition (don't trap the user).
        if (isInTransition()) {
          transitionStartMs = null;
          transitionFrom = null;
          transitionTo = null;
          transitionTargetQuake = null;
        }
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
    canvas.addEventListener("dblclick", onDoubleClick);
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
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [region]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="fixed inset-0 h-full w-full cursor-grab active:cursor-grabbing"
        aria-label={`Quake Globe — ${region.label}`}
      />
      {focusInfo ? <FocusInfoCard info={focusInfo} /> : null}
    </>
  );
}

function FocusInfoCard({ info }: { info: FocusInfo }) {
  const [opacity, setOpacity] = useState(0);
  const { quake } = info;
  useEffect(() => {
    // Fade in starting from 0 → 0.85 over INFO_FADE_MS.
    const id = requestAnimationFrame(() => setOpacity(0.85));
    return () => cancelAnimationFrame(id);
  }, []);

  const rel = relativeTime(quake.time_ms);
  const localIso = formatLocalIso(quake.time_ms);

  return (
    <div
      className="pointer-events-none fixed bottom-20 left-1/2 z-30 -translate-x-1/2 select-none text-center font-serif italic text-white md:bottom-24"
      style={{
        opacity,
        transition: `opacity ${INFO_FADE_MS}ms ease-out`,
        textShadow: "0 1px 6px rgba(0,0,0,0.7)",
      }}
    >
      <div className="text-sm md:text-base">
        M{quake.mag.toFixed(1)} · {quake.place || "—"}
      </div>
      <div className="mt-0.5 text-[11px] opacity-80 md:text-xs">
        {rel} · depth {quake.depth_km.toFixed(0)} km · {localIso}
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
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function formatLocalIso(timeMs: number): string {
  const d = new Date(timeMs);
  // YYYY-MM-DD HH:MM in viewer's local TZ.
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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

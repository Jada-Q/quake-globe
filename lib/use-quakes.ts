"use client";

// Shared quake data hook — extracted verbatim from QuakeCanvas so both
// renderers (2D dark canvas / WebGL toon globe) consume identical polling,
// fallback, and last-known-cache behaviour.

import { useEffect, useRef, useState } from "react";
import { fetchQuakes, filterQuakes, type Quake } from "@/lib/usgs";
import { saveLastKnown, loadLastKnown } from "@/lib/last-known";
import type { Region } from "@/lib/regions";

export const POLL_MS = 60_000;
// How long a ring keeps expanding/fading after the canvas first sees the
// quake (wall-clock seconds since component-side firstSeen).
export const RING_LIFETIME_MS = 90_000;

export interface QuakeStats {
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

export interface UseQuakesResult {
  /** All filtered quakes (by min magnitude — globe shows all globally). */
  quakesRef: React.RefObject<Map<string, Quake>>;
  /** When this client first saw the quake — drives ring animation. */
  firstSeenRef: React.RefObject<Map<string, number>>;
  /** Bumps whenever the quake set changes — subscribe to re-upload buffers. */
  version: number;
}

export function useQuakes({
  region,
  minMag,
  onStatsChange,
}: {
  region: Region;
  minMag: number;
  onStatsChange?: (s: QuakeStats) => void;
}): UseQuakesResult {
  const quakesRef = useRef<Map<string, Quake>>(new Map());
  const firstSeenRef = useRef<Map<string, number>>(new Map());
  const [version, setVersion] = useState(0);

  // Polling — fetch from /api/quakes every 60s.
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    // Japan view → P2P/JMA (denser, ~M1+). Everywhere else → USGS (global).
    const desiredSource: "usgs" | "p2p" = region.key === "japan" ? "p2p" : "usgs";
    // localStorage slot for the last-known-state cache (per source).
    const lsKey = `quake-globe:last-known:${desiredSource}`;

    // Apply a set of quakes + report stats. Shared by the live path and the
    // offline-hydrate path. `freshAt` is the firstSeen timestamp stamped onto
    // NEW ids: live data passes Date.now() so a fresh quake fires a ring;
    // hydrated stale data passes a far-past time so old quakes render as
    // quiet dots — a ring means "a quake just happened", firing it for
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
      setVersion((n) => (n + 1) % 1000);
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

  return { quakesRef, firstSeenRef, version };
}

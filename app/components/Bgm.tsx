"use client";

import { useCallback, useEffect, useRef } from "react";
import { BgmToggle, useBgm } from "@/lib/bgm/engine";
import { preset } from "@/lib/bgm/preset";
import { getSignals, magToNorm } from "@/lib/bgm/signals";
import { fetchQuakes, type Quake } from "@/lib/usgs";

// Bgm polls /api/quakes on its own (reusing lib/usgs.fetchQuakes — the same
// proxy useQuakes hits, so the server cache absorbs the duplicate) to keep
// the audio layer fully decoupled from the existing data hook / canvases.
const POLL_MS = 60_000;
// Avoid a bell blast if one poll surfaces many new quakes at once.
const MAX_EVENT_TRIGGERS_PER_POLL = 8;
const EVENT_STAGGER_MS = 400;

export default function Bgm({
  regionKey,
  variant,
}: {
  regionKey: string;
  variant: string;
}) {
  const quakesRef = useRef<Quake[]>([]);

  const getSignalsFromQuakes = useCallback(() => getSignals(quakesRef.current), []);
  const bgm = useBgm({ preset, variant, getSignals: getSignalsFromQuakes });
  const { triggerEvent } = bgm;

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    // Same source choice as useQuakes: Japan view → P2P/JMA, else USGS.
    const source: "usgs" | "p2p" = regionKey === "japan" ? "p2p" : "usgs";
    // null until the first successful poll — the initial set is not "new",
    // so it never fires events (mirrors useQuakes' firstSeen semantics).
    let seenIds: Set<string> | null = null;

    const poll = async () => {
      try {
        const { quakes } = await fetchQuakes(source, ctrl.signal);
        if (cancelled) return;
        quakesRef.current = quakes;
        if (seenIds !== null) {
          const fresh = quakes.filter((q) => !seenIds!.has(q.id));
          fresh
            .slice(0, MAX_EVENT_TRIGGERS_PER_POLL)
            .forEach((q, i) => {
              timeouts.push(
                setTimeout(() => triggerEvent(magToNorm(q.mag)), i * EVENT_STAGGER_MS),
              );
            });
        }
        seenIds = new Set(quakes.map((q) => q.id));
      } catch {
        // transient fetch failure — keep the last signals, retry next tick
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearInterval(id);
      for (const t of timeouts) clearTimeout(t);
    };
  }, [regionKey, triggerEvent]);

  return (
    <BgmToggle status={bgm.status} embed={bgm.embed} debug={bgm.debug} onToggle={bgm.toggle} />
  );
}

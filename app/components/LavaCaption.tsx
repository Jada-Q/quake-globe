"use client";

import { useEffect, useState } from "react";

const LAVA_GIST_RAW =
  "https://gist.githubusercontent.com/Jada-Q/d674be530b9a9a061c76b118d6284939/raw/lava-init.md";

// Refetch interval for the daily caption. This is a long-running ambient
// wallpaper (Plash) — without periodic refetch a caption fetched once on mount
// stays frozen for days and never picks up the next day's poem. The cron
// updates once daily, so catching up within the hour is plenty; no need to poll
// aggressively.
const REFETCH_MS = 30 * 60_000;

export default function LavaCaption({
  theme,
}: {
  theme: "toon" | "dark";
}) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      // Compute the date-based cache-buster FRESH on every call, not once on
      // mount — otherwise an always-open wallpaper crossing midnight keeps
      // requesting yesterday's `?t=` key and can be served a stale CDN object.
      const today = new Date().toISOString().slice(0, 10);
      fetch(`${LAVA_GIST_RAW}?t=${today}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
        .then((body) => {
          if (cancelled) return;
          const trimmed = body.trim();
          if (trimmed && !trimmed.startsWith("🪨 Lava — initializing")) {
            setText(trimmed);
          }
        })
        .catch(() => {
          // silent: keep showing the last good caption (the date header is its
          // own staleness signal — better an older date than a blank), and
          // never blank out a caption we already have on a transient failure.
        });
    };

    load();
    const interval = setInterval(load, REFETCH_MS);
    // Also refetch at the moments an always-on surface has most likely gone
    // stale: when the wallpaper becomes visible again (Plash wake / tab
    // refocus) and when the network comes back.
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", load);
    window.addEventListener("online", load);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", load);
      window.removeEventListener("online", load);
    };
  }, []);

  if (!text) return null;

  const ink = theme === "toon";

  return (
    <div
      className={
        "pointer-events-none fixed bottom-32 left-1/2 z-10 hidden -translate-x-1/2 select-none px-4 text-center font-serif md:block lg:bottom-40 " +
        (ink ? "text-[#22302c]" : "text-white")
      }
      style={ink ? undefined : { textShadow: "0 1px 4px rgba(0,0,0,0.55)" }}
    >
      <div className="mb-1 text-[10px] uppercase tracking-[0.25em] opacity-45">
        from the core
      </div>
      <div className="max-w-[420px] whitespace-pre-wrap text-[12px] italic leading-relaxed opacity-70">
        {text}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

// IMPORTANT: this switcher MUST use `group/btn` per-dot hover pattern, NOT
// container `group-hover`. The container-only pattern makes ALL labels appear
// on any hover and they collide. See feedback_switcher_per_dot_hover.md —
// this bug has been repeated 4×; do not be the 5th.

const REGIONS: Array<{ key: string; label: string }> = [
  { key: "world", label: "World" },
  { key: "japan", label: "Japan" },
  { key: "americas", label: "Americas" },
  { key: "europe", label: "Europe" },
  { key: "pacific-rim", label: "Pacific Rim" },
];

export default function RegionSwitcher({
  active,
  theme,
}: {
  active: string;
  theme: "toon" | "dark";
}) {
  const [hidden, setHidden] = useState(false);
  // Current query string, read after mount — empty during SSR/hydration so
  // server and client render identical hrefs (no hydration mismatch).
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("embed") === "app") {
      setHidden(true);
    }
    setSearch(window.location.search);
  }, []);
  if (hidden) return null;

  // Region links must carry the rest of the query string (theme/min) —
  // a bare `?r=` would silently kick a dark-theme user back to toon.
  const hrefFor = (key: string) => {
    const params = new URLSearchParams(search);
    params.set("r", key);
    return `?${params.toString()}`;
  };

  const ink = theme === "toon";

  return (
    <div
      className="pointer-events-none fixed z-20 select-none
        max-md:right-3 max-md:top-1/2 max-md:-translate-y-1/2
        md:bottom-7 md:left-1/2 md:-translate-x-1/2"
      style={
        ink ? undefined : { textShadow: "0 1px 4px rgba(0,0,0,0.55)" }
      }
    >
      <div
        className="pointer-events-auto group flex items-center rounded-full opacity-30 transition-opacity duration-500 hover:opacity-100
          max-md:flex-col max-md:gap-4 max-md:px-2 max-md:py-3
          md:flex-row md:gap-5 md:px-5 md:py-3"
      >
        {REGIONS.map((r) => {
          const isActive = active === r.key;
          const dotActive = ink
            ? "h-2 w-2 bg-[#22302c] shadow-[0_0_6px_rgba(34,48,44,0.45)]"
            : "h-2 w-2 bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]";
          const dotIdle = ink
            ? "h-1.5 w-1.5 bg-[#22302c]/50 group-hover/btn:h-2 group-hover/btn:w-2 group-hover/btn:bg-[#22302c]"
            : "h-1.5 w-1.5 bg-white/55 group-hover/btn:h-2 group-hover/btn:w-2 group-hover/btn:bg-white";
          return (
            <a
              key={r.key}
              href={hrefFor(r.key)}
              className="group/btn relative flex h-6 w-6 items-center justify-center"
              aria-label={r.label}
              title={r.label}
            >
              <span
                className={
                  "block rounded-full transition-all duration-300 " +
                  (isActive ? dotActive : dotIdle)
                }
              />
              <span
                className={
                  "pointer-events-none absolute whitespace-nowrap font-serif text-[11px] tracking-wide opacity-0 transition-opacity duration-300 group-hover/btn:opacity-90 max-md:right-7 max-md:top-1/2 max-md:-translate-y-1/2 md:-top-7 " +
                  (ink ? "text-[#22302c]" : "text-white")
                }
              >
                {r.label}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

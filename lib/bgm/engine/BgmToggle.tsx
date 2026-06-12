// AUTO-SYNCED from ambient-art-pack/bgm-engine — DO NOT EDIT in project repos.
// Edit the canonical copy and run bgm-engine/sync.sh.
"use client";

import type { BgmDebugState } from "./types";
import type { BgmStatus } from "./useBgm";

/**
 * Speaker toggle, bottom-right. Visual language cloned from CitySwitcher:
 * opacity-30 → hover 100, serif 11px labels, soft text shadow.
 * Hidden entirely in ?embed=app (wallpaper) mode.
 */
export default function BgmToggle({
  status,
  embed,
  debug,
  onToggle,
}: {
  status: BgmStatus;
  embed: boolean;
  debug: BgmDebugState | null;
  onToggle: () => void;
}) {
  if (embed) return null;

  return (
    <>
      <div
        className="fixed bottom-7 right-7 z-20 select-none"
        style={{ textShadow: "0 1px 4px rgba(0,0,0,0.55)" }}
      >
        <button
          onClick={onToggle}
          aria-label={status === "on" ? "Mute background music" : "Play background music"}
          className="group/bgm relative flex h-8 w-8 items-center justify-center rounded-full opacity-30 transition-opacity duration-500 hover:opacity-100"
        >
          <SpeakerIcon on={status === "on"} />
          <span
            className="pointer-events-none absolute -top-7 whitespace-nowrap font-serif text-[11px] tracking-wide text-white opacity-0 transition-opacity duration-300 group-hover/bgm:opacity-90"
          >
            {status === "on" ? "sound off" : "sound on"}
          </span>
        </button>
      </div>

      {status === "blocked" && (
        <button
          onClick={onToggle}
          className="fixed bottom-7 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/40 px-4 py-1.5 font-serif text-[12px] tracking-wide text-white/90 backdrop-blur-sm transition-opacity duration-500 hover:bg-black/55 md:bottom-20"
          style={{ textShadow: "0 1px 4px rgba(0,0,0,0.55)" }}
        >
          ♪ tap for sound
        </button>
      )}

      {debug && (
        <pre className="pointer-events-none fixed left-3 top-3 z-30 rounded bg-black/60 p-2 font-mono text-[10px] leading-relaxed text-green-300">
          {`ctx: ${debug.contextState}
seed: ${debug.seed}
chord: ${debug.chord.join(" ")}
meter: ${debug.meterDb} dB
${Object.entries(debug.signals)
  .map(([k, v]) => `${k}: ${v.toFixed(3)}`)
  .join("\n")}`}
        </pre>
      )}
    </>
  );
}

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 6v4h2.5L8 13V3L4.5 6H2z"
        fill="white"
        fillOpacity={on ? 1 : 0.55}
      />
      {on ? (
        <>
          <path d="M10 5.5c.9.6 1.5 1.5 1.5 2.5s-.6 1.9-1.5 2.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M11.5 3.5c1.5 1 2.5 2.6 2.5 4.5s-1 3.5-2.5 4.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.7" />
        </>
      ) : (
        <path d="M10.5 6l3 4M13.5 6l-3 4" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.7" />
      )}
    </svg>
  );
}

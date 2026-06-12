import type { Quake } from "@/lib/usgs";

// Normalized 0..1 signals consumed by the BGM engine's preset mappings.
// Pure math over the already-fetched quake list — no network here.

const HOUR_MS = 60 * 60 * 1000;

// Heuristic ceiling: USGS all_day global typically shows ~5-20 quakes/hour,
// P2P/JMA (Japan, ~M1+) is similar — 15/hour saturates the drone.
const RATE_CEILING = 15;

/** Magnitude → 0..1, anchored at M3 ≈ 0.3 and M7 ≈ 1.0 (linear, clamped). */
export function magToNorm(mag: number): number {
  return clamp01(0.3 + (mag - 3) * 0.175);
}

export function getSignals(
  quakes: Quake[],
  now: number = Date.now(),
): Record<string, number> {
  const cutoff = now - HOUR_MS;
  let count = 0;
  let maxMag: number | null = null;
  for (const q of quakes) {
    if (q.time_ms < cutoff) continue;
    count += 1;
    if (maxMag === null || q.mag > maxMag) maxMag = q.mag;
  }
  return {
    // quakes in the last hour, normalized → pad swell
    quakeRate: clamp01(count / RATE_CEILING),
    // largest quake in the last hour → mix darkens (mapping inverts it)
    recentMaxMag: maxMag === null ? 0 : magToNorm(maxMag),
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

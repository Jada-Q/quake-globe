// Last-known-state cache — the "Find My" pattern.
//
// When a live data source is unreachable (cold start + upstream down, network
// drop, 502), fall back to the last payload we successfully fetched instead of
// showing a blank screen — and keep the timestamp so the UI can honestly mark
// it "stale / last known N ago" rather than pretending it's live.
//
// Generic over the payload type, persisted to localStorage under a caller-
// supplied key. This file is intentionally dependency-free and project-
// agnostic: copy it as-is into any ambient piece that polls an external feed
// (tide-pixels, sky-traffic, bay-ships, …) and wire save-on-success /
// hydrate-on-failure at the poll site.

export interface LastKnown<T> {
  /** The last payload fetched fresh from the live source. */
  data: T;
  /** unix ms when that payload was fetched fresh. */
  savedAt: number;
}

/**
 * Persist a fresh payload as the new last-known state. Call this on every
 * successful fetch. Never throws — last-known is a nice-to-have; a failed cache
 * write (quota, private mode, disabled storage) must not break the live path.
 */
export function saveLastKnown<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    const entry: LastKnown<T> = { data, savedAt: Date.now() };
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // ignore — see doc comment
  }
}

/**
 * Read the last-known payload, or null if none / corrupt. Call this only when
 * the live fetch failed AND you have nothing else to show (e.g. a fresh load),
 * so a transient single failure doesn't replace good live data with older data.
 */
export function loadLastKnown<T>(key: string): LastKnown<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastKnown<T>;
    if (typeof parsed?.savedAt !== "number" || parsed.data == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

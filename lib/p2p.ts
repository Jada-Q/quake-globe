// P2P Quake API parser & fetcher (Japan domestic, JMA-based feed).
//
// Upstream (public, no auth):
//   https://api.p2pquake.net/v2/history?codes=551&limit=100
//
// (limit caps at 100 — codes>100 returns HTTP 400. Verified 2026-05-07.
// codes=551 = "earthquake info" reports issued by JMA. Other codes are
// peer-status/tsunami/etc and don't carry hypocenter data we need.)
//
// Why we use this for the Japan view: USGS's all_day feed catches ~1-3 quakes
// in/around Japan per day (M ≥ ~2.5). P2P relays JMA's official feed which
// includes everything down to ~M1 → ~30-100 events/day in the Japan region.
// That's the difference between "0 dots" and "Japan visibly ringing" when a
// viewer opens /?r=japan.
//
// Each P2P entry (codes=551 = "earthquake info") has:
//   {
//     id: "69fbb43ae88ee598246becc9",       // stable hex id
//     time: "2026/05/07 06:35:54.522",       // when JMA issued the report (JST)
//     earthquake: {
//       time: "2026/05/07 06:32:00",         // when the quake happened (JST)
//       hypocenter: {
//         latitude: 29.3,
//         longitude: 129.5,
//         depth: 20,                         // km
//         magnitude: 2.2,
//         name: "トカラ列島近海"              // Japanese place name (kept as-is)
//       },
//       maxScale: 10                         // JMA shindo scale × 10 (10 = 震度1)
//     },
//     points: [...]                          // observation points (we ignore)
//   }

import type { Quake } from "./usgs";

interface P2PHypocenter {
  latitude?: number | null;
  longitude?: number | null;
  depth?: number | null;
  magnitude?: number | null;
  name?: string | null;
}

interface P2PEarthquake {
  time?: string | null;
  hypocenter?: P2PHypocenter;
}

interface P2PEntry {
  id?: string;
  code?: number;
  time?: string;
  earthquake?: P2PEarthquake;
}

const P2P_URL = "https://api.p2pquake.net/v2/history?codes=551&limit=100";

/**
 * Parse "YYYY/MM/DD HH:MM:SS[.fff]" interpreted as JST (UTC+9) into unix ms.
 * Returns null on parse failure.
 *
 * We can't use `new Date(jstString)` because the string has no timezone
 * suffix — Date treats it as the runtime's local time, which on Vercel is UTC.
 * So we parse the parts and compute the UTC ms ourselves.
 */
export function parseJstToMs(s: string): number | null {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(
    s,
  );
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const min = Number(m[5]);
  const sec = Number(m[6]);
  const frac = m[7] ? Number(m[7].padEnd(3, "0").slice(0, 3)) : 0;
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(min) ||
    !Number.isFinite(sec)
  ) {
    return null;
  }
  // Date.UTC computes ms-since-epoch for the given UTC datetime. JST = UTC+9,
  // so a JST wall clock (Y, M, D, h, m, s) corresponds to UTC (Y, M, D, h-9,
  // m, s). Subtracting 9h from the UTC-interpreted value gives the right ms.
  const utcMs = Date.UTC(year, month - 1, day, hour, min, sec, frac);
  if (!Number.isFinite(utcMs)) return null;
  return utcMs - 9 * 60 * 60 * 1000;
}

/** Parse the P2P /v2/history response into our Quake shape. */
export function parseP2P(json: unknown): Quake[] {
  if (!Array.isArray(json)) return [];
  const out: Quake[] = [];
  for (const raw of json as P2PEntry[]) {
    const eq = raw?.earthquake;
    const hypo = eq?.hypocenter;
    if (!eq || !hypo) continue;
    const lat =
      typeof hypo.latitude === "number" && Number.isFinite(hypo.latitude)
        ? hypo.latitude
        : null;
    const lng =
      typeof hypo.longitude === "number" && Number.isFinite(hypo.longitude)
        ? hypo.longitude
        : null;
    const mag =
      typeof hypo.magnitude === "number" && Number.isFinite(hypo.magnitude)
        ? hypo.magnitude
        : null;
    if (lat === null || lng === null || mag === null) continue;
    // Some P2P entries report "magnitude: -1" when JMA hasn't determined a
    // magnitude yet (e.g. very local felt reports). Skip those — we can't
    // size the ring for them and they'd render as a misleading huge ring.
    if (mag < 0) continue;

    const depth =
      typeof hypo.depth === "number" && Number.isFinite(hypo.depth)
        ? hypo.depth
        : 0;
    const place = typeof hypo.name === "string" ? hypo.name : "";

    // Prefer earthquake.time (when it occurred); fall back to issue time.
    const timeStr =
      typeof eq.time === "string" && eq.time.length > 0
        ? eq.time
        : typeof raw.time === "string"
          ? raw.time
          : null;
    if (!timeStr) continue;
    const time_ms = parseJstToMs(timeStr);
    if (time_ms === null) continue;

    // Prefer the API's stable id; if missing, synthesize a deterministic key
    // from time + coords so dedupe across polls still works.
    const id =
      typeof raw.id === "string" && raw.id.length > 0
        ? `p2p:${raw.id}`
        : `p2p:${time_ms}:${lat.toFixed(2)}:${lng.toFixed(2)}`;

    out.push({
      id,
      mag,
      time_ms,
      place,
      lat,
      lng,
      depth_km: depth,
      source: "p2p",
    });
  }
  return out;
}

/**
 * Fetch P2P feed (server-side). Returns Quake[] sorted desc by time_ms.
 *
 * Note on window: the USGS all_day feed uses a 24h window. P2P's `codes=551`
 * (JMA earthquake reports) only fires when JMA issues a felt-observation
 * report — typically ~5-15 events/day in Japan, but quiet days produce <5.
 * To keep the Japan view "alive" instead of mostly empty on calm days, we
 * return the most recent ~100 events regardless of age (the API caps at
 * limit=100). This typically spans 7-14 days of seismic activity. The ring
 * animation only fires for events the client first SEES live (RING_LIFETIME
 * is 90s after first poll), so older events render as quiet persistent dots.
 *
 * If P2P starts returning >100 events/day or we want a strict 24h window, add
 * a `?recent=true` flag and filter here.
 */
export async function fetchP2PJapanQuakes(): Promise<Quake[]> {
  const res = await fetch(P2P_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; quake-globe/1.0; +https://github.com/Jada-Q/quake-globe)",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`p2p ${res.status}`);
  }
  const json = await res.json();
  const all = parseP2P(json);
  all.sort((a, b) => b.time_ms - a.time_ms);
  return all;
}

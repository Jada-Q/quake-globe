import { NextResponse, type NextRequest } from "next/server";
import { parseUsgs, type Quake } from "@/lib/usgs";
import { fetchP2PJapanQuakes } from "@/lib/p2p";

// Same-origin proxy for two upstreams:
//
//   ?source=usgs (default) → USGS Earthquake Hazards Program (global, M ≥ ~2.5)
//     https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson
//
//   ?source=p2p             → P2P Quake API (Japan domestic, JMA-based, denser)
//     https://api.p2pquake.net/v2/history?codes=551&limit=300
//
// Both responses are normalized server-side into our Quake shape so the
// client can mix sources without per-source parsers in the browser. Each
// source has its own 50s cache slot; if P2P fails we silently fall back to
// USGS and set the X-Quake-Fallback header so the UI can show a notice.
//
// Wire format: { quakes: Quake[] }   (was: raw GeoJSON; changed in v4)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const USGS_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

const TTL_MS = 50_000;

interface CacheEntry {
  ts: number;
  quakes: Quake[];
}

// Separate cache slots per source so a P2P request never gets served stale
// USGS data (or vice versa).
const cache: { usgs: CacheEntry | null; p2p: CacheEntry | null } = {
  usgs: null,
  p2p: null,
};

async function loadUsgs(): Promise<Quake[]> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(USGS_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; quake-globe/1.0; +https://github.com/Jada-Q/quake-globe)",
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        lastErr = new Error(`usgs ${res.status}`);
        continue;
      }
      const json = await res.json();
      return parseUsgs(json);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("usgs: unknown error");
}

function jsonResponse(
  quakes: Quake[],
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { quakes },
    {
      headers: {
        "Cache-Control": "public, max-age=50",
        ...extraHeaders,
      },
    },
  );
}

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source") === "p2p" ? "p2p" : "usgs";
  const now = Date.now();

  // Cache hit
  const slot = cache[source];
  if (slot && now - slot.ts < TTL_MS) {
    return jsonResponse(slot.quakes, { "X-Quake-Source": source });
  }

  if (source === "p2p") {
    try {
      const quakes = await fetchP2PJapanQuakes();
      // Empty array from upstream = treat as failure (something's wrong with
      // the feed, not just a quiet day — the feed always returns hundreds of
      // historical entries; we filter to 24h. An empty 24h is plausible but
      // exceedingly rare. Still, an empty PARSE result is suspicious.)
      if (quakes.length === 0) {
        throw new Error("p2p: empty result after parse");
      }
      cache.p2p = { ts: now, quakes };
      return jsonResponse(quakes, { "X-Quake-Source": "p2p" });
    } catch {
      // Fall back to USGS — never make the user see a broken UI.
      try {
        let usgsQuakes: Quake[];
        if (cache.usgs && now - cache.usgs.ts < TTL_MS) {
          usgsQuakes = cache.usgs.quakes;
        } else {
          usgsQuakes = await loadUsgs();
          cache.usgs = { ts: now, quakes: usgsQuakes };
        }
        return jsonResponse(usgsQuakes, {
          "X-Quake-Source": "usgs",
          "X-Quake-Fallback": "p2p-failed-using-usgs",
        });
      } catch (e) {
        // Both upstreams down — return stale P2P or USGS if any, else 502.
        if (cache.p2p) {
          return jsonResponse(cache.p2p.quakes, {
            "X-Quake-Source": "p2p",
            "X-Cache-Status": "stale-error",
          });
        }
        if (cache.usgs) {
          return jsonResponse(cache.usgs.quakes, {
            "X-Quake-Source": "usgs",
            "X-Quake-Fallback": "p2p-failed-using-usgs",
            "X-Cache-Status": "stale-error",
          });
        }
        const err = e as Error;
        return NextResponse.json(
          { error: `${err.name}: ${err.message}` },
          { status: 502 },
        );
      }
    }
  }

  // source === "usgs"
  try {
    const quakes = await loadUsgs();
    cache.usgs = { ts: now, quakes };
    return jsonResponse(quakes, { "X-Quake-Source": "usgs" });
  } catch (e) {
    if (cache.usgs) {
      return jsonResponse(cache.usgs.quakes, {
        "X-Quake-Source": "usgs",
        "X-Cache-Status": "stale-error",
      });
    }
    const err = e as Error;
    return NextResponse.json(
      { error: `${err.name}: ${err.message}` },
      { status: 502 },
    );
  }
}

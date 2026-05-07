import { NextResponse } from "next/server";

// Same-origin proxy to USGS Earthquake Hazards Program GeoJSON feed.
// Browser can call USGS directly (it does send CORS headers), but routing
// through our API gives us:
//  - server-side caching (50s TTL — USGS regenerates every minute)
//  - graceful stale-on-error
//  - one easy place to swap feed URL (all_day -> all_week, etc.)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UPSTREAM =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

let cache: { ts: number; data: unknown } | null = null;
const TTL_MS = 50_000;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.ts < TTL_MS) {
    return NextResponse.json(cache.data, {
      headers: { "Cache-Control": "public, max-age=50" },
    });
  }

  let lastErr = "unknown";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(UPSTREAM, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; quake-globe/1.0; +https://github.com/Jada-Q/quake-globe)",
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        lastErr = `usgs ${res.status}`;
        if (attempt === 0) continue;
        if (cache) {
          return NextResponse.json(cache.data, {
            headers: {
              "Cache-Control": "public, max-age=50",
              "X-Cache-Status": "stale-error",
            },
          });
        }
        return NextResponse.json({ error: lastErr }, { status: 502 });
      }
      const data = await res.json();
      cache = { ts: now, data };
      return NextResponse.json(data, {
        headers: { "Cache-Control": "public, max-age=50" },
      });
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      lastErr = `${err.name}: ${err.message}${
        err.cause?.code ? ` (${err.cause.code})` : ""
      }`;
    }
  }

  if (cache) {
    return NextResponse.json(cache.data, {
      headers: {
        "Cache-Control": "public, max-age=50",
        "X-Cache-Status": "stale-error",
      },
    });
  }
  return NextResponse.json({ error: lastErr }, { status: 502 });
}

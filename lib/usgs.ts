// USGS earthquake feed parser.
//
// Upstream (public, no auth, ~1-15 min lag for small quakes):
//   https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson
//
// USGS publishes summary feeds at all_hour / all_day / all_week / all_month.
// We use all_day because it gives ~200-400 events at any time — dense enough
// to feel "alive" without being overwhelming.

export interface Quake {
  id: string;
  mag: number;
  time_ms: number;
  place: string;
  lat: number;
  lng: number;
  depth_km: number;
  /** Which upstream this quake came from. UI surfaces this so viewers know
   *  whether they're looking at USGS (global, M ≥ ~2.5) or P2P/JMA (Japan,
   *  down to ~M1). */
  source: "usgs" | "p2p";
}

interface UsgsFeature {
  id?: string;
  properties?: {
    mag?: number | null;
    place?: string | null;
    time?: number | null;
  };
  geometry?: {
    coordinates?: [number, number, number] | number[];
  };
}

interface UsgsResponse {
  features?: UsgsFeature[];
}

/** Parse the raw USGS GeoJSON FeatureCollection into our flat shape. */
export function parseUsgs(json: unknown): Quake[] {
  const fc = json as UsgsResponse;
  if (!fc.features || !Array.isArray(fc.features)) return [];
  const out: Quake[] = [];
  for (const f of fc.features) {
    const id = typeof f.id === "string" ? f.id : null;
    const mag = typeof f.properties?.mag === "number" ? f.properties.mag : null;
    const time = typeof f.properties?.time === "number" ? f.properties.time : null;
    const place = typeof f.properties?.place === "string" ? f.properties.place : "";
    const coords = f.geometry?.coordinates;
    if (!id || mag === null || time === null) continue;
    if (!coords || coords.length < 2) continue;
    const lng = typeof coords[0] === "number" ? coords[0] : null;
    const lat = typeof coords[1] === "number" ? coords[1] : null;
    const depth = typeof coords[2] === "number" ? coords[2] : 0;
    if (lat === null || lng === null) continue;
    out.push({
      id,
      mag,
      time_ms: time,
      place,
      lat,
      lng,
      depth_km: depth,
      source: "usgs",
    });
  }
  return out;
}

/**
 * Filter quakes by minimum magnitude only. In v2 (spinning globe) we render
 * every quake globally and use front/back-hemisphere alpha to convey the
 * region focus rather than bbox clipping.
 */
export function filterQuakes(quakes: Quake[], minMag: number): Quake[] {
  return quakes.filter((q) => q.mag >= minMag);
}

/** Result of a /api/quakes fetch — quakes plus metadata flags from headers. */
export interface QuakesFetchResult {
  quakes: Quake[];
  /** Server returns this header when the requested source failed and the
   *  response body is from the USGS fallback. */
  fallbackFromP2P: boolean;
  /** True when the server served its in-memory cache because BOTH upstreams
   *  were down (X-Cache-Status: stale-error) — the data is real but delayed. */
  stale: boolean;
}

/**
 * Fetch quakes from our same-origin proxy. The route now returns a normalized
 * `Quake[]` shape (instead of raw USGS GeoJSON) so we can mix sources.
 *
 * @param source "usgs" (default, global) or "p2p" (Japan domestic, JMA-based,
 *               denser — see lib/p2p.ts)
 */
export async function fetchQuakes(
  source: "usgs" | "p2p" = "usgs",
  signal?: AbortSignal,
): Promise<QuakesFetchResult> {
  const url = source === "p2p" ? "/api/quakes?source=p2p" : "/api/quakes";
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`quakes ${res.status}`);
  const json = (await res.json()) as { quakes?: Quake[] };
  const fallbackFromP2P =
    res.headers.get("X-Quake-Fallback") === "p2p-failed-using-usgs";
  const stale = res.headers.get("X-Cache-Status") === "stale-error";
  return {
    quakes: Array.isArray(json.quakes) ? json.quakes : [],
    fallbackFromP2P,
    stale,
  };
}

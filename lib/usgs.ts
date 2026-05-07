// USGS earthquake feed parser.
//
// Upstream (public, no auth, ~1-15 min lag for small quakes):
//   https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson
//
// USGS publishes summary feeds at all_hour / all_day / all_week / all_month.
// We use all_day because it gives ~200-400 events at any time — dense enough
// to feel "alive" without being overwhelming.

import { isInRegion, type Region } from "./regions";

export interface Quake {
  id: string;
  mag: number;
  time_ms: number;
  place: string;
  lat: number;
  lng: number;
  depth_km: number;
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
    });
  }
  return out;
}

/** Filter quakes to those inside the region bbox and meeting min magnitude. */
export function filterQuakes(
  quakes: Quake[],
  region: Region,
  minMag: number,
): Quake[] {
  return quakes.filter(
    (q) => q.mag >= minMag && isInRegion(region, q.lat, q.lng),
  );
}

/** Fetch the USGS feed via our same-origin proxy. */
export async function fetchQuakes(signal?: AbortSignal): Promise<Quake[]> {
  const res = await fetch("/api/quakes", { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`quakes ${res.status}`);
  const json = await res.json();
  return parseUsgs(json);
}

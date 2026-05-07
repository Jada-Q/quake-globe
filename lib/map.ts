// Coastline / land data loader.
//
// We use `world-atlas/land-110m.json` — a TopoJSON of land polygons at
// 1:110-million scale (~140KB). `topojson-client.feature()` converts it back
// to a GeoJSON FeatureCollection that d3.geoPath can render directly.
//
// 110m is intentional: too detailed (50m / 10m) and lines alias into noise at
// fullscreen wallpaper size; too sparse and continents don't read. On a
// spinning globe at 1440×900, 110m is the sweet spot.

import { feature } from "topojson-client";
import landTopo from "world-atlas/land-110m.json";
import type { FeatureCollection, Geometry } from "geojson";

let cachedLand: FeatureCollection<Geometry> | null = null;

interface MinimalTopology {
  objects: { land: unknown };
}

/** Returns the world's land as a GeoJSON FeatureCollection. */
export function getLand(): FeatureCollection<Geometry> {
  if (cachedLand) return cachedLand;
  const topo = landTopo as unknown as MinimalTopology;
  const fc = feature(
    topo as unknown as Parameters<typeof feature>[0],
    topo.objects.land as unknown as Parameters<typeof feature>[1],
  ) as unknown as FeatureCollection<Geometry>;
  cachedLand = fc;
  return fc;
}

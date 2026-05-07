// Coastline data loader.
//
// We use `world-atlas/land-110m.json` — a TopoJSON of land polygons at
// 1:110-million scale (~140KB). `topojson-client.feature()` converts it back
// to GeoJSON. We then walk the polygon rings and render them as thin strokes.
//
// The 110m resolution is intentional: too detailed (50m / 10m) and the lines
// alias into noise at fullscreen wallpaper size; too sparse and continents
// don't read.

import { feature } from "topojson-client";
import landTopo from "world-atlas/land-110m.json";

// Minimal local shapes — we don't pull @types/topojson-specification just for
// these two fields. world-atlas land-110m.json is a Topology with one
// GeometryCollection named "land".
interface MinimalTopology {
  objects: { land: unknown };
}

interface MinimalGeometry {
  type: string;
  coordinates?: unknown;
  geometries?: MinimalGeometry[];
}

interface MinimalFeature {
  type: "Feature";
  geometry: MinimalGeometry;
}

interface MinimalFeatureCollection {
  type: "FeatureCollection";
  features: MinimalFeature[];
}

let cachedRings: Array<Array<[number, number]>> | null = null;

/** Returns all coastline rings as arrays of [lng, lat] pairs. */
export function getCoastlineRings(): Array<Array<[number, number]>> {
  if (cachedRings) return cachedRings;

  const topo = landTopo as unknown as MinimalTopology;
  // topojson-client's `feature` returns a Feature or FeatureCollection
  // depending on the topology object shape.
  const fc = feature(
    topo as unknown as Parameters<typeof feature>[0],
    topo.objects.land as unknown as Parameters<typeof feature>[1],
  ) as unknown as MinimalFeature | MinimalFeatureCollection;

  const features: MinimalFeature[] =
    fc.type === "FeatureCollection" ? fc.features : [fc];

  const rings: Array<Array<[number, number]>> = [];
  for (const f of features) {
    walkGeometry(f.geometry, rings);
  }
  cachedRings = rings;
  return rings;
}

function walkGeometry(
  geom: MinimalGeometry,
  out: Array<Array<[number, number]>>,
): void {
  if (geom.type === "Polygon") {
    const coords = geom.coordinates as Array<Array<[number, number]>>;
    for (const ring of coords) out.push(ring);
  } else if (geom.type === "MultiPolygon") {
    const coords = geom.coordinates as Array<Array<Array<[number, number]>>>;
    for (const poly of coords) {
      for (const ring of poly) out.push(ring);
    }
  } else if (geom.type === "GeometryCollection" && geom.geometries) {
    for (const g of geom.geometries) walkGeometry(g, out);
  }
}

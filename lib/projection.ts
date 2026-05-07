// Equirectangular projection — straight lat/lng → x/y.
// Mercator distorts polar zones too much for an ambient-art piece showing
// global quakes (Aleutians, Tonga, etc.). Equirectangular is honest about
// where things are even if it stretches polar regions horizontally.
//
// The world is mapped into the full canvas; for non-world regions we project
// the region bbox into the full canvas (with a small inner padding so quake
// rings near the edge aren't clipped).

import type { Region } from "./regions";

export interface Projection {
  project: (lat: number, lng: number) => { x: number; y: number };
  /** Width of the drawable map area (excludes padding). */
  mapW: number;
  /** Height of the drawable map area. */
  mapH: number;
  /** Top-left corner of the drawable map area. */
  ox: number;
  oy: number;
}

export function buildProjection(
  region: Region,
  w: number,
  h: number,
  paddingPx = 24,
): Projection {
  const innerW = Math.max(100, w - paddingPx * 2);
  const innerH = Math.max(100, h - paddingPx * 2);

  // Bbox spans (degrees), respecting antimeridian wrap.
  const dLat = region.lat1 - region.lat0;
  const dLng = region.wrapsAntimeridian
    ? 360 - region.lng0 + region.lng1
    : region.lng1 - region.lng0;

  // Pixels per degree in each axis (anisotropic — this is equirectangular,
  // so we let lat and lng scale independently to fill the canvas).
  const pxPerLat = innerH / dLat;
  const pxPerLng = innerW / dLng;

  const ox = paddingPx;
  const oy = paddingPx;
  const mapW = innerW;
  const mapH = innerH;

  const project = (lat: number, lng: number) => {
    let lngOffset: number;
    if (region.wrapsAntimeridian) {
      // Treat the wrapping bbox as starting from lng0 going east.
      // A point at lng=L is at offset (L - lng0) mod 360 from the start.
      let off = lng - region.lng0;
      if (off < 0) off += 360;
      lngOffset = off;
    } else {
      lngOffset = lng - region.lng0;
    }
    const x = ox + lngOffset * pxPerLng;
    const y = oy + (region.lat1 - lat) * pxPerLat;
    return { x, y };
  };

  return { project, mapW, mapH, ox, oy };
}

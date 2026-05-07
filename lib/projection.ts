// Orthographic globe projection (Canvas 2D, d3-geo).
//
// Why orthographic + not WebGL: d3.geoOrthographic gives us a real spinning
// sphere with continent-edge clipping logic, all on Canvas 2D. The whole
// piece is < 200 lines of math — Three.js / globe.gl would be > 100 KB
// of GL code for what is fundamentally a 2D pulse wallpaper.
//
// We deliberately do NOT clip the back hemisphere: front-side features draw
// at full alpha, back-side features draw at low alpha (~0.18-0.22) so the
// globe reads as see-through ambient art rather than a hard sphere. This
// is the difference between "earth model" and "sky window".

import { geoOrthographic, geoPath, geoDistance } from "d3-geo";
import type { GeoProjection, GeoPath } from "d3-geo";

export interface GlobeProjection {
  projection: GeoProjection;
  /**
   * Build a path generator bound to the supplied 2D context. Use this for
   * coastlines and the sphere disk; for individual quake markers we call
   * `projection([lng, lat])` and draw the dot/ring manually for control.
   */
  path: (ctx: CanvasRenderingContext2D) => GeoPath;
  /** Returns true when (lng, lat) is on the visible (front) hemisphere. */
  isFront: (lng: number, lat: number) => boolean;
  /** Center [lng, lat] derived from current rotation. */
  center: [number, number];
  /** Pixel radius of the sphere on canvas (= base * scale). */
  pixelRadius: number;
}

export function buildGlobeProjection(
  w: number,
  h: number,
  scale: number,
  lambda: number,
  phi: number,
): GlobeProjection {
  const baseScale = Math.min(w, h) * 0.42;
  const pixelRadius = baseScale * scale;

  const projection = geoOrthographic()
    .scale(pixelRadius)
    .translate([w / 2, h / 2])
    .rotate([lambda, phi, 0])
    .clipAngle(180); // disable clipping — we'll fade the back hemisphere ourselves

  // Center longitude/latitude that the rotation places at canvas center:
  // d3.rotate([λ, φ]) centers (-λ, -φ). Cache for hemisphere tests.
  const center: [number, number] = [-lambda, -phi];

  const isFront = (lng: number, lat: number): boolean => {
    return geoDistance([lng, lat], center) < Math.PI / 2;
  };

  const path = (ctx: CanvasRenderingContext2D): GeoPath =>
    geoPath(projection, ctx);

  return { projection, path, isFront, center, pixelRadius };
}

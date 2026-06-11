// Bake public/textures/planet-mask.png — the single texture the toon planet
// shader samples:
//   R: land signed-distance field (0.5 = coastline, >0.5 inland, <0.5 sea)
//   G: stylized vegetation mask (value noise × latitude bands, land only)
//   B: unused (zero)
//
// Run: node scripts/bake-textures.mjs
// Offline tool — never shipped to the client. Uses @napi-rs/canvas to
// rasterize world-atlas land at equirectangular projection in ~1s, then a
// two-pass chamfer distance transform for the SDF.

import { createCanvas } from "@napi-rs/canvas";
import { geoPath, geoEquirectangular } from "d3-geo";
import { feature } from "topojson-client";
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const land110 = require("world-atlas/land-110m.json");

const W = 2048;
const H = 1024;
// SDF spread: how many texels the 0..1 ramp covers on each side of the
// coastline. Wider = smoother zoomed-out edges; narrower = crisper ink band.
const SPREAD = 16;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "textures", "planet-mask.png");

// ---------------------------------------------------------------- raster --
function rasterizeLand() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const projection = geoEquirectangular()
    .scale(W / (2 * Math.PI))
    .translate([W / 2, H / 2]);
  const path = geoPath(projection, ctx);
  const land = feature(land110, land110.objects.land);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  path(land);
  ctx.fill();
  const { data } = ctx.getImageData(0, 0, W, H);
  // Binary land mask from the red channel.
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = data[i * 4] > 127 ? 1 : 0;
  return mask;
}

// ------------------------------------------------------------------- sdf --
// Two-pass chamfer distance transform (3-4 metric scaled to ~1 per texel).
// Computes distance-to-boundary for both sides, then signs it by the mask.
function distanceTransform(inside) {
  const INF = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = inside[i] ? 0 : INF;
  const idx = (x, y) => y * W + x;
  // X wraps (equirectangular longitude seam); Y clamps at the poles.
  const at = (x, y) => d[idx((x + W) % W, Math.max(0, Math.min(H - 1, y)))];
  // forward pass
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      d[i] = Math.min(
        d[i],
        at(x - 1, y) + 1,
        at(x, y - 1) + 1,
        at(x - 1, y - 1) + 1.4142,
        at(x + 1, y - 1) + 1.4142,
      );
    }
  }
  // backward pass
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = idx(x, y);
      d[i] = Math.min(
        d[i],
        at(x + 1, y) + 1,
        at(x, y + 1) + 1,
        at(x + 1, y + 1) + 1.4142,
        at(x - 1, y + 1) + 1.4142,
      );
    }
  }
  return d;
}

function buildSdf(mask) {
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) inv[i] = mask[i] ? 0 : 1;
  const dLand = distanceTransform(mask); // distance to land (for sea texels)
  const dSea = distanceTransform(inv); // distance to sea (for land texels)
  const sdf = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    // signed: positive inland, negative at sea; normalize to 0..1 around 0.5
    const signed = mask[i] ? dSea[i] : -dLand[i];
    const n = 0.5 + 0.5 * Math.max(-1, Math.min(1, signed / SPREAD));
    sdf[i] = Math.round(n * 255);
  }
  return sdf;
}

// ----------------------------------------------------------------- noise --
// Deterministic value noise for the vegetation mask (no Math.random — bakes
// must be reproducible).
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = (h * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y, freq) {
  const fx = x * freq;
  const fy = y * freq;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const e = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy;
}

// |latitude| → vegetation weight, smoothly interpolated control points.
const BAND_POINTS = [
  [0, 0.95],
  [14, 0.8],
  [24, 0.42],
  [38, 0.7],
  [52, 0.8],
  [62, 0.45],
  [72, 0.12],
  [90, 0.0],
];

function bandAt(absLat) {
  for (let k = 1; k < BAND_POINTS.length; k++) {
    const [l1, v1] = BAND_POINTS[k];
    if (absLat <= l1) {
      const [l0, v0] = BAND_POINTS[k - 1];
      const t = (absLat - l0) / (l1 - l0);
      const s = t * t * (3 - 2 * t); // smoothstep
      return v0 + (v1 - v0) * s;
    }
  }
  return 0;
}

function buildVegetation(mask) {
  const veg = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    // Latitude in degrees: +90 (top) → -90 (bottom)
    const lat = 90 - (y / H) * 180;
    const a = Math.abs(lat);
    // Stylized band weighting: lush tropics + temperate belt, a desert dip
    // around 20-30°, dying off toward the poles. Interpolated through
    // control points — hard if/else steps printed visible horizontal seams
    // across the continents.
    const band = bandAt(a);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      const n =
        0.62 * valueNoise(x, y, 1 / 96) +
        0.28 * valueNoise(x + 7129, y + 911, 1 / 34) +
        0.1 * valueNoise(x + 31, y + 5077, 1 / 12);
      veg[i] = band * (0.35 + 0.65 * n) > 0.42 ? 255 : 0;
    }
  }
  return veg;
}

// ------------------------------------------------------------------ main --
console.time("rasterize");
const mask = rasterizeLand();
console.timeEnd("rasterize");

console.time("sdf");
const sdf = buildSdf(mask);
console.timeEnd("sdf");

console.time("vegetation");
const veg = buildVegetation(mask);
console.timeEnd("vegetation");

const out = createCanvas(W, H);
const octx = out.getContext("2d");
const img = octx.createImageData(W, H);
for (let i = 0; i < W * H; i++) {
  img.data[i * 4] = sdf[i];
  img.data[i * 4 + 1] = veg[i];
  img.data[i * 4 + 2] = 0;
  img.data[i * 4 + 3] = 255;
}
octx.putImageData(img, 0, 0);

mkdirSync(dirname(OUT), { recursive: true });
const png = out.toBuffer("image/png");
writeFileSync(OUT, png);

// Sanity stats — a broken bake (all-sea / all-land) must fail loudly here,
// not as a silently blank planet in the browser.
let landCount = 0;
for (let i = 0; i < W * H; i++) if (mask[i]) landCount++;
const landPct = ((landCount / (W * H)) * 100).toFixed(1);
console.log(`wrote ${OUT}`);
console.log(`size: ${(png.length / 1024).toFixed(0)} KB, land: ${landPct}%`);
if (landCount === 0 || landCount === W * H) {
  console.error("BAKE FAILED: degenerate land mask");
  process.exit(1);
}

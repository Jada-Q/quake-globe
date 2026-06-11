// Toon theme palette + live-tweakable parameters.
//
// Color strategy (from the Messenger-style spec): everything on screen is
// cool/neutral — mint backdrop, paper planet, green vegetation, near-black
// ink. The golden ACCENT is reserved for exactly ONE element (the intro
// BEGIN button); nothing else may use a warm hue or the accent loses its
// pull.

export const MINT_BG = "#66c4bd";
export const PAPER = "#d8d3c5";
export const VEGETATION = "#3e7d58";
export const SEA = "#4fa89e";
export const INK = "#22302c";
export const ACCENT = "#e8ab3c"; // intro BEGIN button ONLY
export const CLOUD = "#f4f1e8";

/** Magnitude → color, staying inside the cool/neutral palette. Severity is
 *  carried by darkness + marker size + animation intensity, NOT warmth —
 *  yellow/orange/red would compete with the single accent. */
export function magnitudeHex(mag: number): string {
  if (mag < 3) return "#efece3"; // pale paper
  if (mag < 4) return "#9fbfa8"; // sage
  if (mag < 5) return VEGETATION; // deep green
  if (mag < 6) return "#2e5d66"; // slate teal
  return INK; // near-black ink
}

/** Mutable params shared between materials (as uniforms) and the dev
 *  Tweakpane. One object, read every frame — no plumbing. */
export interface ToonParams {
  steps: number; // toon light quantization steps
  shadeMul: number; // darkest band multiplier (0..1)
  inkWidth: number; // coastline ink band width (SDF units)
  inkStrength: number; // coastline ink opacity
  outlineWidth: number; // inverted-hull silhouette thickness (world units)
  rotationSpeed: number; // auto-rotate deg per frame @60fps
  cloudSpeed: number; // cloud shell rotation multiplier
  lightAzimuth: number; // light direction azimuth (deg)
  lightElevation: number; // light direction elevation (deg)
}

export function defaultToonParams(): ToonParams {
  return {
    steps: 3,
    shadeMul: 0.72,
    inkWidth: 0.018,
    inkStrength: 0.85,
    outlineWidth: 0.012,
    rotationSpeed: 0.1,
    cloudSpeed: 1.0,
    lightAzimuth: -35,
    lightElevation: 28,
  };
}

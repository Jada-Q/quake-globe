// Region presets for Quake Globe.
//
// In v2 (spinning globe), a region is no longer a bbox FILTER — every quake
// in the world is always rendered (front hemisphere bright, back hemisphere
// ghosted at 20% alpha). A region preset is a CAMERA: target globe rotation
// + scale, plus whether auto-rotation continues.
//
// `world` is the only preset that auto-rotates from a free starting longitude.
// `pacific-rim` keeps slow auto-rotation but starts centered on the Pacific.
// `japan / americas / europe` lock the view (no auto-rotation).

export interface Region {
  /** Stable URL key, e.g. "world", "japan". */
  key: string;
  /** Display label shown in overlay. */
  label: string;
  /** IANA timezone for time display. */
  timezone: string;
  /**
   * Target longitude rotation (d3.geoOrthographic uses negative lambda for the
   * rotate() argument — i.e. rotate([-lng, -lat]) centers (lng,lat)).
   * Stored here as the d3 lambda value directly (i.e. -lng of the desired
   * center). For example, to center on Tokyo (~139°E lat 36°N) → lambda=-139.
   */
  lambda: number;
  /** Target latitude tilt (d3 phi). To center lat=36 → phi=-36. */
  phi: number;
  /** Scale multiplier on top of the canvas-fit base radius. 1.0 = world. */
  scale: number;
  /** When true, the auto-rotate animation continues from `lambda`. */
  autoRotate: boolean;
  /** Words for editorial overlay (replaces bbox printout). */
  caption: string;
}

export const PRESETS: Record<string, Region> = {
  world: {
    key: "world",
    label: "WORLD",
    timezone: "UTC",
    lambda: 0,
    phi: -10,
    scale: 1.0,
    autoRotate: true,
    caption: "全球 · 24h",
  },
  japan: {
    key: "japan",
    label: "JAPAN 日本",
    timezone: "Asia/Tokyo",
    // Center near 138°E 36°N — d3.rotate uses [-lng, -lat].
    lambda: -138,
    phi: -36,
    scale: 2.5,
    autoRotate: false,
    caption: "日本列島 · view locked",
  },
  americas: {
    key: "americas",
    label: "AMERICAS",
    timezone: "America/New_York",
    // Center near 80°W 20°N → rotate([80, -20])
    lambda: 80,
    phi: -20,
    scale: 1.5,
    autoRotate: false,
    caption: "Americas · view locked",
  },
  europe: {
    key: "europe",
    label: "EUROPE",
    timezone: "Europe/London",
    // Center near 15°E 50°N → rotate([-15, -50])
    lambda: -15,
    phi: -50,
    scale: 2.0,
    autoRotate: false,
    caption: "Europe · view locked",
  },
  "pacific-rim": {
    key: "pacific-rim",
    label: "PACIFIC RIM",
    timezone: "Asia/Tokyo",
    // Center near 150°W 10°N (the Pacific basin) → rotate([150, -10])
    lambda: 150,
    phi: -10,
    scale: 1.2,
    autoRotate: true,
    caption: "Ring of Fire · slow drift",
  },
};

export const PRESET_KEYS = Object.keys(PRESETS);

export interface UrlParams {
  r?: string;
}

export function resolveRegion(params: UrlParams | undefined): Region {
  if (!params) return PRESETS.world;
  if (params.r) {
    const key = params.r.toLowerCase();
    if (PRESETS[key]) return PRESETS[key];
  }
  return PRESETS.world;
}

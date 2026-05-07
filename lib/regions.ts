// Geographic region presets for Quake Globe.
//
// A region is a lat/lng bounding box plus a label/timezone for the editorial
// overlay. Some regions wrap the antimeridian (pacific-rim spans lng 100°E
// through 180°/-180° to -100°W); these have lng0 > lng1 and are flagged.

export interface Region {
  /** Stable URL key, e.g. "world", "japan". */
  key: string;
  /** Display label shown in overlay. */
  label: string;
  /** Southern latitude bound. */
  lat0: number;
  /** Northern latitude bound. */
  lat1: number;
  /** Western longitude bound. */
  lng0: number;
  /** Eastern longitude bound. */
  lng1: number;
  /** IANA timezone for time display. */
  timezone: string;
  /** True when the bbox crosses the antimeridian (lng0 > lng1). */
  wrapsAntimeridian?: boolean;
}

export const PRESETS: Record<string, Region> = {
  world: {
    key: "world",
    label: "WORLD",
    lat0: -60,
    lat1: 70,
    lng0: -180,
    lng1: 180,
    timezone: "UTC",
  },
  japan: {
    key: "japan",
    label: "JAPAN 日本",
    lat0: 24,
    lat1: 46,
    lng0: 122,
    lng1: 146,
    timezone: "Asia/Tokyo",
  },
  americas: {
    key: "americas",
    label: "AMERICAS",
    lat0: -55,
    lat1: 65,
    lng0: -170,
    lng1: -30,
    timezone: "America/New_York",
  },
  europe: {
    key: "europe",
    label: "EUROPE",
    lat0: 35,
    lat1: 72,
    lng0: -25,
    lng1: 50,
    timezone: "Europe/London",
  },
  "pacific-rim": {
    key: "pacific-rim",
    label: "PACIFIC RIM",
    lat0: -50,
    lat1: 60,
    lng0: 100,
    lng1: -100, // wraps antimeridian
    timezone: "Asia/Tokyo",
    wrapsAntimeridian: true,
  },
};

export const PRESET_KEYS = Object.keys(PRESETS);

export interface UrlParams {
  r?: string;
  lat0?: string;
  lat1?: string;
  lng0?: string;
  lng1?: string;
  label?: string;
  tz?: string;
}

export function resolveRegion(params: UrlParams | undefined): Region {
  if (!params) return PRESETS.world;

  if (params.r) {
    const key = params.r.toLowerCase();
    if (PRESETS[key]) return PRESETS[key];
  }

  if (params.lat0 && params.lat1 && params.lng0 && params.lng1) {
    const lat0 = Number(params.lat0);
    const lat1 = Number(params.lat1);
    const lng0 = Number(params.lng0);
    const lng1 = Number(params.lng1);
    if (
      Number.isFinite(lat0) &&
      Number.isFinite(lat1) &&
      Number.isFinite(lng0) &&
      Number.isFinite(lng1)
    ) {
      const wraps = lng0 > lng1;
      return {
        key: "custom",
        label: params.label || "CUSTOM",
        lat0: Math.min(lat0, lat1),
        lat1: Math.max(lat0, lat1),
        lng0,
        lng1,
        timezone: params.tz || "UTC",
        wrapsAntimeridian: wraps,
      };
    }
  }

  return PRESETS.world;
}

/** True when (lat,lng) is inside the region bbox, accounting for antimeridian wrap. */
export function isInRegion(
  region: Region,
  lat: number,
  lng: number,
): boolean {
  if (lat < region.lat0 || lat > region.lat1) return false;
  if (region.wrapsAntimeridian) {
    // bbox is [lng0..180] U [-180..lng1]
    return lng >= region.lng0 || lng <= region.lng1;
  }
  return lng >= region.lng0 && lng <= region.lng1;
}

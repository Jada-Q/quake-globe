# Quake Globe

Live global earthquakes from the USGS Earthquake Hazards Program, rendered as ringing light pulses on a flat world map. Built as a real-time Mac desktop wallpaper. Sister piece to [Tide Pixels](https://github.com/Jada-Q/tide-pixels), [Sky Traffic](https://github.com/Jada-Q/sky-traffic), [Bay Ships](https://github.com/Jada-Q/bay-ships), [Subway Pulse](https://github.com/Jada-Q/subway-pulse).

<p align="center">
  <img src="docs/preview/world.png" width="32%" alt="World — Pacific Ring of Fire glowing" />
  <img src="docs/preview/japan.png" width="32%" alt="Japan — quiet day, one quake near Chigasaki" />
  <img src="docs/preview/pacific-rim.png" width="32%" alt="Pacific Rim — Aleutians, Philippines, NZ all active" />
</p>

<p align="center"><em>Same minute, three crops — World · Japan · Pacific Rim. Each ring is a real quake from the last 24 hours.</em></p>

**Live**: [quake-globe-2026-05-07.vercel.app](https://quake-globe-2026-05-07.vercel.app)

Open it in a browser tab, or set it as a Mac desktop wallpaper via [Plash](https://sindresorhus.com/plash) and watch the planet's seismic pulse.

---

## Five regions

| Region | URL |
|---|---|
| World (default) | [`/`](https://quake-globe-2026-05-07.vercel.app/) |
| Japan 日本 | [`/?r=japan`](https://quake-globe-2026-05-07.vercel.app/?r=japan) |
| Americas | [`/?r=americas`](https://quake-globe-2026-05-07.vercel.app/?r=americas) |
| Europe | [`/?r=europe`](https://quake-globe-2026-05-07.vercel.app/?r=europe) |
| Pacific Rim | [`/?r=pacific-rim`](https://quake-globe-2026-05-07.vercel.app/?r=pacific-rim) |

**Custom bbox**: `/?lat0=24&lat1=46&lng0=122&lng1=146&label=Japan&tz=Asia/Tokyo`

**Magnitude floor**: `/?min=4` — only show M ≥ 4 (default `min=2.5`; USGS publishes a lot of M<3 noise).

The bottom dot row (right side on mobile) lets you switch regions live.

---

## What's actually drawn

- **Coastlines** — `world-atlas/land-110m` TopoJSON, rendered as 0.5 px white strokes at 22% alpha. Low-res on purpose: too much detail aliases into noise at fullscreen wallpaper size.
- **Bbox frame** — faint rectangle marking the region's lat/lng bounds (only when region ≠ world).
- **Static dot** — every quake's epicenter persists for the full 24 h window as a small dim dot, so the location stays markable after its ring fades.
- **Expanding ring** — when the canvas first sees a quake, it animates an outward ring for 90 s of wall time. Radius scales with magnitude (`6 + mag * 14` px → M3 ≈ 48 px, M6 ≈ 90 px). Alpha fades 0.85 → 0 over the lifetime.
- **Color by magnitude** —
  - M < 3 → warm white `#f0e8d4`
  - M 3–4 → yellow `#ffd86a`
  - M 4–5 → orange `#ff9f4a`
  - M 5–6 → red-orange `#ff5a3a`
  - M ≥ 6 → deep red `#d62a3a` with stronger glow halo
- **Recent / strong glow** — quakes < 60 s old or M ≥ 6 get an additional radial gradient halo.

The art-piece label at the bottom-right says it: *"データ: USGS Earthquake Hazards Program. リング寿命 90 秒。色 = マグニチュード。"*

Projection is **equirectangular** — straight lat/lng → x/y. Mercator distorts polar zones too much for a piece showing Aleutian and Tongan quakes; equirectangular is honest about location even if it stretches the poles.

---

## Data

- **Source**: [USGS Earthquakes Feed](https://earthquake.usgs.gov/earthquakes/feed/) — `summary/all_day.geojson` (last 24 h, ~200–400 events globally at any moment)
- **Lag**: USGS auto-publishes events ~1–15 minutes after detection for small quakes; large events are typically faster
- **Polling**: client polls our API proxy every 60 s; proxy caches USGS for 50 s

The feed URL is documented in `app/api/quakes/route.ts` so you can swap it for `all_hour`, `all_week`, or `all_month`.

---

## Tech stack

- Next.js 16 (App Router, server components for `searchParams`)
- Tailwind v4
- Cormorant Garamond + Geist Mono (`next/font/google`)
- [`world-atlas`](https://github.com/topojson/world-atlas) + [`topojson-client`](https://github.com/topojson/topojson-client) — coastlines
- Plain Canvas 2D + RAF — no external animation library

---

## Local dev

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>.

```bash
pnpm build  # production build
```

---

## Used as a desktop wallpaper

1. Install [Plash](https://apps.apple.com/app/plash/id1494023538) (free, Mac App Store).
2. Plash menu bar → `Add Website…` → paste a region URL above.
3. Keep `Browsing Mode` off — Quake Globe has no required interaction; switching regions happens via Plash's website list (or by hovering the dot row in Browsing Mode).

For multi-display: Pacific Rim on one monitor, Americas on another. The asynchrony of the planet's seismic activity makes the screens feel alive without ever being distracting.

---

## Elsewhere

- [Tide Pixels](https://github.com/Jada-Q/tide-pixels) — moon-driven tide and sky over your city
- [Sky Traffic](https://github.com/Jada-Q/sky-traffic) — live aircraft trails over your city's airspace
- [Bay Ships](https://github.com/Jada-Q/bay-ships) — ship lanes through major harbors
- [Subway Pulse](https://github.com/Jada-Q/subway-pulse) — Tokyo metro lines as a Beck-style abstract diagram

---

## License

MIT — do whatever you want, but if you ship a paid product literally cloned from this, at least drop a thank-you somewhere.

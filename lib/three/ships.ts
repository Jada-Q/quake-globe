// Ambient toon ships — blocky little boats riding the ocean surface inside
// the spin group (they travel their routes AND rotate with the planet).
//
// A route is a tilted circle, which inevitably crosses continents — so each
// frame a ship samples the SAME baked land-SDF mask the planet shader uses
// (CPU copy) and fades out over land / back in over open sea. Reads as
// "docked, then set sail again" instead of a boat driving across the Andes.

import {
  BackSide,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Vector3,
} from "three";
import { INK } from "./palette";
import { makeGradientMap } from "./clouds";

const SURFACE_RADIUS = 1.004;
const SHIP_SCALE = 0.034;
const FADE_PER_FRAME = 0.04;

const ROUTES = [
  { tiltX: 0.45, tiltZ: -0.3, speed: 0.0005, phase: 0.5 },
  { tiltX: -0.6, tiltZ: 0.25, speed: -0.00038, phase: 2.4 },
  { tiltX: 0.15, tiltZ: 0.55, speed: 0.00046, phase: 4.0 },
  { tiltX: -0.25, tiltZ: -0.65, speed: -0.00055, phase: 5.5 },
];

/** CPU copy of the land mask R channel for sea/land lookups. */
export interface LandMask {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

export async function loadLandMask(): Promise<LandMask | null> {
  try {
    const res = await fetch("/textures/planet-mask.png");
    const bmp = await createImageBitmap(await res.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { data: img.data, w: bmp.width, h: bmp.height };
  } catch {
    // No mask → ships simply never fade; acceptable degradation.
    return null;
  }
}

/** True when (lat, lng) is open sea — with a safety margin so ships fade
 *  before visually touching the coastline (SDF 0.5 = coast; lower = sea). */
export function isSea(mask: LandMask, lat: number, lng: number): boolean {
  const u = (lng + 180) / 360;
  const v = 1 - (lat + 90) / 180;
  const px = Math.min(mask.w - 1, Math.max(0, Math.round(u * mask.w)));
  const py = Math.min(mask.h - 1, Math.max(0, Math.round(v * mask.h)));
  return mask.data[(py * mask.w + px) * 4] < 110;
}

/** Blocky toon boat: hull + cabin + funnel, nose along +X. */
function buildBoat(): {
  group: Group;
  setOpacity: (o: number) => void;
} {
  const g = new Group();
  const body = new MeshToonMaterial({
    color: "#f2efe6",
    gradientMap: makeGradientMap(3, 0.78),
    transparent: true,
  });
  const cabinMat = new MeshToonMaterial({
    color: "#2e5d66",
    gradientMap: makeGradientMap(3, 0.78),
    transparent: true,
  });
  const inkMat = new MeshBasicMaterial({
    color: INK,
    side: BackSide,
    transparent: true,
  });

  const parts: Array<[BoxGeometry, MeshToonMaterial, [number, number, number]]> = [
    [new BoxGeometry(1.0, 0.3, 0.4), body, [0, 0, 0]], // hull
    [new BoxGeometry(0.4, 0.3, 0.3), cabinMat, [-0.05, 0.3, 0]], // cabin
    [new BoxGeometry(0.12, 0.3, 0.12), body, [0.22, 0.35, 0]], // funnel
  ];
  for (const [geo, mat, pos] of parts) {
    const m = new Mesh(geo, mat);
    m.position.set(...pos);
    g.add(m);
    const hull = new Mesh(geo, inkMat);
    hull.position.set(...pos);
    hull.scale.setScalar(1.22);
    g.add(hull);
  }
  g.scale.setScalar(SHIP_SCALE);

  const mats = [body, cabinMat, inkMat];
  return {
    group: g,
    setOpacity(o: number) {
      for (const m of mats) m.opacity = o;
      g.visible = o > 0.02;
    },
  };
}

export interface Ships {
  /** Add this to the SPIN group — ships belong to the planet's frame. */
  group: Group;
  /** Advance routes + land fade. `speedMul` shares ToonParams.cloudSpeed. */
  update(speedMul: number): void;
  dispose(): void;
}

export function buildShips(): Ships {
  const root = new Group();
  let mask: LandMask | null = null;
  void loadLandMask().then((m) => {
    mask = m;
  });

  const ships: Array<{
    orbit: Group;
    boat: ReturnType<typeof buildBoat>;
    speed: number;
    opacity: number;
  }> = [];

  for (const cfg of ROUTES) {
    const orbit = new Group();
    orbit.rotation.x = cfg.tiltX;
    orbit.rotation.z = cfg.tiltZ;
    orbit.rotation.y = cfg.phase;
    const boat = buildBoat();
    boat.group.position.set(0, 0, SURFACE_RADIUS);
    boat.group.rotation.y = cfg.speed >= 0 ? 0 : Math.PI;
    boat.setOpacity(0); // fade in only once confirmed at sea
    orbit.add(boat.group);
    root.add(orbit);
    ships.push({ orbit, boat, speed: cfg.speed, opacity: 0 });
  }

  const world = new Vector3();
  const local = new Vector3();

  return {
    group: root,
    update(speedMul: number) {
      for (const s of ships) {
        s.orbit.rotation.y += s.speed * speedMul;
        let atSea = true;
        if (mask) {
          // Position in the planet's (spin-group) frame → lat/lng → mask.
          s.boat.group.getWorldPosition(world);
          root.parent?.worldToLocal(local.copy(world));
          local.normalize();
          const lat = (Math.asin(local.y) * 180) / Math.PI;
          const lng = (Math.atan2(-local.z, local.x) * 180) / Math.PI;
          atSea = isSea(mask, lat, lng);
        }
        const target = atSea ? 1 : 0;
        if (s.opacity !== target) {
          s.opacity = Math.max(
            0,
            Math.min(1, s.opacity + (target > s.opacity ? 1 : -1) * FADE_PER_FRAME),
          );
          s.boat.setOpacity(s.opacity);
        }
      }
    },
    dispose() {
      root.traverse((obj) => {
        if (obj instanceof Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material)
            ? obj.material
            : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
    },
  };
}

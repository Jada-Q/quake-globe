// Whale moments — every minute or two, somewhere in deep ocean, a small
// white spout puffs up, then an ink tail fin arcs through the surface and
// is gone. Designed as a rare-glimpse delight for an always-on wallpaper:
// you don't watch for it, you happen to catch it.

import {
  BackSide,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from "three";
import { INK } from "./palette";
import { makeGradientMap } from "./clouds";
import { loadLandMask, isSea, type LandMask } from "./ships";
import { latLngToVec3 } from "./quake-layer";

const IDLE_MIN_MS = 45_000;
const IDLE_MAX_MS = 110_000;
const SPOUT_MS = 2_300;
const FIN_MS = 2_000;

/** Deep-sea check: the point plus a ring of neighbours must all be sea, so
 *  the whale never surfaces in a bay touching the coastline ink. */
function isDeepSea(mask: LandMask, lat: number, lng: number): boolean {
  for (const [dLat, dLng] of [
    [0, 0],
    [4, 0],
    [-4, 0],
    [0, 4],
    [0, -4],
  ]) {
    if (!isSea(mask, lat + dLat, lng + dLng)) return false;
  }
  return true;
}

export interface Whale {
  /** Add to the SPIN group (planet frame). */
  group: Group;
  update(nowMs: number): void;
  dispose(): void;
}

export function buildWhale(): Whale {
  const group = new Group();
  let mask: LandMask | null = null;
  void loadLandMask().then((m) => {
    mask = m;
  });

  // Spout: three stacked white puffs that grow and fade.
  const puffGeo = new SphereGeometry(1, 8, 6);
  const puffs: Array<{ mesh: Mesh; mat: MeshBasicMaterial; delay: number }> =
    [];
  for (let i = 0; i < 3; i++) {
    const mat = new MeshBasicMaterial({
      color: "#f6f4ee",
      transparent: true,
      opacity: 0,
    });
    const mesh = new Mesh(puffGeo, mat);
    group.add(mesh);
    puffs.push({ mesh, mat, delay: i * 280 });
  }

  // Tail fin: flat ink box that arcs through the surface.
  const finGeo = new BoxGeometry(0.5, 1.0, 0.14);
  const finMat = new MeshToonMaterial({
    color: "#3a4d48",
    gradientMap: makeGradientMap(3, 0.75),
    transparent: true,
    opacity: 0,
  });
  const finHullMat = new MeshBasicMaterial({
    color: INK,
    side: BackSide,
    transparent: true,
    opacity: 0,
  });
  const finPivot = new Group();
  const fin = new Mesh(finGeo, finMat);
  fin.position.y = 0.55;
  const finHull = new Mesh(finGeo, finHullMat);
  finHull.position.y = 0.55;
  finHull.scale.setScalar(1.15);
  finPivot.add(finHull, fin);
  finPivot.scale.setScalar(0.03);
  group.add(finPivot);

  group.visible = false;

  type Phase = "idle" | "spout" | "fin";
  let phase: Phase = "idle";
  let phaseStart = 0;
  let nextShowAt = performance.now() + IDLE_MIN_MS * Math.random();

  const anchor = new Object3D();
  const pos = new Vector3();

  const placeRandomDeepSea = (): boolean => {
    if (!mask) return false;
    for (let tries = 0; tries < 40; tries++) {
      const lat = -52 + Math.random() * 104;
      const lng = -180 + Math.random() * 360;
      if (!isDeepSea(mask, lat, lng)) continue;
      latLngToVec3(lat, lng, pos).multiplyScalar(1.002);
      anchor.position.copy(pos);
      anchor.lookAt(pos.x * 2, pos.y * 2, pos.z * 2);
      group.position.copy(anchor.position);
      group.quaternion.copy(anchor.quaternion);
      return true;
    }
    return false;
  };

  return {
    group,
    update(nowMs: number) {
      if (phase === "idle") {
        if (nowMs >= nextShowAt && placeRandomDeepSea()) {
          phase = "spout";
          phaseStart = nowMs;
          group.visible = true;
        }
        return;
      }

      if (phase === "spout") {
        const elapsed = nowMs - phaseStart;
        for (const p of puffs) {
          const t = Math.min(Math.max((elapsed - p.delay) / 1400, 0), 1);
          // Rise, swell, dissolve. Local +Z is the outward normal (lookAt).
          p.mesh.position.set(0, 0, 0.012 + t * 0.045);
          p.mesh.scale.setScalar(0.006 + t * 0.02);
          p.mat.opacity = t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75;
        }
        if (elapsed >= SPOUT_MS) {
          for (const p of puffs) p.mat.opacity = 0;
          phase = "fin";
          phaseStart = nowMs;
        }
        return;
      }

      // fin: arc from -70° to +70° around the surface-tangent axis,
      // fading in then out.
      const t = Math.min((nowMs - phaseStart) / FIN_MS, 1);
      finPivot.rotation.x = (-70 + 140 * t) * (Math.PI / 180);
      const o = t < 0.2 ? t / 0.2 : t > 0.8 ? (1 - t) / 0.2 : 1;
      finMat.opacity = o;
      finHullMat.opacity = o;
      if (t >= 1) {
        phase = "idle";
        group.visible = false;
        nextShowAt =
          nowMs + IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
      }
    },
    dispose() {
      puffGeo.dispose();
      finGeo.dispose();
      for (const p of puffs) p.mat.dispose();
      finMat.dispose();
      finMat.gradientMap?.dispose();
      finHullMat.dispose();
    },
  };
}

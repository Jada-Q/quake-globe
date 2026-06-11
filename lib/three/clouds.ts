// Toon puffball clouds — three tilted shells around the planet, each one an
// InstancedMesh of flattened spheres rotating slowly on its own axis. No
// transparency, no noise shaders: cheap enough for an all-day wallpaper.

import {
  DataTexture,
  Group,
  InstancedMesh,
  Matrix4,
  MeshToonMaterial,
  NearestFilter,
  Object3D,
  RedFormat,
  SphereGeometry,
} from "three";
import { CLOUD } from "./palette";

/** 3×1 stepped gradient map for MeshToonMaterial-based props. */
export function makeGradientMap(steps: number, shadeMul: number): DataTexture {
  const n = Math.max(2, Math.round(steps));
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 1 : i / (n - 1);
    data[i] = Math.round(255 * (shadeMul + (1 - shadeMul) * t));
  }
  const tex = new DataTexture(data, n, 1, RedFormat);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// Deterministic LCG — clouds must land in the same spots every load.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Shell {
  group: Group;
  speed: number; // base rad/frame
}

export interface Clouds {
  group: Group;
  /** Advance shell rotation; `speedMul` comes from ToonParams.cloudSpeed. */
  update(speedMul: number): void;
  dispose(): void;
}

export function buildClouds(): Clouds {
  const root = new Group();
  const rng = makeRng(20260611);

  const geo = new SphereGeometry(1, 10, 8);
  const mat = new MeshToonMaterial({
    color: CLOUD,
    gradientMap: makeGradientMap(3, 0.82),
  });

  const shells: Shell[] = [];
  const tmp = new Object3D();
  const anchor = new Object3D();
  const offset = new Matrix4();

  const SHELLS = [
    { radius: 1.07, tiltX: 0.3, tiltZ: 0.15, clusters: 3, speed: 0.00045 },
    { radius: 1.1, tiltX: -0.2, tiltZ: 0.4, clusters: 3, speed: -0.0003 },
    { radius: 1.13, tiltX: 0.5, tiltZ: -0.25, clusters: 2, speed: 0.0006 },
  ];

  for (const cfg of SHELLS) {
    const shell = new Group();
    shell.rotation.x = cfg.tiltX;
    shell.rotation.z = cfg.tiltZ;

    // Count puffs first so the InstancedMesh is sized exactly.
    const clusters: Array<{ lat: number; lng: number; puffs: number }> = [];
    let total = 0;
    for (let c = 0; c < cfg.clusters; c++) {
      const puffs = 3 + Math.floor(rng() * 3); // 3-5
      clusters.push({
        lat: -55 + rng() * 110,
        lng: rng() * 360,
        puffs,
      });
      total += puffs;
    }

    const mesh = new InstancedMesh(geo, mat, total);
    let i = 0;
    for (const cl of clusters) {
      const latR = (cl.lat * Math.PI) / 180;
      const lngR = (cl.lng * Math.PI) / 180;
      anchor.position.set(
        Math.cos(latR) * Math.cos(lngR) * cfg.radius,
        Math.sin(latR) * cfg.radius,
        -Math.cos(latR) * Math.sin(lngR) * cfg.radius,
      );
      anchor.lookAt(0, 0, 0);
      anchor.updateMatrix();
      for (let p = 0; p < cl.puffs; p++) {
        const s = 0.035 + rng() * 0.05;
        tmp.position.set((rng() - 0.5) * 0.14, (rng() - 0.5) * 0.07, 0);
        tmp.scale.set(s * (1.1 + rng() * 0.5), s * 0.55, s * 0.85);
        tmp.rotation.set(0, 0, rng() * Math.PI);
        tmp.updateMatrix();
        offset.multiplyMatrices(anchor.matrix, tmp.matrix);
        mesh.setMatrixAt(i++, offset);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    shell.add(mesh);
    root.add(shell);
    shells.push({ group: shell, speed: cfg.speed });
  }

  return {
    group: root,
    update(speedMul: number) {
      for (const s of shells) s.group.rotation.y += s.speed * speedMul;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mat.gradientMap?.dispose();
    },
  };
}

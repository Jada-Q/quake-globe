// Ambient bird flocks — V-formations of tiny ink chevrons skimming low over
// the ocean, faster than ships, lower than planes. Irregular group motion
// (per-bird flap phase + bob) is the strongest "alive" signal on the globe.

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  InstancedMesh,
  Object3D,
  Vector3,
} from "three";
import { INK } from "./palette";

const FLIGHT_RADIUS = 1.045; // under the cloud shells
const BIRD_SIZE = 0.016;

const FLOCKS = [
  { tiltX: 0.35, tiltZ: -0.15, speed: 0.0021, phase: 1.0, birds: 9 },
  { tiltX: -0.5, tiltZ: 0.45, speed: -0.0017, phase: 3.8, birds: 7 },
];

/** Chevron (open "M") — two triangles meeting at the body. */
function chevronGeometry(): BufferGeometry {
  const geo = new BufferGeometry();
  // x = forward, z = wingspan
  const verts = new Float32Array([
    // left wing
    0.0, 0, 0, -0.55, 0.18, -1.0, -0.4, 0, -0.15,
    // right wing
    0.0, 0, 0, -0.4, 0, 0.15, -0.55, 0.18, 1.0,
  ]);
  geo.setAttribute("position", new BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

interface Flock {
  orbit: Group;
  mesh: InstancedMesh;
  speed: number;
  offsets: Array<{ back: number; side: number; flapPhase: number }>;
}

export interface Birds {
  group: Group;
  update(speedMul: number, nowMs: number): void;
  dispose(): void;
}

export function buildBirds(): Birds {
  const root = new Group();
  const geo = chevronGeometry();
  const mat = new MeshBasicMaterial({ color: INK, side: DoubleSide });

  const flocks: Flock[] = [];
  for (const cfg of FLOCKS) {
    const orbit = new Group();
    orbit.rotation.x = cfg.tiltX;
    orbit.rotation.z = cfg.tiltZ;
    orbit.rotation.y = cfg.phase;

    const mesh = new InstancedMesh(geo, mat, cfg.birds);
    mesh.frustumCulled = false;
    orbit.add(mesh);
    root.add(orbit);

    // V formation: leader in front, pairs trailing diagonally behind.
    const offsets = [];
    for (let i = 0; i < cfg.birds; i++) {
      const row = Math.ceil(i / 2);
      const side = i === 0 ? 0 : i % 2 === 1 ? 1 : -1;
      offsets.push({
        back: row * 0.028,
        side: side * row * 0.022,
        flapPhase: i * 1.7,
      });
    }
    flocks.push({ orbit, mesh, speed: cfg.speed, offsets });
  }

  const tmp = new Object3D();
  const pos = new Vector3();
  const m4 = new Matrix4();

  return {
    group: root,
    update(speedMul: number, nowMs: number) {
      for (const f of flocks) {
        f.orbit.rotation.y += f.speed * speedMul;
        const dir = f.speed >= 0 ? 1 : -1;
        for (let i = 0; i < f.offsets.length; i++) {
          const o = f.offsets[i];
          const flap = Math.sin(nowMs * 0.012 + o.flapPhase);
          // Orbit frame at (0,0,R): travel = ±X, lateral = Y, radial = Z.
          pos.set(dir * -o.back, o.side, FLIGHT_RADIUS + flap * 0.004);
          tmp.position.copy(pos);
          // Chevron: forward=+x, wingspan=z, up=y → Rx(90°) lays the
          // wingspan into the lateral axis and points "up" radially;
          // Rz(180°) flips forward for retrograde flocks.
          tmp.rotation.set(Math.PI / 2, 0, dir >= 0 ? 0 : Math.PI);
          tmp.scale.setScalar(BIRD_SIZE * (1 + 0.15 * flap));
          tmp.updateMatrix();
          m4.copy(tmp.matrix);
          f.mesh.setMatrixAt(i, m4);
        }
        f.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

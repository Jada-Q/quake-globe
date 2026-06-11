// Ambient toon airplanes — a few blocky paper planes orbiting above the
// clouds on tilted great-circle paths, each with a fading contrail. Pure
// box assembly + ink hulls, matching the voxel/toon language; ~3 small
// draw-call groups, wallpaper-cheap (per-frame cost = one rotation each).

import {
  BackSide,
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  PlaneGeometry,
  ShaderMaterial,
} from "three";
import { INK } from "./palette";
import { makeGradientMap } from "./clouds";

const ORBIT_RADIUS = 1.2; // above the cloud shells (1.07–1.13)
const PLANE_SCALE = 0.055;

// Tilt (x/z) and speed (rad per frame @60fps) per plane — different axes
// and rates so the crossings never sync up.
const ORBITS = [
  { tiltX: 0.55, tiltZ: 0.2, speed: 0.0011, phase: 0.0 },
  { tiltX: -0.35, tiltZ: 0.7, speed: -0.0008, phase: 2.1 },
  { tiltX: 0.1, tiltZ: -0.5, speed: 0.0014, phase: 4.2 },
];

const TRAIL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Contrail: white ribbon fading out toward its tail (u → 0), with a soft
// edge across its width (v).
const TRAIL_FRAG = /* glsl */ `
  varying vec2 vUv;
  void main() {
    float along = smoothstep(0.0, 0.85, vUv.x);
    float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
    float alpha = along * smoothstep(0.0, 0.35, across) * 0.55;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(0.96, 0.95, 0.92, alpha);
  }
`;

/** Blocky toon plane: fuselage + main wing + tail wing + fin, with an
 *  inverted-hull ink twin. Nose points along +X (direction of travel). */
function buildPlaneMesh(): Group {
  const g = new Group();
  const body = new MeshToonMaterial({
    color: "#f2efe6",
    gradientMap: makeGradientMap(3, 0.78),
  });
  const inkMat = new MeshBasicMaterial({ color: INK, side: BackSide });

  const parts: Array<[BoxGeometry, [number, number, number]]> = [
    [new BoxGeometry(1.0, 0.22, 0.22), [0, 0, 0]], // fuselage
    [new BoxGeometry(0.34, 0.06, 1.05), [0.06, 0, 0]], // main wing
    [new BoxGeometry(0.18, 0.05, 0.42), [-0.42, 0.04, 0]], // tail wing
    [new BoxGeometry(0.16, 0.3, 0.06), [-0.44, 0.14, 0]], // fin
  ];
  for (const [geo, pos] of parts) {
    const m = new Mesh(geo, body);
    m.position.set(...pos);
    g.add(m);
    const hull = new Mesh(geo, inkMat);
    hull.position.set(...pos);
    hull.scale.setScalar(1.18);
    g.add(hull);
  }
  g.scale.setScalar(PLANE_SCALE);
  return g;
}

export interface Planes {
  group: Group;
  /** Advance orbits; `speedMul` shares ToonParams.cloudSpeed. */
  update(speedMul: number): void;
  dispose(): void;
}

export function buildPlanes(): Planes {
  const root = new Group();
  const orbits: Array<{ group: Group; speed: number }> = [];

  const trailGeo = new PlaneGeometry(1, 1, 1, 1);
  const trailMat = new ShaderMaterial({
    vertexShader: TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });

  for (const cfg of ORBITS) {
    const orbit = new Group();
    orbit.rotation.x = cfg.tiltX;
    orbit.rotation.z = cfg.tiltZ;
    orbit.rotation.y = cfg.phase;

    const plane = buildPlaneMesh();
    plane.position.set(0, 0, ORBIT_RADIUS);
    // Orbit spins +Y; at (0,0,R) the velocity direction is ±X depending on
    // spin sign — point the nose accordingly.
    plane.rotation.y = cfg.speed >= 0 ? 0 : Math.PI;
    orbit.add(plane);

    // Contrail ribbon behind the tail, lying in the orbit's tangent plane.
    const trail = new Mesh(trailGeo, trailMat);
    const len = 0.34;
    const dir = cfg.speed >= 0 ? 1 : -1;
    trail.scale.set(len, 0.018, 1);
    trail.position.set(dir * (-len / 2 - 0.035), 0, ORBIT_RADIUS);
    if (dir < 0) trail.rotation.z = Math.PI; // keep fade toward the tail
    orbit.add(trail);

    root.add(orbit);
    orbits.push({ group: orbit, speed: cfg.speed });
  }

  return {
    group: root,
    update(speedMul: number) {
      for (const o of orbits) o.group.rotation.y += o.speed * speedMul;
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

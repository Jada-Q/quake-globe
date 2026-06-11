// A lone satellite on the highest orbit — body, two solar panels, a
// blinking beacon, and a faint dashed orbit line. It watches the earth the
// way the quake feed does.

import {
  BoxGeometry,
  BufferGeometry,
  Group,
  Line,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { INK } from "./palette";
import { makeGradientMap } from "./clouds";

const ORBIT_RADIUS = 1.42;
const SPEED = 0.0009; // rad/frame @60fps

export interface Satellite {
  group: Group;
  update(speedMul: number, nowMs: number): void;
  dispose(): void;
}

export function buildSatellite(): Satellite {
  const root = new Group();
  root.rotation.x = -0.65;
  root.rotation.z = 0.35;

  // Dashed orbit line.
  const pts: Vector3[] = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    pts.push(
      new Vector3(Math.cos(a) * ORBIT_RADIUS, 0, Math.sin(a) * ORBIT_RADIUS),
    );
  }
  const ringGeo = new BufferGeometry().setFromPoints(pts);
  const ringMat = new LineDashedMaterial({
    color: INK,
    transparent: true,
    opacity: 0.22,
    dashSize: 0.03,
    gapSize: 0.025,
  });
  const ring = new Line(ringGeo, ringMat);
  ring.computeLineDistances();
  root.add(ring);

  // Satellite body + panels + beacon.
  const sat = new Group();
  const bodyMat = new MeshToonMaterial({
    color: "#e9e5d8",
    gradientMap: makeGradientMap(3, 0.75),
  });
  const panelMat = new MeshToonMaterial({
    color: "#2e5d66",
    gradientMap: makeGradientMap(3, 0.75),
  });
  const bodyGeo = new BoxGeometry(0.3, 0.3, 0.45);
  const panelGeo = new BoxGeometry(0.85, 0.04, 0.32);
  const body = new Mesh(bodyGeo, bodyMat);
  const p1 = new Mesh(panelGeo, panelMat);
  p1.position.x = 0.62;
  const p2 = new Mesh(panelGeo, panelMat);
  p2.position.x = -0.62;
  const beaconGeo = new SphereGeometry(0.09, 6, 4);
  const beaconMat = new MeshBasicMaterial({
    color: "#f6f4ee",
    transparent: true,
  });
  const beacon = new Mesh(beaconGeo, beaconMat);
  beacon.position.z = 0.3;
  sat.add(body, p1, p2, beacon);
  sat.scale.setScalar(0.055);
  sat.position.set(ORBIT_RADIUS, 0, 0);
  root.add(sat);

  let angle = 0;
  return {
    group: root,
    update(speedMul: number, nowMs: number) {
      angle += SPEED * speedMul;
      sat.position.set(
        Math.cos(angle) * ORBIT_RADIUS,
        0,
        Math.sin(angle) * ORBIT_RADIUS,
      );
      sat.rotation.y = -angle;
      // Slow beacon blink.
      beaconMat.opacity = 0.35 + 0.65 * Math.max(0, Math.sin(nowMs * 0.004));
    },
    dispose() {
      ringGeo.dispose();
      ringMat.dispose();
      bodyGeo.dispose();
      panelGeo.dispose();
      beaconGeo.dispose();
      bodyMat.dispose();
      bodyMat.gradientMap?.dispose();
      panelMat.dispose();
      panelMat.gradientMap?.dispose();
      beaconMat.dispose();
    },
  };
}

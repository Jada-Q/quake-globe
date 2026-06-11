// Intro voxel letters — "QUAKE / GLOBE" built from instanced cubes laid out
// on a 5×7 bitmap font, arced over the planet's near hemisphere (the
// Messenger "blocky letters × round planet" tension, procedurally — no
// letter-interior buildings, that's their custom art).
//
// The exit animation is CPU-driven (≈360 matrix writes per frame for 1.2s
// only) so the letters can use stock MeshToonMaterial + an inverted-hull
// twin for ink outlines.

import {
  Group,
  InstancedMesh,
  BoxGeometry,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  Vector3,
  BackSide,
} from "three";
import { INK, PAPER } from "./palette";
import { makeGradientMap } from "./clouds";

const GLYPHS: Record<string, string[]> = {
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
};

const LINES = ["QUAKE", "GLOBE"];
const CELL = 0.044; // world units per font cell
const LETTER_W = 5;
const LETTER_GAP = 2; // cells between letters
const LINE_GAP = 3.5; // cells between rows
const ARC_RADIUS = 1.16; // letters hug this sphere around the planet
const EXIT_MS = 1200;

interface Cube {
  base: Vector3; // resting position
  normal: Vector3; // outward direction (for fly-off velocity)
  seed: number; // 0..1 stagger
}

export interface IntroLetters {
  group: Group;
  /** Begin the fly-off. */
  startExit(nowMs: number): void;
  /** Advance exit animation; returns true when finished. */
  update(nowMs: number): boolean;
  dispose(): void;
}

export function buildIntroLetters(): IntroLetters {
  const group = new Group();

  // Collect cube grid positions (font-plane coords, origin at center).
  const cells: Array<{ x: number; y: number }> = [];
  const lineCells = (line: string) =>
    line.length * LETTER_W + (line.length - 1) * LETTER_GAP;
  const totalRows = LINES.length * 7 + (LINES.length - 1) * LINE_GAP;
  LINES.forEach((line, li) => {
    const width = lineCells(line);
    const y0 = totalRows / 2 - li * (7 + LINE_GAP);
    for (let ci = 0; ci < line.length; ci++) {
      const glyph = GLYPHS[line[ci]];
      const x0 = -width / 2 + ci * (LETTER_W + LETTER_GAP);
      glyph.forEach((row, ry) => {
        for (let rx = 0; rx < 5; rx++) {
          if (row[rx] !== "#") continue;
          cells.push({ x: (x0 + rx) * CELL, y: (y0 - ry) * CELL });
        }
      });
    }
  });

  const cubes: Cube[] = [];
  // Deterministic seeds (no Math.random — keep renders reproducible).
  let seedState = 1234567;
  const rng = () => {
    seedState = (seedState * 1664525 + 1013904223) >>> 0;
    return seedState / 4294967296;
  };
  for (const c of cells) {
    // Wrap the flat letter plane onto the ARC_RADIUS sphere: keep x/y,
    // push z out to the sphere (clamped so far-out cells don't fold back).
    const r2 = c.x * c.x + c.y * c.y;
    const z = Math.sqrt(Math.max(ARC_RADIUS * ARC_RADIUS - r2, 0.2));
    const base = new Vector3(c.x, c.y, z);
    cubes.push({
      base,
      normal: base.clone().normalize(),
      seed: rng(),
    });
  }

  const geo = new BoxGeometry(CELL * 0.98, CELL * 0.98, CELL * 1.6);
  const mat = new MeshToonMaterial({
    color: PAPER,
    gradientMap: makeGradientMap(3, 0.78),
  });
  const mesh = new InstancedMesh(geo, mat, cubes.length);

  const hullGeo = new BoxGeometry(CELL * 1.14, CELL * 1.14, CELL * 1.76);
  const hullMat = new MeshBasicMaterial({ color: INK, side: BackSide });
  const hull = new InstancedMesh(hullGeo, hullMat, cubes.length);

  const tmp = new Object3D();
  const lookTarget = new Vector3();

  const writeMatrices = (progressMs: number | null) => {
    for (let i = 0; i < cubes.length; i++) {
      const c = cubes[i];
      if (progressMs === null) {
        tmp.position.copy(c.base);
        tmp.scale.setScalar(1);
        lookTarget.copy(c.base).add(c.normal);
        tmp.lookAt(lookTarget);
      } else {
        // Staggered fly-off: launch outward + down, shrink to nothing.
        const delay = c.seed * 0.35 * EXIT_MS;
        const t = Math.min(Math.max((progressMs - delay) / (EXIT_MS * 0.65), 0), 1);
        const e = t * t; // ease-in — cubes accelerate away
        tmp.position
          .copy(c.base)
          .addScaledVector(c.normal, e * (0.6 + c.seed * 0.8))
          .add(new Vector3(0, -e * e * 0.5, 0));
        tmp.scale.setScalar(Math.max(1 - t, 0.0001));
        lookTarget.copy(tmp.position).add(c.normal);
        tmp.lookAt(lookTarget);
        tmp.rotateZ(e * (c.seed - 0.5) * 4);
      }
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
      hull.setMatrixAt(i, tmp.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    hull.instanceMatrix.needsUpdate = true;
  };

  writeMatrices(null);
  group.add(hull, mesh);

  let exitStart: number | null = null;
  let finished = false;

  return {
    group,
    startExit(nowMs: number) {
      if (exitStart === null) exitStart = nowMs;
    },
    update(nowMs: number): boolean {
      if (exitStart === null || finished) return finished;
      const elapsed = nowMs - exitStart;
      writeMatrices(elapsed);
      if (elapsed >= EXIT_MS + 100) {
        finished = true;
        group.visible = false;
      }
      return finished;
    },
    dispose() {
      geo.dispose();
      hullGeo.dispose();
      mat.dispose();
      mat.gradientMap?.dispose();
      hullMat.dispose();
    },
  };
}

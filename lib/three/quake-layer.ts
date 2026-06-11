// Quake layer — two InstancedMeshes sharing one instance list:
//   1. marker dots (low-poly spheres, squash-stretch pop on arrival)
//   2. ink ripples (tangent quads, expanding outline circles, 90s lifetime)
//
// Buffers are written once per poll (setQuakes); the per-frame cost is a
// handful of uniform updates. Ages and ripple growth are computed on the GPU
// from aBirth + uTime; a ripple older than RING_LIFETIME collapses to a
// degenerate quad (zero fragments, zero CPU bookkeeping).

import {
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import type { Quake } from "@/lib/usgs";
import { RING_LIFETIME_MS } from "@/lib/use-quakes";
import { magnitudeHex } from "./palette";

const CAPACITY = 800;
const RING_LIFETIME_S = RING_LIFETIME_MS / 1000;

/** lat/lng → unit-sphere position matching SphereGeometry's texture mapping
 *  (see camera-rig.ts for the derivation). */
export function latLngToVec3(lat: number, lng: number, out: Vector3): Vector3 {
  const latR = (lat * Math.PI) / 180;
  const lngR = (lng * Math.PI) / 180;
  return out.set(
    Math.cos(latR) * Math.cos(lngR),
    Math.sin(latR),
    -Math.cos(latR) * Math.sin(lngR),
  );
}

/** Same magnitude→px formulas as the 2D renderer (parity for hit-testing
 *  and ripple sizing). */
export function ringRadiusPx(mag: number, scale: number): number {
  return (6 + mag * 14) / Math.max(1, Math.sqrt(scale));
}
export function hitThresholdForMag(mag: number): number {
  return Math.max(20, (6 + mag * 14) * 0.6);
}

const MARKER_VERT = /* glsl */ `
  attribute float aBirth;
  attribute float aMag;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPxToWorld;
  varying vec3 vColor;
  varying float vFacing;

  void main() {
    vColor = aColor;
    float age = uTime - aBirth;
    // Squash-stretch pop over the first 0.45s: wide→round with overshoot.
    float t = clamp(age / 0.45, 0.0, 1.0);
    float over = 1.0 + 0.45 * sin(t * 3.14159) * (1.0 - t);
    float squash = mix(1.6, 1.0, t);
    // Pixel-sized dots like the 2D renderer (it drew 1.4px dots): a touch
    // larger here for the toon look, gently weighted by magnitude.
    float size = (1.8 + aMag * 0.45) * uPxToWorld;
    // Local z = outward normal (lookAt), so squash flattens z and widens xy.
    vec3 scaled = position * vec3(over * squash, over * squash, over / squash) * size;

    vec4 world = modelMatrix * instanceMatrix * vec4(scaled, 1.0);
    // Hemisphere: instance origin direction vs the +Z view axis.
    vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vFacing = normalize(origin.xyz).z;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const MARKER_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vFacing;
  void main() {
    float alpha = vFacing > 0.0 ? 0.9 : 0.18;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

const RIPPLE_VERT = /* glsl */ `
  attribute float aBirth;
  attribute float aMag;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPxToWorld;   // world units per CSS px at the sphere center
  uniform float uScaleDamp;   // 1 / max(1, sqrt(view scale))
  varying vec3 vColor;
  varying float vT;           // ripple progress 0..1
  varying float vFacing;
  varying vec2 vLocal;        // -1..1 across the quad
  varying float vMag;

  void main() {
    vColor = aColor;
    vMag = aMag;
    vLocal = position.xy * 2.0;
    float age = uTime - aBirth;
    float t = age / ${RING_LIFETIME_S.toFixed(1)};
    vT = t;
    // Outside the ring lifetime → degenerate quad, no fragments.
    float alive = (t >= 0.0 && t < 1.0) ? 1.0 : 0.0;
    float maxR = (6.0 + aMag * 14.0) * uScaleDamp * uPxToWorld;
    float r = maxR * clamp(t, 0.0, 1.0) * alive;
    vec4 world = modelMatrix * instanceMatrix * vec4(position * (r * 2.0), 1.0);
    vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vFacing = normalize(origin.xyz).z;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const RIPPLE_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vT;
  varying float vFacing;
  varying vec2 vLocal;
  varying float vMag;

  void main() {
    float r = length(vLocal); // 0 center, 1 quad edge
    float w = fwidth(r) * 1.4;
    // Outer ink circle at the quad edge.
    float ring = 1.0 - smoothstep(0.06 + w, 0.06 + w * 2.0, abs(r - 0.92));
    // Trailing second circle for M5+.
    if (vMag >= 5.0) {
      ring = max(ring, (1.0 - smoothstep(0.045 + w, 0.045 + w * 2.0, abs(r - 0.62))) * 0.7);
    }
    float hemi = vFacing > 0.0 ? 1.0 : 0.25;
    float alpha = ring * 0.85 * (1.0 - vT) * hemi;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

export interface QuakeLayer {
  group: Group;
  /** Re-upload instance buffers. Call on poll (≤1/min), not per frame. */
  setQuakes(quakes: Quake[], firstSeen: Map<string, number>): void;
  /** Per-frame uniforms. epochSeconds = (Date.now()-epoch0)/1000. */
  updateUniforms(epochSeconds: number, pxToWorld: number, viewScale: number): void;
  /** Current instance list (for CPU hit-testing). */
  readonly entries: Quake[];
  dispose(): void;
}

export function buildQuakeLayer(epoch0: number): QuakeLayer {
  const group = new Group();

  const markerGeo = new SphereGeometry(1, 8, 6);
  const rippleGeo = new PlaneGeometry(1, 1);

  const markerMat = new ShaderMaterial({
    vertexShader: MARKER_VERT,
    fragmentShader: MARKER_FRAG,
    uniforms: { uTime: { value: 0 }, uPxToWorld: { value: 0.002 } },
    transparent: true,
    depthWrite: false,
  });
  const rippleMat = new ShaderMaterial({
    vertexShader: RIPPLE_VERT,
    fragmentShader: RIPPLE_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uPxToWorld: { value: 0.002 },
      uScaleDamp: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });

  const markers = new InstancedMesh(markerGeo, markerMat, CAPACITY);
  const ripples = new InstancedMesh(rippleGeo, rippleMat, CAPACITY);
  markers.instanceMatrix.setUsage(DynamicDrawUsage);
  ripples.instanceMatrix.setUsage(DynamicDrawUsage);
  markers.frustumCulled = false;
  ripples.frustumCulled = false;

  const birth = new Float32Array(CAPACITY);
  const mag = new Float32Array(CAPACITY);
  const color = new Float32Array(CAPACITY * 3);
  const aBirthM = new InstancedBufferAttribute(birth, 1);
  const aMagM = new InstancedBufferAttribute(mag, 1);
  const aColorM = new InstancedBufferAttribute(color, 3);
  markerGeo.setAttribute("aBirth", aBirthM);
  markerGeo.setAttribute("aMag", aMagM);
  markerGeo.setAttribute("aColor", aColorM);
  // Ripples share the same backing arrays via their own attribute objects.
  const aBirthR = new InstancedBufferAttribute(birth, 1);
  const aMagR = new InstancedBufferAttribute(mag, 1);
  const aColorR = new InstancedBufferAttribute(color, 3);
  rippleGeo.setAttribute("aBirth", aBirthR);
  rippleGeo.setAttribute("aMag", aMagR);
  rippleGeo.setAttribute("aColor", aColorR);

  group.add(markers, ripples);

  const entries: Quake[] = [];
  const tmp = new Object3D();
  const pos = new Vector3();
  const m4 = new Matrix4();
  const col = new Color();

  function setQuakes(quakes: Quake[], firstSeen: Map<string, number>): void {
    entries.length = 0;
    const n = Math.min(quakes.length, CAPACITY);
    for (let i = 0; i < n; i++) {
      const q = quakes[i];
      entries.push(q);
      latLngToVec3(q.lat, q.lng, pos);

      // Marker: positioned on the surface, oriented to the normal so the
      // squash axis points outward.
      tmp.position.copy(pos);
      tmp.up.set(0, 1, 0);
      tmp.lookAt(pos.x * 2, pos.y * 2, pos.z * 2);
      tmp.updateMatrix();
      markers.setMatrixAt(i, tmp.matrix);

      // Ripple: tangent quad slightly above the surface (avoid z-fighting).
      tmp.position.copy(pos).multiplyScalar(1.004);
      tmp.updateMatrix();
      ripples.setMatrixAt(i, tmp.matrix);

      birth[i] = ((firstSeen.get(q.id) ?? Date.now()) - epoch0) / 1000;
      mag[i] = q.mag;
      col.set(magnitudeHex(q.mag));
      color[i * 3] = col.r;
      color[i * 3 + 1] = col.g;
      color[i * 3 + 2] = col.b;
    }
    // Park unused instances at zero scale.
    m4.makeScale(0, 0, 0);
    for (let i = n; i < CAPACITY; i++) {
      markers.setMatrixAt(i, m4);
      ripples.setMatrixAt(i, m4);
    }
    markers.count = n;
    ripples.count = n;
    markers.instanceMatrix.needsUpdate = true;
    ripples.instanceMatrix.needsUpdate = true;
    for (const a of [aBirthM, aMagM, aColorM, aBirthR, aMagR, aColorR]) {
      a.needsUpdate = true;
    }
  }

  function updateUniforms(
    epochSeconds: number,
    pxToWorld: number,
    viewScale: number,
  ): void {
    markerMat.uniforms.uTime.value = epochSeconds;
    markerMat.uniforms.uPxToWorld.value = pxToWorld;
    rippleMat.uniforms.uTime.value = epochSeconds;
    rippleMat.uniforms.uPxToWorld.value = pxToWorld;
    rippleMat.uniforms.uScaleDamp.value = 1 / Math.max(1, Math.sqrt(viewScale));
  }

  return {
    group,
    setQuakes,
    updateUniforms,
    entries,
    dispose() {
      markerGeo.dispose();
      rippleGeo.dispose();
      markerMat.dispose();
      rippleMat.dispose();
    },
  };
}

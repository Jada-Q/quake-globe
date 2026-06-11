// Toon planet — sphere + custom ShaderMaterial sampling the baked SDF mask
// (R = land SDF, G = vegetation), plus an inverted-hull silhouette outline.
//
// Lighting is a uniform (uLightDir), not a scene light: quantized N·L with
// uSteps bands. The SDF gives resolution-independent coastlines AND the
// coastline ink stroke for free (band around d = 0.5).

import {
  BackSide,
  Color,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  TextureLoader,
  Vector3,
} from "three";
import { INK, PAPER, SEA, VEGETATION, type ToonParams } from "./palette";

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec3 uSea;
  uniform vec3 uLand;
  uniform vec3 uVegetation;
  uniform vec3 uInk;
  uniform vec3 uCityColor;
  uniform vec3 uLightDir;
  uniform float uInkWidth;
  uniform float uInkStrength;
  uniform float uSteps;
  uniform float uShadeMul;
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vec4 m = texture2D(uMask, vUv);
    float d = m.r;   // land SDF, 0.5 = coastline
    float veg = m.g;
    float city = m.b;

    float w = fwidth(d) * 1.2;
    float land = smoothstep(0.5 - w, 0.5 + w, d);
    vec3 albedo = mix(uSea, mix(uLand, uVegetation, step(0.5, veg)), land);

    // Coastline ink band hugging d = 0.5.
    float ink = 1.0 - smoothstep(uInkWidth, uInkWidth + w, abs(d - 0.5));
    albedo = mix(albedo, uInk, ink * uInkStrength);

    // Quantized toon shading from the uniform sun.
    float ndl = dot(normalize(vNormal), uLightDir) * 0.5 + 0.5;
    float band = floor(ndl * uSteps) / max(uSteps - 1.0, 1.0);
    band = clamp(band, 0.0, 1.0);
    vec3 color = albedo * mix(uShadeMul, 1.0, band);

    // City lights bloom on the night side only (raw ndl, not banded —
    // they should fade in smoothly as a region rolls into darkness).
    float night = smoothstep(0.42, 0.18, ndl);
    color += uCityColor * city * night * land;

    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface Planet {
  group: Group;
  /** Push current ToonParams + light direction into the shader uniforms. */
  applyParams(params: ToonParams, lightDir: Vector3): void;
  dispose(): void;
}

export function buildPlanet(params: ToonParams): Planet {
  const group = new Group();

  const tex: Texture = new TextureLoader().load("/textures/planet-mask.png");
  tex.anisotropy = 4;

  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uMask: { value: tex },
      uSea: { value: new Color(SEA) },
      uLand: { value: new Color(PAPER) },
      uVegetation: { value: new Color(VEGETATION) },
      uInk: { value: new Color(INK) },
      // Pale cream — deliberately NOT the golden accent (reserved for CTA).
      uCityColor: { value: new Color("#efe7cf") },
      uLightDir: { value: new Vector3(0, 0, 1) },
      uInkWidth: { value: params.inkWidth },
      uInkStrength: { value: params.inkStrength },
      uSteps: { value: params.steps },
      uShadeMul: { value: params.shadeMul },
    },
  });

  const sphere = new Mesh(new SphereGeometry(1, 96, 64), material);
  group.add(sphere);

  // Inverted-hull silhouette: a slightly larger ink sphere rendered
  // back-face only. For a sphere a uniform scale equals normal displacement.
  const hullMat = new ShaderMaterial({
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk;
      void main() { gl_FragColor = vec4(uInk, 1.0); }
    `,
    uniforms: { uInk: { value: new Color(INK) } },
    side: BackSide,
  });
  const hull = new Mesh(new SphereGeometry(1, 96, 64), hullMat);
  hull.scale.setScalar(1 + params.outlineWidth);
  group.add(hull);

  return {
    group,
    applyParams(p: ToonParams, lightDir: Vector3) {
      material.uniforms.uInkWidth.value = p.inkWidth;
      material.uniforms.uInkStrength.value = p.inkStrength;
      material.uniforms.uSteps.value = p.steps;
      material.uniforms.uShadeMul.value = p.shadeMul;
      (material.uniforms.uLightDir.value as Vector3).copy(lightDir);
      hull.scale.setScalar(1 + p.outlineWidth);
    },
    dispose() {
      sphere.geometry.dispose();
      hull.geometry.dispose();
      material.dispose();
      hullMat.dispose();
      tex.dispose();
    },
  };
}

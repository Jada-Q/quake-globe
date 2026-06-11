// ToonGlobeApp — imperative three.js orchestrator for the toon theme.
//
// All GL state lives here; the React wrapper (ToonGlobe.tsx) only mounts it,
// feeds it quake data from useQuakes, and renders DOM overlays.
//
// Scene graph: tiltGroup (phi, X) ⊃ spinGroup (lambda, Y) ⊃ planet/quakes.
// The camera stays on +Z; CameraRig owns the d3-semantics view state.

import {
  AmbientLight,
  DirectionalLight,
  Group,
  Mesh,
  NearestFilter,
  DataTexture,
  RedFormat,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { defaultToonParams, type ToonParams } from "./palette";
import { buildPlanet, type Planet } from "./planet";
import { CameraRig } from "./camera-rig";
import { attachControls } from "./controls";
import type { Region } from "@/lib/regions";

export interface ToonGlobeAppOptions {
  canvas: HTMLCanvasElement;
  region: Region;
  /** Wallpaper mode: lower DPR cap, low-power GPU, 30fps throttle. */
  embed: boolean;
}

export class ToonGlobeApp {
  readonly params: ToonParams = defaultToonParams();
  readonly rig: CameraRig;

  private renderer: WebGLRenderer;
  private scene = new Scene();
  private tiltGroup = new Group();
  private spinGroup = new Group();
  private planet: Planet;
  private sun!: DirectionalLight;
  private lightDir = new Vector3(0, 0, 1);
  private detachControls: () => void;
  private raf = 0;
  private lastRenderMs = 0;
  private readonly embed: boolean;
  private disposed = false;
  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
    } else if (!this.disposed) {
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  constructor({ canvas, region, embed }: ToonGlobeAppOptions) {
    this.embed = embed;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true, // mint backdrop + swirl live in CSS (ToonBackdrop), free
      powerPreference: embed ? "low-power" : "default",
    });
    this.rig = new CameraRig(region);

    // Lights serve the MeshToonMaterial props (clouds/letters). The planet
    // shader ignores them (light dir is a uniform); the directional light
    // tracks the same azimuth/elevation params so the sun is consistent.
    this.sun = new DirectionalLight(0xffffff, 2.2);
    this.applyLightDir();
    this.scene.add(this.sun, new AmbientLight(0xffffff, 0.55));

    this.tiltGroup.add(this.spinGroup);
    this.scene.add(this.tiltGroup);
    this.planet = buildPlanet(this.params);
    this.spinGroup.add(this.planet.group);

    this.detachControls = attachControls({
      canvas,
      rig: this.rig,
      onDoubleClick: (x, y) => this.handleDoubleClick(x, y),
      onMouseMove: () => {},
    });

    this.resize();
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.raf = requestAnimationFrame(this.tick);
  }

  /** 3×1 stepped gradient map for MeshToonMaterial-based props. */
  static makeGradientMap(steps: number, shadeMul: number): DataTexture {
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

  /** Place the sun + shader light from the shared azimuth/elevation params. */
  applyLightDir(): void {
    const az = (this.params.lightAzimuth * Math.PI) / 180;
    const el = (this.params.lightElevation * Math.PI) / 180;
    this.lightDir.set(
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      Math.cos(az) * Math.cos(el),
    );
    this.sun.position.copy(this.lightDir).multiplyScalar(10);
  }

  // Quake hit-testing arrives with the quake layer (step 5).
  private handleDoubleClick(_cssX: number, _cssY: number): void {}

  private resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dprCap = this.embed ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    this.renderer.setSize(w, h, false);
    this.rig.setViewport(w, h);
  };

  private tick = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    // Embed throttle: ~30fps is plenty for a wallpaper; animations are
    // wall-clock driven so skipping frames never desyncs them.
    if (this.embed && now - this.lastRenderMs < 33) return;
    this.lastRenderMs = now;

    this.rig.autoSpeed = this.params.rotationSpeed;
    this.rig.update(now, false);
    this.tiltGroup.rotation.x = this.rig.tiltRad();
    this.spinGroup.rotation.y = this.rig.spinRad();

    this.planet.applyParams(this.params, this.lightDir);
    this.renderer.render(this.scene, this.rig.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.detachControls();
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.planet.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m.dispose();
      }
    });
    this.renderer.dispose();
  }
}

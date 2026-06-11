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
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { defaultToonParams, type ToonParams } from "./palette";
import { buildPlanet, type Planet } from "./planet";
import { CameraRig } from "./camera-rig";
import { attachControls } from "./controls";
import {
  buildQuakeLayer,
  hitThresholdForMag,
  latLngToVec3,
  type QuakeLayer,
} from "./quake-layer";
import { buildClouds, type Clouds } from "./clouds";
import type { Quake } from "@/lib/usgs";
import type { Region } from "@/lib/regions";

// After this long with no mouse movement while in focus mode, auto fly back.
// (Same constant as the 2D renderer — covers Plash where you can't dblclick.)
const FOCUS_AUTO_EXIT_MS = 5_000;

export interface ToonGlobeAppOptions {
  canvas: HTMLCanvasElement;
  region: Region;
  /** Wallpaper mode: lower DPR cap, low-power GPU, 30fps throttle. */
  embed: boolean;
  /** Fired when focus mode is entered (quake + arrival time) or left (null). */
  onFocusChange?: (quake: Quake | null, arrivedAtMs: number) => void;
}

export class ToonGlobeApp {
  readonly params: ToonParams = defaultToonParams();
  readonly rig: CameraRig;

  private renderer: WebGLRenderer;
  private scene = new Scene();
  private tiltGroup = new Group();
  private spinGroup = new Group();
  private planet: Planet;
  private quakeLayer: QuakeLayer;
  private clouds: Clouds;
  private sun!: DirectionalLight;
  private lightDir = new Vector3(0, 0, 1);
  private detachControls: () => void;
  private raf = 0;
  private lastRenderMs = 0;
  private readonly embed: boolean;
  private readonly epoch0 = Date.now();
  private readonly onFocusChange?: (q: Quake | null, at: number) => void;
  private focusedQuake: Quake | null = null;
  private lastMouseMoveMs = -Infinity;
  private disposed = false;
  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
    } else if (!this.disposed) {
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  constructor({ canvas, region, embed, onFocusChange }: ToonGlobeAppOptions) {
    this.embed = embed;
    this.onFocusChange = onFocusChange;
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
    this.quakeLayer = buildQuakeLayer(this.epoch0);
    this.spinGroup.add(this.quakeLayer.group);
    // Clouds live OUTSIDE the spin group — they drift on their own axes so
    // the planet visibly rotates beneath them.
    this.clouds = buildClouds();
    this.tiltGroup.add(this.clouds.group);

    this.detachControls = attachControls({
      canvas,
      rig: this.rig,
      onDoubleClick: (x, y) => this.handleDoubleClick(x, y),
      onMouseMove: (nowMs) => {
        this.lastMouseMoveMs = nowMs;
      },
    });

    this.resize();
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.raf = requestAnimationFrame(this.tick);
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

  /** Re-upload quake instance buffers (called from React on poll). */
  setQuakes(quakes: Map<string, Quake>, firstSeen: Map<string, number>): void {
    this.quakeLayer.setQuakes([...quakes.values()], firstSeen);
  }

  /** CPU hit-test, replicating the 2D algorithm exactly: project each
   *  front-hemisphere quake to CSS px; closest within its magnitude
   *  threshold wins; near-ties (≤6px) prefer larger magnitude. */
  private hitTest(cssX: number, cssY: number): Quake | null {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.tiltGroup.updateWorldMatrix(true, true);
    const v = new Vector3();
    let best: Quake | null = null;
    let bestDist = Infinity;
    let bestMag = -Infinity;
    for (const q of this.quakeLayer.entries) {
      latLngToVec3(q.lat, q.lng, v);
      this.spinGroup.localToWorld(v);
      if (v.z <= 0) continue; // back hemisphere — don't click through
      v.project(this.rig.camera);
      const px = (v.x * 0.5 + 0.5) * w;
      const py = (-v.y * 0.5 + 0.5) * h;
      const dist = Math.hypot(cssX - px, cssY - py);
      if (dist > hitThresholdForMag(q.mag)) continue;
      if (
        dist < bestDist - 6 ||
        (Math.abs(dist - bestDist) <= 6 && q.mag > bestMag)
      ) {
        best = q;
        bestDist = dist;
        bestMag = q.mag;
      }
    }
    return best;
  }

  private handleDoubleClick(cssX: number, cssY: number): void {
    if (this.rig.isInTransition()) return;
    const hit = this.hitTest(cssX, cssY);
    if (hit) {
      this.flyToQuake(hit);
    } else if (this.focusedQuake) {
      this.flyBack();
    }
    this.rig.markInteraction(performance.now());
  }

  private flyToQuake(q: Quake): void {
    this.rig.flyTo(q.lng, q.lat, () => {
      this.focusedQuake = q;
      this.onFocusChange?.(q, performance.now());
    });
  }

  private flyBack(): void {
    // Clear focus immediately so the info card hides during the flight.
    this.focusedQuake = null;
    this.onFocusChange?.(null, performance.now());
    this.rig.flyBack();
  }

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

    // Auto fly-back after 5s of no mouse movement while focused.
    if (
      this.focusedQuake !== null &&
      !this.rig.isInTransition() &&
      now - this.lastMouseMoveMs > FOCUS_AUTO_EXIT_MS
    ) {
      this.flyBack();
    }

    this.rig.autoSpeed = this.params.rotationSpeed;
    this.rig.update(now, this.focusedQuake !== null);
    this.tiltGroup.rotation.x = this.rig.tiltRad();
    this.spinGroup.rotation.y = this.rig.spinRad();
    // Alive feel: gentle bob + drifting cloud shells.
    this.tiltGroup.position.y = Math.sin(now * 0.0004) * 0.012;
    this.clouds.update(this.params.cloudSpeed);

    this.planet.applyParams(this.params, this.lightDir);
    this.quakeLayer.updateUniforms(
      (Date.now() - this.epoch0) / 1000,
      1 / this.rig.pixelRadius(),
      this.rig.scale,
    );
    this.renderer.render(this.scene, this.rig.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.detachControls();
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.planet.dispose();
    this.quakeLayer.dispose();
    this.clouds.dispose();
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

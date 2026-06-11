// ToonGlobeApp — imperative three.js orchestrator for the toon theme.
//
// All GL state lives here; the React wrapper (ToonGlobe.tsx) only mounts it,
// feeds it quake data from useQuakes, and renders DOM overlays. Stub stage:
// renderer + RAF + resize + a placeholder sphere; planet material, quake
// layer, clouds and intro arrive in later steps.

import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshToonMaterial,
  NearestFilter,
  DataTexture,
  RedFormat,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { PAPER, defaultToonParams, type ToonParams } from "./palette";

/** Base distance from which scale=1.0 frames the whole globe (radius 1). */
const BASE_CAMERA_DIST = 4.6;
const CAMERA_FOV = 30;

export interface ToonGlobeAppOptions {
  canvas: HTMLCanvasElement;
  /** Wallpaper mode: lower DPR cap, low-power GPU, 30fps throttle. */
  embed: boolean;
}

export class ToonGlobeApp {
  readonly params: ToonParams = defaultToonParams();

  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private planetGroup = new Group();
  private sun!: DirectionalLight;
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

  constructor({ canvas, embed }: ToonGlobeAppOptions) {
    this.embed = embed;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true, // mint backdrop + swirl live in CSS (ToonBackdrop), free
      powerPreference: embed ? "low-power" : "default",
    });
    this.camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
    this.camera.position.set(0, 0, BASE_CAMERA_DIST);

    // Lights serve the MeshToonMaterial props (clouds/letters/placeholder).
    // The final planet shader ignores them (light dir is a uniform), so the
    // directional light tracks the same azimuth/elevation params for a
    // consistent sun across both material families.
    this.sun = new DirectionalLight(0xffffff, 2.2);
    this.applyLightDir();
    this.scene.add(this.sun, new AmbientLight(0xffffff, 0.55));

    this.scene.add(this.planetGroup);
    this.planetGroup.add(this.buildPlaceholderPlanet());

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

  /** Place the sun from the shared azimuth/elevation params. */
  applyLightDir(): void {
    const az = (this.params.lightAzimuth * Math.PI) / 180;
    const el = (this.params.lightElevation * Math.PI) / 180;
    const dir = new Vector3(
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      Math.cos(az) * Math.cos(el),
    );
    this.sun.position.copy(dir.multiplyScalar(10));
  }

  private buildPlaceholderPlanet(): Mesh {
    const geo = new SphereGeometry(1, 64, 48);
    const mat = new MeshToonMaterial({
      color: new Color(PAPER),
      gradientMap: ToonGlobeApp.makeGradientMap(
        this.params.steps,
        this.params.shadeMul,
      ),
    });
    return new Mesh(geo, mat);
  }

  private resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dprCap = this.embed ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private tick = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    // Embed throttle: ~30fps is plenty for a wallpaper; animations are
    // wall-clock driven so skipping frames never desyncs them.
    if (this.embed && now - this.lastRenderMs < 33) return;
    this.lastRenderMs = now;

    this.planetGroup.rotation.y += (this.params.rotationSpeed * Math.PI) / 180;
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibility);
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

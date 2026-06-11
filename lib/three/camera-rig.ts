// Camera rig — keeps the EXACT d3 view semantics (lambda/phi in degrees,
// scale as a multiplier on the canvas-fit base radius) so Region presets and
// drag/zoom behaviour port 1:1 from the 2D renderer.
//
// The camera stays on +Z; the world rotates: an outer tilt group (phi, X
// axis) wraps an inner spin group (lambda, Y axis). Zoom maps scale → camera
// distance so the projected sphere radius matches the d3 pixel radius.

import { MathUtils, PerspectiveCamera } from "three";
import type { Region } from "@/lib/regions";

// Same constants as the 2D renderer (QuakeCanvas) — behaviour parity.
const AUTO_RESUME_MS = 3_000;
export const FLY_IN_MS = 600;
export const FLY_BACK_MS = 500;
export const FOCUS_TARGET_SCALE = 3.0;
export const FOCUS_MIN_SCALE_BOOST = 1.8;
export const FOCUS_MAX_SCALE = 5.0;

const CAMERA_FOV_DEG = 30;
/** d3: base pixel radius = min(w,h) * 0.42; we solve camera distance so a
 *  unit sphere projects to that same pixel radius. */
const D3_FIT = 0.42;

export interface ViewState {
  lambda: number;
  phi: number;
  scale: number;
}

export class CameraRig {
  readonly camera: PerspectiveCamera;

  lambda: number;
  phi: number;
  scale: number;
  /** Set false while dragging so auto-rotate pauses immediately. */
  isDragging = false;
  /** Auto-rotate rate (deg/frame @60fps) — fed from ToonParams each frame. */
  autoSpeed = 0.1;

  private readonly autoRotate: boolean;
  private readonly homeView: ViewState;
  private lastInteractionMs = -Infinity;
  private viewportW = 1;
  private viewportH = 1;

  private transitionStartMs: number | null = null;
  private transitionDurationMs = FLY_IN_MS;
  private transitionFrom: ViewState | null = null;
  private transitionTo: ViewState | null = null;
  private onTransitionDone: (() => void) | null = null;

  constructor(region: Region) {
    this.camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.05, 100);
    this.lambda = region.lambda;
    this.phi = region.phi;
    this.scale = region.scale;
    this.autoRotate = region.autoRotate;
    this.homeView = {
      lambda: region.lambda,
      phi: region.phi,
      scale: region.scale,
    };
  }

  setViewport(w: number, h: number): void {
    this.viewportW = w;
    this.viewportH = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Sphere pixel radius the d3 renderer would draw at the current scale. */
  pixelRadius(): number {
    return Math.min(this.viewportW, this.viewportH) * D3_FIT * this.scale;
  }

  /** Camera distance so a unit sphere projects to pixelRadius() pixels. */
  private distanceForScale(): number {
    const halfFov = MathUtils.degToRad(CAMERA_FOV_DEG / 2);
    const k = (this.pixelRadius() / (this.viewportH / 2)) * Math.tan(halfFov);
    const angular = Math.atan(k);
    return 1 / Math.sin(Math.min(angular, Math.PI / 2 - 1e-4));
  }

  markInteraction(now: number): void {
    this.lastInteractionMs = now;
  }

  isInTransition(): boolean {
    return this.transitionStartMs !== null;
  }

  snapshot(): ViewState {
    return { lambda: this.lambda, phi: this.phi, scale: this.scale };
  }

  /** Fly to center (lng, lat) at a boosted focus scale (d3: rotate [-lng, -lat]). */
  flyTo(lng: number, lat: number, onDone?: () => void): void {
    const boosted = Math.min(
      FOCUS_MAX_SCALE,
      Math.max(FOCUS_TARGET_SCALE, this.scale * FOCUS_MIN_SCALE_BOOST),
    );
    this.startTransition(
      { lambda: -lng, phi: -lat, scale: boosted },
      FLY_IN_MS,
      onDone,
    );
  }

  /** Fly back to the region preset view. */
  flyBack(onDone?: () => void): void {
    this.startTransition({ ...this.homeView }, FLY_BACK_MS, onDone);
  }

  cancelTransition(): void {
    this.transitionStartMs = null;
    this.transitionFrom = null;
    this.transitionTo = null;
    this.onTransitionDone = null;
  }

  private startTransition(
    to: ViewState,
    durationMs: number,
    onDone?: () => void,
  ): void {
    this.transitionFrom = this.snapshot();
    this.transitionTo = to;
    this.transitionDurationMs = durationMs;
    this.transitionStartMs = performance.now();
    this.onTransitionDone = onDone ?? null;
  }

  /** Advance transitions / auto-rotation. `focused` pauses auto-rotate. */
  update(now: number, focused: boolean): void {
    if (this.transitionStartMs !== null && this.transitionFrom && this.transitionTo) {
      const t = Math.min(1, (now - this.transitionStartMs) / this.transitionDurationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic, same as 2D
      this.lambda = lerp(this.transitionFrom.lambda, this.transitionTo.lambda, eased);
      this.phi = lerp(this.transitionFrom.phi, this.transitionTo.phi, eased);
      this.scale = lerp(this.transitionFrom.scale, this.transitionTo.scale, eased);
      if (t >= 1) {
        this.lambda = this.transitionTo.lambda;
        this.phi = this.transitionTo.phi;
        this.scale = this.transitionTo.scale;
        const done = this.onTransitionDone;
        this.cancelTransition();
        done?.();
      }
    } else if (
      !this.isDragging &&
      !focused &&
      this.autoRotate &&
      now - this.lastInteractionMs > AUTO_RESUME_MS
    ) {
      this.lambda += this.autoSpeed;
    }
    this.camera.position.set(0, 0, this.distanceForScale());
    this.camera.lookAt(0, 0, 0);
  }

  /** Rotations for the world groups (outer tilt X, inner spin Y).
   *
   * Derived against SphereGeometry's texture mapping: a texel at longitude L
   * sits at (cos L·sinθ, cosθ, −sin L·sinθ), so bringing center lng = −λ to
   * +Z needs spin = λ − 90°. Markers must use the SAME convention:
   * P(lat,lng) = (cos lat·cos lng, sin lat, −cos lat·sin lng). */
  tiltRad(): number {
    return MathUtils.degToRad(-this.phi);
  }
  spinRad(): number {
    return MathUtils.degToRad(this.lambda) - Math.PI / 2;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

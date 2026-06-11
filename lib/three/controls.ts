// Pointer/touch/wheel input → CameraRig, ported 1:1 from QuakeCanvas:
// drag 0.4°/px with phi clamped ±85, wheel/pinch zoom 0.5–5, double-click /
// double-tap reported to a callback (the quake hit-test lives with the quake
// layer, not here).

import type { CameraRig } from "./camera-rig";

const DRAG_SENSITIVITY = 0.4;
const MIN_SCALE = 0.5;
const MAX_SCALE = 5;

export interface ControlsOptions {
  canvas: HTMLCanvasElement;
  rig: CameraRig;
  /** Double-click / double-tap at CSS-pixel coords (canvas-relative). */
  onDoubleClick: (cssX: number, cssY: number) => void;
  /** Any mousemove — drives the focus auto-exit timer. */
  onMouseMove: (nowMs: number) => void;
}

export function attachControls({
  canvas,
  rig,
  onDoubleClick,
  onMouseMove,
}: ControlsOptions): () => void {
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartLambda = 0;
  let dragStartPhi = 0;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let lastTapMs = -Infinity;
  let lastTapX = 0;
  let lastTapY = 0;

  const onMouseDown = (e: MouseEvent) => {
    if (rig.isInTransition()) return; // lock during fly-in/out
    rig.isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartLambda = rig.lambda;
    dragStartPhi = rig.phi;
    rig.markInteraction(performance.now());
  };
  const onMouseMoveWin = (e: MouseEvent) => {
    onMouseMove(performance.now());
    if (!rig.isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    rig.lambda = dragStartLambda + dx * DRAG_SENSITIVITY;
    rig.phi = clamp(dragStartPhi + dy * DRAG_SENSITIVITY, -85, 85);
    rig.markInteraction(performance.now());
  };
  const onMouseUp = () => {
    rig.isDragging = false;
    rig.markInteraction(performance.now());
  };

  const onDblClick = (e: MouseEvent) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    onDoubleClick(e.clientX - rect.left, e.clientY - rect.top);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (rig.isInTransition()) return; // lock zoom mid-flight
    const factor = 1 - e.deltaY * 0.0015;
    rig.scale = clamp(rig.scale * factor, MIN_SCALE, MAX_SCALE);
    rig.markInteraction(performance.now());
  };

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      const t0 = e.touches[0];
      const tNow = performance.now();
      const dt = tNow - lastTapMs;
      const sameSpot =
        Math.hypot(t0.clientX - lastTapX, t0.clientY - lastTapY) <= 30;
      if (dt < 300 && sameSpot) {
        // Double-tap; ignore mid-flight to match the 2D behaviour.
        if (!rig.isInTransition()) {
          const rect = canvas.getBoundingClientRect();
          onDoubleClick(t0.clientX - rect.left, t0.clientY - rect.top);
        }
        lastTapMs = -Infinity; // triple-tap must not re-trigger
        return;
      }
      lastTapMs = tNow;
      lastTapX = t0.clientX;
      lastTapY = t0.clientY;
      if (rig.isInTransition()) return; // lock drag mid-flight
      rig.isDragging = true;
      dragStartX = t0.clientX;
      dragStartY = t0.clientY;
      dragStartLambda = rig.lambda;
      dragStartPhi = rig.phi;
    } else if (e.touches.length === 2) {
      // Pinch starts — cancel any in-flight transition (don't trap the user).
      if (rig.isInTransition()) rig.cancelTransition();
      rig.isDragging = false;
      pinchStartDist = touchDist(e.touches);
      pinchStartScale = rig.scale;
    }
    rig.markInteraction(performance.now());
  };
  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length === 1 && rig.isDragging) {
      e.preventDefault();
      const dx = e.touches[0].clientX - dragStartX;
      const dy = e.touches[0].clientY - dragStartY;
      rig.lambda = dragStartLambda + dx * DRAG_SENSITIVITY;
      rig.phi = clamp(dragStartPhi + dy * DRAG_SENSITIVITY, -85, 85);
      rig.markInteraction(performance.now());
    } else if (e.touches.length === 2 && pinchStartDist > 0) {
      e.preventDefault();
      const factor = touchDist(e.touches) / pinchStartDist;
      rig.scale = clamp(pinchStartScale * factor, MIN_SCALE, MAX_SCALE);
      rig.markInteraction(performance.now());
    }
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length === 0) {
      rig.isDragging = false;
      pinchStartDist = 0;
    }
    rig.markInteraction(performance.now());
  };

  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMoveWin);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("dblclick", onDblClick);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove", onTouchMove, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd);
  canvas.addEventListener("touchcancel", onTouchEnd);

  return () => {
    canvas.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mousemove", onMouseMoveWin);
    window.removeEventListener("mouseup", onMouseUp);
    canvas.removeEventListener("dblclick", onDblClick);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("touchend", onTouchEnd);
    canvas.removeEventListener("touchcancel", onTouchEnd);
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function touchDist(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

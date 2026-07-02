// Bridge into the splat viewer iframe. The viewer (repo-root index.html) is
// same-origin and exposes window.DEBUG = { THREE, camera, renderer, … } plus
// window.__recording — the same contract the headless flythrough recorder
// drives. preserveDrawingBuffer is on, so canvas.toDataURL works.

import type { Pose } from "../model/types";
import { poseLerp } from "./pose";

// Vite dev serves the viewer at /viewer.html (see vite.config.ts); the built
// app lives at /storyboard/ next to the viewer at ../index.html.
export const VIEWER_PATH = import.meta.env.DEV ? "/viewer.html" : "../index.html";

export interface ViewerHandles {
  camera: {
    position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
    quaternion: { x: number; y: number; z: number; w: number; set(x: number, y: number, z: number, w: number): void };
    fov: number;
    aspect: number;
  };
  renderer: { domElement: HTMLCanvasElement };
}

export function getViewer(iframe: HTMLIFrameElement | null): ViewerHandles | null {
  const w = iframe?.contentWindow as (Window & { DEBUG?: ViewerHandles }) | null;
  return w?.DEBUG ?? null;
}

export interface Capture {
  dataUrl: string;
  pose: Pose;
  fov: number;
  aspect: number;
}

const CAPTURE_MAX_W = 1280;

export function captureFrame(iframe: HTMLIFrameElement | null): Capture | null {
  const v = getViewer(iframe);
  if (!v) return null;
  const src = v.renderer.domElement;
  const scale = Math.min(1, CAPTURE_MAX_W / src.width);
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(src, 0, 0, w, h);
  const { position: p, quaternion: q } = v.camera;
  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.88),
    pose: { position: [p.x, p.y, p.z], quaternion: [q.x, q.y, q.z, q.w] },
    fov: v.camera.fov,
    aspect: v.camera.aspect,
  };
}

export function setViewerPose(iframe: HTMLIFrameElement | null, pose: Pose) {
  const v = getViewer(iframe);
  if (!v) return;
  v.camera.position.set(...pose.position);
  v.camera.quaternion.set(...pose.quaternion);
}

/** Drive the viewer camera from start to end over durationSec — a real 3D
 * preview of the shot's camera move. Pauses the viewer's own controls via
 * window.__recording (the recorder contract). */
export function previewMove(
  iframe: HTMLIFrameElement | null,
  start: Pose,
  end: Pose,
  durationSec: number,
  onDone?: () => void,
): () => void {
  const w = iframe?.contentWindow as (Window & { __recording?: boolean }) | null;
  const v = getViewer(iframe);
  if (!w || !v) { onDone?.(); return () => {}; }
  w.__recording = true;
  const t0 = performance.now();
  let raf = 0;
  let cancelled = false;
  const finish = () => {
    w.__recording = false;
    if (!cancelled) onDone?.();
  };
  const step = () => {
    const t = Math.min(1, (performance.now() - t0) / (durationSec * 1000));
    // ease-in-out — closer to how a dolly actually accelerates
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    setViewerPose(iframe, poseLerp(start, end, e));
    if (t < 1) raf = requestAnimationFrame(step);
    else finish();
  };
  raf = requestAnimationFrame(step);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
    w.__recording = false;
  };
}

/** Register a key listener inside the iframe document (so hotkeys work while
 * the viewer holds pointer lock). Returns an unsubscribe. */
export function onViewerKey(
  iframe: HTMLIFrameElement | null,
  code: string,
  cb: () => void,
): () => void {
  const doc = iframe?.contentDocument;
  if (!doc) return () => {};
  const handler = (e: KeyboardEvent) => {
    if (e.code === code) cb();
  };
  doc.addEventListener("keydown", handler);
  return () => doc.removeEventListener("keydown", handler);
}

// Mock-mode footage: render the shot's keyframe through its ken-burns move
// into a real webm, so "make it move" moves even without a FARM servable.
// MediaRecorder captures in real time, so clips are capped short.

import type { Movement } from "../model/types";
import { kenBurns } from "../lib/movement";

const MAX_RENDER_SEC = 3;
const W = 640;
const H = 360;

function parseKb(s: string): { scale: number; tx: number; ty: number } {
  return {
    scale: parseFloat(/scale\(([\d.]+)\)/.exec(s)?.[1] ?? "1"),
    tx: parseFloat(/translateX?\((-?[\d.]+)%/.exec(s)?.[1] ?? /translate\((-?[\d.]+)%/.exec(s)?.[1] ?? "0"),
    ty: parseFloat(/translateY\((-?[\d.]+)%/.exec(s)?.[1] ?? /translate\(-?[\d.]+%,\s*(-?[\d.]+)%/.exec(s)?.[1] ?? "0"),
  };
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export async function renderMockTake(
  imageDataUrl: string,
  movement: Movement,
  durationSec: number,
): Promise<string> {
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("mock take: image failed to load"));
    img.src = imageDataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const kb = kenBurns(movement);
  const from = parseKb(kb.from);
  const to = parseKb(kb.to);
  const dur = Math.min(durationSec, MAX_RENDER_SEC) * 1000;

  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { videoBitsPerSecond: 700_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<Blob>((res) => {
    rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType || "video/webm" }));
  });

  // cover-fit the image, then apply the interpolated ken-burns transform
  const cover = Math.max(W / img.width, H / img.height);
  const draw = (t01: number) => {
    const e = easeInOut(t01);
    const l = (a: number, b: number) => a + (b - a) * e;
    const s = l(from.scale, to.scale) * cover;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2 + (l(from.tx, to.tx) / 100) * W, H / 2 + (l(from.ty, to.ty) / 100) * H);
    ctx.scale(s, s);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  };

  draw(0);
  rec.start(250);
  const t0 = performance.now();
  await new Promise<void>((res) => {
    const step = () => {
      const el = performance.now() - t0;
      draw(Math.min(1, el / dur));
      if (el >= dur) { rec.stop(); res(); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  const blob = await done;
  return await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("mock take: encode failed"));
    r.readAsDataURL(blob);
  });
}

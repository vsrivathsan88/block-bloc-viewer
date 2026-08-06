// FARM T2I: prompt → a set image to storyboard in. Mock mode paints a
// placeholder slate so the flow works without a servable; live mode goes
// through the Marble Task API (tasks:farmT2i) and polls the Operation.

import { loadMarbleConfig, pollOperation, submitTask } from "../marble/client";
import { loadFarmConfig } from "./client";

/** Dig an image out of a shape-tolerant task response. */
function findImage(o: unknown): string | undefined {
  if (o == null || typeof o !== "object") return undefined;
  if (Array.isArray(o)) {
    for (const v of o) {
      const hit = findImage(v);
      if (hit) return hit;
    }
    return undefined;
  }
  const rec = o as Record<string, unknown>;
  for (const [k, v] of Object.entries(rec)) {
    const key = k.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (typeof v === "string" && v) {
      if (key === "imagebase64") return v.startsWith("data:") ? v : `data:image/png;base64,${v}`;
      if (key === "imageurl" || key === "url" || key === "uri") return v;
    }
    const hit = findImage(v);
    if (hit) return hit;
  }
  return undefined;
}

function mockSetImage(prompt: string): string {
  const W = 1280, H = 720;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#2a2f45");
  g.addColorStop(0.55, "#4a4f6b");
  g.addColorStop(0.56, "#38333c");
  g.addColorStop(1, "#191721");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // horizon-ish blocks so ken-burns mocks read as a place, not a gradient
  ctx.fillStyle = "rgba(255,255,255,.08)";
  ctx.fillRect(W * 0.08, H * 0.3, W * 0.2, H * 0.26);
  ctx.fillRect(W * 0.62, H * 0.22, W * 0.28, H * 0.34);
  ctx.fillStyle = "rgba(0,0,0,.28)";
  ctx.fillRect(0, H * 0.72, W, H * 0.28);
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.font = "600 34px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("mock set — FARM T2I", W / 2, H * 0.46);
  ctx.font = "26px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,.6)";
  ctx.fillText(prompt.slice(0, 70), W / 2, H * 0.54);
  return c.toDataURL("image/jpeg", 0.9);
}

/** Returns an image src (data URL in mock mode, whatever the task returns live). */
export async function generateSetImage(prompt: string): Promise<string> {
  const farm = loadFarmConfig();
  if (farm.mode === "mock") {
    await new Promise((r) => setTimeout(r, 1200));
    return mockSetImage(prompt);
  }
  const cfg = loadMarbleConfig();
  const handle = await submitTask(cfg, "farmT2i", { prompt });
  const deadline = Date.now() + 5 * 60 * 1000;
  for (;;) {
    const op = await pollOperation(cfg, { name: handle.name, task: "farmT2i" });
    if (op.status === "done") {
      const img = findImage(op.response);
      if (!img) throw new Error("farmT2i finished but returned no image");
      return img;
    }
    if (op.status === "error") throw new Error(op.error ?? "farmT2i failed");
    if (Date.now() > deadline) throw new Error("farmT2i timed out");
    await new Promise((r) => setTimeout(r, 1500));
  }
}

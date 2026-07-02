// Third-party image-edit adapter — the "cast pass". Given a clean plate from
// the Marble world, character reference images, and an instruction, return the
// plate with the character composited in. A 2D edit never moves the camera, so
// the result inherits the clean plate's pose and stays a valid FARM AR anchor.
//
// Providers:
//   mock   — offline: draws a labeled figure silhouette so the pipeline can be
//            exercised without keys.
//   gemini — Gemini image generation (aka Nano Banana): browser-friendly REST,
//            reference-guided edits via inline image parts.
//   openai — gpt-image-1 /v1/images/edits.
// Keys live in this browser's localStorage only.

export interface EditConfig {
  provider: "mock" | "gemini" | "openai";
  apiKey: string;
  model: string;
}

export const DEFAULT_EDIT_CONFIG: EditConfig = {
  provider: "mock",
  apiKey: "",
  model: "gemini-2.5-flash-image",
};

const CONFIG_KEY = "shotboard.editConfig";

export function loadEditConfig(): EditConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_EDIT_CONFIG, ...JSON.parse(raw) };
  } catch { /* fall through */ }
  return { ...DEFAULT_EDIT_CONFIG };
}

export function saveEditConfig(c: EditConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
}

export interface EditInput {
  /** clean plate data URL; omitted for pure generation (character sheets) */
  base?: string;
  /** character reference images, data URLs */
  refs: string[];
  instruction: string;
}

export async function editImage(cfg: EditConfig, input: EditInput): Promise<string> {
  switch (cfg.provider) {
    case "mock":
      return mockEdit(input);
    case "gemini":
      return geminiEdit(cfg, input);
    case "openai":
      return openaiEdit(cfg, input);
  }
}

// --- mock ---------------------------------------------------------------

async function mockEdit(input: EditInput): Promise<string> {
  const W = 1280, H = 720;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  if (input.base) {
    const img = await loadImg(input.base);
    ctx.drawImage(img, 0, 0, W, H);
  } else {
    ctx.fillStyle = "#efe8d6";
    ctx.fillRect(0, 0, W, H);
  }
  // stand-in figure, right of center at eye height
  const fx = W * 0.62, fh = H * 0.52, fy = H - fh * 1.05;
  ctx.fillStyle = "rgba(43,38,32,0.82)";
  ctx.beginPath(); // head
  ctx.arc(fx, fy + fh * 0.08, fh * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath(); // body
  ctx.moveTo(fx - fh * 0.11, fy + fh * 0.2);
  ctx.quadraticCurveTo(fx, fy + fh * 0.14, fx + fh * 0.11, fy + fh * 0.2);
  ctx.lineTo(fx + fh * 0.09, fy + fh * 0.62);
  ctx.lineTo(fx + fh * 0.05, fy + fh);
  ctx.lineTo(fx - fh * 0.05, fy + fh);
  ctx.lineTo(fx - fh * 0.09, fy + fh * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(179,55,43,0.9)";
  ctx.font = "22px 'Courier New', monospace";
  const label = `[mock cast] ${input.instruction.slice(0, 60)}`;
  ctx.fillText(label, 24, H - 24);
  await new Promise((r) => setTimeout(r, 600)); // feel like a network call
  return canvas.toDataURL("image/jpeg", 0.88);
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// --- gemini ---------------------------------------------------------------

function dataUrlParts(dataUrl: string): { mime: string; b64: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error("expected a base64 data URL");
  return { mime: m[1], b64: m[2] };
}

async function geminiEdit(cfg: EditConfig, input: EditInput): Promise<string> {
  if (!cfg.apiKey) throw new Error("gemini: missing API key (settings → cast pass)");
  const parts: unknown[] = [{ text: input.instruction }];
  if (input.base) {
    const { mime, b64 } = dataUrlParts(input.base);
    parts.push({ inline_data: { mime_type: mime, data: b64 } });
  }
  for (const ref of input.refs) {
    const { mime, b64 } = dataUrlParts(ref);
    parts.push({ inline_data: { mime_type: mime, data: b64 } });
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
      body: JSON.stringify({ contents: [{ parts }] }),
    },
  );
  if (!res.ok) throw new Error(`gemini: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const outParts: { inlineData?: { mimeType: string; data: string } }[] =
    json.candidates?.[0]?.content?.parts ?? [];
  const img = outParts.find((p) => p.inlineData);
  if (!img?.inlineData) throw new Error("gemini: no image in response");
  return `data:${img.inlineData.mimeType};base64,${img.inlineData.data}`;
}

// --- openai ---------------------------------------------------------------

async function openaiEdit(cfg: EditConfig, input: EditInput): Promise<string> {
  if (!cfg.apiKey) throw new Error("openai: missing API key (settings → cast pass)");
  const model = cfg.model.startsWith("gpt-image") ? cfg.model : "gpt-image-1";
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", input.instruction);
  const toBlob = async (dataUrl: string) => await (await fetch(dataUrl)).blob();
  // base first, then refs — gpt-image-1 accepts multiple image[] inputs
  const images = [...(input.base ? [input.base] : []), ...input.refs];
  if (!images.length) throw new Error("openai edit needs at least one image");
  for (const [i, d] of images.entries()) form.append("image[]", await toBlob(d), `img${i}.jpg`);
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`openai: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("openai: no image in response");
  return `data:image/png;base64,${b64}`;
}

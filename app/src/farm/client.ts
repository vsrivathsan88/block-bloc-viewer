// FARM AR Task API client — conforms to docs/farm_ar_api_spec.md (the
// canonical spec, vendored in this repo).
//
//   POST {base}/api/v2/tasks:farmAr   (account-scoped path used when an
//   account id is configured) → long-running Operation; poll until done.
//
// Request essentials (wire names are camelCase):
//   prompt, referenceImages: [{imageBase64, camera}], targetCameras,
//   targetFrameCount (== len(targetCameras)), fps, seed, cfg, numSteps,
//   promptEnhancerModel, model, depthScaleFactor.
// Camera = pinhole intrinsics (fx fy cx cy width height, px units) +
// camera-to-world extrinsics in Three.js convention (XYZW quaternion) — the
// backend does the OpenCV conversion, so we send raw Three.js camera state.
//
// Context rules from the spec that shape this client:
// - The servable is STATELESS: the context window is exactly the
//   referenceImages we send per call. Ordering matters — the model weights
//   recent positions most, so the most-relevant view (the shot's keyframe)
//   goes LAST in referenceImages.
// - Sequence budget: num_context + num_targets ≤ 128 hard, but the model was
//   trained with a 32-frame context — we cap context+targets at 32.
// - Rig normalization is per request; depthScaleFactor pins a consistent
//   metric scale across shots in the same world.

import type { CapturedFrame, Pose } from "../model/types";
import { poseLerp } from "../lib/pose";

export const TRAINED_SEQ_BUDGET = 32;

export interface FarmConfig {
  mode: "mock" | "live";
  baseUrl: string; // e.g. https://marble4-autopush.worldlabs.ai
  accountId: string; // acct_… (blank = unscoped /api/v2/tasks:farmAr)
  token: string; // Clerk JWT or API key, sent as Bearer
  model: string; // servable slug, e.g. "run09-v1" ("" = server default)
  fps: number; // camera-path density AND MP4 fps → playback matches durations
  seed: number;
  cfg: number;
  numSteps: number;
  depthScaleFactor: number | null; // pin metric scale across shots ("" = derived)
}

export const DEFAULT_FARM_CONFIG: FarmConfig = {
  mode: "mock",
  baseUrl: "https://marble4-autopush.worldlabs.ai",
  accountId: "",
  token: "",
  model: "",
  fps: 8,
  seed: 42,
  cfg: 2.5,
  numSteps: 50,
  depthScaleFactor: null,
};

const CONFIG_KEY = "shotboard.farmConfig";

export function loadFarmConfig(): FarmConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_FARM_CONFIG, ...JSON.parse(raw) };
  } catch { /* fall through */ }
  return { ...DEFAULT_FARM_CONFIG };
}

export function saveFarmConfig(c: FarmConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
}

interface CameraJson {
  intrinsics: { fx: number; fy: number; cx: number; cy: number; width: number; height: number };
  extrinsics: { position: number[]; quaternion: number[] };
}

function cameraJson(pose: Pose, fovDeg: number, width: number, height: number): CameraJson {
  // Pinhole intrinsics in pixel units of the client viewport, principal
  // point at the image centre. The server rescales to the servable's native
  // shape (640×640 for run09-v1) and center-crops aspect mismatches.
  const f = height / 2 / Math.tan((fovDeg * Math.PI) / 360);
  return {
    intrinsics: { fx: f, fy: f, cx: width / 2, cy: height / 2, width, height },
    extrinsics: { position: [...pose.position], quaternion: [...pose.quaternion] },
  };
}

export interface BuildRequestInput {
  prompt: string;
  /** context anchors in tray order; the LAST entry should be the keyframe
   * (most-relevant view) — recent positions carry the most weight */
  contextFrames: { frame: CapturedFrame; imageDataUrl: string }[];
  startPose: Pose;
  endPose: Pose;
  fovDeg: number;
  frameCount: number;
  width: number;
  height: number;
  cfg: FarmConfig;
}

export function buildFarmArRequest(input: BuildRequestInput): Record<string, unknown> {
  const { cfg } = input;
  // enforce the trained sequence budget: context + targets ≤ 32
  const maxTargets = Math.max(2, TRAINED_SEQ_BUDGET - input.contextFrames.length);
  const n = Math.min(maxTargets, Math.max(2, input.frameCount));
  const referenceImages = input.contextFrames.map(({ frame, imageDataUrl }) => ({
    imageBase64: imageDataUrl.replace(/^data:image\/\w+;base64,/, ""),
    camera: cameraJson(frame.pose, frame.fov, input.width, input.height),
  }));
  const targetCameras = Array.from({ length: n }, (_, i) =>
    cameraJson(poseLerp(input.startPose, input.endPose, i / (n - 1)), input.fovDeg, input.width, input.height),
  );
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    referenceImages,
    targetCameras,
    targetFrameCount: n,
    fps: cfg.fps,
    seed: cfg.seed,
    cfg: cfg.cfg,
    numSteps: cfg.numSteps,
  };
  if (cfg.model) body.model = cfg.model;
  if (cfg.depthScaleFactor && cfg.depthScaleFactor > 0) body.depthScaleFactor = cfg.depthScaleFactor;
  return body;
}

export interface TaskHandle {
  taskId: string;
  mock: boolean;
}

export interface TaskResult {
  status: "queued" | "running" | "done" | "error";
  videoUrl?: string;
  captionUsed?: string;
  phase?: string; // enhancing / staging / generating / assembling
  error?: string;
}

function authHeaders(cfg: FarmConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
  };
}

function taskPath(cfg: FarmConfig, suffix: string): string {
  const base = cfg.baseUrl.replace(/\/$/, "");
  return cfg.accountId
    ? `${base}/api/v2/accounts/${cfg.accountId}/${suffix}`
    : `${base}/api/v2/${suffix}`;
}

export async function submitFarmAr(
  cfg: FarmConfig,
  body: Record<string, unknown>,
): Promise<TaskHandle> {
  if (cfg.mode === "mock") {
    const taskId = `mock_${Date.now().toString(36)}`;
    mockTasks.set(taskId, Date.now());
    return { taskId, mock: true };
  }
  const res = await fetch(taskPath(cfg, "tasks:farmAr"), {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`farmAr submit failed: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 300))}`);
  const json = await res.json();
  // Operation contract; tolerate id living under a few names.
  const taskId: string | undefined =
    json.name ?? json.id ?? json.operation?.name ?? json.operationId ?? json.task_id;
  if (!taskId) throw new Error(`farmAr submit: no operation id in ${JSON.stringify(json).slice(0, 300)}`);
  return { taskId: String(taskId), mock: false };
}

export async function pollFarmAr(cfg: FarmConfig, handle: TaskHandle): Promise<TaskResult> {
  if (handle.mock) {
    const started = mockTasks.get(handle.taskId);
    if (started == null) return { status: "error", error: "unknown mock task" };
    const elapsed = Date.now() - started;
    if (elapsed < 2000) return { status: "queued", phase: "staging" };
    if (elapsed < MOCK_DURATION_MS) return { status: "running", phase: "generating" };
    // Mock "done" carries no video: the animatic falls back to the Ken Burns
    // pencil-test, clearly labeled as simulated.
    return { status: "done" };
  }
  const id = handle.taskId.replace(/^\/+/, "");
  // Operation names may already be paths ("operations/…"); otherwise treat as
  // a task id under tasks/.
  const suffix = id.includes("/") ? id : `tasks/${id}`;
  const res = await fetch(taskPath(cfg, suffix), { headers: authHeaders(cfg) });
  if (!res.ok) return { status: "error", error: `poll HTTP ${res.status}` };
  const json = await res.json();
  const phase: string | undefined = json.metadata?.phase;
  if (json.error) {
    return { status: "error", phase, error: String(json.error?.message ?? json.error) };
  }
  if (json.done === true || json.response?.videoUrl) {
    const r = json.response ?? {};
    return { status: "done", videoUrl: r.videoUrl ?? r.video_url, captionUsed: r.captionUsed, phase };
  }
  if (json.done === false || phase) {
    return { status: phase === "generating" || phase === "assembling" ? "running" : "queued", phase };
  }
  // non-Operation shaped fallback
  const state = String(json.state ?? json.status ?? "").toLowerCase();
  if (state.includes("fail") || state.includes("error")) return { status: "error", error: state };
  if (state.includes("succeed") || state.includes("done")) return { status: "done", videoUrl: json.video_url };
  return { status: "running" };
}

const MOCK_DURATION_MS = 6000;
const mockTasks = new Map<string, number>();

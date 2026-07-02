// FARM AR Task API client.
//
// Contract (wlt: src/wlt/marble/v2/schema/tasks/farm_ar.py):
//   POST {baseUrl}/api/v2/accounts/{accountId}/tasks:farmAr
//   Body (FarmArRequest):
//     prompt: str                     — required when reference_images is empty
//     reference_images: [             — context views = SPATIAL ANCHORS
//       { image_base64, camera: FarmArCamera }
//     ]
//     target_frame_count: int         — must equal len(target_cameras)
//     target_cameras: [FarmArCamera]  — the client-built camera path
//     model?: slug                    — e.g. "run09-v1" (FARM_AR_SLUG_TO_SERVABLE)
//   FarmArCamera:
//     intrinsics: pinhole in pixel units (Three.js viewport)
//     extrinsics: camera-to-world, Three.js convention (Y-up, Z-backward),
//                 { position: [x,y,z], quaternion: [x,y,z,w] }
//   The task is an LRO; poll the Operation until done. Completed response
//   (FarmArResponse) carries video_url — the assembled MP4 preview asset.
//
// Anchoring rule (farm_ar/context_bundle.py): the context bundle is anchored
// at the identity pose, and target cameras should stay anchored against it.
// All Shotboard poses live in the splat-world frame, so we re-express every
// camera relative to the FIRST context anchor before sending.

import type { CapturedFrame, Pose } from "../model/types";
import { poseLerp, relativeTo } from "../lib/pose";

export interface FarmConfig {
  mode: "mock" | "live";
  baseUrl: string; // e.g. https://marble4-autopush.worldlabs.ai
  accountId: string; // acct_…
  token: string; // Clerk JWT or API key, sent as Bearer
  model: string; // servable slug, e.g. "run09-v1" ("" = server default)
  fps: number; // target cameras per second of shot duration
}

export const DEFAULT_FARM_CONFIG: FarmConfig = {
  mode: "mock",
  baseUrl: "https://marble4-autopush.worldlabs.ai",
  accountId: "",
  token: "",
  model: "",
  fps: 12,
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

interface FarmArCameraJson {
  intrinsics: { width: number; height: number; fx: number; fy: number };
  extrinsics: { position: number[]; quaternion: number[] };
}

function cameraJson(pose: Pose, fovDeg: number, width: number, height: number): FarmArCameraJson {
  // Pinhole intrinsics in pixel units from the viewer's vertical fov.
  const f = height / 2 / Math.tan((fovDeg * Math.PI) / 360);
  return {
    intrinsics: { width, height, fx: f, fy: f },
    extrinsics: { position: [...pose.position], quaternion: [...pose.quaternion] },
  };
}

export interface BuildRequestInput {
  prompt: string;
  /** ordered context anchors; [0] becomes the identity pose */
  contextFrames: { frame: CapturedFrame; imageDataUrl: string }[];
  startPose: Pose;
  endPose: Pose;
  fovDeg: number;
  frameCount: number;
  /** render size of the target views (defaults to the anchor's capture size) */
  width: number;
  height: number;
  model?: string;
}

export function buildFarmArRequest(input: BuildRequestInput): Record<string, unknown> {
  const anchor = input.contextFrames[0]?.frame.pose ?? input.startPose;
  const reference_images = input.contextFrames.map(({ frame, imageDataUrl }) => ({
    image_base64: imageDataUrl.replace(/^data:image\/\w+;base64,/, ""),
    camera: cameraJson(
      relativeTo(frame.pose, anchor),
      frame.fov,
      input.width,
      input.height,
    ),
  }));
  const n = Math.max(2, input.frameCount);
  const target_cameras = Array.from({ length: n }, (_, i) => {
    const pose = poseLerp(input.startPose, input.endPose, i / (n - 1));
    return cameraJson(relativeTo(pose, anchor), input.fovDeg, input.width, input.height);
  });
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    reference_images,
    target_frame_count: n,
    target_cameras,
  };
  if (input.model) body.model = input.model;
  return body;
}

export interface TaskHandle {
  taskId: string;
  mock: boolean;
}

export interface TaskResult {
  status: "queued" | "running" | "done" | "error";
  videoUrl?: string;
  error?: string;
}

function authHeaders(cfg: FarmConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
  };
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
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/api/v2/accounts/${cfg.accountId}/tasks:farmAr`;
  const res = await fetch(url, { method: "POST", headers: authHeaders(cfg), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`farmAr submit failed: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 300))}`);
  const json = await res.json();
  // The task is an Operation; be tolerant about where the id lives.
  const taskId: string | undefined =
    json.id ?? json.task_id ?? json.name ?? json.operation?.name ?? json.operation_id;
  if (!taskId) throw new Error(`farmAr submit: no task id in response ${JSON.stringify(json).slice(0, 300)}`);
  return { taskId: String(taskId), mock: false };
}

export async function pollFarmAr(cfg: FarmConfig, handle: TaskHandle): Promise<TaskResult> {
  if (handle.mock) {
    const started = mockTasks.get(handle.taskId);
    if (started == null) return { status: "error", error: "unknown mock task" };
    const elapsed = Date.now() - started;
    if (elapsed < 2000) return { status: "queued" };
    if (elapsed < MOCK_DURATION_MS) return { status: "running" };
    // Mock "done" carries no video: the animatic falls back to the Ken Burns
    // pencil-test, clearly labeled as simulated.
    return { status: "done" };
  }
  const base = cfg.baseUrl.replace(/\/$/, "");
  const id = encodeURIComponent(handle.taskId);
  const url = `${base}/api/v2/accounts/${cfg.accountId}/tasks/${id}`;
  const res = await fetch(url, { headers: authHeaders(cfg) });
  if (!res.ok) return { status: "error", error: `poll HTTP ${res.status}` };
  const json = await res.json();
  const state = String(json.state ?? json.status ?? json.operation?.state ?? "").toLowerCase();
  const response = json.response ?? json.result ?? json;
  const videoUrl: string | undefined = response?.video_url ?? response?.videoUrl;
  if (json.error || state.includes("fail") || state.includes("error")) {
    return { status: "error", error: String(json.error?.message ?? json.error ?? state) };
  }
  if (videoUrl || state.includes("succeed") || state.includes("done") || state.includes("complete")) {
    return { status: "done", videoUrl };
  }
  if (state.includes("queue") || state.includes("pend")) return { status: "queued" };
  return { status: "running" };
}

const MOCK_DURATION_MS = 6000;
const mockTasks = new Map<string, number>();

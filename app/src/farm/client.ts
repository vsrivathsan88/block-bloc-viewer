// FARM AR request building + generation params. Hosts, auth, and Operation
// polling live in ../marble/client — FARM is one task on that surface.
// Contract: docs/farm_ar_api_spec.md (vendored canonical spec).
//
// Context rules from the spec that shape this client:
// - The servable is STATELESS: the context window is exactly the
//   referenceImages we send per call. Ordering matters — the model weights
//   recent positions most, so the most-relevant view (the shot's keyframe)
//   goes LAST in referenceImages.
// - Sequence budget: context + targets ≤ 128 hard, trained at 32 — we cap at 32.
// - Rig normalization is per request; depthScaleFactor pins a consistent
//   metric scale across shots in the same world.
// - Cameras are RAW Three.js camera-to-world state (pinhole fx/fy/cx/cy +
//   XYZW quaternion); the backend converts to OpenCV and normalizes.

import type { CapturedFrame, Pose } from "../model/types";
import { poseLerp } from "../lib/pose";
import { samplePath } from "../lib/path";
import { loadMarbleConfig, pollOperation, submitTask } from "../marble/client";

export const TRAINED_SEQ_BUDGET = 32;

/** Generation parameters only — endpoint/auth are Marble-level config. */
export interface FarmConfig {
  mode: "mock" | "live";
  model: string; // servable slug, e.g. "run09-v1" ("" = server default)
  fps: number; // camera-path density AND MP4 fps → playback matches durations
  seed: number;
  cfg: number;
  numSteps: number;
  depthScaleFactor: number | null; // pin metric scale across shots ("" = derived)
}

export const DEFAULT_FARM_CONFIG: FarmConfig = {
  mode: "mock",
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
  // Pinhole intrinsics in pixel units, principal point at the image centre.
  // The server rescales to the servable's native shape (640×640 for run09-v1).
  const f = height / 2 / Math.tan((fovDeg * Math.PI) / 360);
  return {
    intrinsics: { fx: f, fy: f, cx: width / 2, cy: height / 2, width, height },
    extrinsics: { position: [...pose.position], quaternion: [...pose.quaternion] },
  };
}

export interface BuildRequestInput {
  prompt: string;
  /** context anchors in model-sequence order; keyframe LAST (most weight) */
  contextFrames: { frame: CapturedFrame; imageDataUrl: string }[];
  startPose: Pose;
  endPose: Pose;
  /** recorded waypoints; when present (≥2) the camera path is the arc-length
   * spline through these instead of the start→end lerp */
  path?: Pose[];
  fovDeg: number;
  frameCount: number;
  width: number;
  height: number;
  cfg: FarmConfig;
}

export function buildFarmArRequest(input: BuildRequestInput): Record<string, unknown> {
  const { cfg } = input;
  const maxTargets = Math.max(2, TRAINED_SEQ_BUDGET - input.contextFrames.length);
  const n = Math.min(maxTargets, Math.max(2, input.frameCount));
  const referenceImages = input.contextFrames.map(({ frame, imageDataUrl }) => ({
    imageBase64: imageDataUrl.replace(/^data:image\/\w+;base64,/, ""),
    camera: cameraJson(frame.pose, frame.fov, input.width, input.height),
  }));
  const pathPoses =
    input.path && input.path.length >= 2
      ? samplePath(input.path, n)
      : Array.from({ length: n }, (_, i) => poseLerp(input.startPose, input.endPose, i / (n - 1)));
  const targetCameras = pathPoses.map((p) => cameraJson(p, input.fovDeg, input.width, input.height));
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
  phase?: string;
  error?: string;
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
  const handle = await submitTask(loadMarbleConfig(), "farmAr", body);
  return { taskId: handle.name, mock: false };
}

export async function pollFarmAr(cfg: FarmConfig, handle: TaskHandle): Promise<TaskResult> {
  if (handle.mock) {
    const started = mockTasks.get(handle.taskId);
    if (started == null) return { status: "error", error: "unknown mock task" };
    const elapsed = Date.now() - started;
    if (elapsed < 2000) return { status: "queued", phase: "staging" };
    if (elapsed < MOCK_DURATION_MS) return { status: "running", phase: "generating" };
    // Mock "done" carries no video: the animatic falls back to the pencil-test.
    return { status: "done" };
  }
  void cfg;
  const op = await pollOperation(loadMarbleConfig(), { name: handle.taskId, task: "farmAr" });
  const r = (op.response ?? {}) as { videoUrl?: string; video_url?: string; captionUsed?: string };
  return {
    status: op.status,
    phase: op.phase,
    error: op.error,
    videoUrl: r.videoUrl ?? r.video_url,
    captionUsed: r.captionUsed,
  };
}

const MOCK_DURATION_MS = 6000;
const mockTasks = new Map<string, number>();

// Marble V2 Task API client — the single place that knows hosts, auth, and
// the Operation contract. Capabilities are deployed behind DIFFERENT
// endpoints per environment, so every task name can override the base URL.
//
// Task surface used by Shotboard (wire names from the generated marble-api):
//   tasks:farmAr                — camera path + posed context → MP4   (docs/farm_ar_api_spec.md)
//   tasks:farmT2i               — prompt → image
//   tasks:depthPano2Pano        — depth pano + prompt → Chisel RGB pano/cubemap (x2p-chisel-v1)
//   tasks:depthPano2DraftSplats — depth pano + prompt → Chisel pano → L3RM draft splats
// All are long-running Operations: POST returns an operation; poll until done.

export type MarbleTask = "farmAr" | "farmT2i" | "depthPano2Pano" | "depthPano2DraftSplats";

export const MARBLE_TASKS: MarbleTask[] = ["farmAr", "farmT2i", "depthPano2Pano", "depthPano2DraftSplats"];

export interface MarbleConfig {
  baseUrl: string; // default host, e.g. https://marble4-autopush.worldlabs.ai
  accountId: string; // acct_… ("" = unscoped /api/v2/tasks:*)
  token: string; // Clerk JWT or API key, sent as Bearer
  /** per-task base-URL overrides — capabilities live on different hosts */
  endpoints: Partial<Record<MarbleTask, string>>;
}

export const DEFAULT_MARBLE_CONFIG: MarbleConfig = {
  baseUrl: "https://marble4-autopush.worldlabs.ai",
  accountId: "",
  token: "",
  endpoints: {},
};

const CONFIG_KEY = "shotboard.marbleConfig";
const LEGACY_FARM_KEY = "shotboard.farmConfig"; // pre-split config carried host+auth

export function loadMarbleConfig(): MarbleConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_MARBLE_CONFIG, ...JSON.parse(raw) };
    const legacy = localStorage.getItem(LEGACY_FARM_KEY);
    if (legacy) {
      const l = JSON.parse(legacy);
      return {
        ...DEFAULT_MARBLE_CONFIG,
        baseUrl: l.baseUrl ?? DEFAULT_MARBLE_CONFIG.baseUrl,
        accountId: l.accountId ?? "",
        token: l.token ?? "",
      };
    }
  } catch { /* fall through */ }
  return { ...DEFAULT_MARBLE_CONFIG };
}

export function saveMarbleConfig(c: MarbleConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
}

function hostFor(cfg: MarbleConfig, task: MarbleTask): string {
  return (cfg.endpoints[task] || cfg.baseUrl).replace(/\/$/, "");
}

function pathFor(cfg: MarbleConfig, suffix: string): string {
  return cfg.accountId ? `/api/v2/accounts/${cfg.accountId}/${suffix}` : `/api/v2/${suffix}`;
}

function headers(cfg: MarbleConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
  };
}

export interface OperationHandle {
  /** operation name/id as returned by the submit */
  name: string;
  /** the task it was submitted as — polling must hit the same host */
  task: MarbleTask;
}

export interface OperationStatus {
  status: "queued" | "running" | "done" | "error";
  /** completed Operation response body (task-specific) */
  response?: Record<string, unknown>;
  phase?: string;
  progressPercent?: number;
  error?: string;
}

export async function submitTask(
  cfg: MarbleConfig,
  task: MarbleTask,
  body: Record<string, unknown>,
): Promise<OperationHandle> {
  const url = `${hostFor(cfg, task)}${pathFor(cfg, `tasks:${task}`)}`;
  const res = await fetch(url, { method: "POST", headers: headers(cfg), body: JSON.stringify(body) });
  if (!res.ok) {
    throw new Error(`${task} submit failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  const name: string | undefined =
    json.name ?? json.id ?? json.operation?.name ?? json.operationId ?? json.task_id;
  if (!name) throw new Error(`${task} submit: no operation id in ${JSON.stringify(json).slice(0, 300)}`);
  return { name: String(name), task };
}

export async function pollOperation(cfg: MarbleConfig, handle: OperationHandle): Promise<OperationStatus> {
  const id = handle.name.replace(/^\/+/, "");
  const suffix = id.includes("/") ? id : `tasks/${id}`;
  const res = await fetch(`${hostFor(cfg, handle.task)}${pathFor(cfg, suffix)}`, { headers: headers(cfg) });
  if (!res.ok) return { status: "error", error: `poll HTTP ${res.status}` };
  const json = await res.json();
  const phase: string | undefined = json.metadata?.phase;
  const progressPercent: number | undefined = json.metadata?.progressPercent;
  if (json.error) {
    return { status: "error", phase, error: String(json.error?.message ?? json.error) };
  }
  if (json.done === true) {
    return { status: "done", response: json.response ?? {}, phase, progressPercent };
  }
  if (json.done === false || phase) {
    return {
      status: phase === "generating" || phase === "assembling" ? "running" : "queued",
      phase,
      progressPercent,
    };
  }
  // tolerate non-Operation shapes
  const state = String(json.state ?? json.status ?? "").toLowerCase();
  if (state.includes("fail") || state.includes("error")) return { status: "error", error: state };
  if (state.includes("succeed") || state.includes("done")) return { status: "done", response: json };
  return { status: "running" };
}

// ---- typed request builders for the non-FARM tasks -------------------------

/** Body of POST tasks:farmT2i (prompt → image). */
export interface FarmT2iRequest {
  prompt: string;
  [k: string]: unknown;
}

/** Body of POST tasks:depthPano2DraftSplats — the greybox→world path.
 * depthPano: exactly one of assetId | url. Log-encoded equirect PNG inputs
 * require zMin/zMax (min/max radial depth); EXR inputs must omit them. */
export interface DepthPano2DraftSplatsRequest {
  depthPano: { assetId?: string | null; url?: string | null };
  zMin?: number | null;
  zMax?: number | null;
  prompt: string;
  seed?: number | null;
  iterations?: number | null; // 1–50
  cfgW?: number | null; // 1–15
  voxelSize?: number | null; // 0–0.5
  model?: string | null; // e.g. "x2p-chisel-v1"
}

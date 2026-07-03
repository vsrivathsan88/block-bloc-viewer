// Meridian serving layer (src/wlt/meridian/serving/README.md):
//
//   Data plane   https://api-{env}.worldlabs.ai
//     POST /api/serving/v1/predict            — sync inference; the body
//       carries `servable_instance_name` and is validated against the
//       servable's pydantic InputModel
//     GET  /api/serving/v1/operations/{lro}   — async predict polling
//   Control plane https://meridian-{env}.worldlabs.ai
//     GET  /api/serving/v1/deployments                    — live servables
//     GET  /api/model_registry/v1/inference_bundles       — the model registry
//       (paginated, page_size ≤ 200; also /inference_bundles/{bundle_id})
//
// The Marble V2 Task API (../marble/client.ts) is the product wrapper over
// this; Shotboard talks to Meridian directly only to DISCOVER models — the
// registry/deployments power the model pickers so slugs are never hand-typed.

export type MeridianEnv = "autopush" | "staging" | "prod";

export interface MeridianConfig {
  env: MeridianEnv;
  /** override hosts; blank = derived from env */
  apiHost?: string;
  registryHost?: string;
  apiKey: string; // sent as Bearer
}

export const DEFAULT_MERIDIAN_CONFIG: MeridianConfig = {
  env: "autopush",
  apiKey: "",
};

const CONFIG_KEY = "shotboard.meridianConfig";
const CATALOG_KEY = "shotboard.modelCatalog";

export function loadMeridianConfig(): MeridianConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_MERIDIAN_CONFIG, ...JSON.parse(raw) };
  } catch { /* fall through */ }
  return { ...DEFAULT_MERIDIAN_CONFIG };
}

export function saveMeridianConfig(c: MeridianConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
}

export function meridianHosts(cfg: MeridianConfig): { api: string; registry: string } {
  return {
    api: (cfg.apiHost || `https://api-${cfg.env}.worldlabs.ai`).replace(/\/$/, ""),
    registry: (cfg.registryHost || `https://meridian-${cfg.env}.worldlabs.ai`).replace(/\/$/, ""),
  };
}

function headers(cfg: MeridianConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
  };
}

/** Pull every string that looks like a servable instance name out of an
 * unknown response shape — the deployments/bundles schemas carry the name
 * under different keys, and being tolerant beats being brittle here. */
function harvestNames(node: unknown, out: Set<string>) {
  if (typeof node === "string") {
    if (/^[a-z0-9]+(_[a-z0-9]+)*_(servable|v\d+)[a-z0-9_]*$/i.test(node) || /_servable_/.test(node)) {
      out.add(node);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const x of node) harvestNames(x, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && /(servable_instance_name|servable_name|instance_name)$/i.test(k)) {
        out.add(v);
      } else {
        harvestNames(v, out);
      }
    }
  }
}

/** Live servable instance names from the deployments list, falling back to
 * the model-registry inference bundles. */
export async function listServables(cfg: MeridianConfig): Promise<string[]> {
  const { registry } = meridianHosts(cfg);
  const found = new Set<string>();
  for (const path of [
    "/api/serving/v1/deployments",
    "/api/model_registry/v1/inference_bundles?page_size=200",
  ]) {
    try {
      const res = await fetch(`${registry}${path}`, { headers: headers(cfg) });
      if (!res.ok) continue;
      harvestNames(await res.json(), found);
    } catch { /* next source */ }
  }
  return [...found].sort();
}

/** farm_ar_servable_run09_v1 → run09-v1 (the Task API `model` slug form). */
export function farmSlugOfServable(name: string): string | null {
  const m = /^farm_ar_servable_(run\d+)_(v\d+)$/.exec(name);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** x2p_chisel_v1 → x2p-chisel-v1 (chisel `model` slug form). */
export function chiselSlugOfServable(name: string): string | null {
  return /chisel/.test(name) ? name.replace(/_/g, "-") : null;
}

export interface ModelCatalog {
  fetchedAt: number;
  servables: string[];
  farmSlugs: string[];
  chiselSlugs: string[];
}

export function loadModelCatalog(): ModelCatalog | null {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    return raw ? (JSON.parse(raw) as ModelCatalog) : null;
  } catch {
    return null;
  }
}

export async function refreshModelCatalog(cfg: MeridianConfig): Promise<ModelCatalog> {
  const servables = await listServables(cfg);
  const catalog: ModelCatalog = {
    fetchedAt: Date.now(),
    servables,
    farmSlugs: servables.map(farmSlugOfServable).filter((s): s is string => !!s),
    chiselSlugs: servables.map(chiselSlugOfServable).filter((s): s is string => !!s),
  };
  localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
  return catalog;
}

/** Direct data-plane inference (applet-style) — available for tooling and
 * debugging; product calls go through the Marble Task API. */
export async function predict(
  cfg: MeridianConfig,
  servableInstanceName: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { api } = meridianHosts(cfg);
  const res = await fetch(`${api}/api/serving/v1/predict`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify({ servable_instance_name: servableInstanceName, ...payload }),
  });
  if (!res.ok) throw new Error(`predict HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function pollServingOperation(
  cfg: MeridianConfig,
  lroId: string,
): Promise<Record<string, unknown>> {
  const { api } = meridianHosts(cfg);
  const res = await fetch(`${api}/api/serving/v1/operations/${encodeURIComponent(lroId)}`, {
    headers: headers(cfg),
  });
  if (!res.ok) throw new Error(`operation poll HTTP ${res.status}`);
  return res.json();
}

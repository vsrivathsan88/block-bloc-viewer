// Marble Developer API (public) — worlds. Separate plane from the internal
// V2 Task API: its own host + key. Surface per public-docs/api:
//   GET  /marble/v1/worlds/{world_id}   — world object incl. assets
//   POST /marble/v1/worlds:list         — the account's worlds
// The world object carries everything Shotboard needs: splat tiers
// (assets.splats.spz_urls), collider (assets.mesh.collider_mesh_url), pano
// (assets.imagery.pano_url), minimap, and the caption/world_prompt that
// grounds FARM prompts in what the world actually is.

export interface DevApiConfig {
  baseUrl: string;
  apiKey: string;
}

export const DEFAULT_DEV_API_CONFIG: DevApiConfig = {
  baseUrl: "https://api.worldlabs.ai",
  apiKey: "",
};

const CONFIG_KEY = "shotboard.devApiConfig";

export function loadDevApiConfig(): DevApiConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_DEV_API_CONFIG, ...JSON.parse(raw) };
  } catch { /* fall through */ }
  return { ...DEFAULT_DEV_API_CONFIG };
}

export function saveDevApiConfig(c: DevApiConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
}

function headers(cfg: DevApiConfig): Record<string, string> {
  // Send both auth header styles; the gateway accepts one and ignores extras.
  return {
    "Content-Type": "application/json",
    ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}`, "X-API-Key": cfg.apiKey } : {}),
  };
}

/** Find the first string value under any of the given key names, anywhere. */
function findKey(node: unknown, names: RegExp): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (typeof v === "string" && v && names.test(k)) return v;
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    const hit = findKey(v, names);
    if (hit) return hit;
  }
  return undefined;
}

function findSpzUrls(node: unknown): Record<string, string> | undefined {
  if (!node || typeof node !== "object") return undefined;
  const rec = node as Record<string, unknown>;
  if (rec.spz_urls && typeof rec.spz_urls === "object") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec.spz_urls as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    if (Object.keys(out).length) return out;
  }
  for (const v of Object.values(rec)) {
    const hit = findSpzUrls(v);
    if (hit) return hit;
  }
  return undefined;
}

export interface ResolvedWorld {
  worldId: string;
  name: string;
  caption?: string;
  spzUrls: Record<string, string>; // tier → url
  colliderUrl?: string;
  panoUrl?: string;
  minimapUrl?: string;
}

function parseWorld(worldId: string, json: unknown): ResolvedWorld {
  const j = json as Record<string, unknown>;
  return {
    worldId,
    name:
      (typeof j.display_name === "string" && j.display_name) ||
      (typeof j.name === "string" && j.name) ||
      worldId,
    caption:
      findKey(j, /^(generated_recaption|world_prompt|caption)$/) ?? undefined,
    spzUrls: findSpzUrls(j) ?? {},
    colliderUrl: findKey(j, /^collider_mesh_url$/),
    panoUrl: findKey(j, /^(pano_url|skypano_url)$/),
    minimapUrl: findKey(j, /^minimap_url$/),
  };
}

export async function getWorld(cfg: DevApiConfig, worldId: string): Promise<ResolvedWorld> {
  const id = worldId.trim().replace(/^.*worlds\//, ""); // accept pasted URLs too
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/marble/v1/worlds/${encodeURIComponent(id)}`, {
    headers: headers(cfg),
  });
  if (!res.ok) throw new Error(`GET world: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return parseWorld(id, await res.json());
}

export interface WorldListing {
  worldId: string;
  name: string;
  thumbUrl?: string;
}

export async function listWorlds(cfg: DevApiConfig, pageSize = 50): Promise<WorldListing[]> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/marble/v1/worlds:list`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify({ page_size: pageSize }),
  });
  if (!res.ok) throw new Error(`worlds:list HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as Record<string, unknown>;
  const items = (json.worlds ?? json.items ?? json.data ?? []) as Record<string, unknown>[];
  return items
    .map((w) => ({
      worldId:
        (typeof w.world_id === "string" && w.world_id) ||
        (typeof w.id === "string" && w.id) ||
        "",
      name:
        (typeof w.display_name === "string" && w.display_name) ||
        (typeof w.name === "string" && w.name) ||
        "untitled world",
      thumbUrl: findKey(w, /^(thumbnail_url|pano_url|minimap_url)$/),
    }))
    .filter((w) => w.worldId);
}

/** Prefer a light tier for interactive scouting. */
export function pickScoutTier(spzUrls: Record<string, string>): string | undefined {
  const keys = Object.keys(spzUrls);
  if (!keys.length) return undefined;
  const light = keys.find((k) => /500k|small|low/i.test(k));
  return spzUrls[light ?? keys[0]];
}

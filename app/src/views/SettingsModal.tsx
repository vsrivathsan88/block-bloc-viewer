// FARM AR Task API configuration. Mock mode works offline; live mode talks to
// the Marble V2 Task API (Bearer auth — Clerk JWT or API key).

import { useState } from "react";
import { loadFarmConfig, saveFarmConfig, type FarmConfig } from "../farm/client";
import { loadMarbleConfig, MARBLE_TASKS, saveMarbleConfig, type MarbleConfig } from "../marble/client";
import {
  loadMeridianConfig, loadModelCatalog, refreshModelCatalog, saveMeridianConfig,
  type MeridianConfig, type MeridianEnv, type ModelCatalog,
} from "../marble/meridian";
import {
  getWorld, listWorlds, loadDevApiConfig, pickScoutTier, saveDevApiConfig,
  type DevApiConfig, type WorldListing,
} from "../marble/worlds";
import { loadEditConfig, saveEditConfig, type EditConfig } from "../edit/imageEdit";
import { useProject } from "../store/useProject";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { project, dispatch } = useProject();
  const [world, setWorld] = useState(project.world);
  const [marble, setMarble] = useState<MarbleConfig>(loadMarbleConfig());
  const setM = (patch: Partial<MarbleConfig>) => setMarble({ ...marble, ...patch });
  const [cfg, setCfg] = useState<FarmConfig>(loadFarmConfig());
  const set = (patch: Partial<FarmConfig>) => setCfg({ ...cfg, ...patch });
  const [edit, setEdit] = useState<EditConfig>(loadEditConfig());
  const setE = (patch: Partial<EditConfig>) => setEdit({ ...edit, ...patch });
  const [meridian, setMeridian] = useState<MeridianConfig>(loadMeridianConfig());
  const [catalog, setCatalog] = useState<ModelCatalog | null>(loadModelCatalog());
  const [catalogNote, setCatalogNote] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);

  async function loadModels() {
    setLoadingModels(true);
    setCatalogNote("");
    try {
      saveMeridianConfig(meridian);
      const c = await refreshModelCatalog(meridian);
      setCatalog(c);
      setCatalogNote(c.servables.length ? `${c.servables.length} servables` : "registry reachable but no servables parsed");
    } catch (e) {
      setCatalogNote(String(e));
    } finally {
      setLoadingModels(false);
    }
  }

  const [dev, setDev] = useState<DevApiConfig>(loadDevApiConfig());
  const [worldIdInput, setWorldIdInput] = useState(project.world.worldId ?? "");
  const [worldNote, setWorldNote] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [library, setLibrary] = useState<WorldListing[] | null>(null);

  async function resolveWorld(id: string) {
    setWorldNote("resolving…");
    try {
      saveDevApiConfig(dev);
      const w = await getWorld(dev, id);
      setWorld({
        spzUrl: pickScoutTier(w.spzUrls) ?? world.spzUrl,
        colliderUrl: w.colliderUrl,
        title: w.name,
        worldId: w.worldId,
        caption: w.caption,
        minimapUrl: w.minimapUrl,
        spzUrls: Object.keys(w.spzUrls).length ? w.spzUrls : undefined,
      });
      setWorldIdInput(w.worldId);
      setWorldNote(`resolved · ${Object.keys(w.spzUrls).length} splat tier(s)${w.caption ? " · caption ✓" : ""}${w.minimapUrl ? " · minimap ✓" : ""}`);
      setBrowsing(false);
    } catch (e) {
      setWorldNote(String(e));
    }
  }

  async function browse() {
    setBrowsing(true);
    setWorldNote("");
    try {
      saveDevApiConfig(dev);
      setLibrary(await listWorlds(dev));
    } catch (e) {
      setLibrary(null);
      setWorldNote(String(e));
      setBrowsing(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>World</h2>
        <div className="form-grid">
          <label className="field">developer API base
            <input value={dev.baseUrl} onChange={(e) => setDev({ ...dev, baseUrl: e.target.value })} />
          </label>
          <label className="field">developer API key
            <input type="password" value={dev.apiKey} onChange={(e) => setDev({ ...dev, apiKey: e.target.value })} />
          </label>
        </div>
        <label className="field">Marble world id / URL
          <div style={{ display: "flex", gap: 6 }}>
            <input style={{ flex: 1 }} value={worldIdInput} placeholder="world_…"
              onChange={(e) => setWorldIdInput(e.target.value)} />
            <button className="ghost" disabled={!worldIdInput.trim()} onClick={() => resolveWorld(worldIdInput)}>resolve</button>
            <button className="ghost" onClick={browse}>browse…</button>
          </div>
        </label>
        {browsing && library && (
          <div className="world-grid">
            {library.map((w) => (
              <button key={w.worldId} className="world-card" onClick={() => resolveWorld(w.worldId)}>
                {w.thumbUrl ? <img src={w.thumbUrl} alt="" /> : <span className="ph" />}
                <span>{w.name}</span>
              </button>
            ))}
            {!library.length && <div className="hint">no worlds returned</div>}
          </div>
        )}
        {worldNote && <div className="hint">{worldNote}</div>}
        {world.spzUrls && Object.keys(world.spzUrls).length > 1 && (
          <label className="field">splat quality
            <select
              value={world.spzUrl}
              onChange={(e) => setWorld({ ...world, spzUrl: e.target.value })}
            >
              {Object.entries(world.spzUrls).map(([tier, url]) => (
                <option key={tier} value={url}>{tier}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">name
          <input value={world.title} onChange={(e) => setWorld({ ...world, title: e.target.value })} />
        </label>
        <label className="field">.spz URL
          <input value={world.spzUrl} onChange={(e) => setWorld({ ...world, spzUrl: e.target.value })} />
        </label>
        <label className="field">collider GLB URL (optional)
          <input value={world.colliderUrl ?? ""} onChange={(e) => setWorld({ ...world, colliderUrl: e.target.value || undefined })} />
        </label>
        <label className="field">set description (grounds FARM prompts; auto-filled from the world's caption)
          <textarea rows={2} value={world.caption ?? ""} onChange={(e) => setWorld({ ...world, caption: e.target.value || undefined })} />
        </label>

        <h2 style={{ marginTop: 10 }}>Marble API</h2>
        <label className="field">default base URL
          <input value={marble.baseUrl} onChange={(e) => setM({ baseUrl: e.target.value })}
            placeholder="https://marble4-autopush.worldlabs.ai" />
        </label>
        <div className="form-grid">
          <label className="field">account id
            <input value={marble.accountId} onChange={(e) => setM({ accountId: e.target.value })} placeholder="acct_…" />
          </label>
          <label className="field">bearer token
            <input type="password" value={marble.token} onChange={(e) => setM({ token: e.target.value })} />
          </label>
        </div>
        <div className="hint">Per-task endpoint overrides — capabilities are deployed on different hosts; blank uses the default.</div>
        {MARBLE_TASKS.map((t) => (
          <label className="field" key={t}>tasks:{t}
            <input
              value={marble.endpoints[t] ?? ""}
              placeholder="(default host)"
              onChange={(e) => setM({ endpoints: { ...marble.endpoints, [t]: e.target.value || undefined } })}
            />
          </label>
        ))}

        <h2 style={{ marginTop: 10 }}>Meridian (model discovery)</h2>
        <div className="form-grid">
          <label className="field">environment
            <select value={meridian.env} onChange={(e) => setMeridian({ ...meridian, env: e.target.value as MeridianEnv })}>
              <option value="autopush">autopush</option>
              <option value="staging">staging</option>
              <option value="prod">prod</option>
            </select>
          </label>
          <label className="field">api key
            <input type="password" value={meridian.apiKey}
              onChange={(e) => setMeridian({ ...meridian, apiKey: e.target.value })} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="ghost" onClick={loadModels} disabled={loadingModels}>
            {loadingModels ? "loading…" : "↻ load models from registry"}
          </button>
          {catalogNote && <span className="hint">{catalogNote}</span>}
          {!catalogNote && catalog && (
            <span className="hint">{catalog.servables.length} servables · {new Date(catalog.fetchedAt).toLocaleTimeString()}</span>
          )}
        </div>

        <h2 style={{ marginTop: 10 }}>FARM AR</h2>
        <label className="field">mode
          <select value={cfg.mode} onChange={(e) => set({ mode: e.target.value as FarmConfig["mode"] })}>
            <option value="mock">mock — no network, animatic uses pencil-test</option>
            <option value="live">live — tasks:farmAr</option>
          </select>
        </label>
        <label className="field">model (blank = server default)
          <input value={cfg.model} onChange={(e) => set({ model: e.target.value })}
            placeholder="run09-v1" list="farm-models" />
          <datalist id="farm-models">
            {(catalog?.farmSlugs ?? []).map((s) => <option key={s} value={s} />)}
          </datalist>
        </label>
        <div className="form-grid">
          <label className="field">fps (path density + MP4)
            <input type="number" min={1} max={60} value={cfg.fps}
              onChange={(e) => set({ fps: Math.min(60, Math.max(1, Number(e.target.value) || 8)) })} />
          </label>
          <label className="field">seed
            <input type="number" min={0} value={cfg.seed}
              onChange={(e) => set({ seed: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <label className="field">cfg scale (0–15)
            <input type="number" min={0} max={15} step={0.5} value={cfg.cfg}
              onChange={(e) => set({ cfg: Math.min(15, Math.max(0, Number(e.target.value) || 2.5)) })} />
          </label>
          <label className="field">diffusion steps (1–100)
            <input type="number" min={1} max={100} value={cfg.numSteps}
              onChange={(e) => set({ numSteps: Math.min(100, Math.max(1, Number(e.target.value) || 50)) })} />
          </label>
        </div>
        <label className="field">depth scale factor (blank = derived per request)
          <input
            value={cfg.depthScaleFactor ?? ""}
            placeholder="pin metric scale across shots in one world"
            onChange={(e) => set({ depthScaleFactor: e.target.value ? Number(e.target.value) || null : null })}
          />
        </label>
        <div className="hint" style={{ fontSize: 11, lineHeight: 1.5 }}>
          Conforms to <code>docs/farm_ar_api_spec.md</code>: camelCase wire
          names, raw Three.js camera state (server converts + normalizes the
          rig), context + targets capped at the trained 32-frame budget, MP4
          assembled at the fps above. Token stays in this browser's
          localStorage.
        </div>
        <h2 style={{ marginTop: 10 }}>Cast pass (image edit)</h2>
        <label className="field">provider
          <select value={edit.provider} onChange={(e) => setE({ provider: e.target.value as EditConfig["provider"] })}>
            <option value="mock">mock — offline stand-in figure</option>
            <option value="gemini">gemini — Nano Banana image edit</option>
            <option value="openai">openai — gpt-image-1 edits</option>
          </select>
        </label>
        <label className="field">model
          <input value={edit.model} onChange={(e) => setE({ model: e.target.value })}
            placeholder="gemini-2.5-flash-image" />
        </label>
        <label className="field">API key
          <input type="password" value={edit.apiKey} onChange={(e) => setE({ apiKey: e.target.value })} />
        </label>
        <div className="hint" style={{ fontSize: 11 }}>
          Used to composite cast members into clean plates and to generate
          character reference sheets. Key stays in this browser's localStorage.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => {
            saveMarbleConfig(marble);
            saveMeridianConfig(meridian);
            saveFarmConfig(cfg);
            saveEditConfig(edit);
            if (JSON.stringify(world) !== JSON.stringify(project.world)) dispatch({ type: "updateWorld", world });
            onClose();
          }}>save</button>
          <button className="ghost" onClick={onClose}>cancel</button>
        </div>
      </div>
    </div>
  );
}

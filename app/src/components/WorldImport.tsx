// The front door: paste anything Marble — a share URL, a world id, or a
// direct .spz URL — and shoot in it. One field, one button. Library browse
// when a Developer API key is configured.

import { useEffect, useState } from "react";
import { DEMO_MODE } from "../lib/demoViewer";
import {
  getWorld, listWorlds, loadDevApiConfig, pickScoutTier, saveDevApiConfig,
  type WorldListing,
} from "../marble/worlds";
import { useProject } from "../store/useProject";
import { IconClose } from "./icons";

type Parsed = { kind: "spz"; url: string } | { kind: "id"; id: string };

function parseInput(s: string): Parsed | null {
  const t = s.trim();
  if (!t) return null;
  if (/\.spz(\?|#|$)/i.test(t)) return { kind: "spz", url: t };
  const m = /worlds?\/([A-Za-z0-9_-]{6,})/.exec(t);
  if (m) return { kind: "id", id: m[1] };
  if (/^[A-Za-z0-9_-]{6,}$/.test(t)) return { kind: "id", id: t };
  return null;
}

function titleFromSpz(url: string): string {
  const m = /cdn\.marble[^/]*\/([^/]+)\//.exec(url);
  if (m) return m[1].slice(0, 12);
  const file = url.split("/").pop() ?? "world";
  return file.replace(/\.spz.*$/i, "").replace(/_[a-z0-9]+_\d+k$/i, "").slice(0, 24) || "world";
}

export default function WorldImport({ onClose, firstRun }: { onClose: () => void; firstRun?: boolean }) {
  const { project, dispatch } = useProject();
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState<WorldListing[] | null>(null);
  const dev = loadDevApiConfig();

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function importWorld(raw: string) {
    const parsed = parseInput(raw);
    if (!parsed) return setNote("paste a Marble world URL, a world id, or a .spz URL");
    setBusy(true);
    setNote("");
    try {
      if (parsed.kind === "spz") {
        dispatch({
          type: "updateWorld",
          world: { spzUrl: parsed.url, title: titleFromSpz(parsed.url) },
        });
        onClose();
        return;
      }
      if (!dev.apiKey) {
        setNote("resolving a world id needs a Developer API key (⚙ settings) — or paste a direct .spz URL");
        return;
      }
      const w = await getWorld(dev, parsed.id);
      const spz = pickScoutTier(w.spzUrls);
      if (!spz) {
        setNote("world resolved but has no splat assets yet");
        return;
      }
      dispatch({
        type: "updateWorld",
        world: {
          spzUrl: spz,
          colliderUrl: w.colliderUrl,
          title: w.name,
          worldId: w.worldId,
          caption: w.caption,
          minimapUrl: w.minimapUrl,
          spzUrls: Object.keys(w.spzUrls).length ? w.spzUrls : undefined,
        },
      });
      onClose();
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function browse() {
    setBusy(true);
    setNote("");
    try {
      saveDevApiConfig(dev);
      setLibrary(await listWorlds(dev));
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal world-import" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ flex: 1 }}>{firstRun ? "Where are we shooting?" : "Change world"}</h2>
          <button className="ib" title="close" onClick={onClose}><IconClose /></button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            style={{ flex: 1 }}
            autoFocus
            placeholder="paste a Marble world URL, world id, or .spz URL…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") importWorld(input); }}
          />
          <button className="red" disabled={busy || !input.trim()} onClick={() => importWorld(input)}>
            {busy ? "…" : "shoot here"}
          </button>
        </div>
        {dev.apiKey && (
          <button className="ghost" onClick={browse} disabled={busy}>browse my worlds…</button>
        )}
        {library && (
          <div className="world-grid">
            {library.map((w) => (
              <button key={w.worldId} className="world-card" onClick={() => importWorld(w.worldId)}>
                {w.thumbUrl ? <img src={w.thumbUrl} alt="" /> : <span className="ph" />}
                <span>{w.name}</span>
              </button>
            ))}
            {!library.length && <div className="hint">no worlds returned</div>}
          </div>
        )}
        {note && <div className="hint" style={{ color: "var(--danger)" }}>{note}</div>}
        {firstRun && (
          <button className="ghost" onClick={onClose}>
            start in the demo set — change any time from the world chip
          </button>
        )}
        {DEMO_MODE && (
          <div className="hint">
            this hosted preview always renders the built-in demo set — imports
            apply when the app runs with real CDN access
          </div>
        )}
        <div className="hint">
          currently: <b>{project.world.title}</b>
          {project.world.worldId ? ` · ${project.world.worldId}` : ""}
        </div>
      </div>
    </div>
  );
}

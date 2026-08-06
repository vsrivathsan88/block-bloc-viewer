// The front door: paste anything Marble — a share URL, a world id, or a
// direct .spz URL — OR start from a single image (upload, image URL, or
// FARM T2I prompt). One field, one button. Library browse when a Developer
// API key is configured.

import { useEffect, useRef, useState } from "react";
import type { CapturedFrame, Pose } from "../model/types";
import { uid } from "../model/types";
import { DEMO_MODE } from "../lib/demoViewer";
import { generateSetImage } from "../farm/t2i";
import {
  getWorld, listWorlds, loadDevApiConfig, pickScoutTier, saveDevApiConfig,
  type WorldListing,
} from "../marble/worlds";
import { db } from "../store/db";
import { primeImageCache, useProject } from "../store/useProject";
import { IconClose } from "./icons";

type Parsed =
  | { kind: "spz"; url: string }
  | { kind: "imageUrl"; url: string }
  | { kind: "id"; id: string };

function parseInput(s: string): Parsed | null {
  const t = s.trim();
  if (!t) return null;
  if (/\.spz(\?|#|$)/i.test(t)) return { kind: "spz", url: t };
  if (/\.(png|jpe?g|webp|avif)(\?|#|$)/i.test(t)) return { kind: "imageUrl", url: t };
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

const IDENTITY: Pose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };

async function imageDims(src: string): Promise<{ w: number; h: number }> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth || 1280, h: img.naturalHeight || 720 });
    img.onerror = () => rej(new Error("image failed to load"));
    img.src = src;
  });
}

export default function WorldImport({ onClose, firstRun }: { onClose: () => void; firstRun?: boolean }) {
  const { project, dispatch } = useProject();
  const [input, setInput] = useState("");
  const [prompt, setPrompt] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState<WorldListing[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dev = loadDevApiConfig();

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  /** A single image becomes the whole set: one reference frame at the
   * identity pose (FARM AR's single-image "dream beyond" mode) plus a
   * first shot ready for its arrow. */
  async function importImage(src: string, title: string) {
    const { w, h } = await imageDims(src);
    const imageId = uid();
    primeImageCache(imageId, src);
    await db.putImage(imageId, src);
    const frame: CapturedFrame = {
      id: uid(),
      imageId,
      pose: IDENTITY,
      fov: 55,
      aspect: w / h,
      label: "reference",
      capturedAt: Date.now(),
    };
    dispatch({ type: "addFrame", frame });
    dispatch({
      type: "updateWorld",
      world: {
        kind: "image",
        spzUrl: "",
        imageId,
        refFrameId: frame.id,
        title: title.slice(0, 24) || "image set",
        caption: prompt.trim() || undefined,
      },
    });
    onClose();
  }

  async function importWorld(raw: string) {
    const parsed = parseInput(raw);
    if (!parsed) return setNote("paste a Marble world URL, a world id, an image URL — or upload an image below");
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
      if (parsed.kind === "imageUrl") {
        await importImage(parsed.url, parsed.url.split("/").pop()?.replace(/\.\w+(\?.*)?$/, "") ?? "image set");
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

  async function uploadImage(file: File) {
    setBusy(true);
    setNote("");
    try {
      const src = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(new Error("could not read file"));
        r.readAsDataURL(file);
      });
      await importImage(src, file.name.replace(/\.\w+$/, ""));
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function imagineSet() {
    if (!prompt.trim()) return;
    setBusy(true);
    setNote("");
    try {
      const src = await generateSetImage(prompt.trim());
      await importImage(src, prompt.trim());
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
            placeholder="paste a Marble world URL, world id, .spz — or an image URL…"
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

        <div className="wi-or"><span>or start from a single image</span></div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="ghost" style={{ flex: "none" }} disabled={busy} onClick={() => fileRef.current?.click()}>
            upload an image
          </button>
          <input
            style={{ flex: 1 }}
            placeholder="…or imagine one: “a rain-slicked diner at night”"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") imagineSet(); }}
          />
          <button className="red" disabled={busy || !prompt.trim()} onClick={imagineSet}>
            {busy ? "…" : "imagine"}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadImage(f);
            e.target.value = "";
          }}
        />

        {note && <div className="hint" style={{ color: "var(--danger)" }}>{note}</div>}
        {firstRun && (
          <button className="ghost" onClick={onClose}>
            start in the demo set — change any time from the world chip
          </button>
        )}
        {DEMO_MODE && (
          <div className="hint">
            heads-up: this hosted preview can't stream Marble splat worlds
            (sandboxed) — but single images work fully here. Run the app
            locally (README) for real Marble worlds.
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

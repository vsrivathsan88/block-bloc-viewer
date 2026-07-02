// FARM AR Task API configuration. Mock mode works offline; live mode talks to
// the Marble V2 Task API (Bearer auth — Clerk JWT or API key).

import { useState } from "react";
import { loadFarmConfig, saveFarmConfig, type FarmConfig } from "../farm/client";
import { loadEditConfig, saveEditConfig, type EditConfig } from "../edit/imageEdit";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<FarmConfig>(loadFarmConfig());
  const set = (patch: Partial<FarmConfig>) => setCfg({ ...cfg, ...patch });
  const [edit, setEdit] = useState<EditConfig>(loadEditConfig());
  const setE = (patch: Partial<EditConfig>) => setEdit({ ...edit, ...patch });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>FARM AR settings</h2>
        <label className="field">mode
          <select value={cfg.mode} onChange={(e) => set({ mode: e.target.value as FarmConfig["mode"] })}>
            <option value="mock">mock — no network, animatic uses pencil-test</option>
            <option value="live">live — Marble V2 Task API (tasks:farmAr)</option>
          </select>
        </label>
        <label className="field">base URL
          <input value={cfg.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })}
            placeholder="https://marble4-autopush.worldlabs.ai" />
        </label>
        <label className="field">account id
          <input value={cfg.accountId} onChange={(e) => set({ accountId: e.target.value })} placeholder="acct_…" />
        </label>
        <label className="field">bearer token (Clerk JWT / API key)
          <input type="password" value={cfg.token} onChange={(e) => set({ token: e.target.value })} />
        </label>
        <label className="field">model slug (blank = server default)
          <input value={cfg.model} onChange={(e) => set({ model: e.target.value })} placeholder="run09-v1" />
        </label>
        <label className="field">target cameras per second
          <input type="number" min={4} max={30} value={cfg.fps}
            onChange={(e) => set({ fps: Math.min(30, Math.max(4, Number(e.target.value) || 12)) })} />
        </label>
        <div className="hint" style={{ fontSize: 11, lineHeight: 1.5 }}>
          Request shape: <code>POST /api/v2/accounts/&lt;acct&gt;/tasks:farmAr</code>{" "}
          with prompt + reference_images (posed context anchors) +
          target_cameras. All poses are re-anchored so the first context view is
          the identity, per the context-bundle contract. Token is stored in this
          browser's localStorage only.
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
          <button onClick={() => { saveFarmConfig(cfg); saveEditConfig(edit); onClose(); }}>save</button>
          <button className="ghost" onClick={onClose}>cancel</button>
        </div>
      </div>
    </div>
  );
}

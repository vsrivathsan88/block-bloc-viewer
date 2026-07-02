// The cast: characters with reference images. The same references go into
// every shot's cast pass — that's what keeps a character consistent across
// the board. Refs come from upload or from generation (character sheet via
// the configured image model).

import { useState } from "react";
import type { CastMember } from "../model/types";
import { uid } from "../model/types";
import { editImage, loadEditConfig } from "../edit/imageEdit";
import { db } from "../store/db";
import { primeImageCache, useImage, useProject } from "../store/useProject";

function RefThumb({ imageId, onDelete }: { imageId: string; onDelete: () => void }) {
  const img = useImage(imageId);
  return (
    <div style={{ position: "relative" }}>
      {img && <img src={img} alt="" style={{ width: 96, aspectRatio: "3/4", objectFit: "cover", border: "1px solid var(--ink-soft)" }} />}
      <button className="ghost" style={{ position: "absolute", top: 2, right: 2, padding: "0 4px", fontSize: 10 }} onClick={onDelete}>✕</button>
    </div>
  );
}

function MemberCard({ member }: { member: CastMember }) {
  const { dispatch } = useProject();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const patch = (p: Partial<CastMember>) =>
    dispatch({ type: "updateCastMember", memberId: member.id, patch: p });

  async function addRefFromDataUrl(dataUrl: string) {
    const imageId = uid();
    primeImageCache(imageId, dataUrl);
    await db.putImage(imageId, dataUrl);
    patch({ refImageIds: [...member.refImageIds, imageId] });
  }

  async function generateRef() {
    setBusy(true);
    setErr("");
    try {
      const cfg = loadEditConfig();
      const dataUrl = await editImage(cfg, {
        refs: [],
        instruction:
          `Full-body character reference of ${member.name}: ${member.description || "no description yet"}. ` +
          "Neutral standing pose, plain background, cinematic natural lighting, photoreal.",
      });
      await addRefFromDataUrl(dataUrl);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card cast-card">
      <div className="name-row">
        <input
          className="name"
          value={member.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <button className="ghost" onClick={() => confirm(`Remove ${member.name} from the cast?`) && dispatch({ type: "deleteCastMember", memberId: member.id })}>✕</button>
      </div>
      <label className="field">description (wardrobe, age, look — goes into every composite)
        <textarea rows={2} value={member.description} onChange={(e) => patch({ description: e.target.value })}
          placeholder="Woman in her 40s, long red wool coat, short dark hair." />
      </label>
      <div className="ref-row">
        {member.refImageIds.map((id) => (
          <RefThumb key={id} imageId={id}
            onDelete={() => patch({ refImageIds: member.refImageIds.filter((r) => r !== id) })} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label className="upload-btn">
          ⇧ upload ref
          <input type="file" accept="image/*" style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => addRefFromDataUrl(String(reader.result));
              reader.readAsDataURL(file);
              e.target.value = "";
            }} />
        </label>
        <button className="ochre" onClick={generateRef} disabled={busy}>
          {busy ? "generating…" : `⌁ generate ref (${loadEditConfig().provider})`}
        </button>
      </div>
      {err && <div className="hint" style={{ color: "var(--red)" }}>{err}</div>}
    </div>
  );
}

export default function CastView() {
  const { project, dispatch } = useProject();
  return (
    <div className="board">
      <div className="cast-grid">
        <div className="hint">
          Characters live here once and get composited into shots in the
          editor's cast pass. Consistency comes from the reference images — the
          same refs are sent with every composite.
        </div>
        {project.cast.map((m) => <MemberCard key={m.id} member={m} />)}
        <button
          className="ochre"
          style={{ alignSelf: "flex-start" }}
          onClick={() => dispatch({ type: "addCastMember", member: { id: uid(), name: `Character ${project.cast.length + 1}`, description: "", refImageIds: [] } })}
        >
          + cast member
        </button>
      </div>
    </div>
  );
}

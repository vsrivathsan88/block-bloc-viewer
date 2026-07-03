// One frame, one overlay. Draw on it, pick a move glyph, type one line,
// drop a character in, make it move. Icons + tooltips; no labels.

import { useEffect, useState } from "react";
import type { CapturedFrame, CastMember, Shot } from "../model/types";
import { frameById, MOVEMENTS, uid } from "../model/types";
import { buildPrompt } from "../farm/prompt";
import { buildFarmArRequest, loadFarmConfig, submitFarmAr } from "../farm/client";
import { editImage, loadEditConfig } from "../edit/imageEdit";
import { impliedEndPose, MOVEMENT_GLYPH, movementFamily } from "../lib/movement";
import { autoContextIds } from "../lib/inference";
import SketchCanvas from "./SketchCanvas";
import { db } from "../store/db";
import { getImageData, primeImageCache, useImage, useProject } from "../store/useProject";
import {
  IconArrow, IconBolt, IconBox, IconCheck, IconClose, IconPencil, IconPerson,
  IconPersonPlus, IconRevert, IconTrash, IconUndo,
} from "./icons";

const COLORS = ["#3d3a35", "#e5484d", "#3d648f"];

function CastChip({ member, onClick, busy }: { member: CastMember; onClick: () => void; busy: boolean }) {
  const img = useImage(member.refImageIds[0]);
  return (
    <button
      className={`chip-cast ${member.kind === "prop" ? "prop" : ""}`}
      title={`add ${member.name} to this frame`}
      onClick={onClick}
      disabled={busy}
    >
      {img ? <img src={img} alt="" /> : <span>{member.name.slice(0, 1).toUpperCase()}</span>}
    </button>
  );
}

export default function FrameOverlay({ shotId, onClose }: { shotId: string; onClose: () => void }) {
  const { project, dispatch } = useProject();
  const located = project.scenes
    .flatMap((sc) => sc.shots.map((s) => ({ scene: sc, shot: s })))
    .find((x) => x.shot.id === shotId);
  const shot = located?.shot;

  const [tool, setTool] = useState<"pencil" | "arrow">("arrow");
  const [color, setColor] = useState(COLORS[1]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [showCastForm, setShowCastForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newKind, setNewKind] = useState<"character" | "prop">("character");

  const cleanFrame = shot ? frameById(project, shot.frameId) : undefined;
  const castFrame = shot ? frameById(project, shot.castFrameId) : undefined;
  const keyframe = castFrame ?? cleanFrame;
  const img = useImage(keyframe?.imageId);
  // generation polling is app-level (store/farmWatcher) — closing this
  // overlay never stops a task

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  if (!shot) return null;
  const patch = (p: Partial<Shot>) => dispatch({ type: "updateShot", shotId: shot.id, patch: p });

  async function compositeCast(member: CastMember) {
    if (!shot || !cleanFrame) return;
    setBusy(true);
    setNote("");
    try {
      const base = await getImageData(cleanFrame.imageId);
      if (!base) throw new Error("frame image missing");
      const refs: string[] = [];
      for (const rid of member.refImageIds) {
        const r = await getImageData(rid);
        if (r) refs.push(r);
      }
      const instruction =
        (member.kind === "prop"
          ? `Place a ${member.name} (${member.description || "see reference"}) into this room at a natural spot, `
          : `Add ${member.name} (${member.description || "see reference"}) into this room, `) +
        `matching its lighting, perspective and grain exactly. ${shot.action || ""} ` +
        (refs.length ? "Use the reference image(s) for the exact appearance. " : "") +
        "Do not change the room, framing or camera.";
      const dataUrl = await editImage(loadEditConfig(), { base, refs, instruction });
      const imageId = uid();
      primeImageCache(imageId, dataUrl);
      await db.putImage(imageId, dataUrl);
      const frame: CapturedFrame = {
        id: uid(),
        imageId,
        pose: cleanFrame.pose, // a 2D edit never moves the camera
        fov: cleanFrame.fov,
        aspect: cleanFrame.aspect,
        label: `${member.name} plate`,
        capturedAt: Date.now(),
      };
      dispatch({ type: "addFrame", frame });
      patch({ castFrameId: frame.id });
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (!shot || !keyframe || !cleanFrame) return;
    const cfg = loadFarmConfig();
    if (cfg.mode === "live" && !cfg.token) return setNote("live mode needs a token — open settings");
    try {
      setNote("");
      // auto context: nearest anchors + keyframe last; cast plate substitutes
      const ids = autoContextIds(project, shot).map((id) =>
        id === shot.frameId && shot.castFrameId ? shot.castFrameId : id,
      );
      const ctx = [];
      for (const id of ids) {
        const f = frameById(project, id);
        const dataUrl = f && (await getImageData(f.imageId));
        if (f && dataUrl) ctx.push({ frame: f, imageDataUrl: dataUrl });
      }
      if (!ctx.length) return setNote("no frame yet");
      const endPose = shot.endPose ?? impliedEndPose(shot.movement, keyframe.pose);
      const body = buildFarmArRequest({
        prompt: buildPrompt(shot),
        contextFrames: ctx,
        startPose: keyframe.pose,
        endPose,
        fovDeg: keyframe.fov,
        frameCount: Math.round(shot.durationSec * cfg.fps),
        width: Math.round(480 * (keyframe.aspect || 16 / 9)),
        height: 480,
        cfg,
      });
      const handle = await submitFarmAr(cfg, body);
      patch({
        farm: {
          taskId: handle.taskId,
          mock: handle.mock,
          status: "queued",
          prompt: buildPrompt(shot),
          contextFrameIds: ids,
          frameCount: body.targetFrameCount as number,
          submittedAt: Date.now(),
        },
      });
    } catch (e) {
      setNote(String(e));
    }
  }

  const generating = shot.farm?.status === "queued" || shot.farm?.status === "running";

  return (
    <div className="frame-overlay" onClick={onClose}>
      <div className="frame-card" onClick={(e) => e.stopPropagation()}>
        <div className="frame-stage">
          {shot.farm?.videoUrl ? (
            <video src={shot.farm.videoUrl} controls autoPlay loop />
          ) : (
            <>
              {img && <img src={img} alt="" />}
              <SketchCanvas strokes={shot.strokes} tool={tool} color={color} onStrokes={(strokes) => patch({ strokes })} />
            </>
          )}
          {generating && <div className="gen-bar"><span /><em>{shot.farm?.phase || "…"}</em></div>}
          {shot.farm?.status === "error" && <div className="gen-err" title={shot.farm.error}>!</div>}
        </div>

        <div className="frame-tools">
          <button className={`ib ${tool === "pencil" ? "on" : ""}`} title="pencil" onClick={() => setTool("pencil")}><IconPencil /></button>
          <button className={`ib ${tool === "arrow" ? "on" : ""}`} title="arrow — the camera move" onClick={() => setTool("arrow")}><IconArrow /></button>
          {COLORS.map((c) => (
            <span key={c} className={`swatch ${color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
          <button className="ib" title="undo stroke" disabled={!shot.strokes.length}
            onClick={() => patch({ strokes: shot.strokes.slice(0, -1) })}><IconUndo /></button>

          <span className="sep" />

          <div className="glyph-row" title="camera move">
            {MOVEMENTS.map((m) => (
              <button
                key={m}
                className={`glyph ${movementFamily(m)} ${shot.movement === m ? "on" : ""}`}
                title={m}
                onClick={() => patch({ movement: m })}
              >
                {MOVEMENT_GLYPH[m]}
              </button>
            ))}
          </div>

          <span className="sep" />

          <div className="dur" title="duration">
            <button className="ib" onClick={() => patch({ durationSec: Math.max(0.5, shot.durationSec - 0.5) })}>−</button>
            <b>{shot.durationSec}s</b>
            <button className="ib" onClick={() => patch({ durationSec: shot.durationSec + 0.5 })}>+</button>
          </div>
        </div>

        <input
          className="action-line"
          placeholder="what happens in this shot…"
          value={shot.action}
          onChange={(e) => patch({ action: e.target.value })}
        />

        <div className="frame-actions">
          <div className="cast-row">
            {project.cast.map((m) => (
              <CastChip key={m.id} member={m} busy={busy} onClick={() => compositeCast(m)} />
            ))}
            <button className="ib" title="new character" onClick={() => setShowCastForm(!showCastForm)}><IconPersonPlus /></button>
            {castFrame && (
              <button className="ib" title="back to clean plate" onClick={() => patch({ castFrameId: undefined })}><IconRevert /></button>
            )}
          </div>
          <div className="spacer" />
          <button className="ib big-ib bolt" title={loadFarmConfig().mode === "mock" ? "make it move (mock)" : "make it move — FARM AR"}
            disabled={!keyframe || generating || busy} onClick={generate}>
            <IconBolt />
          </button>
          <button className="ib" title="delete shot"
            onClick={() => { if (confirm("Delete this shot?")) { onClose(); dispatch({ type: "deleteShot", shotId: shot.id }); } }}>
            <IconTrash />
          </button>
          <button className="ib" title="close" onClick={onClose}><IconClose /></button>
        </div>

        {showCastForm && (
          <div className="cast-form">
            <button className={`ib ${newKind === "character" ? "on" : ""}`} title="character" onClick={() => setNewKind("character")}><IconPerson /></button>
            <button className={`ib ${newKind === "prop" ? "on" : ""}`} title="prop / object" onClick={() => setNewKind("prop")}><IconBox /></button>
            <input placeholder={newKind === "prop" ? "prop — e.g. record player" : "name"} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input placeholder={newKind === "prop" ? "material, size, era…" : "look — wardrobe, age…"} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            <button className="ib" title="add"
              onClick={() => {
                if (!newName.trim()) return;
                dispatch({ type: "addCastMember", member: { id: uid(), name: newName.trim(), description: newDesc.trim(), refImageIds: [], kind: newKind } });
                setNewName(""); setNewDesc(""); setShowCastForm(false);
              }}><IconCheck /></button>
          </div>
        )}
        {busy && <div className="gen-bar inline"><span /><em>compositing</em></div>}
        {note && <div className="frame-note">{note}</div>}
      </div>
    </div>
  );
}

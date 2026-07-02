// Shot editor: sketch over the keyframe (pencil + movement arrows), the
// shot-list metadata, the FARM AR context tray (ordered spatial anchors,
// user-editable), and generation.

import { useEffect, useMemo, useRef, useState } from "react";
import type { CapturedFrame, Shot } from "../model/types";
import { ANGLES, frameById, LENSES, MOVEMENTS, uid } from "../model/types";
import { buildPrompt } from "../farm/prompt";
import {
  buildFarmArRequest,
  loadFarmConfig,
  pollFarmAr,
  submitFarmAr,
  TRAINED_SEQ_BUDGET,
} from "../farm/client";
import { editImage, loadEditConfig } from "../edit/imageEdit";
import { impliedEndPose, MOVEMENT_GLYPH, movementFamily } from "../lib/movement";
import SketchCanvas from "../components/SketchCanvas";
import { db } from "../store/db";
import { getImageData, primeImageCache, useImage, useProject } from "../store/useProject";

const COLORS = [
  { name: "graphite", value: "#3d3a35" },
  { name: "red", value: "#b3372b" },
  { name: "blue", value: "#2b5a8c" },
];

/** Beyond this many anchors, warn about context pollution: stale/redundant
 * views degrade AR rollouts the same way stale turns degrade an LLM chat —
 * and every context view eats into the 32-frame trained sequence budget. */
const CONTEXT_SOFT_LIMIT = 4;

export default function ShotEditor({ shotId, onClose }: { shotId: string; onClose: () => void }) {
  const { project, dispatch } = useProject();
  const located = project.scenes
    .flatMap((sc) => sc.shots.map((s) => ({ scene: sc, shot: s })))
    .find((x) => x.shot.id === shotId);
  const shot = located?.shot;
  const scene = located?.scene;

  const [tool, setTool] = useState<"pencil" | "arrow">("pencil");
  const [color, setColor] = useState(COLORS[0].value);
  const [promptOverride, setPromptOverride] = useState<string | null>(null);
  const [genNote, setGenNote] = useState("");
  const [genPhase, setGenPhase] = useState("");
  const [castMemberId, setCastMemberId] = useState("");
  const [castBusy, setCastBusy] = useState(false);
  const [castNote, setCastNote] = useState("");
  const pollTimer = useRef<number | undefined>(undefined);

  const cleanFrame = shot ? frameById(project, shot.frameId) : undefined;
  const castFrame = shot ? frameById(project, shot.castFrameId) : undefined;
  const keyframe = castFrame ?? cleanFrame; // what we show and anchor on
  const img = useImage(keyframe?.imageId);
  const prompt = shot ? (promptOverride ?? buildPrompt(shot)) : "";

  // Effective context: the cast plate substitutes for the clean plate as the
  // anchor (never both — same pose with different content is contradictory
  // conditioning).
  const contextFrames = useMemo(() => {
    if (!shot) return [];
    return shot.contextFrameIds
      .map((id) => (id === shot.frameId && shot.castFrameId ? shot.castFrameId : id))
      .map((id) => frameById(project, id))
      .filter((f): f is CapturedFrame => !!f);
  }, [shot, project]);

  // resume polling if the shot has an in-flight generation
  useEffect(() => {
    if (!shot?.farm || shot.farm.status === "done" || shot.farm.status === "error") return;
    const cfg = loadFarmConfig();
    const handle = { taskId: shot.farm.taskId, mock: !!shot.farm.mock };
    const tick = async () => {
      const res = await pollFarmAr(cfg, handle);
      setGenPhase(res.phase ?? "");
      if (res.status === "done" || res.status === "error") {
        dispatch({
          type: "updateShot",
          shotId: shot.id,
          patch: { farm: { ...shot.farm!, status: res.status, videoUrl: res.videoUrl, error: res.error } },
        });
      } else {
        pollTimer.current = window.setTimeout(tick, handle.mock ? 800 : 4000);
      }
    };
    pollTimer.current = window.setTimeout(tick, 500);
    return () => window.clearTimeout(pollTimer.current);
  }, [shot?.farm?.taskId, shot?.farm?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shot || !scene) return null;

  const patch = (p: Partial<Shot>) => dispatch({ type: "updateShot", shotId: shot.id, patch: p });

  // Cast pass: composite a character into the clean plate. The result is a new
  // frame in the library with the SAME pose as the clean plate (a 2D edit
  // never moves the camera), so it's a drop-in anchor replacement.
  async function compositeCast() {
    if (!shot || !cleanFrame) return;
    const member = project.cast.find((c) => c.id === castMemberId);
    if (!member) return setCastNote("pick a cast member (add them in the cast tab)");
    setCastBusy(true);
    setCastNote("");
    try {
      const base = await getImageData(cleanFrame.imageId);
      if (!base) throw new Error("clean plate image missing");
      const refs = [];
      for (const rid of member.refImageIds) {
        const r = await getImageData(rid);
        if (r) refs.push(r);
      }
      const instruction =
        `Add ${member.name} (${member.description || "see reference"}) into this room, ` +
        `matching its lighting, perspective and grain exactly. ${shot.action || ""} ` +
        (refs.length ? "Use the reference image(s) for their exact appearance. " : "") +
        "Do not change the room, framing or camera.";
      const dataUrl = await editImage(loadEditConfig(), { base, refs, instruction });
      const imageId = uid();
      primeImageCache(imageId, dataUrl);
      await db.putImage(imageId, dataUrl);
      const frame: CapturedFrame = {
        id: uid(),
        imageId,
        pose: cleanFrame.pose, // inherited — this is the whole trick
        fov: cleanFrame.fov,
        aspect: cleanFrame.aspect,
        label: `SC${scene!.number}·SH${shot.number} cast: ${member.name}`,
        capturedAt: Date.now(),
      };
      dispatch({ type: "addFrame", frame });
      patch({ castFrameId: frame.id });
    } catch (e) {
      setCastNote(String(e));
    } finally {
      setCastBusy(false);
    }
  }

  async function generate() {
    if (!shot || !keyframe) return;
    const cfg = loadFarmConfig();
    if (cfg.mode === "live" && (!cfg.accountId || !cfg.token)) {
      setGenNote("live mode needs account id + token — open Settings");
      return;
    }
    try {
      setGenNote("");
      const ctx = [];
      for (const f of contextFrames) {
        const dataUrl = await getImageData(f.imageId);
        if (dataUrl) ctx.push({ frame: f, imageDataUrl: dataUrl });
      }
      if (!ctx.length) {
        setGenNote("no context anchors — mark IN or add frames to the tray");
        return;
      }
      const endPose = shot.endPose ?? impliedEndPose(shot.movement, keyframe.pose);
      const frameCount = Math.round(shot.durationSec * cfg.fps);
      const body = buildFarmArRequest({
        prompt,
        contextFrames: ctx,
        startPose: keyframe.pose,
        endPose,
        fovDeg: keyframe.fov,
        frameCount,
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
          prompt,
          contextFrameIds: shot.contextFrameIds,
          frameCount: body.targetFrameCount as number,
          submittedAt: Date.now(),
        },
      });
    } catch (e) {
      setGenNote(String(e));
    }
  }

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="editor" onClick={(e) => e.stopPropagation()}>
        <div className="canvas-side">
          <h3 className="section-title" style={{ ["--accent-c" as string]: "var(--red)" }}>
            SC {scene.number} · SH {shot.number} — sketch the move
          </h3>
          <div className="toolrow">
            <button className={`ghost ${tool === "pencil" ? "on" : ""}`} onClick={() => setTool("pencil")}>✎ pencil</button>
            <button className={`ghost ${tool === "arrow" ? "on" : ""}`} onClick={() => setTool("arrow")}>➤ arrow</button>
            {COLORS.map((c) => (
              <span
                key={c.value}
                className={`swatch ${color === c.value ? "on" : ""}`}
                style={{ background: c.value }}
                title={c.name}
                onClick={() => setColor(c.value)}
              />
            ))}
            <button className="ghost" disabled={!shot.strokes.length}
              onClick={() => patch({ strokes: shot.strokes.slice(0, -1) })}>↶ undo</button>
            <button className="ghost" disabled={!shot.strokes.length}
              onClick={() => confirm("Clear all strokes?") && patch({ strokes: [] })}>clear</button>
          </div>
          <div className="sketch-stage" style={{ aspectRatio: "16/9" }}>
            {img && <img src={img} alt="keyframe" style={{ height: "100%", objectFit: "cover" }} />}
            <SketchCanvas strokes={shot.strokes} tool={tool} color={color} onStrokes={(strokes) => patch({ strokes })} />
          </div>
          <div className="hint">
            Arrows are the grammar: where the camera goes, what the subject does.
            {keyframe ? "" : " No keyframe yet — go to Scout and mark IN."}
          </div>

          <h3 className="section-title" style={{ ["--accent-c" as string]: "var(--ochre)" }}>Cast pass</h3>
          <div className="accent-box" style={{ ["--accent-c" as string]: "var(--ochre)" }}>
            <div className="hint">
              Composite a character into the clean plate ({loadEditConfig().provider}).
              The cast plate keeps the plate's camera pose, so it replaces the
              clean plate as the identity anchor.
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select value={castMemberId} onChange={(e) => setCastMemberId(e.target.value)}>
                <option value="">character…</option>
                {project.cast.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button className="ochre" onClick={compositeCast} disabled={!cleanFrame || castBusy}>
                {castBusy ? "compositing…" : "⌁ composite into plate"}
              </button>
              {castFrame && (
                <button className="ghost" onClick={() => patch({ castFrameId: undefined })}>
                  ↩ back to clean plate
                </button>
              )}
            </div>
            {castFrame && <div className="hint">showing cast plate: {castFrame.label}</div>}
            {!project.cast.length && <div className="hint">no cast yet — add characters in the cast tab</div>}
            {castNote && <div className="hint" style={{ color: "var(--red)" }}>{castNote}</div>}
          </div>

          <h3 className="section-title" style={{ ["--accent-c" as string]: "var(--blue)" }}>FARM AR</h3>
          <div className="accent-box" style={{ ["--accent-c" as string]: "var(--blue)" }}>
            <div className="hint">
              Context anchors, in model-sequence order — later views carry the
              most weight, so the keyframe sits last:
            </div>
            <div className="context-tray">
              {contextFrames.map((f, i) => (
                <div className="context-item" key={f.id}>
                  <ContextThumb imageId={f.imageId} />
                  <span className="grow">{f.label}</span>
                  {i === contextFrames.length - 1 && <span className="anchor-tag">keyframe · most weight</span>}
                  <button className="ghost" disabled={i === 0} title="move up"
                    onClick={() => {
                      const ids = [...shot.contextFrameIds];
                      [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                      patch({ contextFrameIds: ids });
                    }}>↑</button>
                  <button className="ghost" title="remove from context"
                    onClick={() => patch({ contextFrameIds: shot.contextFrameIds.filter((id) => id !== f.id) })}>✕</button>
                </div>
              ))}
              <div className="context-add">
                <select
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    // insert before the keyframe so the keyframe stays last
                    const ids = [...shot.contextFrameIds];
                    const at = shot.frameId && ids[ids.length - 1] === shot.frameId ? ids.length - 1 : ids.length;
                    ids.splice(at, 0, e.target.value);
                    patch({ contextFrameIds: ids });
                  }}
                >
                  <option value="">+ add anchor from frame library…</option>
                  {project.frames
                    .filter((f) => !shot.contextFrameIds.includes(f.id))
                    .map((f) => (
                      <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                </select>
              </div>
              {contextFrames.length > CONTEXT_SOFT_LIMIT && (
                <div className="hint" style={{ color: "var(--red)" }}>
                  {contextFrames.length} anchors — heavy context pollutes the
                  rollout, and it eats the sequence budget: {contextFrames.length}{" "}
                  context + targets ≤ {TRAINED_SEQ_BUDGET} leaves{" "}
                  {Math.max(2, TRAINED_SEQ_BUDGET - contextFrames.length)} frames
                  (~{(Math.max(2, TRAINED_SEQ_BUDGET - contextFrames.length) / loadFarmConfig().fps).toFixed(1)}s).
                </div>
              )}
            </div>
            <div className="hint">Prompt (from the shot spec — editable):</div>
            <textarea
              className="prompt-preview"
              rows={3}
              value={prompt}
              onChange={(e) => setPromptOverride(e.target.value)}
            />
            <div className="btn-row" style={{ display: "flex", gap: 6 }}>
              <button className="blue" onClick={generate} disabled={!keyframe || shot.farm?.status === "queued" || shot.farm?.status === "running"}>
                {loadFarmConfig().mode === "mock" ? "⌁ generate (mock)" : "⌁ generate with FARM AR"}
              </button>
              {promptOverride !== null && (
                <button className="ghost" onClick={() => setPromptOverride(null)}>reset prompt</button>
              )}
            </div>
            {shot.farm && (
              <div className="status">
                task <code>{shot.farm.taskId}</code> — <b>{shot.farm.status}</b>
                {genPhase && (shot.farm.status === "queued" || shot.farm.status === "running") && ` · ${genPhase}`}
                {shot.farm.status === "done" && !shot.farm.videoUrl && " (simulated — animatic uses the pencil-test)"}
                {shot.farm.error && <span style={{ color: "var(--red)" }}> {shot.farm.error}</span>}
              </div>
            )}
            {shot.farm?.videoUrl && <video src={shot.farm.videoUrl} controls loop />}
            {genNote && <div className="status" style={{ color: "var(--red)" }}>{genNote}</div>}
          </div>
        </div>

        <div className="form-side">
          <h3>Shot spec</h3>
          <div className="form-grid">
            <label className="field">shot #
              <input value={shot.number} onChange={(e) => patch({ number: e.target.value })} />
            </label>
            <label className="field">duration (s)
              <input type="number" min={0.5} step={0.5} value={shot.durationSec}
                onChange={(e) => patch({ durationSec: Math.max(0.5, Number(e.target.value) || 0.5) })} />
            </label>
            <label className="field">lens
              <select value={shot.lensMm} onChange={(e) => patch({ lensMm: Number(e.target.value) })}>
                {LENSES.map((l) => <option key={l} value={l}>{l}mm</option>)}
              </select>
            </label>
            <label className="field">angle
              <select value={shot.angle} onChange={(e) => patch({ angle: e.target.value as Shot["angle"] })}>
                {ANGLES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>movement
              <div className="chip-grid">
                {MOVEMENTS.map((m) => (
                  <button
                    key={m}
                    className={`${movementFamily(m)} ${shot.movement === m ? "on" : ""}`}
                    onClick={() => patch({ movement: m })}
                  >
                    {MOVEMENT_GLYPH[m]} {m}
                  </button>
                ))}
              </div>
            </label>
          </div>
          <label className="field">action
            <textarea rows={3} value={shot.action} placeholder="What happens in the frame."
              onChange={(e) => patch({ action: e.target.value })} />
          </label>
          <label className="field">dialogue
            <textarea rows={2} value={shot.dialogue} placeholder="Spoken over the shot (animatic subtitle)."
              onChange={(e) => patch({ dialogue: e.target.value })} />
          </label>
          <label className="field">notes
            <textarea rows={2} value={shot.notes} placeholder="Blocking, sound, cut point…"
              onChange={(e) => patch({ notes: e.target.value })} />
          </label>
          <div className="hint">
            IN pose {keyframe ? "set" : "—"} · OUT pose {shot.endPose ? "set" : `implied by "${shot.movement}"`}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
            <button className="danger" onClick={() => { if (confirm("Delete this shot?")) { onClose(); dispatch({ type: "deleteShot", shotId: shot.id }); } }}>
              delete shot
            </button>
            <button style={{ marginLeft: "auto" }} onClick={onClose}>done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContextThumb({ imageId }: { imageId: string }) {
  const img = useImage(imageId);
  return img ? <img src={img} alt="" /> : <span style={{ width: 56 }} />;
}

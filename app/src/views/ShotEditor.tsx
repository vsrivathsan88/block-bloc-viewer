// Shot editor: sketch over the keyframe (pencil + movement arrows), the
// shot-list metadata, the FARM AR context tray (ordered spatial anchors,
// user-editable), and generation.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Shot } from "../model/types";
import { ANGLES, frameById, LENSES, MOVEMENTS } from "../model/types";
import { buildPrompt } from "../farm/prompt";
import {
  buildFarmArRequest,
  loadFarmConfig,
  pollFarmAr,
  submitFarmAr,
} from "../farm/client";
import { impliedEndPose } from "../lib/movement";
import SketchCanvas from "../components/SketchCanvas";
import { getImageData, useImage, useProject } from "../store/useProject";

const COLORS = [
  { name: "graphite", value: "#3d3a35" },
  { name: "red", value: "#b3372b" },
  { name: "blue", value: "#2b5a8c" },
];

/** Beyond this many anchors, warn about context pollution: stale/redundant
 * views degrade AR rollouts the same way stale turns degrade an LLM chat. */
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
  const pollTimer = useRef<number | undefined>(undefined);

  const keyframe = shot ? frameById(project, shot.frameId) : undefined;
  const img = useImage(keyframe?.imageId);
  const prompt = shot ? (promptOverride ?? buildPrompt(shot)) : "";

  const contextFrames = useMemo(
    () => (shot ? shot.contextFrameIds.map((id) => frameById(project, id)).filter((f) => !!f) : []),
    [shot, project],
  );

  // resume polling if the shot has an in-flight generation
  useEffect(() => {
    if (!shot?.farm || shot.farm.status === "done" || shot.farm.status === "error") return;
    const cfg = loadFarmConfig();
    const handle = { taskId: shot.farm.taskId, mock: !!shot.farm.mock };
    const tick = async () => {
      const res = await pollFarmAr(cfg, handle);
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
      const frameCount = Math.min(129, Math.max(9, Math.round(shot.durationSec * cfg.fps)));
      const body = buildFarmArRequest({
        prompt,
        contextFrames: ctx,
        startPose: keyframe.pose,
        endPose,
        fovDeg: keyframe.fov,
        frameCount,
        width: 832,
        height: 480,
        model: cfg.model || undefined,
      });
      const handle = await submitFarmAr(cfg, body);
      patch({
        farm: {
          taskId: handle.taskId,
          mock: handle.mock,
          status: "queued",
          prompt,
          contextFrameIds: shot.contextFrameIds,
          frameCount,
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
          <h3>SC {scene.number} · SH {shot.number} — sketch the move</h3>
          <div className="toolrow">
            <button className={tool === "pencil" ? "active" : "ghost"} onClick={() => setTool("pencil")}>✎ pencil</button>
            <button className={tool === "arrow" ? "active" : "ghost"} onClick={() => setTool("arrow")}>➤ arrow</button>
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
          <div className="hint" style={{ marginTop: 8 }}>
            Arrows are the grammar: where the camera goes, what the subject does.
            {keyframe ? "" : " No keyframe yet — go to Scout and mark IN."}
          </div>

          <h3 style={{ marginTop: 14 }}>FARM AR</h3>
          <div className="farm-box">
            <div className="hint">
              Context anchors (ordered — first anchor is the identity pose the
              generation is anchored to):
            </div>
            <div className="context-tray">
              {contextFrames.map((f, i) => (
                <div className="context-item" key={f.id}>
                  <ContextThumb imageId={f.imageId} />
                  <span className="grow">{f.label}</span>
                  {i === 0 && <span className="anchor-tag">identity anchor</span>}
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
                    if (e.target.value) patch({ contextFrameIds: [...shot.contextFrameIds, e.target.value] });
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
                  {contextFrames.length} anchors — heavy context can pollute the
                  rollout. Keep the few views that actually cover this shot.
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
              <button onClick={generate} disabled={!keyframe || shot.farm?.status === "queued" || shot.farm?.status === "running"}>
                {loadFarmConfig().mode === "mock" ? "⌁ generate (mock)" : "⌁ generate with FARM AR"}
              </button>
              {promptOverride !== null && (
                <button className="ghost" onClick={() => setPromptOverride(null)}>reset prompt</button>
              )}
            </div>
            {shot.farm && (
              <div className="status">
                task <code>{shot.farm.taskId}</code> — <b>{shot.farm.status}</b>
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
              <select value={shot.movement} onChange={(e) => patch({ movement: e.target.value as Shot["movement"] })}>
                {MOVEMENTS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
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

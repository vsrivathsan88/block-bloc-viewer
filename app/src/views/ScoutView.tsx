// Scout: walk the Marble world in the embedded viewer, frame a composition,
// mark IN (capture keyframe + pose) and optionally OUT (end pose). Every
// capture also lands in the project's posed frame library — the pool of
// spatial anchors available to any shot's FARM context. Press C inside the
// viewer to capture without leaving pointer lock.

import { useEffect, useMemo, useRef, useState } from "react";
import type { CapturedFrame } from "../model/types";
import { allShots, frameById, uid } from "../model/types";
import { impliedEndPose } from "../lib/movement";
import { captureFrame, getViewer, onViewerKey, previewMove, setViewerPose, VIEWER_PATH } from "../lib/viewerBridge";
import { db } from "../store/db";
import { primeImageCache, useImage, useProject } from "../store/useProject";

function FrameChip({ frame, onRename, onDelete, onGoto }: {
  frame: CapturedFrame;
  onRename: (label: string) => void;
  onDelete: () => void;
  onGoto: () => void;
}) {
  const img = useImage(frame.imageId);
  return (
    <div className="frame-chip">
      {img && <img src={img} alt={frame.label} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <input value={frame.label} onChange={(e) => onRename(e.target.value)} />
        <div className="pose-badge">
          [{frame.pose.position.map((n) => n.toFixed(1)).join(", ")}] · fov {Math.round(frame.fov)}°
        </div>
      </div>
      <button className="ghost" title="jump viewer to this pose" onClick={onGoto}>⌖</button>
      <button className="ghost" onClick={onDelete}>✕</button>
    </div>
  );
}

export default function ScoutView({ onOpenShot }: { onOpenShot: (shotId: string) => void }) {
  const { project, dispatch } = useProject();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shots = allShots(project);
  const [activeShotId, setActiveShotId] = useState<string | null>(shots[0]?.shot.id ?? null);
  const [note, setNote] = useState("");
  const active = shots.find((s) => s.shot.id === activeShotId);

  const viewerSrc = useMemo(() => {
    const p = new URLSearchParams();
    p.set("spz", project.world.spzUrl);
    p.set("title", project.world.title);
    if (project.world.colliderUrl) p.set("collider", project.world.colliderUrl);
    return `${VIEWER_PATH}?${p.toString()}`;
  }, [project.world]);

  function flash(msg: string) {
    setNote(msg);
    window.setTimeout(() => setNote(""), 2500);
  }

  async function captureToLibrary(label: string): Promise<CapturedFrame | null> {
    const cap = captureFrame(iframeRef.current);
    if (!cap) {
      flash("viewer not ready yet");
      return null;
    }
    const imageId = uid();
    primeImageCache(imageId, cap.dataUrl);
    await db.putImage(imageId, cap.dataUrl);
    const frame: CapturedFrame = {
      id: uid(),
      imageId,
      pose: cap.pose,
      fov: cap.fov,
      aspect: cap.aspect,
      label,
      capturedAt: Date.now(),
    };
    dispatch({ type: "addFrame", frame });
    return frame;
  }

  async function markIn() {
    if (!active) return;
    const frame = await captureToLibrary(`SC${active.scene.number}·SH${active.shot.number} IN`);
    if (!frame) return;
    dispatch({
      type: "updateShot",
      shotId: active.shot.id,
      patch: {
        frameId: frame.id,
        // the keyframe is always the first anchor; keep any extra anchors
        contextFrameIds: [frame.id, ...active.shot.contextFrameIds.filter((id) => id !== active.shot.frameId)],
      },
    });
    flash(`marked IN for ${active.scene.number}·${active.shot.number}`);
  }

  function markOut() {
    if (!active) return;
    const cap = captureFrame(iframeRef.current);
    if (!cap) return flash("viewer not ready yet");
    dispatch({ type: "setShotEndPose", shotId: active.shot.id, endPose: cap.pose });
    flash(`marked OUT for ${active.scene.number}·${active.shot.number}`);
  }

  // Scan the set: 8 level yaw stops at the current position → 8 posed anchors
  // banked into the library. Cheapest possible "initialize FARM context from
  // the Marble scene" — run it near the capture origin where the splat is
  // sharpest.
  const [scanning, setScanning] = useState(false);
  async function scanSet() {
    const v = getViewer(iframeRef.current);
    const w = iframeRef.current?.contentWindow as (Window & { __recording?: boolean }) | null;
    if (!v || !w) return flash("viewer not ready yet");
    setScanning(true);
    w.__recording = true;
    const p = v.camera.position;
    const q = v.camera.quaternion;
    const orig = { position: [p.x, p.y, p.z] as [number, number, number], quaternion: [q.x, q.y, q.z, q.w] as [number, number, number, number] };
    try {
      for (let i = 0; i < 8; i++) {
        const yaw = (i / 8) * Math.PI * 2;
        setViewerPose(iframeRef.current, {
          position: orig.position,
          quaternion: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
        });
        await new Promise((r) => setTimeout(r, 450)); // let Spark re-sort + render
        await captureToLibrary(`set ${Math.round((yaw * 180) / Math.PI)}°`);
      }
      flash("scanned: 8 anchors banked");
    } finally {
      setViewerPose(iframeRef.current, orig);
      w.__recording = false;
      setScanning(false);
    }
  }

  function preview() {
    if (!active) return;
    const frame = frameById(project, active.shot.frameId);
    if (!frame) return flash("mark IN first");
    const end = active.shot.endPose ?? impliedEndPose(active.shot.movement, frame.pose);
    previewMove(iframeRef.current, frame.pose, end, active.shot.durationSec);
  }

  // C inside the viewer = mark IN without leaving pointer lock. Re-attach on
  // iframe load; poll briefly because contentDocument swaps on navigation.
  const markInRef = useRef(markIn);
  markInRef.current = markIn;
  useEffect(() => {
    let un = () => {};
    const attach = () => {
      un();
      un = onViewerKey(iframeRef.current, "KeyC", () => markInRef.current());
    };
    const iframe = iframeRef.current;
    iframe?.addEventListener("load", attach);
    const t = window.setTimeout(attach, 1500);
    return () => {
      un();
      iframe?.removeEventListener("load", attach);
      window.clearTimeout(t);
    };
  }, [viewerSrc]);

  return (
    <div className="scout">
      <iframe ref={iframeRef} src={viewerSrc} title="world viewer" />
      <div className="rail">
        <h3>Scout · {project.world.title}</h3>
        <div className="hint">
          Walk with WASD (click to grab the mouse). Frame the composition, then
          mark <b>IN</b> — that captures the keyframe <i>and its camera pose</i>{" "}
          (a spatial anchor). Mark <b>OUT</b> where the move should end.
          Hotkey: <b>C</b> = mark IN while walking.
        </div>

        <label className="field">
          active shot
          <select
            value={activeShotId ?? ""}
            onChange={(e) => setActiveShotId(e.target.value || null)}
          >
            {shots.map(({ scene, shot }) => (
              <option key={shot.id} value={shot.id}>
                SC{scene.number} · SH{shot.number} {shot.frameId ? "●" : "○"} {shot.movement}
              </option>
            ))}
          </select>
        </label>

        <div className="btn-row">
          <button onClick={markIn} disabled={!active}>● mark IN</button>
          <button onClick={markOut} disabled={!active?.shot.frameId}>■ mark OUT</button>
          <button className="ghost" onClick={preview} disabled={!active?.shot.frameId}>▶ preview move</button>
        </div>
        <div className="btn-row">
          <button
            className="ghost"
            onClick={() => {
              const sceneId = active?.scene.id ?? project.scenes[project.scenes.length - 1].id;
              dispatch({ type: "addShot", sceneId });
            }}
          >
            + new shot
          </button>
          <button className="ghost" disabled={!active} onClick={() => active && onOpenShot(active.shot.id)}>
            open editor
          </button>
        </div>
        {note && <div className="hint" style={{ color: "var(--red)" }}>{note}</div>}

        <h3>Frame library ({project.frames.length})</h3>
        <div className="hint">
          Posed captures — the spatial anchors FARM AR can be conditioned on.
          Add extra coverage of the set here (wide, reverse, detail), then pick
          anchors per shot in the editor's context tray.
        </div>
        <div className="btn-row">
          <button className="ghost" onClick={() => captureToLibrary(`anchor ${project.frames.length + 1}`)}>
            + capture anchor
          </button>
          <button className="ghost" onClick={scanSet} disabled={scanning}>
            {scanning ? "scanning…" : "◌ scan set (8× yaw)"}
          </button>
        </div>
        <div className="frame-strip">
          {[...project.frames].reverse().map((f) => (
            <FrameChip
              key={f.id}
              frame={f}
              onRename={(label) => dispatch({ type: "renameFrame", frameId: f.id, label })}
              onDelete={() => dispatch({ type: "deleteFrame", frameId: f.id })}
              onGoto={() => setViewerPose(iframeRef.current, f.pose)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

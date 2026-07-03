// Scout: two ways to get shots, both low-click.
//   1. Camera plan (primary): drag cameras onto the top-down canvas — press
//      places, pull aims, release commits. One "shoot" drives the viewer
//      through every planned camera and captures a take per camera; then
//      accept/reject each take and accepted ones land on the board as shots.
//   2. Walk the world and mark IN/OUT for hand-framed compositions.
// Every capture also lands in the posed frame library (FARM AR anchors).

import { useEffect, useMemo, useRef, useState } from "react";
import type { CapturedFrame } from "../model/types";
import { allShots, frameById, newShot, nextShotNumber, uid } from "../model/types";
import { impliedEndPose } from "../lib/movement";
import {
  captureFrame,
  getViewer,
  getWorldBboxXZ,
  onViewerKey,
  previewMove,
  setViewerPose,
  VIEWER_PATH,
} from "../lib/viewerBridge";
import { db } from "../store/db";
import { DEMO_MODE, DEMO_VIEWER_HTML } from "../lib/demoViewer";
import { primeImageCache, useImage, useProject } from "../store/useProject";
import PlanCanvas, { type BboxXZ, type PlannedCam, type ShotMark, yawOfQuat, yawQuat } from "../components/PlanCanvas";
import TakeReview, { type Take } from "../components/TakeReview";

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

const FALLBACK_BBOX: BboxXZ = { min: [-4, -4], max: [4, 4] };

export default function ScoutView({ onOpenShot }: { onOpenShot: (shotId: string) => void }) {
  const { project, dispatch } = useProject();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shots = allShots(project);
  const [activeShotId, setActiveShotId] = useState<string | null>(shots[0]?.shot.id ?? null);
  const [note, setNote] = useState("");
  const active = shots.find((s) => s.shot.id === activeShotId);

  // camera plan state
  const [planned, setPlanned] = useState<PlannedCam[]>([]);
  const [takes, setTakes] = useState<Take[] | null>(null);
  const [shooting, setShooting] = useState(false);
  const [planOpen, setPlanOpen] = useState(true);
  const [bbox, setBbox] = useState<BboxXZ | null>(null);
  const nextNumRef = useRef(1);

  const viewerSrc = useMemo(() => {
    const p = new URLSearchParams();
    p.set("spz", project.world.spzUrl);
    p.set("title", project.world.title);
    if (project.world.colliderUrl) p.set("collider", project.world.colliderUrl);
    return `${VIEWER_PATH}?${p.toString()}`;
  }, [project.world]);

  // poll for the splat's world bbox (available once streaming settles)
  useEffect(() => {
    setBbox(null);
    const t = window.setInterval(() => {
      const b = getWorldBboxXZ(iframeRef.current);
      if (b) {
        setBbox(b);
        window.clearInterval(t);
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [viewerSrc]);

  // fallback: extent of what we've captured so far
  const effBbox = useMemo<BboxXZ>(() => {
    if (bbox) return bbox;
    const pts = project.frames.map((f) => [f.pose.position[0], f.pose.position[2]] as [number, number]);
    if (!pts.length) return FALLBACK_BBOX;
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    return { min: [Math.min(...xs) - 3, Math.min(...zs) - 3], max: [Math.max(...xs) + 3, Math.max(...zs) + 3] };
  }, [bbox, project.frames]);

  const shotMarks = useMemo<ShotMark[]>(
    () =>
      shots.flatMap(({ scene, shot }) => {
        const f = frameById(project, shot.frameId);
        return f
          ? [{ label: `${scene.number}·${shot.number}`, x: f.pose.position[0], z: f.pose.position[2], yaw: yawOfQuat(f.pose.quaternion) }]
          : [];
      }),
    [shots, project],
  );

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

  // ---- camera plan: shoot + accept ----

  async function shootTakes() {
    const v = getViewer(iframeRef.current);
    const w = iframeRef.current?.contentWindow as (Window & { __recording?: boolean }) | null;
    if (!v || !w) return flash("viewer not ready yet");
    setShooting(true);
    w.__recording = true;
    const q = v.camera.quaternion;
    const p = v.camera.position;
    const orig = { position: [p.x, p.y, p.z] as [number, number, number], quaternion: [q.x, q.y, q.z, q.w] as [number, number, number, number] };
    const out: Take[] = [];
    try {
      for (const cam of planned) {
        const pose = { position: [cam.x, 0, cam.z] as [number, number, number], quaternion: yawQuat(cam.yaw) };
        setViewerPose(iframeRef.current, pose);
        await new Promise((r) => setTimeout(r, 550)); // let Spark re-sort + render
        const cap = captureFrame(iframeRef.current);
        if (cap) out.push({ dataUrl: cap.dataUrl, pose, fov: cap.fov, aspect: cap.aspect });
      }
    } finally {
      setViewerPose(iframeRef.current, orig);
      w.__recording = false;
      setShooting(false);
    }
    const lastScene = project.scenes[project.scenes.length - 1];
    nextNumRef.current = parseInt(nextShotNumber(lastScene), 10) || 1;
    setPlanned([]);
    setTakes(out);
  }

  async function acceptTake(t: Take) {
    const imageId = uid();
    primeImageCache(imageId, t.dataUrl);
    await db.putImage(imageId, t.dataUrl);
    const scene = project.scenes[project.scenes.length - 1];
    const num = String(nextNumRef.current++);
    const frame: CapturedFrame = {
      id: uid(),
      imageId,
      pose: t.pose,
      fov: t.fov,
      aspect: t.aspect,
      label: `SC${scene.number}·SH${num} IN`,
      capturedAt: Date.now(),
    };
    dispatch({ type: "addFrame", frame });
    dispatch({
      type: "addShot",
      sceneId: scene.id,
      shot: { ...newShot(num), frameId: frame.id, contextFrameIds: [frame.id] },
    });
  }

  // ---- walk flow: mark IN / OUT ----

  async function markIn() {
    // No shot selected? Marking IN starts one — the frame IS the shot.
    let target = active;
    if (!target) {
      const scene = project.scenes[project.scenes.length - 1];
      const shot = newShot(nextShotNumber(scene));
      dispatch({ type: "addShot", sceneId: scene.id, shot });
      setActiveShotId(shot.id);
      target = { scene, shot };
    }
    const frame = await captureToLibrary(`SC${target.scene.number}·SH${target.shot.number} IN`);
    if (!frame) return;
    dispatch({
      type: "updateShot",
      shotId: target.shot.id,
      patch: {
        frameId: frame.id,
        // keyframe goes LAST — the model weights recent context positions most
        contextFrameIds: [...target.shot.contextFrameIds.filter((id) => id !== target.shot.frameId), frame.id],
      },
    });
    flash(`marked IN for ${target.scene.number}·${target.shot.number}`);
  }

  function markOut() {
    if (!active) return;
    const cap = captureFrame(iframeRef.current);
    if (!cap) return flash("viewer not ready yet");
    dispatch({ type: "setShotEndPose", shotId: active.shot.id, endPose: cap.pose });
    flash(`marked OUT for ${active.scene.number}·${active.shot.number}`);
  }

  // Scan the set: 8 level yaw stops at the current position → 8 posed anchors.
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
        setViewerPose(iframeRef.current, { position: orig.position, quaternion: yawQuat(yaw) });
        await new Promise((r) => setTimeout(r, 450));
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

  // C inside the viewer = mark IN without leaving pointer lock.
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
      {DEMO_MODE ? (
        <iframe ref={iframeRef} srcDoc={DEMO_VIEWER_HTML} title="demo world" />
      ) : (
        <iframe ref={iframeRef} src={viewerSrc} title="world viewer" />
      )}

      <div className={`plan-panel ${planOpen ? "" : "closed"}`}>
        <div className="plan-head">
          <h3 className="section-title" style={{ ["--accent-c" as string]: "var(--red)" }}>
            Camera plan {bbox ? "" : "· sizing…"}
          </h3>
          <button className="ghost" onClick={() => setPlanOpen(!planOpen)}>{planOpen ? "▾" : "▸"}</button>
        </div>
        {planOpen && (
          <>
            <div className="hint">
              press = place camera · pull = aim · click a camera = remove.
              ✦ is the capture origin; green = anchors; red = existing shots.
            </div>
            <PlanCanvas bbox={effBbox} anchors={project.frames} shots={shotMarks} planned={planned} onPlanned={setPlanned} />
            <div className="btn-row">
              <button className="red" disabled={!planned.length || shooting} onClick={shootTakes}>
                {shooting ? "shooting…" : `⏺ shoot ${planned.length || ""} take${planned.length === 1 ? "" : "s"}`}
              </button>
              {planned.length > 0 && !shooting && (
                <button className="ghost" onClick={() => setPlanned([])}>clear</button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="rail" style={{ ["--accent-c" as string]: "var(--teal)" }}>
        <div className="card">
          <h3 className="section-title">Hand-frame a shot</h3>
          <div className="hint">
            Or do it on foot: click the world, walk with <b>WASD</b>, then mark{" "}
            <b>IN</b> (hotkey <b>C</b> while walking). Mark <b>OUT</b> where the
            move ends.
          </div>
          <button className="red big" onClick={markIn}>
            ● mark IN {active ? `→ SC${active.scene.number}·SH${active.shot.number}` : "→ new shot"}
          </button>
          <div className="btn-row">
            <button className="ghost" onClick={markOut} disabled={!active?.shot.frameId}>■ mark OUT</button>
            <button className="ghost" onClick={preview} disabled={!active?.shot.frameId}>▶ preview</button>
            <button className="ghost" disabled={!active} onClick={() => active && onOpenShot(active.shot.id)}>✎ edit</button>
          </div>
          <label className="field">
            shot
            <select value={activeShotId ?? ""} onChange={(e) => setActiveShotId(e.target.value || null)}>
              <option value="">— new shot on mark IN —</option>
              {shots.map(({ scene, shot }) => (
                <option key={shot.id} value={shot.id}>
                  SC{scene.number} · SH{shot.number} {shot.frameId ? "●" : "○"} {shot.movement}
                </option>
              ))}
            </select>
          </label>
          {note && <div className="flash-note">{note}</div>}
        </div>

        <div className="card">
          <h3 className="section-title">Set coverage ({project.frames.length})</h3>
          <div className="hint">
            Posed anchors FARM AR conditions on — bank wide/reverse/detail
            views, pick per shot in the editor.
          </div>
          <div className="btn-row">
            <button className="teal" onClick={scanSet} disabled={scanning}>
              {scanning ? "scanning…" : "◌ scan set (8× around)"}
            </button>
            <button className="ghost" onClick={() => captureToLibrary(`anchor ${project.frames.length + 1}`)}>
              + capture one
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

      {takes && <TakeReview takes={takes} onAccept={acceptTake} onClose={() => setTakes(null)} />}
    </div>
  );
}

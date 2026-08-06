// The one screen. The world fills it; a shutter shoots it; the strip along
// the bottom is the storyboard; the mini-map plans multi-camera setups.

import { useEffect, useMemo, useRef, useState } from "react";
import type { CapturedFrame } from "../model/types";
import { allShots, frameById, isImageWorld, newShot, nextShotNumber, uid } from "../model/types";
import { inferAngle, inferLensMm } from "../lib/inference";
import {
  captureFrame, getViewer, getWorldBboxXZ, onViewerKey, setViewerPose, VIEWER_PATH,
} from "../lib/viewerBridge";
import { DEMO_MODE, DEMO_SPZ, DEMO_VIEWER_HTML } from "../lib/demoViewer";
import { impliedEndPose } from "../lib/movement";
import { pathPoseAt, shouldKeepWaypoint } from "../lib/path";
import { db } from "../store/db";
import { primeImageCache, useImage, useProject } from "../store/useProject";
import PlanCanvas, { type BboxXZ, type PlannedCam, type ShotMark, yawOfQuat, yawQuat } from "../components/PlanCanvas";
import TakeReview, { type Take } from "../components/TakeReview";
import FilmStrip from "../components/FilmStrip";
import { IconBolt, IconCameraRig, IconFilm, IconMap, IconPath, IconPlay, IconShutter } from "../components/icons";
import { generateAll } from "../farm/generateShot";

const FALLBACK_BBOX: BboxXZ = { min: [-4, -4], max: [4, 4] };

export default function Stage({ onOpenShot, onPlay }: { onOpenShot: (shotId: string) => void; onPlay: () => void }) {
  const { project, dispatch } = useProject();
  // image mode: the set is a single reference image, no viewer to drive
  const imageWorld = isImageWorld(project.world);
  const refImg = useImage(project.world.imageId);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [planned, setPlanned] = useState<PlannedCam[]>([]);
  const [takes, setTakes] = useState<Take[] | null>(null);
  const [shooting, setShooting] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [bbox, setBbox] = useState<BboxXZ | null>(null);
  const [flashId, setFlashId] = useState(0); // shutter flash animation
  const [exportNote, setExportNote] = useState("");
  const nextNumRef = useRef(1);

  // path recording: walk the move, it becomes the shot's camera path
  const [recordingPath, setRecordingPath] = useState(false);
  const pathRec = useRef<{ poses: import("../model/types").Pose[]; cap: NonNullable<ReturnType<typeof captureFrame>>; startedAt: number; timer: number } | null>(null);

  const viewerSrc = useMemo(() => {
    const p = new URLSearchParams();
    p.set("spz", project.world.spzUrl);
    p.set("title", project.world.title);
    if (project.world.colliderUrl) p.set("collider", project.world.colliderUrl);
    return `${VIEWER_PATH}?${p.toString()}`;
  }, [project.world]);

  useEffect(() => {
    setBbox(null);
    if (imageWorld) return;
    const t = window.setInterval(() => {
      const b = getWorldBboxXZ(iframeRef.current);
      if (b) { setBbox(b); window.clearInterval(t); }
    }, 1000);
    return () => window.clearInterval(t);
  }, [viewerSrc, imageWorld]);

  const effBbox = useMemo<BboxXZ>(() => {
    if (bbox) return bbox;
    const pts = project.frames.map((f) => [f.pose.position[0], f.pose.position[2]] as [number, number]);
    if (!pts.length) return FALLBACK_BBOX;
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    return { min: [Math.min(...xs) - 3, Math.min(...zs) - 3], max: [Math.max(...xs) + 3, Math.max(...zs) + 3] };
  }, [bbox, project.frames]);

  const shotMarks = useMemo<ShotMark[]>(
    () =>
      allShots(project).flatMap(({ shot }, i) => {
        const f = frameById(project, shot.frameId);
        return f ? [{ label: String(i + 1), x: f.pose.position[0], z: f.pose.position[2], yaw: yawOfQuat(f.pose.quaternion) }] : [];
      }),
    [project],
  );

  const pathLines = useMemo(
    () =>
      allShots(project).flatMap(({ shot }) =>
        shot.pathPoses && shot.pathPoses.length >= 2
          ? [{ pts: shot.pathPoses.map((p) => [p.position[0], p.position[2]] as [number, number]) }]
          : [],
      ),
    [project],
  );

  // preview a shot's move in the world (dispatched from the frame overlay)
  useEffect(() => {
    const h = (e: Event) => {
      const shotId = (e as CustomEvent).detail?.shotId as string | undefined;
      const found = allShots(project).find((x) => x.shot.id === shotId);
      const w = iframeRef.current?.contentWindow as (Window & { __recording?: boolean }) | null;
      if (!found || !w || !getViewer(iframeRef.current)) return;
      const kf = frameById(project, found.shot.frameId);
      if (!kf) return;
      const poses = found.shot.pathPoses ?? [kf.pose, found.shot.endPose ?? impliedEndPose(found.shot.movement, kf.pose)];
      w.__recording = true;
      const t0 = performance.now();
      const durMs = found.shot.durationSec * 1000;
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / durMs);
        const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        setViewerPose(iframeRef.current, pathPoseAt(poses, ease));
        if (t < 1) requestAnimationFrame(step);
        else w.__recording = false;
      };
      requestAnimationFrame(step);
    };
    window.addEventListener("shotboard:preview-move", h);
    return () => window.removeEventListener("shotboard:preview-move", h);
  }, [project]);

  // Auto-bank coverage on first load of a world: a quiet 8-stop yaw ring at
  // the capture pose — FARM anchors exist before the user does anything.
  const autoScanned = useRef(false);
  useEffect(() => {
    if (imageWorld || !bbox || autoScanned.current || project.frames.length > 0) return;
    autoScanned.current = true;
    (async () => {
      const v = getViewer(iframeRef.current);
      const w = iframeRef.current?.contentWindow as (Window & { __recording?: boolean }) | null;
      if (!v || !w) return;
      setExportNote("scanning the set…");
      w.__recording = true;
      const p = v.camera.position, q = v.camera.quaternion;
      const orig = { position: [p.x, p.y, p.z] as [number, number, number], quaternion: [q.x, q.y, q.z, q.w] as [number, number, number, number] };
      try {
        for (let i = 0; i < 8; i++) {
          const yaw = (i / 8) * Math.PI * 2;
          setViewerPose(iframeRef.current, { position: orig.position, quaternion: yawQuat(yaw) });
          await new Promise((r) => setTimeout(r, 450));
          const cap = captureFrame(iframeRef.current);
          if (cap) await bankFrame(cap, `set ${Math.round((yaw * 180) / Math.PI)}°`);
        }
      } finally {
        setViewerPose(iframeRef.current, orig);
        w.__recording = false;
        setExportNote("");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox]);

  async function bankFrame(cap: NonNullable<ReturnType<typeof captureFrame>>, label: string): Promise<CapturedFrame> {
    const imageId = uid();
    primeImageCache(imageId, cap.dataUrl);
    await db.putImage(imageId, cap.dataUrl);
    const frame: CapturedFrame = {
      id: uid(), imageId, pose: cap.pose, fov: cap.fov, aspect: cap.aspect, label, capturedAt: Date.now(),
    };
    dispatch({ type: "addFrame", frame });
    return frame;
  }

  // THE verb. Shoot what you see → a shot lands on the strip. In image
  // mode every shot starts from the one reference frame — the shutter just
  // deals another card.
  async function shutter() {
    const scene = project.scenes[project.scenes.length - 1];
    const num = nextShotNumber(scene);
    if (imageWorld) {
      const ref = frameById(project, project.world.refFrameId);
      if (!ref) return;
      setFlashId((n) => n + 1);
      dispatch({
        type: "addShot",
        sceneId: scene.id,
        shot: {
          ...newShot(num),
          frameId: ref.id,
          contextFrameIds: [ref.id],
          lensMm: inferLensMm(ref.fov),
          angle: inferAngle(ref),
        },
      });
      return;
    }
    const cap = captureFrame(iframeRef.current);
    if (!cap) return;
    setFlashId((n) => n + 1);
    const frame = await bankFrame(cap, `shot ${num}`);
    dispatch({
      type: "addShot",
      sceneId: scene.id,
      shot: {
        ...newShot(num),
        frameId: frame.id,
        contextFrameIds: [frame.id],
        lensMm: inferLensMm(cap.fov),
        angle: inferAngle(frame),
      },
    });
  }

  // Record a camera path by walking it (borrowed concept: Marble camera
  // pathing, wlt#17114). Start = capture the keyframe; while recording, bank
  // a waypoint whenever the camera moves/turns enough; stop = a shot whose
  // duration is the real time walked and whose FARM targets follow the path.
  function togglePathRecord() {
    if (recordingPath) {
      const rec = pathRec.current;
      pathRec.current = null;
      setRecordingPath(false);
      if (!rec) return;
      window.clearInterval(rec.timer);
      finishPathShot(rec);
      return;
    }
    const cap = captureFrame(iframeRef.current);
    if (!cap) return;
    const state = { poses: [cap.pose], cap, startedAt: Date.now(), timer: 0 };
    state.timer = window.setInterval(() => {
      const c = captureFrame(iframeRef.current === null ? null : iframeRef.current);
      if (!c) return;
      const last = state.poses[state.poses.length - 1];
      if (shouldKeepWaypoint(last, c.pose)) state.poses.push(c.pose);
    }, 250);
    pathRec.current = state;
    setRecordingPath(true);
    setFlashId((n) => n + 1);
  }

  async function finishPathShot(rec: NonNullable<typeof pathRec.current>) {
    const durationSec = Math.max(1, Math.round(((Date.now() - rec.startedAt) / 1000) * 2) / 2);
    const scene = project.scenes[project.scenes.length - 1];
    const num = nextShotNumber(scene);
    const frame = await bankFrame(rec.cap, `shot ${num}`);
    dispatch({
      type: "addShot",
      sceneId: scene.id,
      shot: {
        ...newShot(num),
        frameId: frame.id,
        contextFrameIds: [frame.id],
        lensMm: inferLensMm(rec.cap.fov),
        angle: inferAngle(frame),
        durationSec,
        pathPoses: rec.poses.length >= 2 ? rec.poses : undefined,
        movement: rec.poses.length >= 2 ? "handheld" : "static",
      },
    });
  }

  // Flythrough export (borrowed concept: wlt#17114's video export): drive
  // the viewer through every shot's camera move in board order, recording
  // the canvas — the whole cut as one webm.
  async function exportFlythrough() {
    const v = getViewer(iframeRef.current);
    const w = iframeRef.current?.contentWindow as (Window & { __recording?: boolean }) | null;
    const shotsWithFrames = allShots(project).filter(({ shot }) => frameById(project, shot.frameId));
    if (!v || !w || !shotsWithFrames.length) return;
    const canvas = v.renderer.domElement as HTMLCanvasElement & { captureStream(fps: number): MediaStream };
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
    const p = v.camera.position, q = v.camera.quaternion;
    const orig = { position: [p.x, p.y, p.z] as [number, number, number], quaternion: [q.x, q.y, q.z, q.w] as [number, number, number, number] };
    w.__recording = true;
    rec.start();
    try {
      for (let i = 0; i < shotsWithFrames.length; i++) {
        const { shot } = shotsWithFrames[i];
        setExportNote(`exporting ${i + 1}/${shotsWithFrames.length}`);
        const kf = frameById(project, shot.frameId)!;
        const poses = shot.pathPoses ?? [kf.pose, shot.endPose ?? impliedEndPose(shot.movement, kf.pose)];
        const durMs = shot.durationSec * 1000;
        const t0 = performance.now();
        await new Promise<void>((resolve) => {
          const step = () => {
            const t = Math.min(1, (performance.now() - t0) / durMs);
            const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
            setViewerPose(iframeRef.current, pathPoseAt(poses, e));
            if (t < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        });
      }
    } finally {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.stop();
      });
      setViewerPose(iframeRef.current, orig);
      w.__recording = false;
      setExportNote("");
    }
    const blob = new Blob(chunks, { type: mime || "video/webm" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.title.replace(/[^\w-]+/g, "_") || "shotboard"}-flythrough.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // Multi-camera: shoot every planned camera, then triage.
  async function shootPlan() {
    const v = getViewer(iframeRef.current);
    const w = iframeRef.current?.contentWindow as (Window & { __recording?: boolean }) | null;
    if (!v || !w || !planned.length) return;
    setShooting(true);
    w.__recording = true;
    const p = v.camera.position, q = v.camera.quaternion;
    const orig = { position: [p.x, p.y, p.z] as [number, number, number], quaternion: [q.x, q.y, q.z, q.w] as [number, number, number, number] };
    const out: Take[] = [];
    try {
      for (const cam of planned) {
        setViewerPose(iframeRef.current, { position: [cam.x, 0, cam.z], quaternion: yawQuat(cam.yaw) });
        await new Promise((r) => setTimeout(r, 550));
        const cap = captureFrame(iframeRef.current);
        if (cap) out.push({ dataUrl: cap.dataUrl, pose: { position: [cam.x, 0, cam.z], quaternion: yawQuat(cam.yaw) }, fov: cap.fov, aspect: cap.aspect });
      }
    } finally {
      setViewerPose(iframeRef.current, orig);
      w.__recording = false;
      setShooting(false);
    }
    nextNumRef.current = parseInt(nextShotNumber(project.scenes[project.scenes.length - 1]), 10) || 1;
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
      id: uid(), imageId, pose: t.pose, fov: t.fov, aspect: t.aspect, label: `shot ${num}`, capturedAt: Date.now(),
    };
    dispatch({ type: "addFrame", frame });
    dispatch({
      type: "addShot",
      sceneId: scene.id,
      shot: {
        ...newShot(num),
        frameId: frame.id,
        contextFrameIds: [frame.id],
        lensMm: inferLensMm(t.fov),
        angle: inferAngle(frame),
      },
    });
  }

  function moveFlat(shotId: string, toFlatIndex: number) {
    const flat = allShots(project);
    const target = flat[Math.min(toFlatIndex, flat.length - 1)];
    if (!target) return;
    const idxInScene = target.scene.shots.findIndex((s) => s.id === target.shot.id);
    dispatch({ type: "moveShot", shotId, toSceneId: target.scene.id, toIndex: idxInScene });
  }

  // C inside the viewer = shutter (works in pointer lock); also hide the
  // embedded viewer's own chrome — the stage supplies the UI.
  const shutterRef = useRef(shutter);
  shutterRef.current = shutter;
  useEffect(() => {
    let un = () => {};
    const attach = () => {
      un();
      un = onViewerKey(iframeRef.current, "KeyC", () => shutterRef.current());
      const doc = iframeRef.current?.contentDocument;
      if (doc && !doc.getElementById("sb-hide")) {
        const st = doc.createElement("style");
        st.id = "sb-hide";
        st.textContent = "#info,#controls,#adjust,#hint{display:none!important}";
        doc.head?.appendChild(st);
      }
    };
    const iframe = iframeRef.current;
    iframe?.addEventListener("load", attach);
    const t = window.setTimeout(attach, 1500);
    return () => { un(); iframe?.removeEventListener("load", attach); window.clearTimeout(t); };
  }, [viewerSrc]);

  // image mode has no iframe to catch keys — C works at the window level
  useEffect(() => {
    if (!imageWorld) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code === "KeyC" && t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") shutterRef.current();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [imageWorld]);

  return (
    <div className="stage">
      {imageWorld ? (
        <div className="image-stage">{refImg && <img src={refImg} alt="" draggable={false} />}</div>
      ) : DEMO_MODE ? (
        <iframe ref={iframeRef} srcDoc={DEMO_VIEWER_HTML} title="world" />
      ) : (
        <iframe ref={iframeRef} src={viewerSrc} title="world" />
      )}

      <div key={flashId} className={flashId ? "shutter-flash" : ""} />

      {/* mini-map: click to expand, drag to place cameras, rig icon shoots */}
      {!imageWorld && (
      <div className={`minimap ${mapOpen ? "open" : ""}`}>
        <PlanCanvas
          bbox={effBbox}
          anchors={project.frames}
          shots={shotMarks}
          planned={planned}
          paths={pathLines}
          underlayUrl={project.world.minimapUrl}
          detail={mapOpen ? "full" : "mini"}
          onPlanned={(p) => { setPlanned(p); if (!mapOpen) setMapOpen(true); }}
        />
        {!mapOpen && <button className="map-hit" title="camera plan" onClick={() => setMapOpen(true)} />}
        {mapOpen && (
          <div className="map-ctl">
            <button
              className="ib bolt-red"
              title={planned.length ? `shoot ${planned.length} camera${planned.length === 1 ? "" : "s"}` : "place cameras: press + pull to aim"}
              disabled={!planned.length || shooting}
              onClick={shootPlan}
            >
              <IconCameraRig />
              {planned.length > 0 && <b>{planned.length}</b>}
            </button>
            <button className="ib" title="close map" onClick={() => { setMapOpen(false); setPlanned([]); }}>✕</button>
          </div>
        )}
      </div>
      )}

      {/* the imported world can't stream inside a hosted preview — say so
          (single images render fine anywhere) */}
      {DEMO_MODE && !imageWorld && project.world.spzUrl !== DEMO_SPZ && (
        <div className="demo-note">
          this preview renders the demo set — run the app locally (README) to shoot in “{project.world.title}”
        </div>
      )}

      {/* Figma-style floating toolbar — icons carry small labels; the
          viewer-driven tools (plan/path/export) only exist in world mode */}
      <div className="toolbar">
        {!imageWorld && (
          <button className={`ib ${mapOpen ? "on" : ""}`} title="floor plan — place cameras on the map" onClick={() => { setMapOpen(!mapOpen); if (mapOpen) setPlanned([]); }}>
            <IconMap /><span className="lbl">plan</span>
          </button>
        )}
        {!imageWorld && (
          <button
            className={`ib ${recordingPath ? "rec" : ""}`}
            title={recordingPath ? "stop — the walk becomes the shot" : "record a camera path: press, walk the move, press again"}
            onClick={togglePathRecord}
          >
            <IconPath /><span className="lbl">{recordingPath ? "stop" : "path"}</span>
          </button>
        )}
        <button className="shutter" title={imageWorld ? "new shot from this image (C)" : "shoot this frame (C)"} onClick={shutter}>
          <IconShutter />
        </button>
        <button
          className="ib bolt"
          title="FARM AR on every shot that has no footage yet"
          onClick={async () => {
            const [ok, failed] = await generateAll(project, dispatch);
            if (failed) alert(`${ok} submitted, ${failed} failed`);
          }}
        >
          <IconBolt /><span className="lbl">generate</span>
        </button>
        {!imageWorld && (
          <button className="ib" title="export the whole board as one flythrough (.webm)" onClick={exportFlythrough} disabled={!!exportNote}>
            <IconFilm /><span className="lbl">export</span>
          </button>
        )}
        <button className="ib" title="play the cut" onClick={onPlay}>
          <IconPlay /><span className="lbl">play</span>
        </button>
      </div>

      {exportNote && <div className="export-toast">{exportNote}</div>}
      {recordingPath && <div className="export-toast rec-toast">⏺ recording path — walk the move, press again to cut</div>}

      <FilmStrip project={project} activeShotId={null} onOpen={onOpenShot} onMove={moveFlat} />

      {takes && <TakeReview takes={takes} onAccept={acceptTake} onClose={() => setTakes(null)} />}
    </div>
  );
}

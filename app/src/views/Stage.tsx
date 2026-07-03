// The one screen. The world fills it; a shutter shoots it; the strip along
// the bottom is the storyboard; the mini-map plans multi-camera setups.

import { useEffect, useMemo, useRef, useState } from "react";
import type { CapturedFrame } from "../model/types";
import { allShots, frameById, newShot, nextShotNumber, uid } from "../model/types";
import { inferAngle, inferLensMm } from "../lib/inference";
import {
  captureFrame, getViewer, getWorldBboxXZ, onViewerKey, setViewerPose, VIEWER_PATH,
} from "../lib/viewerBridge";
import { DEMO_MODE, DEMO_VIEWER_HTML } from "../lib/demoViewer";
import { db } from "../store/db";
import { primeImageCache, useProject } from "../store/useProject";
import PlanCanvas, { type BboxXZ, type PlannedCam, type ShotMark, yawOfQuat, yawQuat } from "../components/PlanCanvas";
import TakeReview, { type Take } from "../components/TakeReview";
import FilmStrip from "../components/FilmStrip";
import { IconCameraRig, IconMap, IconPlay, IconShutter } from "../components/icons";

const FALLBACK_BBOX: BboxXZ = { min: [-4, -4], max: [4, 4] };

export default function Stage({ onOpenShot, onPlay }: { onOpenShot: (shotId: string) => void; onPlay: () => void }) {
  const { project, dispatch } = useProject();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [planned, setPlanned] = useState<PlannedCam[]>([]);
  const [takes, setTakes] = useState<Take[] | null>(null);
  const [shooting, setShooting] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [bbox, setBbox] = useState<BboxXZ | null>(null);
  const [flashId, setFlashId] = useState(0); // shutter flash animation
  const nextNumRef = useRef(1);

  const viewerSrc = useMemo(() => {
    const p = new URLSearchParams();
    p.set("spz", project.world.spzUrl);
    p.set("title", project.world.title);
    if (project.world.colliderUrl) p.set("collider", project.world.colliderUrl);
    return `${VIEWER_PATH}?${p.toString()}`;
  }, [project.world]);

  useEffect(() => {
    setBbox(null);
    const t = window.setInterval(() => {
      const b = getWorldBboxXZ(iframeRef.current);
      if (b) { setBbox(b); window.clearInterval(t); }
    }, 1000);
    return () => window.clearInterval(t);
  }, [viewerSrc]);

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

  // THE verb. Shoot what you see → a shot lands on the strip.
  async function shutter() {
    const cap = captureFrame(iframeRef.current);
    if (!cap) return;
    setFlashId((n) => n + 1);
    const scene = project.scenes[project.scenes.length - 1];
    const num = nextShotNumber(scene);
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

  return (
    <div className="stage">
      {DEMO_MODE ? (
        <iframe ref={iframeRef} srcDoc={DEMO_VIEWER_HTML} title="world" />
      ) : (
        <iframe ref={iframeRef} src={viewerSrc} title="world" />
      )}

      <div key={flashId} className={flashId ? "shutter-flash" : ""} />

      {/* mini-map: click to expand, drag to place cameras, rig icon shoots */}
      <div className={`minimap ${mapOpen ? "open" : ""}`}>
        <PlanCanvas
          bbox={effBbox}
          anchors={project.frames}
          shots={shotMarks}
          planned={planned}
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

      {/* Figma-style floating toolbar: map · shutter · play */}
      <div className="toolbar">
        <button className={`ib ${mapOpen ? "on" : ""}`} title="camera plan" onClick={() => { setMapOpen(!mapOpen); if (mapOpen) setPlanned([]); }}>
          <IconMap />
        </button>
        <button className="shutter" title="shoot this frame (C)" onClick={shutter}>
          <IconShutter />
        </button>
        <button className="ib" title="play the board" onClick={onPlay}>
          <IconPlay />
        </button>
      </div>

      <FilmStrip project={project} activeShotId={null} onOpen={onOpenShot} onMove={moveFlat} />

      {takes && <TakeReview takes={takes} onAccept={acceptTake} onClose={() => setTakes(null)} />}
    </div>
  );
}

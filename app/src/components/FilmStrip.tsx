// The storyboard as a film strip along the bottom of the stage. Shots
// accumulate as you shoot; grab a frame and slide it to re-cut (pointer
// drag — no native image-drag interference); click to open. A fresh take
// plays right in its thumbnail — circle or toss it without opening
// anything (dailies rhythm). Hover ✕ deletes.

import { useRef, useState } from "react";
import type { Project, Shot, Take } from "../model/types";
import { allShots, displayFrameId, frameById, reviewTake, takeStatus } from "../model/types";
import { MOVEMENT_GLYPH } from "../lib/movement";
import { useImage, useProject } from "../store/useProject";
import { IconCheck, IconClose } from "./icons";

const DOT_TITLE: Record<string, string> = {
  queued: "FARM queued", running: "FARM running", error: "FARM error",
  review: "take ready — circle or toss it", done: "circled take",
};

function StripFrame({ project, shot, index, active, lifted, over }: {
  project: Project;
  shot: Shot;
  index: number;
  active: boolean;
  lifted: boolean;
  over: boolean;
}) {
  const { dispatch } = useProject();
  const frame = frameById(project, displayFrameId(shot));
  const img = useImage(frame?.imageId);
  const dot = takeStatus(shot);
  const pending: Take | undefined = reviewTake(shot);
  const pendingVid = useImage(pending?.videoId);
  const pendingSrc = pending?.videoUrl ?? pendingVid;

  const setTakes = (takes: Take[]) => dispatch({ type: "updateShot", shotId: shot.id, patch: { takes } });
  const circle = () =>
    pending &&
    setTakes((shot.takes ?? []).map((t) =>
      t.id === pending.id ? { ...t, circled: true, rejected: false } : { ...t, circled: false },
    ));
  const toss = () =>
    pending &&
    setTakes((shot.takes ?? []).map((t) => (t.id === pending.id ? { ...t, rejected: true, circled: false } : t)));

  return (
    <div className={`strip-frame ${active ? "on" : ""} ${lifted ? "lift" : ""} ${over ? "dragover" : ""}`} data-idx={index}>
      {pendingSrc ? (
        <video src={pendingSrc} autoPlay muted loop draggable={false} />
      ) : img ? (
        <img src={img} alt="" draggable={false} />
      ) : (
        <span className="blank" />
      )}
      <span className="num">{index + 1}</span>
      <span className="meta">{shot.pathPoses ? "⤳" : MOVEMENT_GLYPH[shot.movement]} {shot.durationSec}s</span>
      {pendingSrc ? (
        <span className="strip-verdict">
          <button className="sv good" title="circle this take" onClick={circle}><IconCheck /></button>
          <button className="sv bad" title="toss this take" onClick={toss}><IconClose /></button>
        </span>
      ) : (
        dot && <span className={`dot ${dot}`} title={DOT_TITLE[dot]} />
      )}
      <button
        className="sf-del"
        title="delete shot"
        onClick={() => { if (confirm("Delete this shot?")) dispatch({ type: "deleteShot", shotId: shot.id }); }}
      >
        <IconClose />
      </button>
    </div>
  );
}

export default function FilmStrip({ project, activeShotId, onOpen, onMove }: {
  project: Project;
  activeShotId: string | null;
  onOpen: (shotId: string) => void;
  onMove: (shotId: string, toIndex: number) => void;
}) {
  const shots = allShots(project);
  const [drag, setDrag] = useState<{ shotId: string; from: number; over: number | null; live: boolean } | null>(null);
  const down = useRef<{ shotId: string; from: number; x: number; y: number } | null>(null);

  const frameAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest?.(".strip-frame") as HTMLElement | null;
    return el?.dataset.idx != null ? Number(el.dataset.idx) : null;
  };

  if (!shots.length) return null;
  return (
    <div
      className="strip"
      onPointerDown={(e) => {
        const t = e.target as Element;
        if (t.closest("button")) return; // verdict / delete buttons act alone
        const idx = frameAt(e.clientX, e.clientY);
        if (idx == null) return;
        down.current = { shotId: shots[idx].shot.id, from: idx, x: e.clientX, y: e.clientY };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = down.current;
        if (!d) return;
        if (!drag && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) {
          setDrag({ shotId: d.shotId, from: d.from, over: null, live: true });
        }
        if (drag) setDrag({ ...drag, over: frameAt(e.clientX, e.clientY) });
      }}
      onPointerUp={() => {
        const d = down.current;
        down.current = null;
        if (drag) {
          if (drag.over != null && drag.over !== drag.from) onMove(drag.shotId, drag.over);
          setDrag(null);
        } else if (d) {
          onOpen(d.shotId); // no movement = a click
        }
      }}
      onPointerCancel={() => { down.current = null; setDrag(null); }}
    >
      {shots.map(({ shot }, i) => (
        <StripFrame
          key={shot.id}
          project={project}
          shot={shot}
          index={i}
          active={shot.id === activeShotId}
          lifted={drag?.shotId === shot.id}
          over={drag != null && drag.over === i && drag.shotId !== shot.id}
        />
      ))}
    </div>
  );
}

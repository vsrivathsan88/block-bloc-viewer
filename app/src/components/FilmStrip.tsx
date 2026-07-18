// The storyboard as a film strip along the bottom of the stage. Shots
// accumulate as you shoot; drag to re-cut; click to open a frame. A fresh
// take plays right in its thumbnail — circle or toss it without opening
// anything (dailies rhythm).

import type { Project, Shot, Take } from "../model/types";
import { allShots, displayFrameId, frameById, reviewTake, takeStatus } from "../model/types";
import { MOVEMENT_GLYPH } from "../lib/movement";
import { useImage, useProject } from "../store/useProject";
import { IconCheck, IconClose } from "./icons";

const DOT_TITLE: Record<string, string> = {
  queued: "FARM queued", running: "FARM running", error: "FARM error",
  review: "take ready — circle or toss it", done: "circled take",
};

function StripFrame({ project, shot, index, active, onOpen, onMove }: {
  project: Project;
  shot: Shot;
  index: number;
  active: boolean;
  onOpen: () => void;
  onMove: (fromShotId: string, toIndex: number) => void;
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
    <div
      className={`strip-frame ${active ? "on" : ""}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("shotId", shot.id)}
      onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("dragover"); }}
      onDragLeave={(e) => e.currentTarget.classList.remove("dragover")}
      onDrop={(e) => {
        e.currentTarget.classList.remove("dragover");
        const id = e.dataTransfer.getData("shotId");
        if (id && id !== shot.id) onMove(id, index);
      }}
      onClick={onOpen}
    >
      {pendingSrc ? (
        <video src={pendingSrc} autoPlay muted loop />
      ) : img ? (
        <img src={img} alt="" />
      ) : (
        <span className="blank" />
      )}
      <span className="num">{index + 1}</span>
      <span className="meta">{shot.pathPoses ? "⤳" : MOVEMENT_GLYPH[shot.movement]} {shot.durationSec}s</span>
      {pendingSrc ? (
        <span className="strip-verdict" onClick={(e) => e.stopPropagation()}>
          <button className="sv good" title="circle this take" onClick={circle}><IconCheck /></button>
          <button className="sv bad" title="toss this take" onClick={toss}><IconClose /></button>
        </span>
      ) : (
        dot && <span className={`dot ${dot}`} title={DOT_TITLE[dot]} />
      )}
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
  if (!shots.length) return null;
  return (
    <div className="strip">
      {shots.map(({ shot }, i) => (
        <StripFrame
          key={shot.id}
          project={project}
          shot={shot}
          index={i}
          active={shot.id === activeShotId}
          onOpen={() => onOpen(shot.id)}
          onMove={onMove}
        />
      ))}
    </div>
  );
}

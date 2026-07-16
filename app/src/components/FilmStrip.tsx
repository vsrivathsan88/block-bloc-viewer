// The storyboard as a film strip along the bottom of the stage. Shots
// accumulate as you shoot; drag to re-cut; click to open a frame.

import type { Project, Shot } from "../model/types";
import { allShots, displayFrameId, frameById } from "../model/types";
import { MOVEMENT_GLYPH } from "../lib/movement";
import { useImage } from "../store/useProject";

function StripFrame({ project, shot, index, active, onOpen, onMove }: {
  project: Project;
  shot: Shot;
  index: number;
  active: boolean;
  onOpen: () => void;
  onMove: (fromShotId: string, toIndex: number) => void;
}) {
  const frame = frameById(project, displayFrameId(shot));
  const img = useImage(frame?.imageId);
  const farm = shot.farm;
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
      {img ? <img src={img} alt="" /> : <span className="blank" />}
      <span className="num">{index + 1}</span>
      <span className="meta">{shot.pathPoses ? "⤳" : MOVEMENT_GLYPH[shot.movement]} {shot.durationSec}s</span>
      {farm && <span className={`dot ${farm.status}`} title={`FARM ${farm.status}`} />}
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

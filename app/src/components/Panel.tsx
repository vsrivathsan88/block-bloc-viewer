// One storyboard panel on the board: keyframe (pencil-filtered), sketch
// overlay, slate strip (shot number, movement, duration), FARM status dot.

import type { Project, SceneGroup, Shot } from "../model/types";
import { displayFrameId, frameById } from "../model/types";
import { MOVEMENT_GLYPH, movementFamily } from "../lib/movement";
import { useImage } from "../store/useProject";
import StrokesSvg from "./StrokesSvg";

interface Props {
  project: Project;
  scene: SceneGroup;
  shot: Shot;
  onOpen: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}

export default function Panel({ project, scene, shot, onOpen, draggable, onDragStart, onDrop }: Props) {
  const frame = frameById(project, displayFrameId(shot));
  const img = useImage(frame?.imageId);
  return (
    <div
      className="panel"
      onClick={onOpen}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("dragover"); }}
      onDragLeave={(e) => e.currentTarget.classList.remove("dragover")}
      onDrop={(e) => { e.currentTarget.classList.remove("dragover"); onDrop?.(e); }}
    >
      <div className="img-wrap">
        {img ? (
          <img className="keyframe" src={img} alt={`shot ${shot.number}`} />
        ) : (
          <div className="empty">no frame — scout it</div>
        )}
        {shot.strokes.length > 0 && <StrokesSvg strokes={shot.strokes} />}
        {shot.farm && (
          <span className={`farm-dot ${shot.farm.status}`}>
            {shot.farm.status === "done" ? (shot.farm.videoUrl ? "FARM ✓" : "FARM (sim)") : `FARM ${shot.farm.status}`}
          </span>
        )}
      </div>
      <div className="slate">
        <span className="no">{scene.number}·{shot.number}</span>
        <span className={`move-chip ${movementFamily(shot.movement)}`}>
          {MOVEMENT_GLYPH[shot.movement]} {shot.movement}
        </span>
        <span className="dur">{shot.lensMm}mm · {shot.durationSec}s</span>
      </div>
    </div>
  );
}

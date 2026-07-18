// The board view: the same document as the strip, but readable — big
// panels with captions and dialogue under each frame. Captions edit inline;
// drag to re-cut; click a frame to open it.

import type { Project, Shot } from "../model/types";
import { allShots, displayFrameId, fmtRuntime, frameById, takeStatus, totalRuntime } from "../model/types";
import { MOVEMENT_GLYPH, movementFamily } from "../lib/movement";
import { useImage, useProject } from "../store/useProject";
import StrokesSvg from "./StrokesSvg";

function BoardCard({ project, shot, index, onOpen, onMove }: {
  project: Project;
  shot: Shot;
  index: number;
  onOpen: () => void;
  onMove: (fromShotId: string, toIndex: number) => void;
}) {
  const { dispatch } = useProject();
  const frame = frameById(project, displayFrameId(shot));
  const img = useImage(frame?.imageId);
  return (
    <div
      className="board-card"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("shotId", shot.id)}
      onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("dragover"); }}
      onDragLeave={(e) => e.currentTarget.classList.remove("dragover")}
      onDrop={(e) => {
        e.currentTarget.classList.remove("dragover");
        const id = e.dataTransfer.getData("shotId");
        if (id && id !== shot.id) onMove(id, index);
      }}
    >
      <div className="bc-img" onClick={onOpen}>
        {img && <img src={img} alt="" />}
        {shot.strokes.length > 0 && <StrokesSvg strokes={shot.strokes} />}
        {takeStatus(shot) && <span className={`dot ${takeStatus(shot)}`} />}
      </div>
      <div className="bc-slate">
        <b>{index + 1}</b>
        <span className={`move-tag ${movementFamily(shot.movement)}`}>{MOVEMENT_GLYPH[shot.movement]} {shot.movement}</span>
        <span className="bc-dur">{shot.lensMm}mm · {shot.durationSec}s</span>
      </div>
      <input
        className="bc-caption"
        placeholder="caption…"
        value={shot.action}
        onChange={(e) => dispatch({ type: "updateShot", shotId: shot.id, patch: { action: e.target.value } })}
      />
      <input
        className="bc-dialogue"
        placeholder="“dialogue…”"
        value={shot.dialogue}
        onChange={(e) => dispatch({ type: "updateShot", shotId: shot.id, patch: { dialogue: e.target.value } })}
      />
    </div>
  );
}

export default function BoardSheet({ onOpenShot }: { onOpenShot: (shotId: string) => void }) {
  const { project, dispatch } = useProject();
  const shots = allShots(project);

  function moveFlat(shotId: string, toFlatIndex: number) {
    const target = shots[Math.min(toFlatIndex, shots.length - 1)];
    if (!target) return;
    const idxInScene = target.scene.shots.findIndex((s) => s.id === target.shot.id);
    dispatch({ type: "moveShot", shotId, toSceneId: target.scene.id, toIndex: idxInScene });
  }

  return (
    <div className="board-sheet">
      <div className="board-grid">
        {shots.map(({ shot }, i) => (
          <BoardCard key={shot.id} project={project} shot={shot} index={i} onOpen={() => onOpenShot(shot.id)} onMove={moveFlat} />
        ))}
        {!shots.length && <div className="board-empty">no shots yet — switch to the stage and hit the shutter</div>}
      </div>
      {shots.length > 0 && <div className="board-total">{fmtRuntime(totalRuntime(project))}</div>}
    </div>
  );
}

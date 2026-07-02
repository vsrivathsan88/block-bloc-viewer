// The board: scenes as rows of pinned panels. Drag to re-cut the sequence.

import { allShots } from "../model/types";
import { useProject } from "../store/useProject";
import Panel from "../components/Panel";

export default function BoardView({ onOpenShot, onGoScout }: { onOpenShot: (shotId: string) => void; onGoScout: () => void }) {
  const { project, dispatch } = useProject();

  if (allShots(project).length === 0) {
    return (
      <div className="empty-board">
        <div className="big-hand">Every picture starts with a walk through the set.</div>
        <div className="steps">
          <span className="step-pill"><b>1</b> scout the world</span>
          <span className="step-pill"><b>2</b> mark IN on a composition</span>
          <span className="step-pill"><b>3</b> panels land here</span>
        </div>
        <button className="teal big" style={{ maxWidth: 260 }} onClick={onGoScout}>
          🥾 go scout the set
        </button>
      </div>
    );
  }

  return (
    <div className="board">
      {project.scenes.map((scene) => (
        <div key={scene.id} className="scene-block">
          <div className="scene-head">
            <span className="scene-no">{scene.number}</span>
            <input
              value={scene.heading}
              onChange={(e) => dispatch({ type: "updateScene", sceneId: scene.id, patch: { heading: e.target.value } })}
              placeholder="INT. SOMEWHERE — DAY"
            />
            <button
              className="ghost"
              onClick={() => {
                if (scene.shots.length === 0 || confirm(`Delete scene ${scene.number} and its ${scene.shots.length} shot(s)?`)) {
                  dispatch({ type: "deleteScene", sceneId: scene.id });
                }
              }}
            >
              ✕
            </button>
          </div>
          <div
            className="panels"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              // drop on empty scene space → append at end
              const shotId = e.dataTransfer.getData("shotId");
              if (shotId) dispatch({ type: "moveShot", shotId, toSceneId: scene.id, toIndex: scene.shots.length });
            }}
          >
            {scene.shots.map((shot, idx) => (
              <Panel
                key={shot.id}
                project={project}
                scene={scene}
                shot={shot}
                onOpen={() => onOpenShot(shot.id)}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("shotId", shot.id)}
                onDrop={(e) => {
                  e.stopPropagation();
                  const shotId = e.dataTransfer.getData("shotId");
                  if (shotId && shotId !== shot.id) {
                    dispatch({ type: "moveShot", shotId, toSceneId: scene.id, toIndex: idx });
                  }
                }}
              />
            ))}
            <div className="panel" style={{ boxShadow: "none", border: "none", background: "transparent" }}>
              <button className="add-shot" onClick={() => dispatch({ type: "addShot", sceneId: scene.id })}>
                + shot
              </button>
            </div>
          </div>
        </div>
      ))}
      <button className="ghost add-scene" onClick={() => dispatch({ type: "addScene" })}>
        + scene
      </button>
    </div>
  );
}

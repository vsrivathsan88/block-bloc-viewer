// The board: scenes as rows of pinned panels. Drag to re-cut the sequence.

import { useProject } from "../store/useProject";
import Panel from "../components/Panel";

export default function BoardView({ onOpenShot }: { onOpenShot: (shotId: string) => void }) {
  const { project, dispatch } = useProject();

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

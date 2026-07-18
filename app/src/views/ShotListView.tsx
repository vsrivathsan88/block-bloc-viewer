// The shooting plan: every shot numbered and specified. Print it.

import type { Project } from "../model/types";
import { circledTake, fmtRuntime, frameById, reviewTake, shotTakes, totalRuntime } from "../model/types";
import { useImage, useProject } from "../store/useProject";

function Thumb({ project, frameId }: { project: Project; frameId?: string }) {
  const frame = frameById(project, frameId);
  const img = useImage(frame?.imageId);
  return img ? <img src={img} alt="" /> : <span>—</span>;
}

export default function ShotListView({ onOpenShot }: { onOpenShot: (shotId: string) => void }) {
  const { project } = useProject();
  return (
    <div className="shotlist">
      <button className="print-btn ghost" onClick={() => window.print()}>⎙ print shot list</button>
      <table>
        <thead>
          <tr>
            <th>Shot</th>
            <th>Frame</th>
            <th>Lens</th>
            <th>Angle</th>
            <th>Movement</th>
            <th>Dur</th>
            <th>Action / Dialogue</th>
            <th>Notes</th>
            <th>FARM</th>
          </tr>
        </thead>
        <tbody>
          {project.scenes.map((scene) => (
            [
              <tr key={scene.id} className="scene-row">
                <td colSpan={9}>SC {scene.number} — {scene.heading}</td>
              </tr>,
              ...scene.shots.map((shot) => (
                <tr key={shot.id} onClick={() => onOpenShot(shot.id)} style={{ cursor: "pointer" }}>
                  <td>{scene.number}·{shot.number}</td>
                  <td><Thumb project={project} frameId={shot.castFrameId ?? shot.frameId} /></td>
                  <td>{shot.lensMm}mm</td>
                  <td>{shot.angle}</td>
                  <td>{shot.movement}{shot.endPose ? " (marked)" : ""}</td>
                  <td>{shot.durationSec}s</td>
                  <td>
                    {shot.action}
                    {shot.dialogue && <div style={{ fontStyle: "italic" }}>“{shot.dialogue}”</div>}
                  </td>
                  <td>{shot.notes}</td>
                  <td>
                    {circledTake(shot)
                      ? `◉ T${shotTakes(shot).findIndex((t) => t.circled) + 1}`
                      : reviewTake(shot)
                        ? "review"
                        : shot.farm
                          ? shot.farm.status
                          : "—"}
                  </td>
                </tr>
              )),
            ]
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={9} style={{ textAlign: "right", fontWeight: "bold" }}>
              total runtime {fmtRuntime(totalRuntime(project))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

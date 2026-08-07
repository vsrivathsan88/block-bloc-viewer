// Infer what the system already knows so the UI never asks for it:
// angle from the captured pose, lens from the fov, FARM context from
// anchor proximity.

import type { Angle, CapturedFrame, Project, Shot, Vec3 } from "../model/types";
import { frameById, LENSES } from "../model/types";
import { qRotate } from "./pose";

export function inferAngle(frame: CapturedFrame): Angle {
  const f = qRotate(frame.pose.quaternion, [0, 0, -1]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, f[1])));
  if (pitch < -0.7) return "overhead";
  if (pitch < -0.28) return "high";
  if (pitch > 0.28) return "low";
  return "eye-level";
}

/** Full-frame-equivalent focal length from vertical fov (24mm sensor height),
 * snapped to the standard lens set. */
export function inferLensMm(fovDeg: number): number {
  const mm = 12 / Math.tan((fovDeg * Math.PI) / 360);
  return LENSES.reduce((a, b) => (Math.abs(b - mm) < Math.abs(a - mm) ? b : a));
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Auto-pick FARM context: the shot's keyframe plus its nearest ≤3 other
 * anchors, ordered farthest → nearest with the keyframe LAST (the model
 * weights recent positions most). Users never curate this; it just works.
 * `eligible` narrows the candidate pool (e.g. image mode excludes frames
 * sitting at the keyframe's own pose — same pose + different content is
 * contradictory conditioning). */
export function autoContextIds(
  project: Project,
  shot: Shot,
  max = 3,
  eligible?: (f: CapturedFrame) => boolean,
): string[] {
  const key = frameById(project, shot.frameId);
  if (!key) return shot.contextFrameIds;
  const near = project.frames
    .filter((f) => f.id !== key.id && f.id !== shot.castFrameId && (!eligible || eligible(f)))
    .map((f) => ({ id: f.id, d: dist(f.pose.position, key.pose.position) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .reverse() // farthest first, nearest just before the keyframe
    .map((x) => x.id);
  return [...near, key.id];
}

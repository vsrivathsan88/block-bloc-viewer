// Anchor harvesting — the loop that makes image mode 3D-consistent ACROSS
// shots, not just within them. Every generated frame has a camera we chose
// (we sent the targetCameras), so a circled take's final frame is a posed
// spatial anchor for free. Bank it and the next shot's auto-context picks
// it up by proximity: the model reconstructs the same scene instead of
// re-dreaming it. The world grows out of one image.

import type { Project, Shot, Take } from "../model/types";
import { frameById, isImageWorld, uid } from "../model/types";
import type { CapturedFrame } from "../model/types";
import { impliedEndPose } from "../lib/movement";
import { shouldKeepWaypoint } from "../lib/path";
import { lastFrameOf } from "../lib/videoFrame";
import { db } from "../store/db";
import { getImageData, primeImageCache } from "../store/useProject";
import type { Action } from "../store/useProject";

/** Where the camera ends after this shot — the last target we sent. */
export function shotEndPose(project: Project, shot: Shot) {
  const kf = frameById(project, shot.frameId);
  if (!kf) return null;
  if (shot.pathPoses && shot.pathPoses.length >= 2) return shot.pathPoses[shot.pathPoses.length - 1];
  return shot.endPose ?? impliedEndPose(shot.movement, kf.pose);
}

/** On circling a take (image mode): bank its end frame as a new anchor,
 * unless an existing anchor already covers that pose (near-duplicate poses
 * with different content are contradictory conditioning). Fire-and-forget. */
export async function harvestCircledTake(
  project: Project,
  shot: Shot,
  take: Take,
  dispatch: React.Dispatch<Action>,
): Promise<void> {
  try {
    if (!isImageWorld(project.world)) return;
    const endPose = shotEndPose(project, shot);
    if (!endPose) return;
    // pose already covered by an existing anchor? skip (also stops re-harvest)
    if (project.frames.some((f) => !shouldKeepWaypoint(f.pose, endPose))) return;
    const src = take.videoUrl ?? (take.videoId ? await getImageData(take.videoId) : undefined);
    if (!src) return;
    const dataUrl = await lastFrameOf(src);
    if (!dataUrl) return; // CORS-tainted remote video — anchor skipped, shot unaffected
    const kf = frameById(project, shot.frameId);
    const imageId = uid();
    primeImageCache(imageId, dataUrl);
    await db.putImage(imageId, dataUrl);
    const frame: CapturedFrame = {
      id: uid(),
      imageId,
      pose: endPose,
      fov: kf?.fov ?? 55,
      aspect: kf?.aspect ?? 16 / 9,
      label: `shot ${shot.number} end`,
      capturedAt: Date.now(),
    };
    dispatch({ type: "addFrame", frame });
  } catch {
    // harvesting is opportunistic — a failure never blocks the circle
  }
}

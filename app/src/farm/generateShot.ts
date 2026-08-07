// One place that turns a shot into a FARM AR submission — used by the frame
// overlay's ⚡ and by "generate all". Every (re)generation bumps the seed
// offset so retakes explore instead of reproducing (seed defaults to 42 and
// the servable is deterministic per the spec).

import type { Project, Shot } from "../model/types";
import { frameById, shotTakes } from "../model/types";
import type { Action } from "../store/useProject";
import { getImageData } from "../store/useProject";
import { autoContextIds } from "../lib/inference";
import { impliedEndPose } from "../lib/movement";
import { shouldKeepWaypoint } from "../lib/path";
import { buildPrompt } from "./prompt";
import { buildFarmArRequest, loadFarmConfig, submitFarmAr } from "./client";

export async function generateShot(
  project: Project,
  shot: Shot,
  dispatch: React.Dispatch<Action>,
): Promise<void> {
  const cleanFrame = frameById(project, shot.frameId);
  if (!cleanFrame) throw new Error("no frame yet");
  const keyframe = frameById(project, shot.castFrameId) ?? cleanFrame;
  const cfg = loadFarmConfig();

  const baseIds = autoContextIds(
    project, shot, 3,
    project.world.kind === "image" && cleanFrame
      ? (f) => shouldKeepWaypoint(f.pose, cleanFrame.pose)
      : undefined,
  );
  const ids = baseIds.map((id) =>
    id === shot.frameId && shot.castFrameId ? shot.castFrameId : id,
  );
  const ctx = [];
  for (const id of ids) {
    const f = frameById(project, id);
    const dataUrl = f && (await getImageData(f.imageId));
    if (f && dataUrl) ctx.push({ frame: f, imageDataUrl: dataUrl });
  }
  if (!ctx.length) throw new Error("no context frames");

  const seedOffset = (shot.farm?.seedOffset ?? -1) + 1;
  const prompt = buildPrompt(shot, {
    set: project.world.caption,
    withAction: !!shot.castFrameId, // gate action on a cast plate
  });
  const body = buildFarmArRequest({
    prompt,
    contextFrames: ctx,
    startPose: keyframe.pose,
    endPose: shot.endPose ?? impliedEndPose(shot.movement, keyframe.pose),
    path: shot.pathPoses,
    fovDeg: keyframe.fov,
    frameCount: Math.round(shot.durationSec * cfg.fps),
    width: Math.round(480 * (keyframe.aspect || 16 / 9)),
    height: 480,
    cfg: { ...cfg, seed: cfg.seed + seedOffset },
  });
  const handle = await submitFarmAr(cfg, body);
  dispatch({
    type: "updateShot",
    shotId: shot.id,
    patch: {
      farm: {
        taskId: handle.taskId,
        mock: handle.mock,
        status: "queued",
        prompt,
        contextFrameIds: ids,
        frameCount: body.targetFrameCount as number,
        submittedAt: Date.now(),
        seedOffset,
      },
    },
  });
}

/** Submit every framed shot that isn't already in flight or finished with
 * footage. Returns [submitted, failed]. */
export async function generateAll(
  project: Project,
  dispatch: React.Dispatch<Action>,
): Promise<[number, number]> {
  let ok = 0, failed = 0;
  for (const scene of project.scenes) {
    for (const shot of scene.shots) {
      if (!shot.frameId) continue;
      const st = shot.farm?.status;
      if (st === "queued" || st === "running") continue;
      if (shotTakes(shot).some((t) => !t.rejected)) continue; // has footage
      try {
        await generateShot(project, shot, dispatch);
        ok++;
      } catch {
        failed++;
      }
    }
  }
  return [ok, failed];
}

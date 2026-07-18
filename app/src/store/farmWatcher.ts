// App-level watcher for in-flight FARM generations. Shots keep generating
// after their overlay closes; the strip's status dot is the UI. A finished
// generation lands as a new take awaiting a circle-or-toss verdict.

import { useEffect, useRef } from "react";
import type { Project, Shot, Take } from "../model/types";
import { allShots, displayFrameId, frameById, uid } from "../model/types";
import { loadFarmConfig, pollFarmAr } from "../farm/client";
import { renderMockTake } from "../farm/mockFootage";
import { db } from "./db";
import { getImageData, primeImageCache } from "./useProject";
import type { Action } from "./useProject";

async function buildTake(project: Project, shot: Shot, videoUrl: string | undefined): Promise<Take> {
  const take: Take = {
    id: uid(),
    videoUrl,
    prompt: shot.farm?.prompt ?? "",
    seedOffset: shot.farm?.seedOffset ?? 0,
    generatedAt: Date.now(),
  };
  if (!videoUrl) {
    // mock mode returns no footage — render the ken-burns pencil test to webm
    const frame = frameById(project, displayFrameId(shot));
    const img = frame && (await getImageData(frame.imageId));
    if (img) {
      const dataUrl = await renderMockTake(img, shot.movement, shot.durationSec);
      const videoId = uid();
      primeImageCache(videoId, dataUrl);
      await db.putImage(videoId, dataUrl);
      take.videoId = videoId;
    }
  }
  return take;
}

export function useFarmWatcher(project: Project | null, dispatch: React.Dispatch<Action>) {
  const projectRef = useRef(project);
  projectRef.current = project;
  const polling = useRef(new Set<string>());

  useEffect(() => {
    const t = window.setInterval(async () => {
      const p = projectRef.current;
      if (!p) return;
      const cfg = loadFarmConfig();
      for (const { shot } of allShots(p)) {
        const farm = shot.farm;
        if (!farm || (farm.status !== "queued" && farm.status !== "running")) continue;
        if (polling.current.has(farm.taskId)) continue;
        polling.current.add(farm.taskId);
        try {
          const res = await pollFarmAr(cfg, { taskId: farm.taskId, mock: !!farm.mock });
          const current = projectRef.current;
          const stillShot = current && allShots(current).find((x) => x.shot.id === shot.id)?.shot;
          const still = stillShot?.farm;
          if (!current || !stillShot || !still || still.taskId !== farm.taskId) continue;
          if (res.status === "done") {
            const take = await buildTake(current, stillShot, res.videoUrl);
            dispatch({
              type: "updateShot",
              shotId: shot.id,
              patch: {
                farm: { ...still, status: "done", videoUrl: res.videoUrl, phase: undefined },
                takes: [...(stillShot.takes ?? []), take],
              },
            });
          } else if (res.status === "error") {
            dispatch({
              type: "updateShot",
              shotId: shot.id,
              patch: { farm: { ...still, status: "error", error: res.error, phase: undefined } },
            });
          } else if (res.status !== still.status || res.phase !== still.phase) {
            dispatch({
              type: "updateShot",
              shotId: shot.id,
              patch: { farm: { ...still, status: res.status, phase: res.phase } },
            });
          }
        } finally {
          polling.current.delete(farm.taskId);
        }
      }
    }, 1500);
    return () => window.clearInterval(t);
  }, [dispatch]);
}

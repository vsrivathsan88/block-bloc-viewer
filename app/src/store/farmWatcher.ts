// App-level watcher for in-flight FARM generations. Shots keep generating
// after their overlay closes; the strip's status dot is the UI.

import { useEffect, useRef } from "react";
import type { Project } from "../model/types";
import { allShots } from "../model/types";
import { loadFarmConfig, pollFarmAr } from "../farm/client";
import type { Action } from "./useProject";

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
          const still = current && allShots(current).find((x) => x.shot.id === shot.id)?.shot.farm;
          if (!still || still.taskId !== farm.taskId) continue;
          if (res.status === "done" || res.status === "error") {
            dispatch({
              type: "updateShot",
              shotId: shot.id,
              patch: { farm: { ...still, status: res.status, videoUrl: res.videoUrl, error: res.error, phase: undefined } },
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

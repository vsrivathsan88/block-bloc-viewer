// Project state: single active project, reducer + IndexedDB persistence.

import { createContext, useContext, useEffect, useReducer, useRef } from "react";
import type { CapturedFrame, Pose, Project, SceneGroup, Shot } from "../model/types";
import { newScene, newShot, nextShotNumber, uid } from "../model/types";
import { db } from "./db";

export type Action =
  | { type: "load"; project: Project }
  | { type: "rename"; title: string }
  | { type: "addFrame"; frame: CapturedFrame }
  | { type: "renameFrame"; frameId: string; label: string }
  | { type: "deleteFrame"; frameId: string }
  | { type: "addScene" }
  | { type: "updateScene"; sceneId: string; patch: Partial<SceneGroup> }
  | { type: "deleteScene"; sceneId: string }
  | { type: "addShot"; sceneId: string; shot?: Shot }
  | { type: "updateShot"; shotId: string; patch: Partial<Shot> }
  | { type: "deleteShot"; shotId: string }
  | { type: "moveShot"; shotId: string; toSceneId: string; toIndex: number }
  | { type: "setShotEndPose"; shotId: string; endPose: Pose | undefined };

function mapShots(p: Project, shotId: string, fn: (s: Shot) => Shot): Project {
  return {
    ...p,
    scenes: p.scenes.map((sc) => ({
      ...sc,
      shots: sc.shots.map((s) => (s.id === shotId ? fn(s) : s)),
    })),
  };
}

function reducer(state: Project | null, action: Action): Project | null {
  if (action.type === "load") return action.project;
  if (!state) return state;
  const touch = (p: Project): Project => ({ ...p, updatedAt: Date.now() });
  switch (action.type) {
    case "rename":
      return touch({ ...state, title: action.title });
    case "addFrame":
      return touch({ ...state, frames: [...state.frames, action.frame] });
    case "renameFrame":
      return touch({
        ...state,
        frames: state.frames.map((f) => (f.id === action.frameId ? { ...f, label: action.label } : f)),
      });
    case "deleteFrame":
      return touch({
        ...state,
        frames: state.frames.filter((f) => f.id !== action.frameId),
        scenes: state.scenes.map((sc) => ({
          ...sc,
          shots: sc.shots.map((s) => ({
            ...s,
            frameId: s.frameId === action.frameId ? undefined : s.frameId,
            contextFrameIds: s.contextFrameIds.filter((id) => id !== action.frameId),
          })),
        })),
      });
    case "addScene":
      return touch({ ...state, scenes: [...state.scenes, newScene(state.scenes.length + 1)] });
    case "updateScene":
      return touch({
        ...state,
        scenes: state.scenes.map((sc) => (sc.id === action.sceneId ? { ...sc, ...action.patch } : sc)),
      });
    case "deleteScene":
      return touch({ ...state, scenes: state.scenes.filter((sc) => sc.id !== action.sceneId) });
    case "addShot":
      return touch({
        ...state,
        scenes: state.scenes.map((sc) =>
          sc.id === action.sceneId
            ? { ...sc, shots: [...sc.shots, action.shot ?? newShot(nextShotNumber(sc))] }
            : sc,
        ),
      });
    case "updateShot":
      return touch(mapShots(state, action.shotId, (s) => ({ ...s, ...action.patch })));
    case "setShotEndPose":
      return touch(mapShots(state, action.shotId, (s) => ({ ...s, endPose: action.endPose })));
    case "deleteShot":
      return touch({
        ...state,
        scenes: state.scenes.map((sc) => ({ ...sc, shots: sc.shots.filter((s) => s.id !== action.shotId) })),
      });
    case "moveShot": {
      let moved: Shot | undefined;
      const without = state.scenes.map((sc) => ({
        ...sc,
        shots: sc.shots.filter((s) => {
          if (s.id === action.shotId) { moved = s; return false; }
          return true;
        }),
      }));
      if (!moved) return state;
      return touch({
        ...state,
        scenes: without.map((sc) => {
          if (sc.id !== action.toSceneId) return sc;
          const shots = [...sc.shots];
          shots.splice(Math.min(action.toIndex, shots.length), 0, moved!);
          return { ...sc, shots };
        }),
      });
    }
  }
}

const LAST_PROJECT_KEY = "shotboard.lastProjectId";

export function useProjectReducer() {
  const [project, dispatch] = useReducer(reducer, null);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!project) return;
    localStorage.setItem(LAST_PROJECT_KEY, project.id);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      db.putProject(project.id, project).catch((e) => console.error("save failed", e));
    }, 400);
    return () => window.clearTimeout(saveTimer.current);
  }, [project]);

  return { project, dispatch };
}

export async function loadLastProject(): Promise<Project | null> {
  const id = localStorage.getItem(LAST_PROJECT_KEY);
  if (id) {
    const p = (await db.getProject(id)) as Project | undefined;
    if (p) return p;
  }
  const all = (await db.listProjects()) as Project[];
  if (all.length) return all.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return null;
}

export interface ProjectCtx {
  project: Project;
  dispatch: React.Dispatch<Action>;
}

export const ProjectContext = createContext<ProjectCtx | null>(null);

export function useProject(): ProjectCtx {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject outside provider");
  return ctx;
}

/** Resolve + cache captured-frame images from IndexedDB. */
const imageCache = new Map<string, string>();

export function useImage(imageId?: string): string | undefined {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const cached = imageId ? imageCache.get(imageId) : undefined;
  useEffect(() => {
    if (!imageId || imageCache.has(imageId)) return;
    let alive = true;
    db.getImage(imageId).then((url) => {
      if (alive && url) {
        imageCache.set(imageId, url);
        force();
      }
    });
    return () => { alive = false; };
  }, [imageId]);
  return cached;
}

export function primeImageCache(imageId: string, dataUrl: string) {
  imageCache.set(imageId, dataUrl);
}

export async function getImageData(imageId: string): Promise<string | undefined> {
  return imageCache.get(imageId) ?? (await db.getImage(imageId)) ?? undefined;
}

export { uid };

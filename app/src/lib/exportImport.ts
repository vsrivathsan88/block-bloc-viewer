// Project export/import as a single self-contained JSON file (images inlined
// as data URLs). Matches schemas/storyboard.schema.json in the repo root.

import type { Project } from "../model/types";
import { db } from "../store/db";
import { primeImageCache } from "../store/useProject";

interface ExportFile {
  format: "shotboard-project";
  version: 1;
  project: Project;
  images: Record<string, string>; // imageId → dataURL
}

export async function exportProject(project: Project): Promise<void> {
  const images: Record<string, string> = {};
  const imageIds = [
    ...project.frames.map((f) => f.imageId),
    ...(project.cast ?? []).flatMap((c) => c.refImageIds),
    // locally rendered take footage (mock mode) also lives in the images store
    ...project.scenes.flatMap((sc) =>
      sc.shots.flatMap((s) => (s.takes ?? []).flatMap((t) => (t.videoId ? [t.videoId] : []))),
    ),
  ];
  for (const id of imageIds) {
    const url = await db.getImage(id);
    if (url) images[id] = url;
  }
  const file: ExportFile = { format: "shotboard-project", version: 1, project, images };
  const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${project.title.replace(/[^\w-]+/g, "_") || "storyboard"}.shotboard.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function importProject(fileText: string): Promise<Project> {
  const file = JSON.parse(fileText) as ExportFile;
  if (file.format !== "shotboard-project" || !file.project) {
    throw new Error("not a shotboard project file");
  }
  for (const [id, dataUrl] of Object.entries(file.images ?? {})) {
    await db.putImage(id, dataUrl);
    primeImageCache(id, dataUrl);
  }
  await db.putProject(file.project.id, file.project);
  return file.project;
}

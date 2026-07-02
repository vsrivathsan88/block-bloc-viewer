// Shotboard data model. Two Scorsese rules encoded here:
//   1. A shot is not "what the frame shows" — it's what the camera DOES.
//      Every shot carries a movement, and the movement carries the shot.
//   2. FARM AR context is spatial: every captured frame keeps its camera pose
//      (a spatial anchor). A shot's FARM context is an ordered, user-editable
//      list of those anchors — never a hidden implementation detail.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // XYZW (Three.js / FARM AR)

export interface Pose {
  position: Vec3;
  quaternion: Quat;
}

/** Camera movement vocabulary. Encoded on every shot; drives arrow overlays,
 * animatic simulation, and the FARM AR prompt. */
export const MOVEMENTS = [
  "static",
  "push-in",
  "pull-out",
  "pan-left",
  "pan-right",
  "tilt-up",
  "tilt-down",
  "track-left",
  "track-right",
  "crane-up",
  "crane-down",
  "dolly-zoom",
  "whip-pan",
  "handheld",
] as const;
export type Movement = (typeof MOVEMENTS)[number];

export const ANGLES = ["eye-level", "low", "high", "overhead", "dutch", "pov"] as const;
export type Angle = (typeof ANGLES)[number];

export const LENSES = [18, 25, 32, 40, 50, 65, 85, 100, 135] as const;

export interface Stroke {
  tool: "pencil" | "arrow";
  color: string; // css color
  width: number; // relative to a 1000-wide panel
  points: [number, number][]; // normalized 0..1 panel coords
}

/** A posed capture from the world — the unit of FARM AR spatial context.
 * The pose is the viewer camera's camera-to-world transform (Three.js
 * convention, Y-up, Z-backward), same frame as the splat world. */
export interface CapturedFrame {
  id: string;
  imageId: string; // key into the images object store
  pose: Pose;
  fov: number; // vertical fov, degrees
  aspect: number;
  label: string;
  capturedAt: number;
}

export type FarmTaskStatus = "queued" | "running" | "done" | "error";

export interface FarmGeneration {
  taskId: string;
  status: FarmTaskStatus;
  prompt: string;
  /** frame ids sent as reference_images, in order — the anchors this
   * generation was conditioned on (kept for provenance) */
  contextFrameIds: string[];
  frameCount: number;
  videoUrl?: string; // assembled MP4 preview when done
  error?: string;
  submittedAt: number;
  mock?: boolean;
}

export interface Shot {
  id: string;
  /** e.g. "3" or "3A" — combined with the scene number for the slate */
  number: string;
  /** keyframe: id of a CapturedFrame (the marked IN) */
  frameId?: string;
  /** marked OUT pose — makes the camera movement literal */
  endPose?: Pose;
  /** ordered FARM AR context anchors; defaults to [frameId] at capture.
   * User-editable in the shot editor's context tray. */
  contextFrameIds: string[];
  lensMm: number;
  angle: Angle;
  movement: Movement;
  durationSec: number;
  action: string; // what happens in the frame
  dialogue: string;
  notes: string;
  strokes: Stroke[];
  farm?: FarmGeneration;
}

export interface SceneGroup {
  id: string;
  number: number;
  heading: string; // "INT. LIVING ROOM — DAY"
  shots: Shot[];
}

export interface WorldRef {
  spzUrl: string;
  colliderUrl?: string;
  title: string;
}

export interface Project {
  id: string;
  title: string;
  world: WorldRef;
  /** the posed frame library — all captures, shared across shots as anchors */
  frames: CapturedFrame[];
  scenes: SceneGroup[];
  createdAt: number;
  updatedAt: number;
  version: 1;
}

export const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function newShot(number: string): Shot {
  return {
    id: uid(),
    number,
    contextFrameIds: [],
    lensMm: 32,
    angle: "eye-level",
    movement: "static",
    durationSec: 3,
    action: "",
    dialogue: "",
    notes: "",
    strokes: [],
  };
}

export function newScene(number: number): SceneGroup {
  return { id: uid(), number, heading: `SCENE ${number}`, shots: [] };
}

export function newProject(title: string, world: WorldRef): Project {
  const now = Date.now();
  return {
    id: uid(),
    title,
    world,
    frames: [],
    scenes: [newScene(1)],
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

export function nextShotNumber(scene: SceneGroup): string {
  const nums = scene.shots
    .map((s) => parseInt(s.number, 10))
    .filter((n) => !Number.isNaN(n));
  return String(nums.length ? Math.max(...nums) + 1 : 1);
}

export function frameById(p: Project, id?: string): CapturedFrame | undefined {
  return id ? p.frames.find((f) => f.id === id) : undefined;
}

export function allShots(p: Project): { scene: SceneGroup; shot: Shot }[] {
  return p.scenes.flatMap((scene) => scene.shots.map((shot) => ({ scene, shot })));
}

export function totalRuntime(p: Project): number {
  return allShots(p).reduce((t, { shot }) => t + (shot.durationSec || 0), 0);
}

export function fmtRuntime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

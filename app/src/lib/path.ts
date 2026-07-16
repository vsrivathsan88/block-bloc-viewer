// Camera paths — design borrowed from Marble's camera-pathing work
// (wlt#17114 + JoshEiten's WOR-42xxx stack): smooth splines through
// waypoints, arc-length parametrization so the camera moves at constant
// speed, orientation carried along the path. Reimplemented for Shotboard's
// pose model (camera-to-world, XYZW quaternions).

import type { Pose } from "../model/types";
import { qSlerp, qNormalize } from "./pose";

/** Centripetal Catmull-Rom for positions (no cusps/overshoots on tight
 * waypoint spacing), per-segment slerp for orientation. */
function crPoint(p0: number[], p1: number[], p2: number[], p3: number[], t: number): [number, number, number] {
  const t2 = t * t, t3 = t2 * t;
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    out.push(
      0.5 *
        (2 * p1[i] +
          (-p0[i] + p2[i]) * t +
          (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
          (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3),
    );
  }
  return out as [number, number, number];
}

interface Dense {
  poses: Pose[];
  cum: number[]; // cumulative arc length
  total: number;
}

const DENSE = 48; // samples per segment

function densify(points: Pose[]): Dense {
  if (points.length === 1) points = [points[0], points[0]];
  const poses: Pose[] = [];
  const cum: number[] = [0];
  const P = points.map((p) => p.position as unknown as number[]);
  for (let seg = 0; seg < points.length - 1; seg++) {
    const p0 = P[Math.max(0, seg - 1)];
    const p1 = P[seg];
    const p2 = P[seg + 1];
    const p3 = P[Math.min(P.length - 1, seg + 2)];
    for (let i = 0; i < DENSE; i++) {
      const t = i / DENSE;
      poses.push({
        position: crPoint(p0, p1, p2, p3, t),
        quaternion: qNormalize(qSlerp(points[seg].quaternion, points[seg + 1].quaternion, t)),
      });
    }
  }
  poses.push(points[points.length - 1]);
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1].position, b = poses[i].position;
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  return { poses, cum, total: cum[cum.length - 1] };
}

/** Pose at normalized arc length s ∈ [0,1] — constant travel speed. Falls
 * back to index-space when the path has (near-)zero length (pure rotation:
 * pans/tilts in place still interpolate). */
export function pathPoseAt(points: Pose[], s: number): Pose {
  if (!points.length) throw new Error("empty path");
  if (points.length === 1) return points[0];
  const d = densify(points);
  const clamped = Math.max(0, Math.min(1, s));
  if (d.total < 1e-6) {
    const idx = clamped * (d.poses.length - 1);
    const i = Math.floor(idx);
    const f = idx - i;
    const a = d.poses[i], b = d.poses[Math.min(d.poses.length - 1, i + 1)];
    return { position: a.position, quaternion: qNormalize(qSlerp(a.quaternion, b.quaternion, f)) };
  }
  const target = clamped * d.total;
  let lo = 0, hi = d.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (d.cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.max(1, lo);
  const span = d.cum[i] - d.cum[i - 1] || 1;
  const f = (target - d.cum[i - 1]) / span;
  const a = d.poses[i - 1], b = d.poses[i];
  return {
    position: [
      a.position[0] + (b.position[0] - a.position[0]) * f,
      a.position[1] + (b.position[1] - a.position[1]) * f,
      a.position[2] + (b.position[2] - a.position[2]) * f,
    ],
    quaternion: qNormalize(qSlerp(a.quaternion, b.quaternion, f)),
  };
}

/** n poses evenly spaced along the path by arc length (FARM target cameras). */
export function samplePath(points: Pose[], n: number): Pose[] {
  const count = Math.max(2, n);
  return Array.from({ length: count }, (_, i) => pathPoseAt(points, i / (count - 1)));
}

/** Waypoint thinning for walk-recorded paths: keep a pose when it moved or
 * turned enough to matter. */
export function shouldKeepWaypoint(prev: Pose, next: Pose): boolean {
  const dp = Math.hypot(
    next.position[0] - prev.position[0],
    next.position[1] - prev.position[1],
    next.position[2] - prev.position[2],
  );
  const dot = Math.abs(
    prev.quaternion[0] * next.quaternion[0] +
    prev.quaternion[1] * next.quaternion[1] +
    prev.quaternion[2] * next.quaternion[2] +
    prev.quaternion[3] * next.quaternion[3],
  );
  return dp > 0.12 || dot < 0.9962; // ~5°
}

// Small quaternion/pose toolbox (XYZW, Three.js convention) so the React app
// doesn't need a three.js dependency. Poses are camera-to-world transforms.

import type { Pose, Quat, Vec3 } from "../model/types";

export const IDENTITY_POSE: Pose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };

export function qMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function qNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function qRotate(q: Quat, v: Vec3): Vec3 {
  // v' = q * (v,0) * q^-1
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

export function qSlerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (cos > 0.9995) {
    return qNormalize([
      a[0] + t * (bx - a[0]),
      a[1] + t * (by - a[1]),
      a[2] + t * (bz - a[2]),
      a[3] + t * (bw - a[3]),
    ]);
  }
  const theta = Math.acos(cos);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [
    wa * a[0] + wb * bx,
    wa * a[1] + wb * by,
    wa * a[2] + wb * bz,
    wa * a[3] + wb * bw,
  ];
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function poseLerp(a: Pose, b: Pose, t: number): Pose {
  return {
    position: lerpVec3(a.position, b.position, t),
    quaternion: qSlerp(a.quaternion, b.quaternion, t),
  };
}

/** Express `pose` in the coordinate frame of `anchor` (both camera-to-world in
 * the same world frame). Result: anchor becomes the identity pose. This is how
 * shot poses are re-anchored before being sent to FARM AR — the context bundle
 * expects everything anchored at (or near) the identity of the first context
 * view. */
export function relativeTo(pose: Pose, anchor: Pose): Pose {
  const invQ = qConjugate(qNormalize(anchor.quaternion));
  const dp: Vec3 = [
    pose.position[0] - anchor.position[0],
    pose.position[1] - anchor.position[1],
    pose.position[2] - anchor.position[2],
  ];
  return {
    position: qRotate(invQ, dp),
    quaternion: qNormalize(qMultiply(invQ, pose.quaternion)),
  };
}

const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as const;

export function qFromAxisAngle(axis: keyof typeof AXES, rad: number): Quat {
  const [x, y, z] = AXES[axis];
  const s = Math.sin(rad / 2);
  return [x * s, y * s, z * s, Math.cos(rad / 2)];
}

/** Move a camera pose in its own local frame (camera looks down -Z). */
export function translateLocal(pose: Pose, local: Vec3): Pose {
  const world = qRotate(qNormalize(pose.quaternion), local);
  return {
    position: [
      pose.position[0] + world[0],
      pose.position[1] + world[1],
      pose.position[2] + world[2],
    ],
    quaternion: pose.quaternion,
  };
}

/** Rotate a camera pose around its own local axis. */
export function rotateLocal(pose: Pose, axis: keyof typeof AXES, rad: number): Pose {
  return {
    position: pose.position,
    quaternion: qNormalize(qMultiply(pose.quaternion, qFromAxisAngle(axis, rad))),
  };
}

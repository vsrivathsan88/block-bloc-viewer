// The camera plan: a top-down canvas of the set. Drag anywhere to place a
// camera and aim it (press = position, pull = direction, release = placed);
// a plain click places a camera aimed at the room center; click an existing
// planned camera to remove it. Existing shots (red) and banked anchors
// (green wedges) are drawn for spatial context; the star is the capture
// origin — the original pano camera.

import { useEffect, useRef } from "react";
import type { CapturedFrame, Quat } from "../model/types";
import { qRotate } from "../lib/pose";

export interface PlannedCam {
  id: string;
  x: number;
  z: number;
  yaw: number; // radians; forward = (-sin yaw, -cos yaw) in XZ
}

export interface ShotMark {
  label: string;
  x: number;
  z: number;
  yaw: number;
}

export interface BboxXZ {
  min: [number, number];
  max: [number, number];
}

interface Props {
  bbox: BboxXZ;
  anchors: CapturedFrame[];
  shots: ShotMark[];
  planned: PlannedCam[];
  onPlanned: (next: PlannedCam[]) => void;
}

export function yawOfQuat(q: Quat): number {
  const f = qRotate(q, [0, 0, -1]);
  return Math.atan2(-f[0], -f[2]);
}

export function yawQuat(yaw: number): Quat {
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

const PAD = 26; // px margin around the bbox

export default function PlanCanvas({ bbox, anchors, shots, planned, onPlanned }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ cam: PlannedCam; moved: boolean } | null>(null);

  // world→canvas mapping (recomputed per render from the element size)
  function mapping(canvas: HTMLCanvasElement) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const spanX = Math.max(1, bbox.max[0] - bbox.min[0]);
    const spanZ = Math.max(1, bbox.max[1] - bbox.min[1]);
    const s = Math.min((w - PAD * 2) / spanX, (h - PAD * 2) / spanZ);
    const ox = (w - spanX * s) / 2 - bbox.min[0] * s;
    const oz = (h - spanZ * s) / 2 - bbox.min[1] * s;
    return {
      s,
      toPx: (x: number, z: number): [number, number] => [ox + x * s, oz + z * s],
      toWorld: (px: number, pz: number): [number, number] => [(px - ox) / s, (pz - oz) / s],
    };
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const m = mapping(canvas);
    const css = getComputedStyle(canvas);
    const col = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const cInk = col("--fg", "#1d1b2a");
    const cMuted = col("--muted", "#786f8f");
    const cBorder = col("--border", "#ded7f0");
    const cRed = col("--danger", "#e5484d");
    const cGreen = col("--success", "#22a06b");
    const cViolet = col("--accent", "#6d4aff");

    // 1m grid
    ctx.strokeStyle = cBorder;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.6;
    for (let x = Math.ceil(bbox.min[0]); x <= bbox.max[0]; x++) {
      const [px] = m.toPx(x, 0);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    }
    for (let z = Math.ceil(bbox.min[1]); z <= bbox.max[1]; z++) {
      const [, pz] = m.toPx(0, z);
      ctx.beginPath(); ctx.moveTo(0, pz); ctx.lineTo(w, pz); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // room bounds
    const [x0, z0] = m.toPx(bbox.min[0], bbox.min[1]);
    const [x1, z1] = m.toPx(bbox.max[0], bbox.max[1]);
    ctx.strokeStyle = cMuted;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, z0, x1 - x0, z1 - z0);

    // capture origin
    const [xo, zo] = m.toPx(0, 0);
    ctx.fillStyle = cInk;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("✦", xo, zo + 4);

    const wedge = (x: number, z: number, yaw: number, color: string, r: number, half = 0.5) => {
      const [px, pz] = m.toPx(x, z);
      const dir = Math.atan2(-Math.sin(yaw), -Math.cos(yaw)); // XZ angle of forward
      ctx.beginPath();
      ctx.moveTo(px, pz);
      ctx.arc(px, pz, r, dir - half, dir + half);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.2;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(px, pz, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };

    for (const a of anchors) {
      wedge(a.pose.position[0], a.pose.position[2], yawOfQuat(a.pose.quaternion), cGreen, 20, 0.45);
    }
    for (const s of shots) {
      wedge(s.x, s.z, s.yaw, cRed, 26, 0.5);
      const [px, pz] = m.toPx(s.x, s.z);
      ctx.fillStyle = cRed;
      ctx.font = "bold 10px sans-serif";
      ctx.fillText(s.label, px, pz - 8);
    }
    planned.forEach((c, i) => {
      wedge(c.x, c.z, c.yaw, cViolet, 30, 0.55);
      const [px, pz] = m.toPx(c.x, c.z);
      ctx.fillStyle = cViolet;
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(String(i + 1), px, pz - 9);
    });
  }

  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(draw);
    obs.observe(canvas);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox, anchors, shots, planned]);

  function eventWorld(e: React.PointerEvent): [number, number] {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const m = mapping(canvas);
    return m.toWorld(e.clientX - rect.left, e.clientY - rect.top);
  }

  return (
    <canvas
      ref={canvasRef}
      className="plan-canvas"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const [x, z] = eventWorld(e);
        // hit-test planned cams (remove on plain click)
        const canvas = canvasRef.current!;
        const m = mapping(canvas);
        const hit = planned.find((c) => {
          const [px, pz] = m.toPx(c.x, c.z);
          const rect = canvas.getBoundingClientRect();
          return Math.hypot(e.clientX - rect.left - px, e.clientY - rect.top - pz) < 12;
        });
        if (hit) {
          onPlanned(planned.filter((c) => c.id !== hit.id));
          return;
        }
        const cam: PlannedCam = {
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          x, z,
          // default aim: at the room center
          yaw: Math.atan2(-((bbox.min[0] + bbox.max[0]) / 2 - x), -((bbox.min[1] + bbox.max[1]) / 2 - z)),
        };
        drag.current = { cam, moved: false };
        onPlanned([...planned, cam]);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const [x, z] = eventWorld(e);
        const c = drag.current.cam;
        const dx = x - c.x, dz = z - c.z;
        if (Math.hypot(dx, dz) > 0.15) {
          drag.current.moved = true;
          const yaw = Math.atan2(-dx, -dz);
          onPlanned(planned.map((p) => (p.id === c.id ? { ...p, yaw } : p)));
          drag.current.cam = { ...c, yaw };
        }
      }}
      onPointerUp={() => { drag.current = null; }}
    />
  );
}

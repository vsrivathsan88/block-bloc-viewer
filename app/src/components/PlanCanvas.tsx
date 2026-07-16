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
  /** "mini" = collapsed corner map: room + shot dots only, no labels/anchors */
  detail?: "mini" | "full";
  /** recorded camera paths (XZ waypoints), drawn as smooth curves */
  paths?: { pts: [number, number][] }[];
  /** the world's own minimap image, drawn under the grid across the bbox */
  underlayUrl?: string;
  /** path-edit mode: drag waypoints, click the curve to insert, click a
   * waypoint to remove. While set, planned-camera placement is disabled. */
  editPath?: { pts: [number, number][]; onEdit: (a: PathEdit) => void };
  /** scrub position marker (world XZ) */
  marker?: [number, number];
}

export type PathEdit =
  | { type: "move"; i: number; x: number; z: number }
  | { type: "insert"; i: number; x: number; z: number }
  | { type: "delete"; i: number };

export function yawOfQuat(q: Quat): number {
  const f = qRotate(q, [0, 0, -1]);
  return Math.atan2(-f[0], -f[2]);
}

export function yawQuat(yaw: number): Quat {
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

const PAD = 26; // px margin around the bbox

export default function PlanCanvas({ bbox, anchors, shots, planned, onPlanned, detail = "full", paths, underlayUrl, editPath, marker }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ cam: PlannedCam; moved: boolean } | null>(null);
  const pathDrag = useRef<{ i: number; moved: boolean } | null>(null);
  const underlay = useRef<{ url: string; img: HTMLImageElement; ready: boolean } | null>(null);

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
    const mini = detail === "mini";
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const m = mapping(canvas);
    // The map lives on dark glass — fixed overlay palette, not theme tokens.
    const GRID = "rgba(255,255,255,0.08)";
    const WALL = "rgba(255,255,255,0.4)";
    const FLOOR = "rgba(255,255,255,0.045)";
    const ORIGIN = "rgba(255,255,255,0.5)";
    const RED = "#ff6b6b";
    const GREEN = "#3ecf9a";
    const VIOLET = "#9d87ff";

    const [x0, z0] = m.toPx(bbox.min[0], bbox.min[1]);
    const [x1, z1] = m.toPx(bbox.max[0], bbox.max[1]);

    // floor: the world's own minimap when it has one, else a flat fill
    // (metadata-less approximation: the minimap is assumed to cover the bbox)
    ctx.fillStyle = FLOOR;
    ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
    if (underlayUrl) {
      if (underlay.current?.url !== underlayUrl) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        const entry = { url: underlayUrl, img, ready: false };
        underlay.current = entry;
        img.onload = () => { entry.ready = true; draw(); };
        img.src = underlayUrl;
      }
      if (underlay.current?.ready) {
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.drawImage(underlay.current.img, x0, z0, x1 - x0, z1 - z0);
        ctx.restore();
      }
    }

    // 1m grid, clipped to the room
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, z0, x1 - x0, z1 - z0);
    ctx.clip();
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (let x = Math.ceil(bbox.min[0]); x <= bbox.max[0]; x++) {
      const [px] = m.toPx(x, 0);
      ctx.beginPath(); ctx.moveTo(px + 0.5, z0); ctx.lineTo(px + 0.5, z1); ctx.stroke();
    }
    for (let z = Math.ceil(bbox.min[1]); z <= bbox.max[1]; z++) {
      const [, pz] = m.toPx(0, z);
      ctx.beginPath(); ctx.moveTo(x0, pz + 0.5); ctx.lineTo(x1, pz + 0.5); ctx.stroke();
    }
    ctx.restore();

    // walls
    ctx.strokeStyle = WALL;
    ctx.lineWidth = mini ? 1 : 1.5;
    ctx.strokeRect(x0, z0, x1 - x0, z1 - z0);

    // capture origin: small cross
    const [xo, zo] = m.toPx(0, 0);
    ctx.strokeStyle = ORIGIN;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xo - 4, zo); ctx.lineTo(xo + 4, zo);
    ctx.moveTo(xo, zo - 4); ctx.lineTo(xo, zo + 4);
    ctx.stroke();

    const cam = (x: number, z: number, yaw: number, color: string, opts: { r: number; wedge?: number; alpha?: number }) => {
      const [px, pz] = m.toPx(x, z);
      if (opts.wedge) {
        const dir = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
        ctx.beginPath();
        ctx.moveTo(px, pz);
        ctx.arc(px, pz, opts.wedge, dir - 0.45, dir + 0.45);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = opts.alpha ?? 0.16;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.arc(px, pz, opts.r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };

    // recorded camera paths — smooth curve through the waypoints
    if (paths?.length) {
      ctx.strokeStyle = RED;
      ctx.lineWidth = mini ? 1 : 1.5;
      ctx.globalAlpha = 0.75;
      for (const path of paths) {
        const px = path.pts.map(([x, z]) => m.toPx(x, z));
        if (px.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(px[0][0], px[0][1]);
        for (let i = 1; i < px.length - 1; i++) {
          ctx.quadraticCurveTo(px[i][0], px[i][1], (px[i][0] + px[i + 1][0]) / 2, (px[i][1] + px[i + 1][1]) / 2);
        }
        ctx.lineTo(px[px.length - 1][0], px[px.length - 1][1]);
        ctx.stroke();
        if (!mini) {
          ctx.beginPath();
          ctx.arc(px[px.length - 1][0], px[px.length - 1][1], 2.5, 0, Math.PI * 2);
          ctx.fillStyle = RED;
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    if (!mini) {
      for (const a of anchors) {
        cam(a.pose.position[0], a.pose.position[2], yawOfQuat(a.pose.quaternion), GREEN, { r: 2, wedge: 13, alpha: 0.1 });
      }
    }
    for (const s of shots) {
      cam(s.x, s.z, s.yaw, RED, mini ? { r: 2.5 } : { r: 3, wedge: 17 });
    }
    if (!mini) {
      ctx.font = "600 9px Inter, sans-serif";
      ctx.textAlign = "center";
      planned.forEach((c, i) => {
        cam(c.x, c.z, c.yaw, VIOLET, { r: 3.5, wedge: 24, alpha: 0.22 });
        const [px, pz] = m.toPx(c.x, c.z);
        ctx.fillStyle = VIOLET;
        ctx.fillText(String(i + 1), px, pz - 7);
      });
    }

    // path being edited: violet curve + draggable waypoint dots + scrub marker
    if (editPath && !mini) {
      const px = editPath.pts.map(([x, z]) => m.toPx(x, z));
      if (px.length >= 2) {
        ctx.strokeStyle = VIOLET;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px[0][0], px[0][1]);
        for (let i = 1; i < px.length - 1; i++) {
          ctx.quadraticCurveTo(px[i][0], px[i][1], (px[i][0] + px[i + 1][0]) / 2, (px[i][1] + px[i + 1][1]) / 2);
        }
        ctx.lineTo(px[px.length - 1][0], px[px.length - 1][1]);
        ctx.stroke();
      }
      px.forEach(([x, y], i) => {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = VIOLET;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (i === 0 || i === px.length - 1) {
          ctx.fillStyle = "#fff";
          ctx.font = "600 8px Inter, sans-serif";
          ctx.fillText(i === 0 ? "in" : "out", x, y - 9);
        }
      });
    }
    if (marker && !mini) {
      const [mx, mz] = m.toPx(marker[0], marker[1]);
      ctx.beginPath();
      ctx.arc(mx, mz, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = VIOLET;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(draw);
    obs.observe(canvas);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox, anchors, shots, planned, detail, paths, underlayUrl, editPath, marker]);

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
        const canvas = canvasRef.current!;
        const m = mapping(canvas);
        // path-edit mode: waypoints and curve own the pointer
        if (editPath) {
          const rect = canvas.getBoundingClientRect();
          const ex = e.clientX - rect.left, ez = e.clientY - rect.top;
          const px = editPath.pts.map(([wx, wz]) => m.toPx(wx, wz));
          const hitIdx = px.findIndex(([hx, hz]) => Math.hypot(ex - hx, ez - hz) < 11);
          if (hitIdx >= 0) {
            pathDrag.current = { i: hitIdx, moved: false };
            return;
          }
          // near a segment → insert a waypoint there and start dragging it
          for (let i = 0; i < px.length - 1; i++) {
            const [ax, az] = px[i], [bx, bz] = px[i + 1];
            const dx = bx - ax, dz = bz - az;
            const len2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((ex - ax) * dx + (ez - az) * dz) / len2));
            const qx = ax + dx * t, qz = az + dz * t;
            if (Math.hypot(ex - qx, ez - qz) < 9) {
              editPath.onEdit({ type: "insert", i: i + 1, x, z });
              pathDrag.current = { i: i + 1, moved: true };
              return;
            }
          }
          return;
        }
        // hit-test planned cams (remove on plain click)
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
        if (editPath && pathDrag.current) {
          const [x, z] = eventWorld(e);
          pathDrag.current.moved = true;
          editPath.onEdit({ type: "move", i: pathDrag.current.i, x, z });
          return;
        }
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
      onPointerUp={() => {
        if (editPath && pathDrag.current) {
          // click (no drag) on a waypoint removes it
          if (!pathDrag.current.moved) editPath.onEdit({ type: "delete", i: pathDrag.current.i });
          pathDrag.current = null;
        }
        drag.current = null;
      }}
    />
  );
}

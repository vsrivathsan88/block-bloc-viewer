// Interactive sketch layer for the shot editor: pencil + arrow tools over the
// keyframe. Strokes are stored as normalized vectors on the shot, so they
// scale with the panel and survive export.

import { useEffect, useRef } from "react";
import type { Stroke } from "../model/types";
import { arrowHead, VB_W, VB_H } from "./StrokesSvg";

interface Props {
  strokes: Stroke[];
  tool: "pencil" | "arrow";
  color: string;
  onStrokes: (s: Stroke[]) => void;
}

export default function SketchCanvas({ strokes, tool, color, onStrokes }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<Stroke | null>(null);

  function redraw(extra?: Stroke | null) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sx = canvas.width / VB_W;
    const sy = canvas.height / VB_H;
    for (const s of extra ? [...strokes, extra] : strokes) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width * sx;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      s.points.forEach(([x, y], i) => {
        const px = x * VB_W * sx, py = y * VB_H * sy;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
      if (s.tool === "arrow") {
        const head = arrowHead(s.points);
        if (head) {
          const p = new Path2D(head);
          ctx.save();
          ctx.scale(sx, sy);
          ctx.lineWidth = s.width;
          ctx.stroke(p);
          ctx.restore();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * devicePixelRatio);
      canvas.height = Math.round(rect.height * devicePixelRatio);
      redraw();
    };
    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(canvas);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => redraw(), [strokes]); // eslint-disable-line react-hooks/exhaustive-deps

  function pointOf(e: React.PointerEvent): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    ];
  }

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = { tool, color, width: tool === "arrow" ? 6 : 4, points: [pointOf(e)] };
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const pts = drawing.current.points;
        if (tool === "arrow" && pts.length > 1) pts[pts.length - 1] = pointOf(e);
        else pts.push(pointOf(e));
        // arrows render as straight-ish: keep first + latest only
        if (tool === "arrow" && pts.length > 2) drawing.current.points = [pts[0], pts[pts.length - 1]];
        redraw(drawing.current);
      }}
      onPointerUp={() => {
        if (drawing.current && drawing.current.points.length > 1) {
          onStrokes([...strokes, drawing.current]);
        }
        drawing.current = null;
      }}
    />
  );
}

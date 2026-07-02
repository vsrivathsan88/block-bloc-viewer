// Render a shot's sketch strokes as an SVG overlay (read-only display —
// panels, animatic). Coordinates are normalized 0..1; viewBox 1000x562 keeps
// stroke widths meaningful at any panel size.

import type { Stroke } from "../model/types";

export const VB_W = 1000;
export const VB_H = 562;

function pathOf(points: [number, number][]): string {
  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${(x * VB_W).toFixed(1)} ${(y * VB_H).toFixed(1)}`)
    .join(" ");
}

export function arrowHead(points: [number, number][]): string | null {
  if (points.length < 2) return null;
  const [x2, y2] = points[points.length - 1];
  // direction from a point a bit back along the stroke, for stability
  const back = points[Math.max(0, points.length - 4)];
  const dx = x2 * VB_W - back[0] * VB_W;
  const dy = y2 * VB_H - back[1] * VB_H;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const size = 18;
  const px = x2 * VB_W, py = y2 * VB_H;
  const left = [px - ux * size - uy * size * 0.55, py - uy * size + ux * size * 0.55];
  const right = [px - ux * size + uy * size * 0.55, py - uy * size - ux * size * 0.55];
  return `M${left[0].toFixed(1)} ${left[1].toFixed(1)} L${px.toFixed(1)} ${py.toFixed(1)} L${right[0].toFixed(1)} ${right[1].toFixed(1)}`;
}

export default function StrokesSvg({ strokes }: { strokes: Stroke[] }) {
  return (
    <svg className="strokes" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none">
      {strokes.map((s, i) => {
        const head = s.tool === "arrow" ? arrowHead(s.points) : null;
        return (
          <g key={i} stroke={s.color} strokeWidth={s.width} fill="none"
             strokeLinecap="round" strokeLinejoin="round" opacity={0.92}>
            <path d={pathOf(s.points)} />
            {head && <path d={head} />}
          </g>
        );
      })}
    </svg>
  );
}

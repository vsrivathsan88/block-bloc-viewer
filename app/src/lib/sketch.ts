// The Scorsese mark: an arrow drawn on the frame IS the camera move.
// Classify an arrow stroke (normalized 0..1 panel coords) into a movement —
// no glyph picking. Anything ambiguous stays overridable via the move tag.

import type { Movement } from "../model/types";

export function movementFromArrow(points: [number, number][]): Movement | null {
  if (points.length < 2) return null;
  const [x0, y0] = points[0];
  const [x1, y1] = points[points.length - 1];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.08) return null; // a dot, not a direction

  // toward/away from frame center = push/pull (depth beats direction)
  const dist = (x: number, y: number) => Math.hypot(x - 0.5, y - 0.5);
  const d0 = dist(x0, y0);
  const d1 = dist(x1, y1);
  if (d1 < 0.16 && d0 > d1 + 0.12) return "push-in";
  if (d0 < 0.16 && d1 > d0 + 0.12) return "pull-out";

  // otherwise the dominant axis: horizontal = pan, vertical = tilt
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "pan-right" : "pan-left";
  return dy < 0 ? "tilt-up" : "tilt-down";
}

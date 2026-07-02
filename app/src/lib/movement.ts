// The movement vocabulary made operational: given a shot's IN pose, derive a
// default OUT pose for each movement (used when the user hasn't marked OUT),
// plus the Ken Burns transform pair for 2D animatic playback and the arrow
// glyph shown on panels.

import type { Movement, Pose } from "../model/types";
import { rotateLocal, translateLocal } from "./pose";

const DEG = Math.PI / 180;

/** Default OUT pose implied by a movement (meters / radians are modest —
 * Marble worlds are room-scale). "static" and "handheld" return the IN pose. */
export function impliedEndPose(movement: Movement, start: Pose): Pose {
  switch (movement) {
    case "push-in":
      return translateLocal(start, [0, 0, -0.9]);
    case "pull-out":
      return translateLocal(start, [0, 0, 0.9]);
    case "pan-left":
      return rotateLocal(start, "y", 30 * DEG);
    case "pan-right":
      return rotateLocal(start, "y", -30 * DEG);
    case "tilt-up":
      return rotateLocal(start, "x", 18 * DEG);
    case "tilt-down":
      return rotateLocal(start, "x", -18 * DEG);
    case "track-left":
      return translateLocal(start, [-0.9, 0, 0]);
    case "track-right":
      return translateLocal(start, [0.9, 0, 0]);
    case "crane-up":
      return translateLocal(start, [0, 0.8, 0]);
    case "crane-down":
      return translateLocal(start, [0, -0.8, 0]);
    case "whip-pan":
      return rotateLocal(start, "y", -80 * DEG);
    case "dolly-zoom": // position pull-out; the zoom half is a lens change
      return translateLocal(start, [0, 0, 0.7]);
    case "static":
    case "handheld":
      return start;
  }
}

/** Ken Burns simulation for the 2D animatic: CSS transforms at t=0 and t=1.
 * Crude on purpose — it's a pencil-test, not the shot. FARM output replaces it. */
export function kenBurns(movement: Movement): { from: string; to: string } {
  switch (movement) {
    case "push-in":
      return { from: "scale(1)", to: "scale(1.28)" };
    case "pull-out":
      return { from: "scale(1.28)", to: "scale(1)" };
    case "pan-left":
      return { from: "scale(1.15) translateX(-5%)", to: "scale(1.15) translateX(5%)" };
    case "pan-right":
      return { from: "scale(1.15) translateX(5%)", to: "scale(1.15) translateX(-5%)" };
    case "tilt-up":
      return { from: "scale(1.15) translateY(-5%)", to: "scale(1.15) translateY(5%)" };
    case "tilt-down":
      return { from: "scale(1.15) translateY(5%)", to: "scale(1.15) translateY(-5%)" };
    case "track-left":
      return { from: "scale(1.12) translateX(-6%)", to: "scale(1.12) translateX(6%)" };
    case "track-right":
      return { from: "scale(1.12) translateX(6%)", to: "scale(1.12) translateX(-6%)" };
    case "crane-up":
      return { from: "scale(1.12) translateY(6%)", to: "scale(1.12) translateY(-6%)" };
    case "crane-down":
      return { from: "scale(1.12) translateY(-6%)", to: "scale(1.12) translateY(6%)" };
    case "dolly-zoom":
      return { from: "scale(1.05)", to: "scale(1.22)" };
    case "whip-pan":
      return { from: "scale(1.2) translateX(12%)", to: "scale(1.2) translateX(-12%)" };
    case "handheld":
      return { from: "scale(1.06) translate(0.4%, -0.3%)", to: "scale(1.06) translate(-0.4%, 0.4%)" };
    case "static":
      return { from: "scale(1)", to: "scale(1)" };
  }
}

export const MOVEMENT_GLYPH: Record<Movement, string> = {
  "static": "⏺",
  "push-in": "⇥",
  "pull-out": "⇤",
  "pan-left": "⟲",
  "pan-right": "⟳",
  "tilt-up": "⤴",
  "tilt-down": "⤵",
  "track-left": "←",
  "track-right": "→",
  "crane-up": "↑",
  "crane-down": "↓",
  "dolly-zoom": "◎",
  "whip-pan": "⚡",
  "handheld": "〜",
};

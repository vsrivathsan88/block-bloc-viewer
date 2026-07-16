// Shot metadata → FARM AR prompt. The prompt reads like a line from a
// Scorsese shot list: movement first, then lens/angle, then what happens.

import type { Shot } from "../model/types";

const MOVEMENT_PHRASE: Record<Shot["movement"], string> = {
  "static": "Locked-off static shot",
  "push-in": "Slow push-in toward the subject",
  "pull-out": "Steady pull-back away from the subject",
  "pan-left": "Smooth pan left",
  "pan-right": "Smooth pan right",
  "tilt-up": "Tilt up",
  "tilt-down": "Tilt down",
  "track-left": "Lateral tracking move to the left",
  "track-right": "Lateral tracking move to the right",
  "crane-up": "Rising crane move",
  "crane-down": "Descending crane move",
  "dolly-zoom": "Dolly-zoom (Vertigo effect): camera pulls back while the lens pushes in",
  "whip-pan": "Fast whip pan",
  "handheld": "Handheld camera with natural sway",
};

const ANGLE_PHRASE: Record<Shot["angle"], string> = {
  "eye-level": "at eye level",
  "low": "from a low angle",
  "high": "from a high angle",
  "overhead": "from directly overhead",
  "dutch": "with a canted (dutch) angle",
  "pov": "as a character POV",
};

export interface PromptContext {
  /** the world's caption (generated_recaption / world_prompt) */
  set?: string;
  /** include the action line only when a cast plate exists — otherwise the
   * prompt asks FARM to invent people the context doesn't show */
  withAction: boolean;
}

export function buildPrompt(shot: Shot, ctx: PromptContext = { withAction: true }): string {
  const parts = [
    `${MOVEMENT_PHRASE[shot.movement]} ${ANGLE_PHRASE[shot.angle]}, ${shot.lensMm}mm lens.`,
  ];
  if (ctx.set?.trim()) parts.push(`The scene: ${ctx.set.trim()}.`);
  if (ctx.withAction && shot.action.trim()) parts.push(shot.action.trim());
  if (shot.notes.trim()) parts.push(shot.notes.trim());
  parts.push("Consistent lighting and geometry with the reference views.");
  return parts.join(" ");
}

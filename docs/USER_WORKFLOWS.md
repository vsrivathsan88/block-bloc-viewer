# Shotboard — user workflow map

The user is a director/previz artist planning a sequence inside a generated
world. Their journey has three acts — **build the world's context → decide
the shots → make the shots real** — and every API touch lives in act three.
Everything before that is deliberately local and instant.

```
ACT I · SET             ACT II · SHOTS              ACT III · FOOTAGE
─────────────           ──────────────              ─────────────────
W1 new picture   ──►    W3 plan cameras      ──►    W7 FARM AR generate
W2 coverage             W4 walk & mark              W5 cast pass (3P edit)
   (anchors)            W6 spec & sketch            W8 animatic
                                                    W9 hand-off
```

---

## Act I — build the set's context

### W1 · Start a picture
**Flow:** open app → title → (demo world prefilled, or paste `.spz` + collider) → start boarding.
**APIs:** none (Marble CDN implicitly, via the viewer).
**Friction / gaps:**
- No world picker from the user's Marble account — URLs are pasted by hand.
- No path for worlds that don't exist yet. *Planned: greybox blockout →
  depth pano → `tasks:depthPano2DraftSplats` (Chisel `x2p-chisel-v1` + L3RM)
  → draft splat world; or `tasks:farmT2i` image as a single identity anchor.*

### W2 · Bank coverage (spatial context)
**Flow:** Scout → `scan set` (8-stop yaw ring, one click) and/or `+ capture one`.
Anchors appear on the plan canvas (green) and in the editor's context tray.
**Why it exists:** FARM AR is stateless — the anchors ARE the model's memory.
Banking coverage once amortizes context across every shot.
**APIs:** none.
**Gaps:** no auto-scan on first load; world's source pano as a single equirect
anchor is internal-only (feature ask, not client work).

---

## Act II — decide the shots

### W3 · Plan-mode shot-getting (primary, lowest-click)
**Flow:** plan canvas → press to place / pull to aim (×N) → `⏺ shoot` →
viewer auto-drives each setup → take review: `A` accept / `R` reject →
accepted takes land on the board as numbered shots with pose + context wired.
**Cost per 5 shots:** 5 drags, 1 click, 5 keys.
**APIs:** none — takes are splat renders.
**Gaps:** planned cameras are eye-height, level, default lens — no per-camera
lens/height/pitch on the canvas yet; no single-take reshoot from review.

### W4 · Walk-mode shot-getting (hand-framed)
**Flow:** walk (WASD) → `mark IN` (`C` in pointer lock; auto-creates a shot)
→ optional `mark OUT` → `preview move` flies IN→OUT.
**APIs:** none.
**When it wins:** compositions the top-down plan can't express (low angles,
through-doorway frames, precise foreground).

### W6 · Spec & sketch
**Flow:** open panel → movement chip (14-move vocabulary, color by family) →
lens/angle/duration → action/dialogue/notes → grease-pencil arrows over the
frame. The spec compiles into the FARM prompt; the movement implies the OUT
pose when none was marked.
**APIs:** none.
**Gaps:** action text is sent to FARM even when no character is in any anchor
(asks the model to invent people — should be gated on a cast plate).

---

## Act III — make the shots real

### W5 · Cast pass (characters/props into plates)
**Flow:** cast tab → character (description + refs: upload or generate) →
editor → pick character → `composite into plate` → cast plate inherits the
clean plate's pose and replaces it as the top anchor.
**APIs:** 3P image edit — mock (default) / Gemini image / gpt-image-1,
browser-direct, key in localStorage.
**FARM T2I: not wired.** Natural first use: `generate ref` via
`tasks:farmT2i` instead of the 3P provider (keeps character generation
in-house; 3P still does the *compositing* since T2I can't edit a plate).
**Gaps:** characters only (no `kind: prop`); no seed-varied re-composite;
no cross-shot consistency check.

### W7 · Generate the shot — **the FARM AR touchpoint**
**Flow:** editor → context tray (ordering = model sequence; keyframe last;
32-frame budget readout) → prompt preview (editable) → `generate` → phase
ticker (staging/generating/assembling) → MP4 lands on the shot.
**API:** `POST /api/v2[/accounts/{acct}]/tasks:farmAr` per
`docs/farm_ar_api_spec.md`; Operation polled to `done` → `videoUrl`.
Request = context anchors (posed base64 frames) + target cameras
(IN→OUT interpolation, duration×fps) + shot-spec prompt + fps/seed/cfg/
numSteps/model/depthScaleFactor.
**Mock mode** (default + hosted preview): nothing leaves the browser.
**Gaps — the highest-value build area:**
- One shot per click; no **generate-all / queue view** across the board.
- No **FARM take review**: regenerate with a different seed and A/R between
  versions (the W3 triage pattern, applied to generations).
- `depthScaleFactor` is a manual setting; should be derived once per project
  from the world bbox and pinned automatically.
- First live browser call may still hit the Cloud Armor/WAF `prompt`-body
  block; needs one real smoke test.

### W8 · Cut & review (animatic)
**Flow:** animatic tab → play — FARM MP4s where they exist, Ken Burns
pencil-tests (labeled) elsewhere → reorder on the board to re-cut →
durations tune the rhythm.
**APIs:** none (FARM videos already on the shots).
**Gaps:** no animatic export (MP4 via MediaRecorder, like the viewer's
flythrough recorder); no share link.

### W9 · Hand-off
**Flow:** shot list (printable shooting plan) · project JSON export/import
(self-contained, schema in `schemas/storyboard.schema.json`).
**Gaps:** browser-local only — no team sharing; no "post board to Slack".

---

## API touchpoint summary

| API | Used today | Where | Next natural use |
|---|---|---|---|
| FARM AR (`tasks:farmAr`) | ✅ live mode | W7 per-shot generate | batch generate + seeded retakes (W7) |
| FARM T2I (`tasks:farmT2i`) | ❌ | — | cast refs (W5), greybox → depthPano2DraftSplats (W1) |
| 3P image edit (NB / gpt-image-1) | ✅ | W5 compositing | props, seed variations |
| Marble CDN / viewer | ✅ | W1–W4 rendering + poses | world picker from account (W1) |

## Priority read (fewest clicks → most value)

1. **W7 batch + FARM take review** — one "generate all" over the board, then
   the same A/R triage users already know, per shot across seeds. This is the
   workflow that makes FARM AR feel like coverage, not a button.
2. **W5 FARM T2I for cast refs** — in-house character generation, one small
   client addition.
3. **W6 prompt gating** — only send action text when a cast plate exists.
4. **W8 animatic export** — the shareable deliverable of the whole app.
5. **W1 greybox → world** — blockout → depth pano → `tasks:depthPano2DraftSplats` for unbuilt sets.

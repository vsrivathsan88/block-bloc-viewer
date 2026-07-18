# Shotboard — user workflows (v2, world-centric)

**Decided (Vaish, 2026-07-03):**
- **Persona:** a Marble user with worlds in their library. Shotboard is what
  you do *with* a world. World creation happens in Marble, not here.
- **Scope:** one world per picture (multi-location = multiple projects).
- **World entry:** pick from library (`worlds:list`) or paste an ID
  (`GET /marble/v1/worlds/{world_id}`). No in-app generation in v1.
- **Auth:** per-user keys in settings (browser-local). Proxy backend is a
  v2 concern; the client keeps host config swappable so it's a config change.

**The spine — five verbs:**

```
PICK a world → SHOOT coverage → DIRECT each shot → PLAY the cut → HAND OFF
     W1              W2               W3               W4           W5
```

Everything before FARM is local and instant; the only waits in the product
are FARM generations (per-shot) — and they run in the background.

---

## W0 · Setup (once per user)

**Steps:** ⚙ settings → paste Marble Developer API key (worlds), Marble V2
token + account (FARM tasks), Meridian env + key → "load models from
registry" fills the model pickers.
**APIs:** `GET /api/serving/v1/deployments`, `GET /api/model_registry/v1/inference_bundles`.
**Failure states:** no keys → app fully works in mock (pencil-test animatic);
registry unreachable → model fields stay free-text.
**Done when:** model picker shows registry slugs; one live ⚡ returns an MP4.

## W1 · Pick a world

**Steps (built):** open app → **world import** (first run auto-opens; the
world chip in the topbar reopens it any time): one field takes a share URL,
world id, or direct `.spz` URL → "shoot here". With a Developer API key,
"browse my worlds…" shows the thumbnail grid (`POST /marble/v1/worlds:list`).
A `.spz` URL needs no key at all. Resolving an id pulls everything from the
world object:
- splat: chosen from `assets.splats.spz_urls` (LOD policy: light tier for
  scouting; tier switchable in settings)
- collider: `assets.mesh.collider_mesh_url` → walk collision + floor-follow
- minimap: `minimap_url` + `minimap_metadata` → **plan-canvas underlay**
- caption: `generated_recaption` / `world_prompt` → the project's
  **set description**, grounding every FARM prompt in what the world is
**APIs:** `worlds:list`, `GET /marble/v1/worlds/{world_id}`.
**Failure states:** list blocked (CORS/key) → paste-ID path still works;
ID fetch fails → error with the raw fields as manual fallback.
**Done when:** stage shows the world, minimap shows its floor plan, and the
project remembers `worldId` (re-resolvable, not frozen URLs).

## W2 · Shoot coverage

**Steps:** walk (WASD) → **shutter** (or `C`) → shot lands on the strip with
pose/lens/angle inferred. Or expand the minimap → place cameras (press =
position, pull = aim) over the world's real floor plan → rig button shoots
them all → `A`/`R` take triage.
First world load auto-banks a yaw-ring of anchors (built — silent, ~4 s).
**APIs:** none — takes are splat renders; anchors are FARM's future context.
**Done when:** 5 shots cost ≈ 5 drags + 1 click + 5 keys.

## W3 · Direct each shot

**Steps:** tap a strip frame → one overlay: **draw the red arrow and the
camera move sets itself** (right = pan right, into center = push-in, up =
tilt-up; the move tag shows the result and overrides on click — no glyph
picking). Pencil sketches in graphite; colors are fixed like paper: red
china marker for moves, graphite for drawing. One action line, duration
stepper. Drop a **cast chip**
(character or prop) onto the plate — NB/gpt-image-1 composites it,
pose-preserving, so the plate stays a valid anchor. Hit **⚡**:
auto-context (nearest anchors, keyframe last, 32-frame budget), prompt =
set description + movement grammar + action (action only when a cast plate
exists — built), Operation polls in the background; strip dot
tracks queued → running → **review**. Footage lands as a **take** and
**plays right in its strip thumbnail with ✓/✗ on it** — circle or toss
without opening anything (dailies rhythm). The overlay has the same
verdict plus history: retakes (⚡, seed-bumped) stack as T1/T2/T3 chips,
any take re-viewable and re-circlable; "still" returns to the drawable
frame. The toolbar ⚡ generates every shot without footage in one press
(shoot everything → draw arrows → one bolt → triage the dots). Mock mode
renders real ken-burns webm takes so the loop works without a servable.
**APIs:** `tasks:farmAr` (spec: `docs/farm_ar_api_spec.md`); 3P image edit.
**Failure states:** FARM error → red dot + error on the frame, retry = ⚡
again; mock mode → labeled simulated.
**Done when:** a shot goes from framed → generated without reopening
anything; closing the overlay never cancels a generation.

## W4 · Play the cut

**Steps:** ▶ in the toolbar → the strip plays as the animatic (FARM MP4s +
labeled pencil-tests), space to pause, click the bar to scrub. Re-cut by
dragging frames on the strip or the board view; captions/dialogue live on
the board view.
**APIs:** none.
**Done when:** the cut plays through mixed FARM/pencil shots at real
durations with no interaction needed.

## W5 · Hand off

**Steps:** `⋯` → shooting plan (printable table: slate, frame, lens, move,
duration, action/dialogue) · export/import project JSON (self-contained,
`schemas/storyboard.schema.json`).
**Built:** flythrough webm export (toolbar) — the viewer drives every shot's
camera move in board order. **Open for v1.x:** post board/clips to Slack.

---

## Act III power loop (carried from v1 map — top build priority after worlds)

**Built:** "⚡ generate all" (menu) + seed-bumped retakes (every ⚡ press uses
a fresh seed) + circle/toss triage BETWEEN generations — takes accumulate
per shot, one gets circled, the rest stay in history. "FARM as coverage"
is closed.

## Non-goals for v1 (explicit)

- In-app world generation (greybox → `depthPano2DraftSplats`,
  `worlds:generate`) — deferred; the client shapes are already typed.
- Multiple worlds per project; per-scene worlds.
- Proxy backend / team-shared persistence (browser-local only).
- FARM T2I (revisit for cast refs in v1.x).

## Open questions (next grill)

1. LOD policy — silent auto (light scout / full capture) or a visible toggle?
   (Today: tier picked at import, switchable in ⚙ settings.)
2. ~~Replace vs accept when FARM footage lands~~ — resolved: footage lands
   as a take awaiting a circle/toss verdict; an unjudged take previews in
   the animatic until judged.
3. Animatic export target — MP4 file, or straight to Slack (#demo-spam)?
4. v2 multi-world shape — per-scene binding vs freely-mixable sets.

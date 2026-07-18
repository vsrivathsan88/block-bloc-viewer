# block-bloc-viewer

Public splat viewer for [block-bloc](https://github.com/vsrivathsan88) worlds (sketch → Blender blockout → World Labs Marble). Loads `.spz` directly from the public Marble CDN. No auth required.

Renders via **[`@sparkjsdev/spark`](https://github.com/sparkjs-dev/spark)** — World Labs' own Gaussian splat library.

Also home to **Shotboard** (`/storyboard`) — a storyboarding/previz app built on top of this viewer + FARM AR. See [Shotboard](#shotboard-storyboard) below.

## Usage

`https://vsrivathsan88.github.io/block-bloc-viewer/`

### Query params

| param      | default | meaning |
|------------|---------|---------|
| `spz`      | living-room demo | any `.spz` URL (CDN or self-hosted) |
| `title`    | `"living-room"` | label shown top-left |
| `mode`     | `walk` (`fly` on touch devices) | camera mode: `walk` \| `fly` \| `orbit` |
| `collider` | — | URL of the world's collider GLB (`.assets.mesh.collider_mesh_url`); enables floor-follow + wall sliding in walk mode |
| `flip_y`   | `true`  | 180° about X — the mandatory OpenCV→OpenGL re-orientation for Marble splats |
| `flip_z`   | `false` | extra 180° around Y (debug escape hatch for a backwards-facing splat) |
| `scale`    | `1.0`   | uniform scale of the splat |
| `y_offset` | `0.0`   | vertical translation in meters |

Example:

```
?spz=https://cdn.marble.worldlabs.ai/<world-id>/<file>_ceramic_500k.spz&title=My%20Room&mode=walk&collider=https://cdn.marble.worldlabs.ai/<world-id>/<file>.glb
```

The viewer exposes flip toggles + a mode switcher as live UI controls (bottom-right) — tweak in real time, click "copy URL" to capture the final settings.

## Camera modes

- **walk** (default) — first-person walking. Click to grab the pointer (Pointer Lock), then WASD to move, mouse to look, Shift to run, Esc to release. No roll; pitch clamped ±85°; eye height locked to the capture height (the splat origin IS the original pano camera pose, ~1.6 m above the floor). With `&collider=<glb-url>` the camera follows floor height (stairs/sunken areas) and slides along walls instead of passing through them; if the collider fails to load, walk degrades gracefully to the flat-plane version.
- **fly** — free-fly FPS via Spark's `SparkControls` (WASD + drag-look + Q/E roll + Shift). What World Labs' own examples use. Default on touch devices (Pointer Lock doesn't exist there).
- **orbit** — `three.js` `OrbitControls` orbiting a point 2 m in front of the capture pose. Inspection mode.

## How it works

- `@sparkjsdev/spark@2.1.0` (Spark renderer + splat mesh) via esm.sh CDN
- `three@0.180.0` pinned via import map (Spark's peer dep); three addons (`OrbitControls`, `GLTFLoader`) resolve through the same import map (`three/addons/` → the pinned three's `examples/jsm/`)
- Walk mode is ~60 lines of hand-rolled Pointer Lock + raycasts — no controls library
- Single static HTML — no build step

## Deploy

GitHub Pages serves `index.html` from `main` branch root. First build ~10s. GH Pages cache + browser cache compound: after pushing, hard-refresh AND `curl | grep <new-string>` the live URL before assuming your fix deployed.

## Coordinate-frame notes

Marble splats are **Y-up natively** but in OpenCV convention (y-down): the viewer applies a 180° rotation about X (`splat.quaternion.set(1,0,0,0)`) when `flip_y=true` (default). The generation viewpoint IS the splat origin — the camera starts at `(0,0,0)` identity, which is the original pano camera pose, inside the room at eye height.

`flip_z=true` spins the splat 180° around Y for the rare world that faces backwards.

The metric scale and ground-plane offset are usually fine at `scale=1, y_offset=0` for indoor scenes but can be tweaked per-world. The collider GLB (when supplied) gets the same orientation/scale/offset transform as the splat, so the raycast world stays aligned with the rendered one.

## Recorder integration

The headless flythrough recorder (`.claude/scripts/api/render_flythrough.mjs` in the main repo) loads this page with `&mode=fly`, sets `window.__recording = true` (which pauses all control updates), and drives `window.DEBUG.camera` frame-by-frame. `preserveDrawingBuffer: true` on the renderer is what makes its `canvas.toDataURL` captures work — don't remove it.

## Shotboard (/storyboard)

A storyboarding app on top of this viewer + FARM AR (`/app` source, built output committed to `/storyboard`). One screen, one verb:

- The **world fills the screen** (this viewer in a same-origin iframe, chrome hidden, driven via the `window.DEBUG` contract). Walk it; the **shutter** (or `C`) shoots what you see — the shot lands on the **film strip** at the bottom with its pose, lens (inferred from fov) and angle (inferred from pitch) already known.
- The **mini-map** (top-left) expands into the camera plan: press to place a camera, pull to aim, rig button shoots them all, and an accept/reject **take review** (`A`/`R`) fills the strip.
- Click a strip frame → the **frame overlay**: draw the move in grease pencil, pick a move glyph, one line of action, drop a **cast chip** on the plate (3P image edit), hit **⚡** for FARM AR. Generation continues after the overlay closes (app-level watcher); the strip dot tracks queued/running/done.
- **▶ plays the board** — FARM footage where it exists, Ken Burns pencil-test elsewhere. The shooting plan (printable) and export/import live in the `⋯` menu.

UI is bound to the [open-design](https://github.com/nexu-io/open-design) **lingo** tokens (vendored in `app/src/styles.css`); controls are icon-only with tooltips. `VITE_DEMO=1` builds swap the viewer for a self-contained blockout world (`app/src/lib/demoViewer.ts`) so hosted previews work without CDN access.

### FARM AR integration

Every capture is a **posed frame** (a spatial anchor). A shot's FARM context is an ordered, user-editable list of anchors. The client (`app/src/farm/client.ts`) conforms to the canonical spec vendored at [`docs/farm_ar_api_spec.md`](docs/farm_ar_api_spec.md):

```
POST {base}/api/v2/tasks:farmAr        (account-scoped when an acct id is set)
  { prompt, referenceImages: [{imageBase64, camera}], targetCameras,
    targetFrameCount, fps, seed, cfg, numSteps, model?, depthScaleFactor? }
```

Cameras are raw Three.js camera-to-world state (pinhole intrinsics fx/fy/cx/cy + XYZW quaternion) — the server converts to OpenCV and normalizes the rig per request. The servable is stateless: the context window is exactly the `referenceImages` sent per call, later positions carry the most weight (the shot's keyframe goes **last**), and the client caps context + targets at the trained 32-frame budget. `depthScaleFactor` (settings) pins metric scale across shots in one world. The task is a long-running Operation polled until `done` → `videoUrl`. Mock mode (default) needs no network/auth; live config under **⚙ farm**.

**Initializing from a Marble scene:** a world can't be passed to FARM AR by reference — the public Task API takes only posed pinhole `reference_images` — so the scene enters the context as posed splat renders. Scout's **scan set** button banks 8 yaw-ring anchors at the current pose in one click (run it near the capture origin, where the splat is sharpest). The world's source pano as a single equirect anchor exists only in the internal farm-api context bundle, not the public Task API.

**Model discovery — Meridian:** the model pickers are fed by the Meridian control plane rather than hand-typed slugs. Settings → Meridian picks an environment (`autopush | staging | prod`), and "load models from registry" queries `GET /api/serving/v1/deployments` and `GET /api/model_registry/v1/inference_bundles` on `meridian-{env}.worldlabs.ai`, harvesting servable instance names (`farm_ar_servable_run09_v1` → Task API slug `run09-v1`; `x2p_chisel_v1` → `x2p-chisel-v1`). The data plane (`api-{env}.worldlabs.ai`: `POST /api/serving/v1/predict`, `GET /api/serving/v1/operations/{lro}`) is wrapped in `app/src/marble/meridian.ts` for tooling; product calls go through the Task API.

**Characters — the cast pass:** FARM AR has no character primitive, so humans enter through the anchors. The **cast** tab holds characters (description + reference images, uploaded or generated); in the shot editor, a third-party image-edit model (mock / Gemini image / gpt-image-1, configurable in settings) composites a character into the clean plate. Because a 2D edit never moves the camera, the cast plate inherits the clean plate's pose and replaces it as the identity anchor — the same references go into every composite, which is what keeps a character consistent across the board. The cast plate substitutes for (never joins) the clean plate in the context: two views at the same pose with different content is contradictory conditioning.

Projects persist in IndexedDB and round-trip through a self-contained JSON export (`schemas/storyboard.schema.json`).

### Run it with real Marble worlds

```bash
cd app && npm install
npm run dev     # app on :5173, viewer served same-origin at /viewer.html
npm run build   # typecheck + build into ../storyboard (commit the output)
```

Then click the **world chip** (topbar, next to the title) and paste a Marble
share URL, world id, or direct `.spz` URL. A `.spz` URL renders immediately;
ids resolve via a Developer API key (⚙ settings). The hosted Claude preview
runs `VITE_DEMO=1` inside a sandbox that cannot reach the Marble CDN, so it
always renders the built-in blockout set — a banner says so whenever a real
world is selected there. Real worlds need the app running with network
access (locally, or any static host serving this repo).

## TODO

- Pano-as-environment background for atmospheric loading
- Auto-detect coordinate frame from `assets.splats.semantics_metadata` when present
- Touch-friendly walk (virtual joystick) so mobile isn't stuck in fly mode

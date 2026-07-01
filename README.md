# block-bloc-viewer

Public splat viewer for [block-bloc](https://github.com/vsrivathsan88) worlds (sketch → Blender blockout → World Labs Marble). Loads `.spz` directly from the public Marble CDN. No auth required.

Renders via **[`@sparkjsdev/spark`](https://github.com/sparkjs-dev/spark)** — World Labs' own Gaussian splat library.

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

## TODO

- Pano-as-environment background for atmospheric loading
- Auto-detect coordinate frame from `assets.splats.semantics_metadata` when present
- Touch-friendly walk (virtual joystick) so mobile isn't stuck in fly mode

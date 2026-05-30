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
| `flip_y`   | `true`  | rotate -π/2 around X (Blender Z-up → Three Y-up) |
| `flip_z`   | `false` | 180° around Y (Marble sometimes flips front/back) |
| `scale`    | `1.0`   | uniform scale of the splat |
| `y_offset` | `0.0`   | vertical translation in meters |

Example:

```
?spz=https://cdn.marble.worldlabs.ai/<world-id>/<file>_sand_500k.spz&title=My%20Room&flip_y=true&y_offset=-1.6
```

The viewer also exposes those four knobs as live UI controls (bottom-right) — tweak in real time, click "copy URL" to capture the final settings.

## How it works

- `@sparkjsdev/spark@2.1.0` (Spark renderer + splat mesh) via esm.sh CDN
- `three@0.180.0` pinned via import map (Spark's peer dep)
- `OrbitControls` for camera (drag-to-orbit; first-person walk is a future upgrade)
- Single static HTML — no build step

## Deploy

GitHub Pages serves `index.html` from `main` branch root. First build ~10s.

## Coordinate-frame notes

Blender-rendered scenes use **Z-up**; Three.js / Spark default to **Y-up**. The viewer applies `rotation.x = -π/2` on a wrapper group when `flip_y=true` (default) so the floor sits on the world XZ plane. If your world appears sideways or upside-down, toggle the UI checkbox and copy the URL.

Marble splats from `worlds:generate` sometimes have the front-of-room facing the camera away — use `flip_z=true` to spin 180° around Y.

The metric scale and ground-plane offset are usually fine at `scale=1, y_offset=0` for indoor scenes but can be tweaked per-world.

## TODO

- First-person walk controls (WASD + mouse-look)
- Pano-as-environment background for atmospheric loading
- Auto-detect coordinate frame from `assets.splats.semantics_metadata` when present

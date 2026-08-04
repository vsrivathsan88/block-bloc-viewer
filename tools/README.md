# tools

## estimate_camera.py — recover a camera from one interior photo

Manhattan-world single-image calibration. Detects line segments, finds the room's
three vanishing points by RANSAC, and uses the orthogonality of two VPs to solve
for focal length and camera pitch.

```
pip install numpy opencv-python-headless
node tools/render_ground_truth.mjs      # renders two frames at known poses
python3 tools/estimate_camera.py        # recovers them from pixels alone
```

### Validated against known ground truth

`render_ground_truth.mjs` renders the model at two exactly-known camera poses;
`estimate_camera.py` then recovers those poses from the rendered pixels with no
access to the truth. Measured on a 1440x960 frame at 55 deg vertical FOV
(focal 922.1 px):

| view   | focal recovered | error | pitch recovered | pitch error |
|--------|-----------------|-------|-----------------|-------------|
| axis   | 906.3 px        | 1.7%  | -2.14 deg       | 0.16 deg    |
| corner | 924.4 px        | 0.2%  | -3.95 deg       | 0.11 deg    |

The corner view is better conditioned: both horizontal VPs land well away from
the principal point (791 px vs 164 px for the axis view), so the orthogonality
constraint is stronger. Aim into corners rather than straight down a room.

Two implementation notes, both of which cost a debugging round:
- Naive angle clustering merges the two horizontal families whenever the camera
  looks near-parallel to one of them — it returned two VPs from the *same*
  family and the orthogonality product came out the wrong sign. RANSAC with
  sequential inlier removal fixes it.
- Vanishing points give lens and rotation but *not* scale. One known dimension
  in frame (or told to me) is still required to fix absolute size.

## render_ground_truth.mjs

Drives roomplanner.html to exact camera poses and records the truth.

Note it poses the camera through `window.DEBUG.fly`, not `camera.lookAt()`.
OrbitControls' `update()` re-aims the camera at its own target every frame and
silently discards a `lookAt` — the fly path bypasses it.

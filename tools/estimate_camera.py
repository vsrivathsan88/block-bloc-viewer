"""Recover focal length and camera pitch from a single interior photo.

Manhattan-world method: detect line segments, find vanishing points by RANSAC
(rather than by naive angle clustering, which merges the two horizontal
families whenever the camera looks near-parallel to one of them), then use the
orthogonality of two VPs to solve for focal length.
"""
import cv2, numpy as np, json, sys

rng = np.random.default_rng(7)

def segments(path, minlen=45):
    img = cv2.imread(path)
    H, W = img.shape[:2]
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    s = cv2.createLineSegmentDetector().detect(g)[0]
    s = s.reshape(-1, 4) if s is not None else np.empty((0, 4))
    L = np.hypot(s[:, 2] - s[:, 0], s[:, 3] - s[:, 1])
    return s[L > minlen], L[L > minlen], W, H

def consistency(seg, vp):
    """cos-angle between a segment's direction and the direction from its
    midpoint to the candidate VP. 1.0 = the segment points exactly at the VP."""
    mx, my = (seg[:, 0] + seg[:, 2]) / 2, (seg[:, 1] + seg[:, 3]) / 2
    dx, dy = seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1]
    n = np.hypot(dx, dy) + 1e-9
    vx, vy = vp[0] - mx, vp[1] - my
    m = np.hypot(vx, vy) + 1e-9
    return np.abs((dx * vx + dy * vy) / (n * m))

def refine(seg, w):
    p1 = np.column_stack([seg[:, 0], seg[:, 1], np.ones(len(seg))])
    p2 = np.column_stack([seg[:, 2], seg[:, 3], np.ones(len(seg))])
    li = np.cross(p1, p2)
    li /= np.linalg.norm(li[:, :2], axis=1, keepdims=True) + 1e-9
    _, _, Vt = np.linalg.svd((li * w[:, None]).T @ li)
    v = Vt[-1]
    return v[:2] / v[2] if abs(v[2]) > 1e-9 else None

def ransac_vp(seg, w, iters=3000, tol=0.9985):
    best, bestscore = None, -1
    n = len(seg)
    if n < 8: return None, np.zeros(n, bool), 0
    for _ in range(iters):
        i, j = rng.integers(0, n, 2)
        if i == j: continue
        a, bq = seg[i], seg[j]
        l1 = np.cross([a[0], a[1], 1], [a[2], a[3], 1])
        l2 = np.cross([bq[0], bq[1], 1], [bq[2], bq[3], 1])
        v = np.cross(l1, l2)
        if abs(v[2]) < 1e-9: continue
        v = v[:2] / v[2]
        if not np.all(np.isfinite(v)) or np.abs(v).max() > 1e6: continue
        inl = consistency(seg, v) > tol
        sc = w[inl].sum()
        if sc > bestscore: bestscore, best = sc, v
    if best is None: return None, np.zeros(n, bool), 0
    inl = consistency(seg, best) > tol
    v = refine(seg[inl], w[inl]) if inl.sum() >= 2 else best
    return (v if v is not None else best), inl, int(inl.sum())

def solve(path):
    seg, L, W, H = segments(path)
    ang = np.degrees(np.arctan2(seg[:, 3] - seg[:, 1], seg[:, 2] - seg[:, 0])) % 180
    vert = np.abs(ang - 90) < 22
    out = {'file': path, 'segments': int(len(seg)), 'vertical_segs': int(vert.sum())}

    # two horizontal VPs, found sequentially so the second cannot reuse the first
    hs, hw = seg[~vert], L[~vert]
    v1, in1, n1 = ransac_vp(hs, hw)
    rest = ~in1
    v2, in2, n2 = ransac_vp(hs[rest], hw[rest]) if rest.sum() >= 8 else (None, None, 0)
    vv = refine(seg[vert], L[vert]) if vert.sum() >= 6 else None

    p = np.array([W / 2.0, H / 2.0])
    out['vp_h1'] = None if v1 is None else [round(float(x), 1) for x in v1]
    out['vp_h1_support'] = n1
    out['vp_h2'] = None if v2 is None else [round(float(x), 1) for x in v2]
    out['vp_h2_support'] = n2

    f = None
    if v1 is not None and v2 is not None:
        d = -float(np.dot(v1 - p, v2 - p))
        cond = min(np.linalg.norm(v1 - p), np.linalg.norm(v2 - p))
        out['orthogonality_dot'] = round(-d, 1)
        if d > 0:
            f = float(np.sqrt(d))
            out['focal_px'] = round(f, 1)
            out['vfov_deg'] = round(float(2 * np.degrees(np.arctan((H / 2) / f))), 2)
        else:
            out['focal_px'] = None
            out['note'] = 'orthogonality dot has the wrong sign — VPs are not an orthogonal pair'
        out['weaker_vp_dist_px'] = round(float(cond), 0)
    if f and vv is not None:
        # verticals converge far below the frame for a down-pitched camera;
        # pitch = -atan(f / dy). (No -90 term — that was an earlier slip.)
        out['pitch_deg'] = round(float(-np.degrees(np.arctan2(f, vv[1] - p[1]))), 2)
        out['vp_vert'] = [round(float(x), 1) for x in vv]
    return out

truth = json.load(open('gt-truth.json'))
for name in ('axis', 'corner'):
    r = solve(f'gt-{name}.png')
    t = truth[name]
    print(f"\n=== {name} view ===")
    print(json.dumps(r, indent=1))
    if r.get('focal_px'):
        ef = 100 * abs(r['focal_px'] - t['focal_px']) / t['focal_px']
        print(f"  focal: got {r['focal_px']} vs true {t['focal_px']}  -> {ef:.1f}% error")
        print(f"  vfov : got {r['vfov_deg']} vs true {t['fov']} deg")
    if r.get('pitch_deg') is not None:
        print(f"  pitch: got {r['pitch_deg']} vs true {t['pitch_deg']} deg"
              f"  -> {abs(r['pitch_deg']-t['pitch_deg']):.2f} deg error")

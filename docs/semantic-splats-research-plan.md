# Semantic Splats: Literature Review & Autoresearch Plan

Goal: give block-bloc-viewer (and the Marble pipeline behind it) two core capabilities —

1. **Cluster** the splats of a scene into semantically meaningful groups, each with a stable semantic/instance ID.
2. **Query** splats by semantic ID — programmatically (`getSplats("sofa")`, `getSplats(id=17)`) and interactively (click an object, type a text query).

This document surveys the relevant literature, maps it onto our constraints (pre-trained `.spz` splats from Marble, a no-build Spark.js browser viewer), proposes a concrete architecture, and lays out a phased autoresearch plan with experiments, metrics, and decision gates that an autonomous agent fleet can execute.

**Architecture decision (v2):** the pipeline is *superpoints-first, semantics-on-clusters*. We over-segment the Gaussians geometrically into small clumps ("superpoints") with no rendering and no AI models, then use a small semantic signal (few views, panoramas, or a point-cloud model) to merge clumps into named objects. Geometry alone never decides object boundaries; 2D/3D foundation models never operate at raw-particle scale. See §3.

---

## 1. Paper landscape

The field splits into four families. The axis that matters most for us is **whether the method needs per-scene training with the original capture images** — we generally receive a finished `.spz` from the Marble CDN, not a training rig.

### 1.1 Per-scene trained instance/identity fields

These attach a learned feature or identity vector to every Gaussian during (or after) 3DGS optimization, supervised by SAM masks made view-consistent.

| Paper | Venue | Core idea |
|---|---|---|
| [Gaussian Grouping](https://arxiv.org/abs/2312.00732) | ECCV 2024 | Adds a 16-dim "identity encoding" per Gaussian; SAM masks associated across views by a zero-shot tracker; enables segment-then-edit (delete, recolor, inpaint) |
| [SAGA / Segment Any Gaussians](https://arxiv.org/abs/2312.00860) | 2024 | Distills SAM features into per-Gaussian features with scale-gating for multi-granularity |
| [Click-Gaussian](https://arxiv.org/abs/2407.11793) | ECCV 2024 | Two-level (coarse/fine) granularity feature field; interactive click-to-segment at real-time rates |
| [OmniSeg3D](https://arxiv.org/abs/2311.11666) (GS variant) | CVPR 2024 | Hierarchical contrastive learning → a granularity slider instead of fixed classes |
| [GARField](https://arxiv.org/abs/2401.09419) | CVPR 2024 | Scale-conditioned affinity field; decompose scene into a hierarchy of groups (part → object → region) |
| [GaussianCut](https://arxiv.org/abs/2411.07555) | NeurIPS 2024 | Graph cut over a Gaussian adjacency graph seeded by user clicks — minimal learning, interactive |

**Takeaway:** the *supervision recipe* (SAM masks + cross-view ID association) is the field's consensus. The *training* part is what we avoid.

### 1.2 Language-embedded fields (open-vocabulary query)

These distill CLIP-family features into the scene so free-text queries work.

| Paper | Venue | Core idea |
|---|---|---|
| [LangSplat](https://arxiv.org/abs/2312.16084) | CVPR 2024 (highlight) | Per-scene autoencoder compresses CLIP to 3-dim latents on Gaussians; SAM's three granularities |
| [LangSplatV2](https://arxiv.org/abs/2507.07136) | 2025 | Each Gaussian = sparse code over a **global codebook**; 42× faster than LangSplat |
| [LEGaussians](https://www.computer.org/csdl/proceedings-article/cvpr/2024/530000f333/20hMENoQal2) | CVPR 2024 | Quantized semantic features per Gaussian; uncertainty handling for multi-view inconsistency |
| [Feature 3DGS](https://arxiv.org/abs/2312.03203) / [FMGS](https://arxiv.org/abs/2401.01970) | CVPR 2024 / IJCV 2024 | General distilled feature fields (SAM, CLIP, DINO) rendered alongside RGB |
| [OpenGaussian](https://arxiv.org/abs/2406.02058) | NeurIPS 2024 | **Point-level** instance features + coarse-to-fine codebook discretization → discrete 3D instance IDs, then per-instance CLIP |
| [Identity-aware Language GS](https://openaccess.thecvf.com/content/ICCV2025/papers/Jang_Identity-aware_Language_Gaussian_Splatting_for_Open-vocabulary_3D_Semantic_Segmentation_ICCV_2025_paper.pdf) | ICCV 2025 | Couples instance identity with language field to fix "fuzzy boundary" queries |
| [SuperGSeg](https://arxiv.org/abs/2412.10231) | 3DV 2026 | Structured **super-Gaussians** — segmentation over clusters rather than raw primitives |
| [OpenSplat3D](https://openaccess.thecvf.com/content/CVPR2025/papers/OpenSplat3D) | CVPR 2025 | Open-vocabulary **instance** segmentation; instance features + mask-based language association |
| [ReferSplat](https://arxiv.org/abs/2508.08252) | 2025 | Referring expressions ("the chair closest to the window") — spatial-relational queries |

**Takeaway:** the modern recipe is *instances first, language second*: segment into discrete 3D instances, then attach **one CLIP/SigLIP embedding per instance** (not per Gaussian). Cheaper, crisper boundaries, and it matches our spec: IDs are the primary key; text queries resolve to IDs.

### 1.3 Training-free / post-hoc lifting ← **our sweet spot**

These take a **pre-trained** 3DGS scene plus 2D masks/features and assign labels to Gaussians with no gradient descent.

| Paper | Venue | Core idea |
|---|---|---|
| [FlashSplat](https://www.ecva.net/papers/eccv_2024/papers_ECCV/papers/03300.pdf) | ECCV 2024 | 2D→3D mask lifting posed as a **linear program with a one-step solution** using accumulated α-blending contributions; ~30 s/scene; background-bias term for robustness |
| [SAGD](https://arxiv.org/abs/2401.17857) | 2024 | Project Gaussian centers into 2D masks + boundary-enhanced handling of boundary-straddling Gaussians |
| [LUDVIG](https://arxiv.org/abs/2410.14462) | 2025 | Learning-free **inverse rendering** uplifting: aggregate any 2D feature onto Gaussians weighted by rendering contribution; optional graph-diffusion refinement |
| [LBG / Lifting by Gaussians](https://openaccess.thecvf.com/content/WACV2025/papers/Chacko_Lifting_by_Gaussians_A_Simple_Fast_and_Flexible_Method_for_WACV_2025_paper.pdf) | WACV 2025 | Per-view mask lifting + incremental cross-view merging by semantic & geometric overlap |
| [THGS](https://www.alphaxiv.org/overview/2504.13153v1) | ACM MM 2025 | **Training-free hierarchical understanding via superpoint graphs** built directly from Gaussian primitives; 2D features reprojected onto superpoints; 30–100× speedups |
| [Open-Vocabulary SAM3D](https://arxiv.org/abs/2405.15580) | 2024 | Training-free 3D understanding using superpoints as 3D prompts — point-cloud-direct, minimal rendering |
| [GaussianCut](https://arxiv.org/abs/2411.07555) | NeurIPS 2024 | (also fits here) graph cut on Gaussians from clicks/scribbles — no training |

**Takeaway:** training-free lifting is mature and fast, and the 2025 efficiency wave (THGS, SuperGSeg) converges on the same structural idea: **don't label a million particles; label ~10k geometric clumps.**

### 1.4 Feed-forward / generalizable

[SemanticSplat](https://arxiv.org/abs/2506.09565) (2025) and successors predict language-aware Gaussian fields in a single forward pass from images. Relevant long-term (Marble could emit semantics natively at generation time), but not the fastest path for this viewer.

### 1.5 Surveys worth keeping open

- [A Survey on 3DGS Applications: Segmentation, Editing, Generation](https://arxiv.org/abs/2508.09977) (TPAMI 2026) with its [Awesome list](https://github.com/heshuting555/Awesome-3DGS-Applications) — maintained taxonomy of everything above.

---

## 2. Our constraints, and the key unlocks

**Constraints**

- Input is a finished `.spz` from the Marble CDN (100k–2M+ Gaussians). We may not have the generating views/poses at hand.
- Viewer is no-build, browser-only: Three.js 0.180 + `@sparkjsdev/spark` 2.1.0 (`index.html`). Heavy compute happens offline; the viewer consumes artifacts.
- Marble world assets already ship `assets.splats.semantics_metadata` in the API response (mentioned in `README.md:64`, currently unused) — **first action item: characterize exactly what's in it.** If Marble already provides per-splat or renderable semantics, the pipeline phases become validation rather than invention.

**Unlock #1 — the splat is its own dataset.** A pre-trained 3DGS scene is a photorealistic novel-view synthesizer: we can render RGB from any pose and lift 2D model outputs back onto the exact Gaussians that produced each pixel, with rasterizer-exact contribution weights. No original capture data needed.

**Unlock #2 — the panorama shortcut (Marble-specific).** Our worlds are single rooms generated from panoramas. One 360° render from the room center sees almost everything, so 2–4 panorama renders (or their cube faces) can replace ~100 pinhole shots for coverage. Academic datasets aren't single rooms, so no paper exploits this — for us it's nearly free.

**Unlock #3 — semantics can operate on clumps, not particles.** Geometric over-segmentation into superpoints is view-free and model-free, and reduces the labeling problem from ~1M particles to ~10k clumps (THGS's 30–100× speedups come from exactly this).

**Feasibility in the viewer (verified against Spark docs/source):**

- `PackedSplats` exposes per-splat CPU read/write (`getSplat`/`setSplat`/`forEachSplat`) and an `extra` side-channel already used for SH coefficients — a natural home for a `semanticId: Uint32Array`.
- The `dyno` shader-graph `Gsplat` struct carries the splat **index**, so a `worldModifier` can fetch a per-splat ID from a `DataTexture` and recolor/dim/hide per-object **on the GPU at render time**.
- `SplatMesh.raycast()` (WASM ray-splat intersection) gives click → splat position → nearest splat index → semantic ID.
- Spark loads `.ply`, `.spz`, `.sog`, `.ksplat` — sidecar or extended-PLY label channels are all ingestible.

---

## 3. Proposed architecture: superpoints first, semantics on clusters

```
                     OFFLINE (Python, GPU box or CI job)
.spz ──► gsplat loader
  │
  ├─► STAGE A: superpoint over-segmentation            [THGS, SuperGSeg]
  │     kNN graph over Gaussians (position, color, scale)
  │     → ~10k small clumps; each clump ⊂ one object (by construction)
  │     view-free, model-free, seconds
  │
  ├─► STAGE B: semantic signal (bake-off, pick cheapest that passes gate)
  │     (a) 2–4 panorama renders + SAM 2 masks          [Marble shortcut]
  │     (b) 10–30 pinhole renders + SAM 2 video-tracked  [Gaussian Grouping's
  │         masks along a smooth camera path              association idea]
  │     (c) point-cloud model on Gaussian centers,       [OV-SAM3D, Mask3D]
  │         zero renders
  │
  ├─► STAGE C: clump → object merge
  │     masks vote on clumps via rendering-contribution weights
  │     (FlashSplat-style one-step assignment, at clump granularity;
  │      LUDVIG-style graph diffusion fills occluded clumps)
  │     → object instance IDs; parentId field keeps hierarchy    [GARField]
  │
  ├─► STAGE D: naming & embeddings                       [OpenMask3D recipe]
  │     per instance: best-view crops → SigLIP/CLIP →
  │     label from room ontology (+ synonyms), one embedding per instance
  │
  ▼
        ARTIFACTS (the "semantic sidecar")
┌──────────────────────────────────────────────────────────┐
│ ids.bin        uint16/uint32 per splat (instance ID)      │
│ superpoints.bin (optional) clump ID per splat + graph     │
│ manifest.json  id → {label, synonyms, bbox, count,        │
│                      centroid, color, parentId}           │
│ embeds.bin     (optional) per-instance SigLIP vector      │
└──────────────────────────────────────────────────────────┘
                             │
              VIEWER (this repo, no build step)
  fetch sidecar ──► PackedSplats.extra.semanticId
               ──► DataTexture keyed by splat index
               ──► dyno worldModifier: highlight/isolate/hide/tint
  click ──► SplatMesh.raycast ──► splat ──► ID ──► manifest card
  click-to-refine (optional): graph propagation on superpoints   [GaussianCut]
  text query ──► manifest label/synonym match (embeds optional)
```

Design rules distilled from the literature:

1. **Geometry never decides object boundaries** — it only over-segments. Pure geometric clustering fails on touching objects (cushion-on-sofa, book-on-table); every strong method uses 2D foundation-model masks or 3D semantic features for the merge decision.
2. **Semantics never operates at raw-particle scale** — clump-level labeling is 100× cheaper and inherently view-consistent (a clump is a 3D entity; per-view mask flicker averages out over its many pixels).
3. **Instances first, language second** — one embedding/label per object, not per particle.

### 3.1 What we take from which paper

| Ingredient | Source paper(s) | What we borrow | What we drop |
|---|---|---|---|
| Superpoint graph over Gaussians | THGS (MM 2025), SuperGSeg (3DV 2026) | Graph construction + hierarchy, clump-level feature reprojection | SuperGSeg's learned features (we stay training-free) |
| Optimal mask→3D assignment | FlashSplat (ECCV 2024) | One-step contribution-weighted assignment + background-bias term, applied at clump level | Per-Gaussian granularity |
| Contribution-weighted lifting & graph diffusion | LUDVIG (2025) | Inverse-rendering weights; diffusion to fill occluded/unseen clumps | — |
| Cross-view mask identity | Gaussian Grouping (ECCV 2024) + SAM 2 | "Track masks like a video" — trivial for us since we control the camera path | The per-scene identity-field training |
| Zero-render baseline | Open-Vocabulary SAM3D, Mask3D lineage | Point-cloud instance segmentation on Gaussian centers as bake-off arm (c) | — |
| Instances-first language attachment | OpenMask3D, OpenGaussian, OpenSplat3D | Best-view crops → one CLIP/SigLIP embedding + label per instance | Codebook training |
| Hierarchy (part→object→region) | GARField, THGS | Single `parentId` field in manifest; granularity slider later | Scale-conditioned field training |
| Interactive click-refine | GaussianCut (NeurIPS 2024) | Graph propagation on our superpoint graph for click-to-select | — |
| Referring queries | ReferSplat (2025) | Manifest bboxes + LLM resolver for "the chair near the window" (stretch) | Its trained matching model |
| Bake-at-generation endgame | SemanticSplat (2025) | Direction for the Marble team: emit labels during generation | — |
| Storage | SPZ v4 [extensions spec](https://github.com/nianticlabs/spz/blob/main/extensions/README.md) | Vendor extension as long-term home for per-splat IDs | — |

Format notes:

- **Sidecar first** (`<world>.semantics.json` + `ids.bin`): zero coupling to splat encoding, cacheable on the CDN next to the `.spz`, versionable.
- **SPZ v4 vendor extension** as the durable long-term home once the schema stabilizes.

---

## 4. Autoresearch plan

Phased so each phase has a falsifiable exit gate; an agent fleet can parallelize *within* phases and must stop at gates. Estimated agent-time assumes one A100/4090-class GPU for offline phases.

### Phase 0 — Ground truth on our own data (1–2 days)

- **P0.1** Pull the Marble API response for our demo worlds; dump and document `assets.splats.semantics_metadata` — schema, whether it's per-splat, per-region, or just frame/scale metadata. *(Internal advantage: we are World Labs — ask the Marble team what semantic exports exist or are planned before rebuilding them. Also raise the SemanticSplat-style "bake at generation" question.)*
- **P0.2** Stand up the offline harness: load demo `.spz` (living-room, teal-bedroom) with `gsplat`; verify both pinhole and **panorama/cube-face** rendering quality (SH0-only spz ⇒ check for view-dependent artifacts).
- **P0.3** Pick eval sets: our 2 Marble rooms (hand-labeled ~15 objects each) **plus** LERF-OVS and 3D-OVS (or ScanNet subsets) where published numbers exist for comparison.
- **Gate:** semantics_metadata characterized; harness renders pinholes + panoramas; eval protocol written down (2D mIoU on held-out renders, per-instance 3D IoU vs hand labels, query recall@1).

### Phase 1 — Superpoint over-segmentation (2–4 days)

Build Stage A: kNN graph over Gaussians using position + color (+ scale/opacity); cut into ~5–20k clumps (region-growing or graph partition, THGS-style). View-free, model-free.

- Ablate: neighbor count, edge weights (position-only vs +color), clump size targets, handling of floaters/near-zero-opacity Gaussians.
- **Metrics:** **purity** (fraction of clumps that do not straddle two hand-labeled objects — the one number that matters), clump count, runtime, coverage.
- **Gate:** ≥98% purity at ≤20k clumps, runtime in seconds on a 1M-splat room. Purity failures concentrated at object boundaries are acceptable (soft assignment later); failures merging *distinct* objects into one clump are not.
- Deliverable is reusable: the same graph powers click-to-select propagation (P4) and label smoothing (P2).

### Phase 2 — Semantic merge bake-off: clump → named object (1 week)

Run Stage B/C with three competing semantic signals, cheapest first:

- **P2.a Panorama shortcut:** 2–4 equirect renders from room interior → SAM 2 on cube faces → masks vote on clumps (FlashSplat-style assignment at clump level).
- **P2.b Sparse pinhole + tracking:** 10–30 views along a smooth path → SAM 2 video propagation for cross-view identity → clump voting.
- **P2.c Zero-render point-cloud:** Open-Vocabulary SAM3D / Mask3D-class model on Gaussian centers → per-point instances → majority vote per clump.
- Shared post-pass: LUDVIG-style graph diffusion on the superpoint graph to fill occluded clumps; small-cluster merge rules; "stuff vs things" handling (floor/walls as semantic-but-not-instance).
- **Metrics:** #instances vs hand count, per-instance 3D IoU, split/merge errors, leakage rate, wall-clock and GPU-cost per scene, determinism across runs.
- **Gate:** ≥90% of hand-labeled objects recovered as single clusters (≤1 split or merge each) on both rooms. **Pick the cheapest signal that passes**; keep the 100-view dense lift only as a quality ceiling to measure against. Fallback if all fail: per-scene identity training (Gaussian Grouping).

### Phase 3 — Labels, embeddings, and text query (3–5 days)

- Per instance: render 3–5 best views (max visibility), crop, embed with SigLIP; label via open-vocab classification over a room ontology (seeded from blockout schema vocab: sofa, coffee_table, rug, lamp…) + CLIP-similarity synonyms (OpenMask3D recipe).
- Query resolution order: exact label → synonym table → (optional) embedding search. Keep embeddings out of v1 viewer unless label matching proves insufficient.
- **Metrics:** label accuracy vs hand labels; query recall@1 for a 50-query benchmark ("tv", "the plant", "something to sit on").
- **Gate:** ≥90% recall@1 → freeze sidecar schema v1.

### Phase 4 — Viewer integration (this repo) (1 week, parallel from day one)

- **P4.1** Sidecar loader: fetch `ids.bin` + `manifest.json` via `?semantics=<url>` param (mirrors existing `?collider=` pattern in `index.html`).
- **P4.2** GPU highlight path: `DataTexture` of per-splat IDs + dyno `worldModifier` → isolate / dim-others / tint / hide by ID set; verify 60 fps at 1M splats. **Start immediately against a fake sidecar** (IDs from k-means on splat positions) so frontend and pipeline develop concurrently against the frozen schema.
- **P4.3** Interaction: click → `raycast` → nearest-splat → ID → outline + manifest card; object list panel with per-object show/hide; text box resolving label queries; optional GaussianCut-style click-refine on the superpoint graph.
- **P4.4** JS API: `window.SEMANTICS = { ids(), query(text), select(id), isolate(ids), hide(ids), export(ids) }` — the programmatic contract, also usable by the headless recorder.
- **Gate:** demo: type "sofa" → sofa glows, everything else dims; click lamp → card with label + bbox; toggle rug off; interactive framerate on the living-room world.

### Phase 5 — Stretch tracks (pick by P0 findings + user demand)

- SPZ v4 vendor-extension writer/reader for per-splat IDs (kill the sidecar).
- Splat-subset **export**: selected IDs → standalone `.spz`/`.ply` (asset extraction).
- Auto-generate `schemas/*.json` blockout (walls/furniture bboxes with labels) from the semantic clusters — closes the loop with `blockout.html`.
- Object **deletion + hole handling** (viewer-side v1: delete and accept holes; Gaussian Grouping's inpainting later).
- Hierarchical IDs + granularity slider (GARField/THGS `parentId`).
- ReferSplat-style relational queries ("the chair near the window") via manifest bboxes + an LLM resolver.

### Standing risks to watch

| Risk | Mitigation |
|---|---|
| Gaussians genuinely shared between objects (α-blending means one splat contributes to several surfaces) | soft assignment weights at clump boundaries; FlashSplat background-bias; report leakage metric every phase |
| Superpoint purity too low on cluttered scenes (clumps straddle objects) | tighten clump size; add DINOv2-feature edge weights as an escalation before abandoning the scaffold |
| Marble spz is SH0-truncated → self-renders lose view-dependence; SAM may segment differently than real captures | acceptable for masks; validate in P0.2 |
| Point-cloud models (P2.c) trained on real scans may transfer poorly to Gaussian centers | it's one bake-off arm, not the plan; measured, not assumed |
| Fine structures (plant leaves, lamp cords) fragment | minimum-cluster merge + parentId hierarchy |
| Viewer memory: +4 bytes/splat ID texture at 2M splats = 8 MB | fine; uint16 (65k instances) halves it |
| semantics_metadata may already solve part of this | that's why it's P0.1, not P5 |

---

## 5. What else would users want? (beyond cluster + query)

Roughly ordered by expected demand, with the cheap-once-we-have-IDs items marked ⚡:

1. ⚡ **Click-to-identify** (inverse query): click anything → name, bbox, ID. Falls out of raycast + IDs.
2. ⚡ **Isolate / hide / show-only**: "hide the ceiling", "show only furniture" — inspection, screenshots, debugging generated worlds.
3. **Extract & export**: select the armchair → download it as its own `.spz`/`.ply`. Turns every world into an asset library — likely the highest-value pro feature.
4. **Delete / defurnish**: empty-room variants (staging inverse, robotics domain randomization).
5. ⚡ **Recolor / restyle per object**: Spark's SplatEdit already does spatial RGBA edits; ID-scoped edits are strictly better.
6. **Scene inventory / scene graph JSON**: labels, counts, bboxes, support relations ("lamp *on* table"). What agent/robotics/sim customers ask for — and it auto-generates our `blockout.html` schemas.
7. **Spatial + relational queries**: "what's on the coffee table", measurements between objects (metric scale is in Marble metadata).
8. **Semantic navigation**: "take me to the kitchen" → camera fly-to; semantic minimap; per-class walk-mode collision.
9. **Granularity control**: part ↔ object ↔ region slider (cushion vs sofa vs seating area).
10. **Move / duplicate objects**: full scene editing. Hard (holes, baked shadows); deletion + inpainting is the published path.
11. **Sim-ready export**: USD/GLB with semantic labels + per-class colliders for Isaac/MuJoCo pipelines.
12. **Consistent IDs across worlds**: same ontology every scene, so re-generated worlds are diffable ("did the new generation keep the fireplace?").

---

## 6. Immediate next actions

1. **P0.1** — dump `assets.splats.semantics_metadata` for the two demo worlds; loop in the Marble API team on existing/planned semantic exports and the bake-at-generation question.
2. Spin up the offline harness (Python: `gsplat` + SAM 2 + SigLIP); implement Stage A superpoint graph on the living-room world and measure purity (P1).
3. In parallel, prototype the viewer's GPU highlight path (P4.2) against a **fake sidecar** (IDs from k-means on splat positions) so the frontend and pipeline develop concurrently against the frozen sidecar schema.

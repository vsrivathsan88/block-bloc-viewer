# Semantic Splats: Literature Review & Autoresearch Plan

Goal: give block-bloc-viewer (and the Marble pipeline behind it) two core capabilities —

1. **Cluster** the splats of a scene into semantically meaningful groups, each with a stable semantic/instance ID.
2. **Query** splats by semantic ID — programmatically (`getSplats("sofa")`, `getSplats(id=17)`) and interactively (click an object, type a text query).

This document surveys the relevant literature, maps it onto our constraints (pre-trained `.spz` splats from Marble, a no-build Spark.js browser viewer), proposes a concrete architecture, and lays out a phased autoresearch plan with experiments, metrics, and decision gates that an autonomous agent fleet can execute.

---

## 1. Paper landscape

The field splits into four families. The axis that matters most for us is **whether the method needs per-scene training with the original capture images** — we generally receive a finished `.spz` from the Marble CDN, not a training rig.

### 1.1 Per-scene trained instance/identity fields

These attach a learned feature or identity vector to every Gaussian during (or after) 3DGS optimization, supervised by SAM masks made view-consistent.

| Paper | Venue | Core idea |
|---|---|---|
| [Gaussian Grouping](https://arxiv.org/abs/2312.00732) | ECCV 2024 | Adds a 16-dim "identity encoding" per Gaussian; SAM masks associated across views by a zero-shot tracker; enables segment-then-edit (delete, recolor, inpaint) |
| [SAGA / Segment Any Gaussians](https://arxiv.org/abs/2312.00860) | 2024 | Distills SAM features into per-Gaussian features with scale-gating for multi-granularity |
| [Click-Gaussian](https://arxiv.org/abs/2407.11793) | ECCV 2024 | Two-level (coarse/fine) granularity feature field; interactive click-to-segment at real-time rates; global feature-guided learning to resolve cross-view mask inconsistency |
| [OmniSeg3D](https://arxiv.org/abs/2311.11666) (GS variant) | CVPR 2024 | Hierarchical contrastive learning → a granularity slider instead of fixed classes |
| [GARField](https://arxiv.org/abs/2401.09419) | CVPR 2024 | Scale-conditioned affinity field; decompose scene into a hierarchy of groups (part → object → region) |
| [GaussianCut](https://arxiv.org/abs/2411.07555) | NeurIPS 2024 | Graph cut over a Gaussian adjacency graph seeded by user clicks — minimal learning, interactive |

**Takeaway:** the *supervision recipe* (SAM masks + cross-view ID association + contrastive pull/push) is the field's consensus. The *training* part is what we want to avoid or replace.

### 1.2 Language-embedded fields (open-vocabulary query)

These distill CLIP-family features into the scene so free-text queries work.

| Paper | Venue | Core idea |
|---|---|---|
| [LangSplat](https://arxiv.org/abs/2312.16084) | CVPR 2024 (highlight) | Per-scene autoencoder compresses CLIP to 3-dim latents on Gaussians; SAM's three granularities |
| [LangSplatV2](https://arxiv.org/abs/2507.07136) | 2025 | Each Gaussian = sparse code over a **global codebook**; 42× faster than LangSplat (450+ FPS high-dim feature splatting) |
| [LEGaussians](https://www.computer.org/csdl/proceedings-article/cvpr/2024/530000f333/20hMENoQal2) | CVPR 2024 | Quantized semantic features per Gaussian; uncertainty handling for multi-view inconsistency |
| [Feature 3DGS](https://arxiv.org/abs/2312.03203) / [FMGS](https://arxiv.org/abs/2401.01970) | CVPR 2024 / IJCV 2024 | General distilled feature fields (SAM, CLIP, DINO) rendered alongside RGB |
| [OpenGaussian](https://arxiv.org/abs/2406.02058) | NeurIPS 2024 | **Point-level** (not pixel-level) instance features + coarse-to-fine codebook discretization → discrete 3D instance IDs, then per-instance CLIP. Closest published shape to our "cluster + query" spec |
| [Identity-aware Language GS](https://openaccess.thecvf.com/content/ICCV2025/papers/Jang_Identity-aware_Language_Gaussian_Splatting_for_Open-vocabulary_3D_Semantic_Segmentation_ICCV_2025_paper.pdf) | ICCV 2025 | Couples instance identity with language field to fix "fuzzy boundary" queries |
| [SuperGSeg](https://arxiv.org/abs/2412.10231) | 3DV 2026 | Structured **super-Gaussians** — segmentation over clusters rather than raw primitives (big efficiency win) |
| [OpenSplat3D](https://openaccess.thecvf.com/content/CVPR2025/papers/OpenSplat3D) | CVPR 2025 | Open-vocabulary **instance** segmentation with instance features + contrastive loss + mask-based language association |
| [ReferSplat](https://arxiv.org/abs/2508.08252) | 2025 | Referring expressions ("the chair closest to the window") — spatial-relational queries |

**Takeaway:** the modern recipe is *instance IDs first, language second*: segment into discrete 3D instances, then attach **one CLIP/SigLIP embedding per instance** (not per Gaussian). That is dramatically cheaper, gives crisp boundaries, and matches our spec exactly (IDs are the primary key; text queries resolve to IDs).

### 1.3 Training-free / post-hoc lifting ← **our sweet spot**

These take a **pre-trained** 3DGS scene plus 2D masks/features and assign labels to Gaussians with no gradient descent.

| Paper | Venue | Core idea |
|---|---|---|
| [FlashSplat](https://www.ecva.net/papers/eccv_2024/papers_ECCV/papers/03300.pdf) | ECCV 2024 | 2D→3D mask lifting posed as a **linear program with a closed-form/one-step solution** using accumulated α-blending contributions; ~30 s/scene, ~50× faster than gradient methods; background-bias term for robustness |
| [SAGD](https://arxiv.org/abs/2401.17857) | 2024 | Gaussian Decomposition: project Gaussian centers into 2D masks + boundary-enhanced handling of "boundary-straddling" Gaussians |
| [LUDVIG](https://arxiv.org/abs/2410.14462) | 2025 | Learning-free **inverse rendering** uplifting: aggregate any 2D feature (DINOv2, CLIP, SAM masks) onto Gaussians weighted by each Gaussian's rendering contribution; optional graph-diffusion refinement over a 3DGS affinity graph |
| [LBG / Lifting by Gaussians](https://openaccess.thecvf.com/content/WACV2025/papers/Chacko_Lifting_by_Gaussians_A_Simple_Fast_and_Flexible_Method_for_WACV_2025_paper.pdf) | WACV 2025 | Per-view mask lifting + incremental cross-view merging by semantic & geometric overlap; also lifts CLIP/DINO features per fragment |
| [iSegMan](https://arxiv.org/abs/2502.pending) | CVPR 2025 | Visibility-guided voting from 2D SAM masks to Gaussians |
| [THGS](https://github.com/heshuting555/Awesome-3DGS-Applications) | 2025 | Training-free **hierarchical** understanding via superpoint graphs on Gaussians |
| [GaussianCut](https://arxiv.org/abs/2411.07555) | NeurIPS 2024 | (also fits here) graph cut on Gaussians from clicks/scribbles — no training |

**Takeaway:** training-free lifting is mature, fast, and fits a batch pipeline. FlashSplat-style optimal assignment and LUDVIG-style contribution-weighted aggregation are the two reference algorithms to reproduce first.

### 1.4 Feed-forward / generalizable

[SemanticSplat](https://arxiv.org/abs/2506.09565) (2025) and successors predict language-aware Gaussian fields in a single forward pass from images. Relevant long-term (Marble could emit semantics natively at generation time), but not the fastest path for this viewer.

### 1.5 Surveys worth keeping open

- [A Survey on 3DGS Applications: Segmentation, Editing, Generation](https://arxiv.org/abs/2508.09977) (TPAMI 2026) with its [Awesome list](https://github.com/heshuting555/Awesome-3DGS-Applications) — maintained taxonomy of everything above.

---

## 2. Our constraints, and the key unlock

**Constraints**

- Input is a finished `.spz` from the Marble CDN (100k–2M+ Gaussians). We may not have the generating views/poses at hand in the viewer context.
- Viewer is no-build, browser-only: Three.js 0.180 + `@sparkjsdev/spark` 2.1.0 (`index.html`). Heavy compute must happen offline; the viewer consumes artifacts.
- Marble world assets already ship `assets.splats.semantics_metadata` in the API response (mentioned in `README.md:64`, currently unused) — **first action item: characterize exactly what's in it.** If Marble already provides per-splat or renderable semantics, phases 1–2 below become validation rather than invention.

**The key unlock: the splat is its own dataset.** A pre-trained 3DGS scene is a photorealistic novel-view synthesizer. We can render RGB from *any* camera pose, run 2D foundation models (SAM 2 for masks, Grounded-SAM / SigLIP / DINOv2 for semantics) on those renders, and lift results back onto the exact Gaussians that produced each pixel — with rasterizer-exact contribution weights, since we control the renderer. No original capture data needed. This is the LUDVIG/FlashSplat setting with a self-rendered image set, and it means the whole pipeline runs from a single `.spz` file.

**Feasibility in the viewer (verified against Spark docs/source):**

- `PackedSplats` exposes per-splat CPU read/write (`getSplat`/`setSplat`/`forEachSplat`) and an `extra: Record<string, unknown>` side-channel already used for SH coefficients — a natural home for a `semanticId: Uint32Array`.
- The `dyno` shader-graph `Gsplat` struct carries the splat **index**, so a `worldModifier`/`objectModifier` can fetch a per-splat ID from a `DataTexture` and recolor/dim/hide per-object **on the GPU at render time** — no CPU rewrites per frame.
- `SplatMesh.raycast()` (WASM ray-splat intersection) gives click → splat position; nearest-splat lookup gives splat index → semantic ID. So "inverse query" (click → ID) is a small amount of glue.
- Spark loads `.ply`, `.spz`, `.sog`, `.ksplat` — sidecar or extended-PLY label channels are all ingestible.

---

## 3. Proposed architecture

```
                     OFFLINE (Python, GPU box or CI job)
.spz ──► gsplat loader ──► camera sampler (orbit + room-aware poses)
              │                    │
              │                    ▼
              │            RGB renders (N≈60–150 views)
              │                    │
              │          SAM 2 masks (+ mask tracking across views)
              │          SigLIP/CLIP crops per mask, open-vocab labels
              │                    │
              ▼                    ▼
      per-Gaussian contribution-weighted label voting (LUDVIG/FlashSplat)
                                   │
                     3D consolidation: cross-view ID merge,
                     spatial regularization (kNN graph smoothing),
                     small-cluster cleanup, soft boundary weights
                                   │
                                   ▼
                    ARTIFACTS (the "semantic sidecar")
        ┌──────────────────────────────────────────────────────┐
        │ ids.bin        uint16/uint32 per splat (instance ID)  │
        │ manifest.json  id → {label, synonyms, bbox, count,    │
        │                      centroid, color, parentId}       │
        │ embeds.bin     (optional) per-instance SigLIP vector  │
        └──────────────────────────────────────────────────────┘
                                   │
                     VIEWER (this repo, no build step)
        fetch sidecar ──► PackedSplats.extra.semanticId
                     ──► DataTexture keyed by splat index
                     ──► dyno worldModifier: highlight/isolate/hide/tint
        click ──► SplatMesh.raycast ──► nearest splat ──► ID ──► manifest
        text query ──► manifest label/synonym match (embeds optional)
```

Format notes:

- **Sidecar first** (`<world>.semantics.json` + `ids.bin`): zero coupling to splat encoding, cacheable on the CDN next to the `.spz`, versionable.
- **SPZ v4 vendor extension** ([spec](https://github.com/nianticlabs/spz/blob/main/extensions/README.md)) as the durable long-term home for per-splat IDs once the schema stabilizes — readers that don't understand the extension skip it safely.
- Hierarchy is one `parentId` field per instance (chair_leg → chair → seating_area), which keeps GARField-style granularity available without committing to it in v1.

---

## 4. Autoresearch plan

Phased so each phase has a falsifiable exit gate; an agent fleet can parallelize *within* phases and must stop at gates. Estimated agent-time assumes one A100/4090-class GPU for offline phases.

### Phase 0 — Ground truth on our own data (1–2 days)

- **P0.1** Pull the Marble API response for our demo worlds; dump and document `assets.splats.semantics_metadata` — schema, whether it's per-splat, per-region, or just frame/scale metadata. *(Internal advantage: we are World Labs — ask the Marble team what semantic exports exist or are planned before rebuilding them.)*
- **P0.2** Stand up the offline harness: load demo `.spz` (living-room, teal-bedroom) with `gsplat`, render a 100-view orbit, verify visual quality of self-rendered views (SH0-only spz ⇒ check for view-dependent artifacts).
- **P0.3** Pick eval sets: our 2 Marble rooms (qualitative + hand-labeled ~15 objects each) **plus** LERF-OVS and 3D-OVS (or ScanNet subsets) where published numbers exist, so we can compare against LangSplat/OpenGaussian/FlashSplat results rather than only ourselves.
- **Gate:** semantics_metadata characterized; harness renders views; eval protocol written down (mIoU on held-out rendered views, per-instance 3D IoU vs hand labels, query recall@1).

### Phase 1 — Training-free mask lifting, single method bake-off (3–5 days)

Reproduce the two reference lifting algorithms on self-rendered views:

- **P1.a FlashSplat-style**: accumulate per-Gaussian α-contribution per 2D mask; solve the one-step assignment with background bias.
- **P1.b LUDVIG-style**: contribution-weighted feature/mask aggregation + optional graph diffusion on a Gaussian kNN graph.
- Ablate: #views (30/60/150), camera strategy (orbit vs room-aware poses vs random interior), mask granularity (SAM whole/part), soft vs hard assignment for boundary Gaussians.
- **Metrics:** 2D mIoU of re-rendered ID maps vs held-out SAM masks; leakage rate (Gaussians assigned to an object but spatially inside another's hull); wall-clock per scene.
- **Gate:** ≥85% 2D mIoU on our rooms with <5 min/scene → pick the winner as the lifting backbone. If both fail, escalate to per-scene identity training (Gaussian Grouping) as fallback.

### Phase 2 — Cross-view consistent instance clustering ("semantic IDs") (1 week)

The hard problem: SAM masks are per-view; IDs must be global.

- **P2.a** Video-tracker association: order sampled cameras along a smooth path, run SAM 2 video propagation for cross-view mask identity (Gaussian Grouping's trick, but on rendered flythroughs — we control the path, so tracking is easy).
- **P2.b** 3D-first clustering: lift per-view masks independently, then cluster Gaussians by (lifted feature, position) — HDBSCAN / graph connected-components over the kNN graph (OpenGaussian/LBG-style merge).
- Handle: over-segmentation merge rules, floaters/sky/wall giant-clusters, minimum cluster size, "stuff vs things" (floor/walls as semantic-but-not-instance classes).
- **Metrics:** #instances vs hand count, per-instance 3D IoU, ID stability across two independent pipeline runs (should be ~deterministic), boundary quality on re-render.
- **Gate:** ≥90% of hand-labeled objects recovered as single clusters (no worse than 1 split or merge each) on both rooms.

### Phase 3 — Labels, embeddings, and text query (3–5 days)

- Per instance: render 3–5 best views (max visibility), crop, embed with SigLIP; label via open-vocab classifier over a room ontology (start from blockout schema vocab: sofa, coffee_table, rug, lamp…) + CLIP-similarity synonyms.
- Query resolution order: exact label → synonym table → (optional) embedding search. Keep embeddings out of v1 viewer unless label matching proves insufficient — a 30-object room rarely needs ANN search.
- **Metrics:** label accuracy vs hand labels; query recall@1 for a 50-query benchmark ("tv", "the plant", "something to sit on").
- **Gate:** ≥90% recall@1 on our benchmark → freeze sidecar schema v1.

### Phase 4 — Viewer integration (this repo) (1 week, parallelizable with P3)

- **P4.1** Sidecar loader: fetch `ids.bin` + `manifest.json` via `?semantics=<url>` param (mirrors existing `?collider=` pattern in `index.html`).
- **P4.2** GPU highlight path: `DataTexture` of per-splat IDs + dyno `worldModifier` → isolate / dim-others / tint / hide by ID set; verify 60 fps at 1M splats.
- **P4.3** Interaction: click → `raycast` → nearest-splat → ID → outline + manifest card; object list panel (from manifest) with per-object show/hide; text box that resolves label queries.
- **P4.4** JS API: `window.SEMANTICS = { ids(), query(text), select(id), isolate(ids), hide(ids), export(ids) }` — the programmatic "query splats by semantic ID" contract, also usable by the headless recorder.
- **Gate:** demo: type "sofa" → sofa glows, everything else dims; click lamp → card with label + bbox; toggle rug off; all at interactive framerate on the living-room world.

### Phase 5 — Stretch tracks (pick by P0 findings + user demand)

- SPZ v4 vendor-extension writer/reader for per-splat IDs (kill the sidecar).
- Splat-subset **export**: selected IDs → standalone `.spz`/`.ply` (asset extraction).
- Auto-generate `schemas/*.json` blockout (walls/furniture bboxes with labels) from the semantic clusters — closes the loop with `blockout.html`.
- Object **deletion + hole handling** (Gaussian Grouping does inpainting; a viewer-side v1 can just delete and accept holes).
- Hierarchical IDs + granularity slider (GARField/THGS).
- ReferSplat-style relational queries ("the chair near the window") via manifest bboxes + an LLM resolver — cheap and very demoable.

### Standing risks to watch

| Risk | Mitigation |
|---|---|
| Gaussians genuinely shared between objects (α-blending means one splat contributes to several surfaces) | soft assignment weights in sidecar; FlashSplat's background-bias handles most; report leakage metric every phase |
| Marble spz is SH0-truncated → self-renders lose view-dependence; SAM may segment differently than on real captures | acceptable for masks; validate in P0.2 |
| Fine structures (plant leaves, lamp cords) fragment | minimum-cluster merge + parentId hierarchy |
| Viewer memory: +4 bytes/splat ID texture at 2M splats = 8 MB | fine; uint16 (65k instances) halves it |
| semantics_metadata may already solve part of this | that's why it's P0.1, not P5 |

---

## 5. What else would users want? (beyond cluster + query)

Roughly ordered by expected demand, with the cheap-once-we-have-IDs items marked ⚡:

1. ⚡ **Click-to-identify** (inverse query): click anything → name, bbox, ID. The single most intuitive interaction; falls out of raycast + IDs.
2. ⚡ **Isolate / hide / show-only**: "hide the ceiling", "show only furniture" — for inspection, screenshots, and debugging generated worlds.
3. **Extract & export**: select the armchair → download it as its own `.spz`/`.ply` for reuse in another scene. Turns every world into an asset library — likely the highest-value pro feature.
4. **Delete / defurnish**: remove objects to get an empty-room variant (real-estate staging inverse, robotics domain randomization).
5. ⚡ **Recolor / restyle per object**: Spark's SplatEdit already does spatial RGBA edits; ID-scoped edits ("make the sofa green") are strictly better.
6. **Scene inventory / scene graph JSON**: machine-readable list of objects with labels, counts, bboxes, support relations ("lamp *on* table"). This is what agent/robotics/sim customers (cf. the Marble robotics case study) ask for — and it auto-generates our `blockout.html` schemas.
7. **Spatial + relational queries**: "what's on the coffee table", "nearest seat to the window", measurements between objects (metric scale is already in Marble metadata).
8. **Semantic navigation**: "take me to the kitchen" → camera fly-to; semantic minimap; walk-mode collision that treats furniture vs floor differently (we already raycast a collider — per-class collision is a natural upgrade).
9. **Granularity control**: part ↔ object ↔ region slider (cushion vs sofa vs seating area) — GARField-style hierarchy.
10. **Move / duplicate objects**: full scene editing. Hard (holes, shadows baked into splats) but the obvious end-state; deletion + inpainting is the published path (Gaussian Grouping).
11. **Sim-ready export**: USD/GLB with semantic labels + per-class colliders for Isaac/MuJoCo pipelines.
12. **Consistent IDs across worlds**: same ontology every scene, so multi-room or re-generated worlds are diffable ("did the new generation keep the fireplace?").

---

## 6. Immediate next actions

1. **P0.1** — dump `assets.splats.semantics_metadata` for the two demo worlds; loop in the Marble API team on existing/planned semantic exports.
2. Spin up the offline harness repo (Python: `gsplat` + SAM 2 + SigLIP) and reproduce FlashSplat-style lifting on the living-room world (P0.2 → P1).
3. In parallel, prototype the viewer's GPU highlight path (P4.2) against a **fake sidecar** (IDs from k-means on splat positions) so the frontend and pipeline develop concurrently against the frozen sidecar schema.

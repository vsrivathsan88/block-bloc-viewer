# FARM AR Task API (`farmAr`)

Autoregressive multi-view generation via the FARM AR Meridian servable.
Clients supply a camera path (target views), an optional text prompt, and/or
posed reference context images. The task stages inputs to GCS, dispatches the
servable asynchronously, and returns a preview MP4 plus runtime metadata
through the standard Operation contract.

- **Method**: `POST /api/v2/tasks:farmAr`
- **Returns**: a long-running `Operation`; poll it until `done`.
- **Surface**: internal (not exposed on the Developer API).
- **Deadlines**: 1800 s default, 3600 s max.
- **Idempotency**: not required.

## Request

Wire names are camelCase. Snake_case aliases are accepted for
`depth_scale_factor` / `depth_scale_metadata`.

| Field | Type | Default | Notes |
|---|---|---|---|
| `prompt` | string | `""` | Required when `referenceImages` is empty. |
| `referenceImages` | `ReferenceImage[]` | `[]` | Posed context views for image-conditioned generation. |
| `targetCameras` | `Camera[]` | required | Cameras to generate, in traversal order. |
| `targetFrameCount` | int >= 1 | required | Must equal `len(targetCameras)`. |
| `fps` | int 1-60 | `8` | Frame rate of the assembled MP4 preview. |
| `seed` | int >= 0 | `42` | RNG seed forwarded to the servable. JSON `null` falls back to the default (it does not disable seeding). |
| `cfg` | float 0-15 | `2.5` | Classifier-free guidance scale. |
| `numSteps` | int 1-100 | `50` | Diffusion steps. |
| `promptEnhancerModel` | enum | `gemini-3.1-flash-lite-preview` | Text-only prompt enhancement preset; `none` uses `prompt` verbatim. |
| `model` | string or null | `null` | Model slug. Currently `run09-v1`; `null` selects the default servable. |
| `depthScaleFactor` | float > 0 or null | `null` | Metric scale override for camera normalization (see below). |
| `depthScaleMetadata` | object or null | `null` | Opaque; echoed verbatim in the response. |

### Camera

```json
{
  "intrinsics": {"fx": 500.0, "fy": 500.0, "cx": 320.0, "cy": 320.0,
                 "width": 640, "height": 640},
  "extrinsics": {"position": [0, 0, 0],
                 "quaternion": [0, 0, 0, 1]}
}
```

- Intrinsics are pinhole, in pixel units of the client viewport.
- Extrinsics are **camera-to-world in the Three.js convention** (Y-up,
  Z-backward); `quaternion` is XYZW. The backend converts to OpenCV
  convention before dispatch, so send raw Three.js camera state.

### ReferenceImage

```json
{"imageBase64": "<png-or-jpeg bytes, base64, data: prefix optional>",
 "camera": { ... }}
```

### Validation errors (HTTP 400)

- `targetFrameCount != len(targetCameras)`.
- Empty `prompt` with empty `referenceImages`.
- Unknown `model` slug.

## Server-side processing

1. **Coordinate conversion**: Three.js camera-to-world -> OpenCV.
2. **Resolution**: reference images and target cameras are resized/cropped to
   the servable's native shape (640x640 for `run09-v1`). Intrinsics are
   rescaled to match; aspect mismatches are center-cropped.
3. **Rig normalization**: context + target cameras are normalized jointly per
   request. Without `depthScaleFactor`, positions are scaled so the maximum
   pairwise camera distance is 1.0 (scale clamped to [0.001, 100]), then the
   rig is recentered. `depthScaleFactor` overrides the derived scale; use it
   to keep scale consistent across successive requests over the same scene.
   The applied scale is reported as `trajectory_scale` in response metadata.
4. **Caption resolution** (the prompt actually sent to the model):
   - Reference images + non-empty `prompt`: passed through verbatim.
   - Reference images + empty `prompt`: Gemini auto-captions the context set.
   - Text-only: `prompt` is expanded by `promptEnhancerModel` unless `none`.
   The resolved text is returned as `captionUsed`.
5. **Staging**: context bundle and `target_cameras.json` are written under
   `gs://<bucket>/accounts/<account>/farm_ar/<run_id>/`, then the servable is
   dispatched via Meridian `async_predict`.
6. **Finalize**: generated frames are assembled into an MP4 (`fps`, qp=18)
   and uploaded as an account asset. Finalize is idempotent per operation.

## Response (completed Operation)

| Field | Notes |
|---|---|
| `requestId` | Servable request id; also the eval-cache key. |
| `videoUrl` | Public URL of the MP4 preview asset. |
| `captionUsed` | The prompt the model actually conditioned on. |
| `metadata` | Runtime metadata: `request_id`, `seed`, `runtime_s`, `num_target_views`, `trajectory_scale`. |
| `depthScaleMetadata` | Echoed from the request. |

Operation metadata carries `task: "farmAr"`, a coarse `phase`
(enhancing / staging / generating / assembling) and `progressPercent`.

## Context management

The servable is **stateless across requests**. The model's KV cache exists
only for the duration of one request: context views are encoded and prefilled,
then each target view is sampled and committed in order. Nothing persists
server-side afterward. "The context window" is therefore exactly the
`referenceImages` list the client sends on each call, plus the views generated
earlier in that same call.

- **Attention scope (within a request)**: every generated view attends to the
  text tokens, all reference views, and all previously generated views in the
  request. There is no server-side truncation or sliding window.
- **Sequence budget**: the servable rejects requests where
  `num_context + num_targets > max_seq_len` (128 for `run09-v1`) with a
  message stating the remaining target budget. Note the model was **trained
  with a 32-frame context**; sequences beyond ~32 total views are out of
  distribution even though the serving cache admits them.
- **Client responsibility**: for iterative flows (generate, move camera,
  generate again), the client must resend whichever previous frames it wants
  the model to be consistent with, as posed `referenceImages`. Selection,
  ordering, and captioning of that set are client policy; see the "context
  selection" guidance below.
- **Ordering**: reference views occupy earlier positions in the model's
  sequence; the model is trained on temporally ordered trajectories and
  weights recent positions most heavily. Place the views most relevant to the
  new target near the end of `referenceImages`.
- **Scale consistency**: normalization is per request. If context sets differ
  across requests, the derived scale can differ too; pass `de`pthScaleFactor`
  to pin a consistent scale for a session.
- **Determinism**: `seed` defaults to 42 on every request. Two requests with
  near-identical context and cameras will produce near-identical outputs.
  Vary the seed per capture if that is not what you want.
- **Debugging**: every served request mirrors `input_request.json` and
  `response.json` to the eval cache under
  `gs://wlt-data-internal-user-share-us-west4/eval/lawless_data/passive/farm_ar/<request_id>/`.
  The staged context bundle and `target_cameras.json` live under the run's
  `context_dir`, so you can verify exactly which views and poses the model saw.
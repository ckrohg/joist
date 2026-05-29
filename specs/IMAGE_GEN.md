# IMAGE_GEN — Brand-faithful image generation pipeline

> Wave 6b spec. Drafted 2026-05-28. Backlinks: [[wave-0-synthesis-2026-05-26]] §2 Stream E, §6.

## 1. What this is

Joist's image-generation surface. Fans out by `asset_type` to one of three
providers, with a per-site LoRA reference (FLUX.2 [dev] via fal.ai) as the
substrate for brand-faithful hero/lifestyle imagery.

Done means: every provider client is in place; every real upstream call is
dark-tested behind an API-key check; the dispatcher refuses-not-corrupts when
the requested provider is unconfigured; a session-scoped cost meter enforces
constraint #9; the REST surface exposes generate / train-lora / lora-for-site
/ cost-meter; routing/validation/cost-cap have acceptance assertions.

Not done in this wave: SVG vectorisation post-hooks, image-anti-slop validator
(ViT-HD anatomy / palette compliance / OCR — that's a v0.8 layer that consumes
this pipeline's output), and the Imagen 4 Fast bootstrap fallback (the
synthesis recommends it but it's a fourth client we defer; the `stock_replacement`
asset type currently routes to FLUX without a LoRA).

## 2. Provider matrix

| Layer | Provider | Endpoint | Auth | Cost | Use |
|---|---|---|---|---|---|
| Primary (hero/lifestyle) | FLUX.2 [dev] + per-site LoRA via fal.ai | `https://queue.fal.run/fal-ai/flux-2/lora` | `Authorization: Key <key>` | $0.021 per megapixel; LoRA train $2–3 | Brand stays in weights, not prompt |
| Vector/icons | Recraft V4.1 | `https://external.api.recraft.ai/v1/images/generations` | `Authorization: Bearer <token>` | $0.04 raster / $0.08 vector | Logos, icon grids, decorative SVG; Style Lock enforces palette |
| Text-on-image | Ideogram 3.0 | `https://api.ideogram.ai/v1/ideogram-v3/generate` | `Api-Key: <key>` | ~$0.06/image (placeholder, TODO verify) | Hero compositions with display type baked in |
| Bootstrap fallback (no brand yet) | Imagen 4 Fast | (not yet wired) | TBD | $0.02/image | Defer to v0.8 — `stock_replacement` currently routes to FLUX-without-LoRA |

Sources verified 2026-05-28:
- https://fal.ai/models/fal-ai/flux-2/lora
- https://fal.ai/models/fal-ai/flux-lora-fast-training
- https://www.recraft.ai/docs/api-reference/endpoints.md (request body fields,
  base URL, auth header verified; per-call billing rate not in public docs)
- https://developer.ideogram.ai/api-reference/api-reference/generate-v3

Items annotated `TODO(provider-api-verify)` in the code mark surface details
that couldn't be fully verified from public docs (e.g. fal queue exact
field names, Ideogram per-call billing rate). Each is funneled through a
single method (`buildInferenceBody()`, `buildTrainingBody()`, `buildMultipart()`,
`buildBody()`) so the fix-up is single-call once a working API key is available.

## 3. Routing decision table

| asset_type | Provider | Notes |
|---|---|---|
| `hero_image` | FluxLoraClient | Resolves the site's LoRA from PreferenceMemory; passes through inference with `loras: [{path, scale}]` |
| `lifestyle` | FluxLoraClient | Same as hero_image |
| `vector_icon` | RecraftClient | `format: svg` enforced; Style Lock id + palette colors from `brand_profile` |
| `logo` | RecraftClient | Same as vector_icon |
| `text_on_image` | IdeogramClient | `magic_prompt: OFF` (Joist owns the prompt); `style: REALISTIC` default; aspect ratio inferred from constraints.{width,height} if not given |
| `stock_replacement` | FluxLoraClient (no LoRA) | Used when brand isn't trained yet; the synthesis recommends Imagen 4 Fast here but that fourth client is a future wave |

Any other value → `422 unknown_asset_type` (failure-mode constraint #1).

## 4. LoRA training lifecycle

```
1. Caller uploads N reference images to WP media library
   (or zips them — fal-lora-fast-training expects a single zip URL)
2. POST /joist/v1/generate/image/train-lora  { site_id, reference_urls: [...] }
   → FluxLoraClient.train() submits to https://queue.fal.run/fal-ai/flux-lora-fast-training
   → returns TrainingJob { status: submitted, job_id, eta_seconds, cost_usd: 3.0 }
3. Caller polls   (or a scheduled WP-Cron job polls; future wave)
   GET (internal) / FluxLoraClient.pollTraining(job_id)
   → IN_QUEUE | IN_PROGRESS → returns { status: running, eta_seconds }
   → COMPLETED              → reads result, persists lora_id, returns { status: completed, lora_id }
4. Persistence (constraint #2 — read-after-write discipline):
   On terminal completion we write a Rule into PreferenceMemory under:
     - siteId    = the train request's site_id
     - kind      = Rule::KIND_STRUCTURAL
     - pattern   = 'flux_lora'
     - directive = 'lora_id: <diffusers_lora_file.url>'
     - provenance = { source: 'flux_lora_training', config_file: ... }
5. Future generate(hero_image) calls resolve the LoRA via:
     PreferenceMemory::listActive(siteId) -> first rule whose directive
     starts with "lora_id:" -> trim the prefix.
   AssetRouter::loraIdForSite() and GET /lora/{site_id} surface this read.
```

Note: PreferenceMemory persistence is gated on `Container::has('preferenceMemory')`.
If the container hasn't wired it (test paths), the lora_id is returned in the
TrainingJob payload but isn't persisted; the caller is expected to handle it.

## 5. Cost model

### Per-call estimates

- FLUX inference: `megapixels × $0.021` (min 0.25 MP)
- FLUX LoRA train: `$3.0` flat
- Recraft raster: `$0.04 × n`
- Recraft vector: `$0.08 × n`
- Ideogram: `$0.06 × n` (placeholder — TODO verify against live billing)

### Cap behaviour (failure-mode constraint #9)

- Per-session total tracked in a WP transient keyed by `X-Joist-Session-Id`
- Default cap `$10.0` per session
- Override: `wp_option('joist_image_gen_cap_usd', <float>)`
- TTL on the transient: 24 hours (matches a typical workday)
- Cap check fires BEFORE the upstream call — over-cap requests don't accrue
  additional cost
- Over-cap response: `429 cost_cap_exceeded` with `session_total_usd`,
  `cap_usd`, and `retry_after: 0` in the details payload
- GET /joist/v1/generate/image/cost-meter exposes
  `{session_id, session_total_usd, cap_usd, remaining_usd}` for dashboard use
- `AssetRouter::resetMeter(sessionId)` is the admin/test reset path

## 6. Configuration

Each provider key is read from (in order):

1. Constructor `apiKeyOverride` argument (test injection)
2. `getenv('JOIST_<PROVIDER>_API_KEY')` — preferred for production
3. `get_option('joist_<provider>_api_key')` — UI-configurable per-site

| Provider | Env var | wp_option |
|---|---|---|
| fal.ai (FLUX) | `JOIST_FAL_API_KEY` | `joist_fal_api_key` |
| Recraft | `JOIST_RECRAFT_API_KEY` | `joist_recraft_api_key` |
| Ideogram | `JOIST_IDEOGRAM_API_KEY` | `joist_ideogram_api_key` |

Other knobs:

| Knob | Default | Notes |
|---|---|---|
| `JOIST_HTTP_TIMEOUT_MS` (env) | `30000` | HttpTransport per-call timeout, rounded to seconds for wp_remote_request() |
| `joist_image_gen_cap_usd` (option) | `10.0` | Per-session cost cap |

## 7. Failure modes and dark-test behaviour

| Condition | Surface | Status |
|---|---|---|
| API key missing for the routed provider | `provider_unconfigured` + `env_var` + `wp_option` hints | 422 |
| Unknown `asset_type` | `unknown_asset_type` with `valid: [...]` | 422 |
| Missing required field (site_id / asset_type / prompt) | `validation.missing_field` | 422 |
| Unknown top-level key in request body | `schema.unknown_key` (constraint #1) | 422 |
| Cost cap reached | `cost_cap_exceeded` with session_total / cap | 429 |
| Provider returned 5xx | `transport.upstream_5xx` | 502 |
| Provider returned non-JSON | `transport.invalid_json` | 502 |
| Network error reaching provider | `transport.network_error` | 502 |
| Provider returned 2xx but no images | `generate.no_images` | 502 |
| Training job submitted but no `request_id` in response | `training.submit_failed` | 502 |
| Training completed but no LoRA file URL | `training.no_lora_url` | 502 |

Dark-test contract: every provider client checks `isConfigured()` FIRST.
Without a key, the client returns `ImageResult::unconfigured()` or
`TrainingJob::unconfigured()` — no upstream HTTP call is made. The
`unconfigured` result bubbles up through AssetRouter::render() as a typed
`provider_unconfigured` WriteException — never a silent downgrade to a
different provider (constraint #16 / refuse-not-corrupt).

## 8. Code map

```
plugin/src/Generate/Image/
├── HttpTransport.php       wp_remote_request wrapper; UA, timeout, JSON strict mode, logging
├── HttpResponse.php        readonly value object {status, headers, body, json, durationMs}
├── TransportException.php  typed exception for 5xx / non-JSON / network failure
├── ImageResult.php         provider-agnostic image-gen result
├── TrainingJob.php         fal.ai training-job handle (status: submitted/running/completed/failed/unconfigured)
├── FluxLoraClient.php      fal.ai FLUX.2 [dev] + LoRA train + inference
├── RecraftClient.php       Recraft V4.1 raster + vector + Style Lock
├── IdeogramClient.php      Ideogram 3.0 text-on-image (multipart/form-data)
└── AssetRouter.php         dispatcher + cost meter + refuse-not-corrupt

plugin/src/REST/
└── GenerateController.php  POST /generate/image, POST /train-lora, GET /lora/{site_id}, GET /cost-meter
```

Container wiring: `imageHttpTransport`, `fluxClient`, `recraftClient`,
`ideogramClient`, `assetRouter` are all registered in `Container::REGISTERED`
and built lazily in `Container::build()`.

## 9. REST surface

### POST /joist/v1/generate/image

```json
{
  "site_id": "host_example.com",
  "asset_type": "hero_image",
  "prompt": "...",
  "brand_profile": { "palette": ["#D4FF3A", "#0E0E0C"], "lora_scale": 1.0 },
  "constraints": { "width": 1024, "height": 768, "format": "png" },
  "lora_id": "https://..."   // optional — overrides PreferenceMemory resolution
}
```

Response: `ImageResult.toApi()` shape.

### POST /joist/v1/generate/image/train-lora

```json
{
  "site_id": "host_example.com",
  "reference_urls": ["https://.../refs.zip"],
  "opts": { "trigger_word": "joistsite", "steps": 1000 }
}
```

Response: `TrainingJob.toApi()` shape.

### GET /joist/v1/generate/image/lora/{site_id}

Response:
```json
{ "site_id": "host_example.com", "lora_id": "https://..." | null, "status": "ready" | "none" }
```

### GET /joist/v1/generate/image/cost-meter

Response:
```json
{ "session_id": "...", "session_total_usd": 0.07, "cap_usd": 10.0, "remaining_usd": 9.93 }
```

## 10. Open questions / TODOs

- `TODO(provider-api-verify)` in `FluxLoraClient::pollTraining()`: confirm
  fal queue status sentinels (IN_QUEUE / IN_PROGRESS / COMPLETED / error
  variant) and exact field names against a working FAL key.
- `TODO(provider-api-verify)` in `FluxLoraClient::buildInferenceBody()`:
  confirm the `loras` array shape (path + scale) is still the contract for
  flux-2/lora, not flux-1 legacy.
- `TODO(provider-api-verify)` in `RecraftClient::buildBody()`: confirm
  `recraftv4_1` (raster) and `recraftv3_svg` (vector) are the right model
  IDs as of V4.1 release.
- `TODO(provider-api-verify)` in `IdeogramClient`: confirm per-call billing
  rate; the spec uses $0.06/image as a placeholder from the synthesis doc.
- Imagen 4 Fast as bootstrap fallback for `stock_replacement` — currently
  routes to FLUX-without-LoRA. Deferred to v0.8 (a fourth client + a routing
  preference).
- Background polling for training jobs (WP-Cron) so we don't wait inline.
  Today `pollTraining` is a manual call; AssetRouter resolves the LoRA on
  every generate. Deferred to v0.8.
- Image anti-slop validator (ViT-HD anatomy + palette compliance + text-render
  OCR) is the consumer of this pipeline's output. Spec'd in
  `[[wave-0-synthesis-2026-05-26]]` §2 Stream E; implementation deferred.

## 11. Backlinks

- `[[wave-0-synthesis-2026-05-26]]` §2 Stream E — brand-faithful generation stack
- `[[wave-0-synthesis-2026-05-26]]` §6 — brand pipeline deltas
- Failure-mode constraints: #1 (unknown keys → 422), #2 (read-after-write),
  #9 (cost meter + cap), #13 (perf budgets), #16 (no silent failures)
- `specs/PREFERENCE_MEMORY.md` — the `Rule` substrate the lora_id is persisted into

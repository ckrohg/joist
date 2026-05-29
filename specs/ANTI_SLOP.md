# Anti-Slop Validator — Wave 6a

> Status: shipped 2026-05-28 as the Wave 6a deliverable. Linked from
> [[wave-0-synthesis-2026-05-26]] §6. This doc is the canonical spec; the
> banned-lexicon catalogue lives in code (see "Catalogue" below).

## Why

Every AI-text and AI-image surface Joist exposes is a slop attack surface.
Public 2026 launches of Lovable, v0, Bolt, etc. teach the same lesson: the
single most effective slop control is a two-layer pattern — a banned-lexicon
system block injected at generation time, plus a deterministic post-generation
validator that catches what survived. The post-gen layer pays for itself the
first time it stops "Let's delve into the realm of robust solutions" from
landing on a Hero widget.

The Ozigi blog (Apr 2026) made this pattern concrete; we ship its shape and
add a per-site preference-memory feedback loop so repeated rejections of a
phrase pin to that site's forbidden list automatically.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  (W6c) Copy-gen                                                 │
│    prompt = brand block + voice exemplars + banned-lexicon       │
│             system block + user task                            │
│    └── output → CopyValidator                                   │
│                                                                  │
│  (W6b) Image-gen                                                │
│    output → ImageValidator                                      │
└─────────────────────────────────────────────────────────────────┘
        │                                            │
        ▼                                            ▼
┌──────────────────────┐                ┌──────────────────────┐
│ CopyValidator        │                │ ImageValidator       │
│  4 lexicon layers +  │                │ palette + text +     │
│  site forbid_phrase  │                │ anatomy(py)          │
└──────────┬───────────┘                └──────────┬───────────┘
           │                                       │
           │ requires_repair=true                  │ verdict=flagged
           ▼                                       ▼
   ┌──────────────────────┐                ┌──────────────────────┐
   │ Repair retry (1×)    │                │ Human review queue   │
   │ same prompt + hint   │                │ (W6b)                │
   └──────────────────────┘                └──────────────────────┘
                  │
                  │ second rejection
                  ▼
          ┌──────────────────────┐
          │ SlopFeedback.record  │
          │  count++             │
          │  count >= 3:         │
          │   promote to         │
          │   PreferenceMemory   │
          │   forbid_phrase Rule │
          └──────────────────────┘
```

Two-layer separation matters because:

- The system block is **a tax on generation** — it changes what the model
  draws from. ~88% of drafts come back clean.
- The post-gen validator is **a tax on regrettable drafts** — it fires on
  the ~12% that slipped through, with one bounded retry.
- The feedback loop converts our **operator's rejection signal into a
  preference**, so we are not paying the slop-detection cost forever on
  the same phrase on the same site.

## Four lexicon layers

The full catalogue is code, not prose. Source of truth:
`plugin/src/AntiSlop/BannedLexicon.php`.

### Layer 1 — `vocab`

Single-token slop. Whole-word case-insensitive match. Categories: `vocab`,
`corporate`, `mystical`. Examples: `delve`, `tapestry`, `robust`,
`cutting-edge`, `seamless`, `leverage`, `landscape`, `realm`, `crucial`,
`paramount`, `myriad`, `plethora`, `pivotal`, `foster`, `embark`, `synergy`,
`empower`, `revolutionize`, `unleash`. Each entry carries a severity
(high / medium / low) and an optional `replacement` suggestion.

### Layer 2 — `phrases`

Multi-word slop. Case-insensitive substring. Examples: `"at its core"`,
`"in today's fast-paced world"`, `"in the realm of"`,
`"navigate the complexities"`, `"unlock the potential"`, `"a testament to"`,
`"it goes without saying"`, `"the world of"`, `"dive into"`,
`"the future of"`, `"build the future of"`, `"scale without limits"`,
`"all-in-one platform"`, `"rich tapestry"`, `"ever-evolving"`.

### Layer 3 — `sentenceOpeners`

Regex against sentence-leading text only. The validator splits text into
sentences, then matches each opener regex against the first ~40 chars.
Patterns include the "It's not X. It's Y." contrastive structure,
`^In conclusion`, `^In summary`, `^Moreover`, `^Furthermore`, `^Indeed`,
`^In essence`, `^In today's <fast-paced|ever-changing|digital|modern> world`,
`^Imagine a world (where|in which)`.

### Layer 4 — `structures`

Slop-shaped formatting. Mix of regex and compound checks:

- **Bold-colon prefix** (`**Heading:**`): Markdown-slop tell.
- **`Here's the thing:`**: LinkedIn-ism.
- **Listicle lead-in**: `Here are <N> reasons|ways|tips|things|steps`.
- **Em-dash overuse**: more than 3 em-dashes per 200 characters (density
  check, not per-occurrence).
- **Rhetorical question chains**: three `?` punctuation marks within
  ~80 chars of each other.
- **Emoji-prefixed bullets**: lines starting with an emoji and a space.

## Scoring & repair gate

- Score starts at 100.
- Each violation subtracts: high=15, medium=8, low=3.
- Clamp to [0, 100].
- `requiresRepair = score < 70`.
- `passed = (violations are empty)`.
- Scores in (70, 99] are "soft pass with warnings" — the caller can choose
  to retry or to surface the warnings inline.

## Repair-retry prompt template

When `requires_repair` is true, the caller composes one retry prompt:

```text
[brand block — cached]
[banned-lexicon system block — cached]
[voice exemplars — cached]

You previously produced this draft for: <original task>.

DRAFT:
<original draft>

VALIDATOR FEEDBACK:
<repair_hint from ValidationResult>

Rewrite the draft. Keep the meaning. Cut the slop. Do not paraphrase the
slop — restructure the sentence around a concrete fact. If you cannot
produce a slop-free version, return REJECTED and explain why.
```

One retry only. If the second draft fails too, the user-facing surface
gets `REQUIRES_HUMAN_REVIEW` with the second draft + both validator
reports. We do not loop indefinitely.

## Feedback loop → preference memory

When a violation is confirmed (user-side reject signal arrives via
webhook or the explicit `POST /anti-slop/feedback` endpoint), the
`SlopFeedback` class:

1. Bumps a per-(site, phrase) counter in `wp_options` under key
   `joist_slop_counts_<site_id>` (separate option per site keeps the row
   bounded).
2. Idempotency: each event carries an event-key hash derived from
   `(site_id, normalised_phrase, sha256(text)[:16])`. Replays are no-ops.
3. When the counter crosses `PROMOTION_THRESHOLD` (default 3), the phrase
   is written into `PreferenceMemory` as a `forbid_phrase` Rule with
   confidence `0.5 + (excess * 0.1)`, capped at 1.0.
4. The promoted Rule then fires inside `CopyValidator::scanSiteRules()`
   on every subsequent call — slop detection on this site becomes a
   first-class signal, not a global one.

Idempotency keys are capped at 50 per phrase (FIFO eviction). Phrase
counts are capped at 500 per site (FIFO eviction). Beyond that, we are
clearly past the option-row substrate; v0.85 spec moves to a dedicated
table at that point.

## Image validator

`ImageValidator::validate(string $imagePath, array $brandProfile)` runs
three layers, each gated by capability:

### Palette compliance (required, PHP via GD)

- Downsample the image to 50×50.
- Histogram pixels into 16-step RGB cubes.
- Top-5 bins become the dominant-color list.
- Each dominant color is converted RGB → Lab (CIE76 via XYZ, D65 white).
- Delta-E (CIE76) is computed against every brand-palette color; the
  minimum is recorded.
- A dominant color "matches brand" if `deltaE <= 25`.
- If `brand_profile.palette_strict !== false`, any non-match flags the
  image.

### Text-region heuristic (required, PHP via GD)

- Tile the 50×50 sample into 10×10 cells.
- A cell is "flat" if its RGB variance < 80 (sum of per-channel variance).
- Connected components of flat, color-similar cells form candidate
  rectangles.
- Rectangles ≥ 5% of canvas surface a warning (`text_overlay_candidate`).
- This is **not OCR**. It is a placeholder for the v0.9 follow-up that
  shells out to Tesseract. Warnings here do not by themselves flag the
  image; they go into `text_regions` for the human reviewer.

### Anatomy / body-distortion (Python microservice, v0.9 contract)

Configured via either:

- `define('JOIST_ANATOMY_SERVICE_URL', 'https://...')` in wp-config, or
- `wp_option('joist_anatomy_service_url')`.

If neither is set, anatomy is `'unchecked'` and `requires_human_review`
is `true`. No silent passes.

#### Python service contract

```
POST <base_url>/anatomy
Content-Type: application/json
Body:
  {
    "image_b64": "<base64-encoded PNG/JPEG>",
    "brand_profile_id": "<optional opaque id>"
  }
200 OK:
  {
    "verdict": "clean" | "flagged",
    "score": 0.0 .. 1.0,
    "reasons": ["malformed_hand", "extra_finger", ...]
  }
Timeout: 5 s (overridable via wp_option 'joist_anatomy_service_timeout').
```

Non-200 or timeout → anatomy becomes `'unchecked'`, `requires_human_review`
becomes `true`. The error is logged via `Joist\Core\Logger` with the
endpoint URL and status (no body, no secrets).

Reference implementation target: the ViT-HD model from
[arxiv:2503.00811](https://arxiv.org/html/2503.00811v1) — F1 = 0.899 on
human-body distortion detection. HandCraft remains the fallback for hand
malformation specifically.

## REST surface

### `POST /joist/v1/anti-slop/copy`

```json
{ "text": "Let's delve into the realm of robust solutions.", "site_id": "host_example_com" }
```

Returns a `ValidationResult`:

```json
{
  "passed": false,
  "score": 25,
  "violations": [
    { "layer": "vocab", "kind": "vocab", "match": "delve", "severity": "high",
      "position": 6, "replacement_suggestion": "examine", "hint": null, "category": "vocab" }
  ],
  "violation_count": 7,
  "requires_repair": true,
  "repair_hint": "The previous draft tripped..."
}
```

### `POST /joist/v1/anti-slop/image`

```json
{
  "image_b64": "<base64>",
  "brand_profile": { "palette": ["#0E0E0C", "#D4FF3A", "#F3F2EC"], "palette_strict": true }
}
```

OR

```json
{
  "image_url": "https://example.com/hero.png",
  "brand_profile": { "palette": ["#0E0E0C", "#D4FF3A"] }
}
```

Returns an `ImageValidationResult`.

### `POST /joist/v1/anti-slop/feedback`

```json
{
  "site_id": "host_example_com",
  "text": "<original text the slop appeared in>",
  "violation_match": {
    "layer": "phrases",
    "match": "the future of",
    "severity": "high",
    "kind": "corporate"
  },
  "threshold": 3
}
```

Returns `{result, state}` — the post-record state of the tracked phrase
(read-after-write, per failure-mode constraint #2).

### `GET /joist/v1/anti-slop/lexicon`

Introspection endpoint that returns the full banned-lexicon catalogue
(severity + category only, not weights). Used by the W6c prompt-cache
builder and by the admin UI's "what's in the slop filter?" panel.

## Failure-mode constraints honoured

- **#1 — Unknown fields → 422**: all three POST endpoints reject unknown
  fields via `AntiSlopController::rejectUnknownFields()` and return a
  precise `unknown_fields[]` + `valid_fields[]` envelope.
- **#2 — Read-after-write**: the feedback endpoint returns the post-record
  state of the tracked phrase.
- **#16 — No silent failures**: missing GD, unreadable image bytes,
  Python service errors, base64 decode failures all surface as
  `requires_human_review: true` or 422/500, never a silent pass.

## Integration points

- **W6c (Copy gen)**: builds the prompt-cached banned-lexicon system
  block from `BannedLexicon::vocab() + ::phrases() + ::sentenceOpeners()
  + ::structures()` at session start (5-min cache TTL). Calls
  `POST /anti-slop/copy` on every generated block. On
  `requires_repair`, performs one repair retry, then surfaces the
  remaining slop to the user.
- **W6b (Image gen)**: after FLUX.2 / Recraft V4.1 / Ideogram 3.0 returns
  an image, calls `POST /anti-slop/image` with the brand profile from
  `preference_memory`. On `verdict: 'flagged'`, enqueues for the human
  review surface. On `verdict: 'requires_review'`, surfaces inline with
  a "this image needs eyes" warning.
- **W5 (Plan Mode UI)**: surfaces both validators' outputs as a
  blast-radius signal on every step that mutates text or media.
  Specifically, a slop-flagged hero copy = visibility:public,
  reversibility:trivial — but it goes red anyway because shipping slop
  is a brand-damage event.

## Sources

- Ozigi blog, "Stopping AI slop in production: a banned-lexicon
  validator" — the two-layer pattern that this spec implements.
- [arxiv:2503.00811](https://arxiv.org/html/2503.00811v1) — ViT-HD body
  distortion detection (F1 0.899). Anatomy microservice reference model.
- `memory/taste_anti_slop_rules.md` — Joist's design-bias and rejection
  list, source of much of the layer-4 structure catalogue.
- `memory/brand_decisions.md` — Joist's voice rules. Contributes
  `synergy`, `empower`, `revolutionize`, `transform`, `unleash`, etc.
  to the corporate-vocab list.
- `specs/WAVE_0_2026-05-26.md` §2 Stream E and §6 — the charter.

## Open questions

1. **Tesseract integration for real text-render OCR**: deferred to v0.9.
   The placeholder heuristic is conservative — it warns but does not fail.
   Need to decide between shelling out to Tesseract (binary footprint,
   shared-host friction) vs. routing text-render checks through the
   same Python microservice as anatomy.
2. **Per-language lexicons**: current catalogue is English only. Joist
   v1 ships English-only generation; v1.5+ needs locale-tagged lexicons
   with a fallback chain (en → product locale → site language).
3. **Repair-retry budget enforcement**: currently the caller honours the
   "one retry" rule by convention. Should we add a `repair_count` field
   on the validation request and refuse with 429 if > 1? Defer until
   we see retry-loop incidents.

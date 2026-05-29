# Copy Generation — Wave 6c spec

Status: shipped in code 2026-05-28 as part of Wave 6c. Real Anthropic API
calls are dark-tested until `JOIST_CLAUDE_API_KEY` (env) or
`joist_claude_api_key` (wp_option) is configured. Backlink: `[[wave-0-synthesis-2026-05-26]]` §6.

---

## 1. Why a dedicated pipeline

Copy generation is the highest-volume Anthropic spend in a Joist build
(6-page site x N copy blocks x repair retries). The Wave 0 synthesis (§2
Stream E) committed to **Claude Opus 4.7 + layered prompt-cached brand
block + Ozigi-pattern slop validator**. Wave 6c implements that pipeline
end-to-end:

- `plugin/src/Generate/Copy/BrandBlock.php` — value object (cached prefix shape)
- `plugin/src/Generate/Copy/BrandBlockAssembler.php` — builds the prefix
- `plugin/src/Generate/Copy/CopyGenerator.php` — drives the Messages API
- `plugin/src/Generate/Copy/CopyResult.php` — return shape
- `plugin/src/Generate/Copy/CopyCostMeter.php` — per-session cap (constraint #9)
- `plugin/src/Generate/Copy/BatchQueue.php` — amortises 5-min cache TTL
- `plugin/src/REST/CopyGenController.php` — public surface

---

## 2. Brand block layout

The prefix is layered stable -> volatile so each `cache_control: ephemeral`
breakpoint hits the right slice of the cache.

| Layer | Content | Cache TTL | Why this order |
|---|---|---|---|
| 1 | Joist house style: tone rules, banned vocabulary, forbidden openers, forbidden structures, output contract | 5m ephemeral | Identical across all sites; longest-lived |
| 2 | Per-site brand profile: `brand.json` (name, voice rules, palette names, typography names, site-specific taboo + preferred vocab) OR `PreferenceMemory::renderForPrompt()` fallback | 5m ephemeral | Site-stable, changes only when the brand is edited |
| 3 | 6-10 voice exemplars (paired user/assistant turns) — `cache_control` placed on the LAST assistant turn so the whole exemplar batch lives in the cached prefix | 5m ephemeral | Per-site, near-stable |
| (delta) | The per-page request | — NOT cached — | This is what changes per call |

The Anthropic Messages API allows **4 cache_control breakpoints per request**
([docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
Wave 6c uses 3 (layers 1, 2, 3) and leaves one slot for future use.

### brand.json schema

Loaded from `$WP_CONTENT_DIR/joist/sites/<site_id>/brand.json`. Sanitisation:
the site_id is regex-restricted to `[a-zA-Z0-9._-]` to prevent path traversal.

```json
{
  "name": "Acme Joinery",
  "tagline": "We measure twice.",
  "positioning": "...",
  "voice": ["Direct, no marketing-speak", "Use trade vocabulary"],
  "palette": {"primary": "#1A1A17", "accent": "#D4FF3A"},
  "typography": {"display": "Fraunces", "body": "Inter"},
  "forbidden": ["world-class"],
  "preferred": ["measured", "finished"]
}
```

When `brand.json` is absent, the assembler falls back to
`PreferenceMemory::renderForPrompt($siteId)` — the active site rules pulled
from `wp_joist_preferences` (capped at 40 rules / 800 tokens — see
`memory/preference_memory_pattern.md`).

### exemplars.json schema

Loaded from `$WP_CONTENT_DIR/joist/sites/<site_id>/exemplars.json`:

```json
[
  {"role": "user", "content": "..."},
  {"role": "assistant", "content": "..."}
]
```

Validation requires alternating roles starting with `user`. Invalid items
are dropped silently. Cap: 10 turns (5 pairs).

When `exemplars.json` is absent, the assembler ships a canonical 6-turn
fallback set demonstrating the Joist voice (sourced from
`memory/brand_decisions.md`).

### `isCacheable()` — the 4,096-token floor

Verified 2026-05-28 against the Anthropic docs: Claude Opus 4.7 / 4.6 / 4.5
require **≥ 4,096 input tokens** for caching. Shorter prefixes silently
skip caching (no error, no cache, no refund). `BrandBlock::isCacheable()`
returns true only when the estimated token count (chars / 4) clears that
floor. The CopyGenerator still sends `cache_control` markers when the
block is sub-threshold — the API tolerates them — but callers can inspect
`isCacheable()` via `GET /brand-block/{site_id}` to know whether the
batch-queue amortisation strategy will actually save money.

`TODO(anthropic-api-verify)`: re-verify the 4,096 minimum at Opus 4.7 GA. The
docs table groups 4.7/4.6/4.5 together at 4,096; older Opus 4.1 uses 1,024.

---

## 3. Cost model

Source: `https://platform.claude.com/docs/en/build-with-claude/prompt-caching`
(verified 2026-05-28). Prices are per million tokens.

| Token type | $/MTok | Multiplier vs base input |
|---|---|---|
| Base input | $5.00 | 1.0x |
| Output | $25.00 | — |
| 5-min cache write | $6.25 | 1.25x |
| 5-min cache read | $0.50 | 0.1x |
| 1-hour cache write | $10.00 | 2.0x |
| 1-hour cache read | $0.50 | 0.1x |

`TODO(anthropic-api-verify)`: Opus 4.7 GA pricing. The docs example uses
Opus 4.5 numbers; per `memory/architecture_decisions.md` they're identical
across the 4.5/4.6/4.7 line, but verify before billing accuracy matters.

### Amortisation math (the whole point of batching)

A brand block of, say, 5,000 input tokens generating 500 output tokens:

| Scenario | Prefix cost | Output cost | Total |
|---|---|---|---|
| First call (cache write) | $0.03125 | $0.0125 | **$0.04375** |
| Second call within 5 min (cache read) | $0.0025 | $0.0125 | **$0.015** |
| All-uncached (no caching at all) | $0.025 | $0.0125 | **$0.0375** |

So: the FIRST call pays a ~25% premium over uncached; every subsequent call
within 5 min saves ~60% vs uncached. Break-even at 1.4 calls — a 6-page
site (6+ copy blocks) is a 4-5x cost reduction in steady state.

This is why Wave 6c ships a `BatchQueue`: callers stack requests per-site
and either call `POST /flush/{site_id}` (sync drain) or
`flush_after_seconds` in the enqueue body (deferred drain via wp-cron).

### Cost meter — why separate from image gen

The W6b image-gen meter measures `$/image`; the W6c copy-gen meter measures
`$/MTok`. Combining them into a single meter would obscure which vertical
is burning budget — a copy runaway loop costs orders of magnitude more
than an image runaway loop at equal call count. Decision: separate meters,
both subject to constraint #9 (per-session cap + refuse-not-corrupt).

Wave 6c meter config:
- `joist_copy_gen_cap_usd` wp_option (default `$5.00` per session)
- Per-session storage: WordPress transient keyed by `X-Joist-Session-Id`,
  60-min TTL
- Pre-flight check at generate() time: refuse with `cost_cap_exceeded`
  (HTTP 429, typed error) if the projected cost would push past the cap

---

## 4. Validate-and-repair loop

Integration with W6a's `\Joist\AntiSlop\CopyValidator`:

1. `CopyGenerator::generate()` makes the first call.
2. If `class_exists('\\Joist\\AntiSlop\\CopyValidator')`, instantiate and
   call `$validator->validate($text, $siteId)`. Tolerates both an object
   shape (`->requiresRepair`, `->repairHint`, `->violations`) and an array
   shape (`requires_repair`, `repair_hint`, `violations`) — the exact W6a
   surface lands in parallel.
3. If `requiresRepair === true` and `opts['repair_retries'] > 0` (default 1),
   compose a repair message (original request + first draft + repair hint)
   and call the Messages API a second time. The second call STILL hits the
   cached prefix because the system blocks + exemplars are bit-identical —
   only the user message changes.
4. Re-validate the repair. If it passes, return it. If both attempts fail,
   return the cleaner of the two with `validation_failed: true` and
   `error_code: validation_failed` — caller routes to human review
   (constraint #16: never silently swallow ambiguous/partial success).

The repair attempt is also gated by the cost meter: if the cap would be
exceeded by a second call, the loop bails out with the first draft +
validation flag (no silent fallback to a worse path).

When `CopyValidator` isn't loaded yet, the loop short-circuits: text comes
back unvalidated. The acceptance suite SKIPs the validation assertions in
that case (per the W6a-parallel charter).

---

## 5. Failure-mode coverage

Constraints (`memory/failure_mode_constraints.md`):

| # | Constraint | How W6c honours it |
|---|---|---|
| 1 | Validate every write | `CopyGenController::rejectUnknownKeys()` 422s on unknown body fields |
| 2 | Read-after-write | The CopyResult IS the read; metrics + cache stats surface every time |
| 9 | Cost meter + cap + refuse | `CopyCostMeter` pre-flight + 429 typed `cost_cap_exceeded` |
| 16 | Refuse silently-failing ops | `validation_failed: true` flag on the result; never silently downgrade to no-validation |

---

## 6. Configuration

| Variable | Type | Default | Purpose |
|---|---|---|---|
| `JOIST_CLAUDE_API_KEY` | env | — | Anthropic API key (preferred path) |
| `joist_claude_api_key` | wp_option | — | Fallback when env isn't usable |
| `JOIST_CLAUDE_MODEL` | env | `claude-opus-4-7` | Model override (per-deploy) |
| `joist_copy_gen_cap_usd` | wp_option | `5.0` | Per-session spend cap |

When the API key is missing (both env and option empty), the generator
returns `status: 'unconfigured'` with `error_code: provider_unconfigured`
(HTTP 422). No fake responses, no synthetic text — dark-test path.

---

## 7. REST surface

All endpoints under `/wp-json/joist/v1/`. Permissions: `permissionsCheck`
(requires the Joist agent capability or `edit_pages`). Writes go through
ControllerBase rate-limit bucket `writes`.

| Method | Path | Body / Params | Returns |
|---|---|---|---|
| POST | `/generate/copy` | `{site_id, request, opts?}` | `CopyResult` (sync) |
| POST | `/generate/copy/batch` | `{site_id, requests: [{request, request_id?}], opts?}` | `{site_id, count, results: CopyResult[]}` |
| POST | `/generate/copy/enqueue` | `{site_id, request, request_id?, opts?, flush_after_seconds?}` | `{request_id, status, queue_depth, site_id}` |
| POST | `/generate/copy/flush/{site_id}` | optional `{opts?}` | `{flushed: int, results: CopyResult[]}` |
| GET | `/generate/copy/cost-meter` | — | `{session_id, session_total_usd, cap_usd, remaining_usd, separated_from_image_gen}` |
| GET | `/generate/copy/brand-block/{site_id}` | — | `{site_id, cache_key, estimated_tokens, is_cacheable, cache_min_tokens, system_block_count, exemplar_count, model_hint, model_in_use, model_default, api_key_configured}` |

### Error envelopes

- 422 `validation.required` — missing required field
- 422 `validation.unknown_keys` — extra body fields
- 422 `validation.invalid_json` — body wasn't a JSON object
- 422 `validation.empty_body` — POST with no body
- 422 `provider_unconfigured` — API key missing
- 429 `cost_cap_exceeded` — per-session cap exhausted
- 502 `provider_error` — Anthropic non-2xx or wp_remote_post WP_Error

---

## 8. Dark-test behaviour

Per the W6b precedent: every real API call is gated on key presence. Dark
tests assert:

1. `POST /generate/copy` with no API key returns 422 + typed `provider_unconfigured`
2. `GET /brand-block/{site_id}` works regardless of key state — it's pure
   assembly, no I/O
3. `GET /cost-meter` works regardless of key state
4. `POST /generate/copy/enqueue` + `POST /generate/copy/flush/{site_id}`
   work regardless — the flush surfaces `unconfigured` results per item
5. The cost-cap pre-flight runs BEFORE the API key is even loaded, so
   a depleted meter returns 429 even when the key is missing

---

## 9. Acceptance assertions

See `plugin/tests/manual/acceptance.sh` section "Wave 6c — copy generation".
Coverage: 13 assertions. SKIPped when `\Joist\AntiSlop\CopyValidator` is
absent: the validate-and-repair-loop ones (W6a-parallel dependency).

---

## 10. Open / deferred

1. **1-hour TTL upgrade.** Currently we use the default 5-min TTL. For build
   waves that stretch >5 min (clone pipeline, multi-page generation), the
   2x write multiplier is cheaper than re-writing the cache every 5 min.
   Defer the decision until we have telemetry on actual session duration
   (W7 smoke test should produce that).
2. **Streaming.** The Messages API supports SSE; Wave 6c uses sync
   request-response for simplicity. Streaming pays off for long-form
   generation (>1k output tokens); add when there's a UI surface that
   benefits from progressive rendering.
3. **Batch API discount.** Anthropic ships a Batch API at 50% off for
   non-interactive workloads. Not used in Wave 6c because Plan Mode wants
   responses inside the user's session. Worth revisiting for the
   audit-subagent path (W8).

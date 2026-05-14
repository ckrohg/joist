# Preference Memory + Quality Eval — design spec

**Date:** 2026-05-13. **Status:** v0 design, partial code (Wave 2 of build-wave 2). **Targets:** v0.7.

The "first concrete self-improve step" for Joist. Captures user corrections per-site, surfaces them to the agent on next session, measures quality over time. Synthesis of two parallel research streams (preference-memory patterns + agent eval frameworks). Joist's advantage: every prior tool drops rejection feedback on the floor; we already capture `rejection_note` on plan rejection — we just need to wire it through.

---

## 1. Goals

- **Per-site preference memory** that captures user corrections (initially from plan `rejection_note`) and surfaces them at the start of subsequent sessions
- **Quality dashboard** showing fidelity scores, plan acceptance rate, schema reject rate, rollback rate over time — with windowed before/after comparison to detect plugin/prompt regressions
- **~600 LOC PHP for PreferenceMemory + ~400 LOC for eval data plane** = the full v0.7-α surface
- No vendor dependency; no ML training; no phone-home
- v1.5+ ready to mirror rollups to `tenet eval` MCP tools for cross-project comparison

## 2. Architecture (two distinct layers)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer A — Preference Memory (per-site rule learning)               │
│                                                                     │
│  Plan rejected with note  ──→  PreferenceExtractor (MCP-side)       │
│                                ─ Claude call w/ JSON-schema response│
│                                ─ Validates extracted rule            │
│                                ─ POST /joist/v1/preferences          │
│  Slash command /remember  ──→  POST /joist/v1/preferences (direct)   │
│                                                                     │
│  Session start          ──→   GET /joist/v1/preferences/render      │
│                                ─ Returns ~800-token markdown block   │
│                                ─ Agent injects into planner prompt   │
│                                                                     │
│  Plan generation        ──→   ValidationGate                         │
│                                ─ regex/LLM pass over generated copy  │
│                                ─ catches forbidden patterns BEFORE   │
│                                  the plan is shown to the user       │
│                                                                     │
│  Daily cron             ──→   PreferenceMemory::compact()            │
│                                ─ last-write-wins on pattern collision│
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Layer B — Quality Eval (metrics over time)                         │
│                                                                     │
│  Every agent op  ──→  EvalEvent record (existing audit log → new    │
│                       joist_eval_events table for queryable form)   │
│                                                                     │
│  Hourly cron     ──→  Rollup job: p50/p95/rate → joist_eval_rollups │
│                                                                     │
│  WP Admin page   ──→  Chart.js dashboard (v0.7-β)                    │
│  REST endpoint   ──→  GET /joist/v1/quality/summary?period=...      │
│  REST endpoint   ──→  GET /joist/v1/quality/compare?a=...&b=...     │
│                                                                     │
│  v1.5+           ──→  Mirror rollups to mcp__tenet-context__         │
│                       eval_run + experiment_history                  │
└─────────────────────────────────────────────────────────────────────┘
```

The two layers share an actor-model (session_id → user, agent_version → joist version) but are otherwise independent. PreferenceMemory shapes *future* agent behavior; Quality Eval *measures* past behavior.

---

## 3. Preference Memory — Layer A

### 3.1 Data model

```
PreferenceMemory (in-memory representation, hydrated from wp_joist_preferences)
├── site_id           (hard partition; never blend across sites)
├── rules[]           (Rule value objects)
└── archived_rules[]  (supersession + audit trail)

Rule
├── id                  (uuid)
├── kind                (forbidden_phrase | preferred_vocab | voice_rule
│                        | layout_preference | color_preference
│                        | element_refused | structural)
├── scope               (global | page_type:X | section_role:Y)
├── pattern             (string OR regex serialized as /pattern/flags)
├── directive           (natural-language instruction for prompt injection)
├── provenance          ({audit_id, rejection_note, revision_diff_id, source})
├── confidence          (0.0–1.0, frequency-weighted)
├── status              (active | archived | superseded | pending_review)
├── created_at
├── last_invoked_at
└── superseded_by       (Rule id reference, when applicable)
```

**Backing store:** single custom table `wp_joist_preferences`.

```sql
CREATE TABLE wp_joist_preferences (
    id              VARCHAR(64) PRIMARY KEY,
    site_id         VARCHAR(64) NOT NULL,   -- multisite-safe
    kind            VARCHAR(32) NOT NULL,
    scope           VARCHAR(100) NOT NULL DEFAULT 'global',
    pattern         TEXT NOT NULL,
    directive       TEXT NOT NULL,
    provenance      LONGTEXT NULL,           -- JSON
    confidence      DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at      DATETIME NOT NULL,
    last_invoked_at DATETIME NULL,
    superseded_by   VARCHAR(64) NULL,
    INDEX idx_site_status (site_id, status),
    INDEX idx_site_kind (site_id, kind)
);
```

Small N (capped at ~200 per site); no vector index needed at v0.7.

### 3.2 Capture pipeline

**Signal 1 — `rejection_note` on rejected plan (v0.7):**
1. PlansController receives `POST /plans/{id}/reject` with note
2. Existing code persists the rejection
3. **NEW:** fire `joist_plan_rejected` action with `{plan_id, note, plan_steps}`
4. MCP server (TypeScript side) listens for the action via webhook
5. MCP server calls Claude with strict JSON-schema response prompt: `"Given this plan and the user's rejection note, extract zero or more rules in this format: {kind, scope, pattern, directive}. Use the narrowest defensible pattern. Return empty array if no generalizable rule."`
6. MCP server `POST /joist/v1/preferences` with the extracted rules
7. PreferencesController validates, dedups, persists

**Signal 2 — explicit `/remember` slash command in chat (v0.7):**
1. Agent recognizes `/remember <natural language rule>` in chat
2. Agent calls `POST /joist/v1/preferences` directly with `{kind, pattern, directive, provenance: {source: "user_explicit"}}`
3. Confidence 1.0, no extraction needed

**Signal 3 — implicit corrections (v1.5):** human edit immediately after agent edit. Deferred.

### 3.3 Surfacing pipeline

**Pre-load** at session start:
```
POST /joist/v1/sessions/start
→ {session_id, preferences_block: "<rendered preferences markdown>"}
```

The agent injects the `preferences_block` at the top of the planner system prompt. `render_for_prompt()` filters: `status = active`, prefer high-confidence + recently-invoked rules, cap at ~800 tokens.

Example rendered block:
```markdown
## Site preferences (from past edits)

**Forbidden phrases (don't write these):**
- "Build the future of X" (you used this in a hero on 2026-05-08; user rejected with note: "too generic")

**Brand voice:**
- Casual but precise; never use exclamation marks in headings (rejected 2 times)

**Layout preferences:**
- Hero sections: photographer-style with real photography preferred; avoid 3D illustrations (rejected 2026-04-29)
```

**Post-generation validator** (cheap, runs in MCP server before plan is shown to user):
1. For every text content the agent generated, run a regex/LLM pass against `kind=forbidden_phrase` rules
2. If a violation, the agent self-corrects BEFORE showing the plan
3. Saves a round-trip of user rejection

### 3.4 REST surface (new endpoints)

```
GET    /joist/v1/preferences                  list all rules for current site
GET    /joist/v1/preferences/render           rendered markdown block
GET    /joist/v1/preferences/{id}             single rule + provenance
POST   /joist/v1/preferences                  create rule
PUT    /joist/v1/preferences/{id}             update rule
DELETE /joist/v1/preferences/{id}             archive rule (not hard delete)
POST   /joist/v1/preferences/compact          manual trigger of daily cron
```

All endpoints require the standard agent capability + session header.

### 3.5 v0.7 scope (~600 LOC PHP)

| File | LOC | Role |
|---|---|---|
| `src/Eval/PreferenceMemory.php` | ~180 | Main class + rule CRUD + render_for_prompt + compact |
| `src/Eval/Rule.php` | ~70 | Value object + serialization |
| `src/Eval/PreferenceCapture.php` | ~80 | Hooks `joist_plan_rejected` action; emits webhook to MCP server for extraction |
| `src/Eval/ForbiddenPhraseValidator.php` | ~60 | Regex pass over generated text; returns violations |
| `src/REST/PreferencesController.php` | ~180 | 7 REST endpoints |
| `src/DB/MigrationRunner.php` (edit) | +30 | Migration 009: create `wp_joist_preferences` table |

**Total: ~600 LOC PHP, single new DB table.**

---

## 4. Quality Eval — Layer B

### 4.1 Data model

```sql
CREATE TABLE wp_joist_eval_events (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ts              DATETIME NOT NULL,
    site_id         VARCHAR(64) NOT NULL,
    session_id      VARCHAR(64) NULL,
    plan_id         VARCHAR(64) NULL,
    page_id         BIGINT UNSIGNED NULL,
    section_id      VARCHAR(64) NULL,
    metric_key      VARCHAR(64) NOT NULL,    -- fidelity | plan_accepted | plan_rejected
                                              -- | schema_invalid | policy_refuse
                                              -- | hash_mismatch | rollback
                                              -- | tokens | retries | latency_ms
    metric_value    DECIMAL(12,4) NOT NULL,
    agent_version   VARCHAR(32) NULL,
    plugin_version  VARCHAR(32) NULL,
    prompt_hash     CHAR(16) NULL,           -- short hash of agent's planner prompt
    INDEX idx_ts (ts),
    INDEX idx_site_metric_ts (site_id, metric_key, ts),
    INDEX idx_plan (plan_id)
);

CREATE TABLE wp_joist_eval_rollups (
    bucket_ts       DATETIME NOT NULL,        -- aligned to hour
    site_id         VARCHAR(64) NOT NULL,
    metric_key      VARCHAR(64) NOT NULL,
    agent_version   VARCHAR(32) NULL,
    plugin_version  VARCHAR(32) NULL,
    sample_count    INT UNSIGNED NOT NULL,
    p50             DECIMAL(12,4) NULL,
    p95             DECIMAL(12,4) NULL,
    avg_value       DECIMAL(12,4) NULL,
    rate            DECIMAL(5,4) NULL,        -- for boolean-like metrics (accepted=1, rejected=0)
    PRIMARY KEY (bucket_ts, site_id, metric_key, agent_version, plugin_version)
);
```

### 4.2 Recording

Existing code in DocumentWriter, PolicyGuard, etc. already produces these signals — they're in the audit log. The eval-recorder is a thin **fan-out**: every audit log write also writes an event row to `wp_joist_eval_events`. Recorded synchronously (it's a single INSERT on the same DB connection).

```php
// In DocumentWriter::save() success path:
EvalRecorder::record('document_save_latency_ms', $durationMs, ['session_id' => $req->sessionId, 'page_id' => $req->postId]);

// In PolicyGuard::assertAllowed() refusal:
EvalRecorder::record('policy_refuse', 1, ['session_id' => $sessionId, 'op' => $op]);

// In SchemaValidator failure:
EvalRecorder::record('schema_invalid', 1, ['session_id' => $sessionId, 'widget_type' => $type]);
```

### 4.3 Hourly rollup (WP-cron)

Existing daily cron extended with hourly job. SQL: `INSERT ... SELECT FROM wp_joist_eval_events GROUP BY hour, site, metric`. Idempotent via `ON DUPLICATE KEY UPDATE`. Rolled-up data is what dashboards query — events table grows fast, rollups are queried fast.

### 4.4 REST surface (new endpoints)

```
GET /joist/v1/quality/summary?period=last-7-days
   → {fidelity_avg, plan_accept_rate, schema_reject_rate, rollback_rate, 
      tokens_p50, tokens_p95, latency_p50, latency_p95, sample_count}

GET /joist/v1/quality/compare?a=2026-05-01..2026-05-07&b=2026-05-08..2026-05-13
   → {a: {...metrics}, b: {...metrics}, deltas: {fidelity_avg: +0.03, ...}}

GET /joist/v1/quality/trend?metric=fidelity&period=last-90-days
   → {points: [{ts, value, agent_version, plugin_version}, ...]}

GET /joist/v1/quality/per-feature?period=last-7-days
   → {hero: {fidelity_avg, ...}, pricing: {...}, ...}
```

### 4.5 Admin dashboard (v0.7-β, deferred)

WP admin page `Joist > Quality` using Chart.js (no React build required, already common in WP plugins). Pulls from the REST endpoints above. Layout:

```
+---------------- Joist Quality (last 7d vs prior 7d) ---------------+
| Quality                    | Safety            | Cost              |
| Fidelity (per section)     | Policy refuses    | Tokens/task       |
| Plan accept rate           | Hash mismatch     | Retries/task      |
| Human-correct-after        | Rollback rate     | TTC p50 / p95     |
| Schema reject rate         |                   |                   |
+--------------------------------------------------------------------+
| Per-feature regression strip: hero / pricing / features / cta ...  |
+--------------------------------------------------------------------+
| Trend chart (90d) with vertical markers on each plugin deploy      |
+--------------------------------------------------------------------+
| Failing runs (last 24h): table → click → revision diff viewer      |
+--------------------------------------------------------------------+
```

**Deliberately deferred from v0.7-α to v0.7-β.** Data plane ships now; visualization is mechanical.

### 4.6 v0.7-α scope (~400 LOC PHP)

| File | LOC | Role |
|---|---|---|
| `src/Eval/EvalRecorder.php` | ~120 | Fan-out from audit log; `record($key, $value, $context)` |
| `src/Eval/RollupJob.php` | ~150 | Hourly cron; computes p50/p95/rate per bucket |
| `src/REST/QualityController.php` | ~200 | 4 REST endpoints; aggregates from rollup table |
| `src/DB/MigrationRunner.php` (edit) | +60 | Migrations 010 + 011: create `eval_events`, `eval_rollups` |
| `src/Bootstrap.php` (edit) | +10 | Wire `EvalRecorder::record` calls at existing audit points |

**Total: ~400 LOC PHP, two new DB tables.**

---

## 5. Combined v0.7-α deliverable

**~1000 LOC PHP, 3 new DB tables, 11 new REST endpoints, 0 new admin UI (deferred).** Ships with the existing acceptance.sh extended.

### Acceptance test additions

```
section "Preference Memory: capture rejection → rule extracted → surfaces at session start"
section "Preference Memory: forbidden-phrase validator catches violations pre-plan"
section "Preference Memory: /remember command persists rule directly"
section "Preference Memory: list/edit/delete via REST"
section "Preference Memory: cross-site isolation (rule on site A doesn't appear on site B)"
section "Quality Eval: every agent op records to joist_eval_events"
section "Quality Eval: hourly rollup produces correct p50/p95/rate"
section "Quality Eval: /quality/compare returns deltas with significance flag"
```

---

## 6. v1.5+ evolution path

| Capability | Lands |
|---|---|
| Implicit-correction diff capture (human edit after agent edit → extracted rule) | v1.5 |
| JIT `retrieve_relevant(section_context)` tool exposed to generator | v1.5 |
| LLM-driven semantic compaction (not just last-write-wins) | v1.5 |
| Vector index over `archived_rules` for similarity search | v2.0 |
| Per-page-type and per-section scoping with predicate evaluation | v1.5 |
| Replay-eval loop: replay audit log against current preferences, measure rejection-rate delta | v1.5 |
| Cross-rule contradiction detector (PrefEval-inspired) | v2.0 |
| Synthetic test suite — Design2Code-style curated 50–150 marketing pages with golden Elementor JSON | v2.0 |
| SSIM render-fidelity scoring against golden corpus | v2.0 |
| DSPy MIPROv2 prompt compilation against fidelity metric | v2.0 |
| TextGrad for "Won't Convert" rubric refinement | v2.0 |
| Mirror rollups to `mcp__tenet-context__eval_run` | v1.5 |
| Braintrust-style PR comment with per-metric deltas on each plugin update | v1.5 |

The architecture supports all of these without refactoring — the `wp_joist_eval_events` schema has `agent_version + plugin_version + prompt_hash` to slice along any dimension, and `wp_joist_preferences` has `confidence + provenance` to support frequency-weighted promotion.

---

## 7. The five failure modes — codified

From research stream A (preference memory across 8 systems), every failure mode has a specific mitigation already in the design:

| Failure mode | Mitigation in this design |
|---|---|
| Over-generalization (one rejection → sweeping rule) | Extractor prompt requires "narrowest defensible pattern"; pending_review queue for low-confidence; rule shown to user inline before persist |
| Stale brand rules (rebrand, old rules persist) | Supersession on conflict (`superseded_by`); `last_invoked_at` tracks freshness; quarterly user-facing review UI in v0.7-β |
| Rule explosion (context budget overflow) | `render_for_prompt()` caps at ~800 tokens, prefers high-confidence + recent; hard cap of ~40 active rules pre-loaded; daily `compact()` merges duplicates |
| Confidently wrong retrieval (rule fires on wrong context) | Every rule has `scope` (global / page_type / section_role); generator MUST cite which rule constrained output (post-hoc audit) |
| Cross-site bleed | `site_id` as hard partition key in DAO; never returns rules from a different site |

---

## 8. What this unlocks

**Before this:** Joist captures rejection notes in the audit log but the agent never sees them on the next run. The same mistake happens again. Same as Lovable.

**After this:** rejection note → extracted rule → loaded at session start → agent doesn't make the same mistake → confidence builds. Quality dashboard shows whether the loop is working in aggregate.

**Concrete user-facing change:** the first time a user rejects "Build the future of X" with a note, that pattern is dead for that site forever. No "I keep telling Claude not to write that" frustration.

This is **the first concrete self-improve step** — narrow scope, validated pattern, ~1000 LOC, ships in v0.7.

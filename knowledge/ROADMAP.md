# Roadmap

> Phased delivery from v0 spike to v3+ feature parity with Webflow/Framer/10Web. Cuts matter more than additions — every phase ships the v(N) scope ruthlessly, then scopes v(N+1) against real user feedback.

---

## Launch target

**v1.0 OSS plugin on wp.org: ~16–18 weeks from start of focused engineering.**

Updated 2026-05-26 after the Wave 0 platform recheck (`specs/WAVE_0_2026-05-26.md`) — original 14–16-week target slipped 2 weeks to absorb v0.85 "WP 7.0 + Elementor 4 compat pass" between v0.7 and v0.9.

- **Weeks 1–6 (v0.5)**: full API surface + all 30 failure-mode constraints + multisite + custom role + PolicyGuard + async I/O
- **Weeks 7–8 (v0.7 — agency-ready)**: bulk fleet CLI, observer/quiet/kill-switch modes, client changelog export, Discord channel live
- **Weeks 9–10 (v0.85 — NEW 2026-05-26 — platform compat)**: Elementor 4 atomic schema adapter + V3/V4 detection on connect, WP 7.0 Connectors API registration, iframed-editor compatibility audit, `preference_memory` refactor to `memory_20250818` substrate
- **Weeks 11–14 (v0.9 — beta)**: Plan Mode end-to-end (DataViews + DataForm + blast-radius column) + anti-slop AI gen + FLUX.2 LoRA pipeline + SiteGround GrowBig real-site testing + preview render + iteration context
- **Week 15 (v0.95)**: third-party security audit + remediation pass
- **Weeks 16–18 (v1.0)**: wp.org submission + public launch + public-artifact pass (failure-mode catalogue, acceptance suite become public docs)

---

## Phase plan

```
[ ] v0.1 — M0 Spike (1–2 days)
    └─ Bare-minimum plugin proves the loop. "Claude wrote this page,
       I can edit it in Elementor, nothing broke."

[ ] v0.5 — Plugin Alpha (4–6 weeks)
    └─ Full §1–§22 API. All 30 failure-mode constraints enforced.
       Schema-validated writes. Atomic rollback. Hash-based OCC.
       Multisite support. Custom joist_agent role. PolicyGuard
       refuse-list. Async I/O discipline. Custom locks table.

[ ] v0.7 — Agency-ready (2 weeks)
    └─ Bulk fleet CLI (`connect --config sites.yaml`).
       Observer / quiet / kill-switch / staging-mandatory modes.
       Client-facing changelog export (HTML/CSV/PDF).
       Discord channel + GitHub Discussions live.
       SiteGround GrowBig compat matrix documented.

[ ] v0.85 — Platform compat pass (2 weeks) — NEW 2026-05-26
    └─ Elementor 4 atomic schema adapter + V3/V4 detection on connect
       (failure-mode constraint #17). WP 7.0 Connectors API registration —
       first-mover advantage on the new core API, Novamira-differentiating.
       Iframed-editor compatibility audit (#18). `add_meta_box` → PluginSidebar
       migration (#19). Multi-page chunking under 90s/500MB (#20).
       `preference_memory` refactor to Anthropic `memory_20250818` substrate.
       Skill bundle refactor (`context: fork` + CLAUDE_CODE_FORK_SUBAGENT=1).

[ ] v0.9 — Beta (6-7 weeks) — SCOPE EXPANDED 2026-05-29
    └─ Plan Mode end-to-end with WP-admin UI on @wordpress/dataviews +
       @wordpress/dataform + PluginSidebar (per-step approval + blast-radius
       column + iframe live preview side-by-side). Anti-slop AI gen for
       copy (Claude Opus 4.7 + cached brand block + Ozigi two-layer validator)
       and images (FLUX.2 [dev] + per-site LoRA via fal.ai; Recraft for vector;
       Ideogram for text-on-image). Quality gates. SiteGround real-site testing.
       POST /preview/render with sandboxed iframe + CSS-diff.
       Iteration context endpoint. Claude Code skill bundle.

       ADDED 2026-05-29 from Wave 9 research (specs/WAVE_9_2026-05-29.md):
       - Generator/evaluator skill harness: split /elementor-build into
         generator + new /elementor-critique sibling skill (Playwright MCP,
         AesEval-Bench rubric, 5-iteration cap). Anthropic's canonical
         agentic-design pattern (Mar 24 2026 post).
       - POST /joist/v1/critique endpoint paired with /preview/render
       - Forced Optimization gate on Document::save (failure-mode #21):
         refuse commits where critique score regresses. Cited evidence:
         VisRefiner empirical regression observation + Patterns paper's
         12-motif collapse finding.
       - Plan Mode UI: vision-judged critique-score column with delta
         and worst-region annotation. Differentiator vs Lovable/v0.
       - Three-tier taste substrate: joist.constitution.md (~50 rationale
         -bearing principles, agency-default + per-site override) →
         preference_memory with rationale + superseded_by fields →
         exemplar_pack (5-20 approved designs cached). Anthropic's own
         2026 constitution grew 2,700 → 23,000 words by adopting
         explanation-with-rationale.
       - Anti-cliché diversity check (failure-mode #22): cosine sim
         against last N committed renders.
       - AGENTS.md emission for generated sites (cross-tool standard).
       - Safety classifier on Document::save (mirror Cursor 3.6
         Auto-review): Haiku-cost allow/redirect/ask classifier.
       - Async preference_memory writes (Mem0 #1 production footgun).
       - Active-learning choice cards in Plan Mode: max 1/session, info
         -value gated, 2 consistent answers required before promotion.
       - Public AesEval-Bench score for /elementor-critique as v1.0
         credibility artifact alongside docs/FAILURE_MODES.md.

[ ] v0.95 — Security audit (1 week) — NEW
    └─ Third-party WP-specialist security audit + remediation pass.
       Penetration test of REST surface, SSRF guards, policy
       refusals, plan approval flow. Budget $5–15k.

[ ] v1.0 — OSS Launch (14–16 weeks total)
    └─ wp.org-listed. Documented. Bulk CLI tested in production.
       Hello + Elementor Pro fully supported. Audit log + rollback
       proven in production with beta users.

[ ] v1.5 — Depth (6 months)
    └─ SEO depth (schema markup, llms.txt). A11y scanner (axe-core)
       + remediation. Multilingual via WPML adapter. Forms (Pro)
       integration. Per-step plan approval + plan forking.
       AI-edit canvas badge in Elementor editor. Visual-diff
       screenshots. GDPR DSR endpoints. Curated starter kits.

[ ] v2.0 — SaaS Launch (9–12 months)
    └─ Hosted control plane with standalone approval surface.
       Multi-site dashboard. Post-launch autonomous agents.
       Brand kit cloud storage. Optional managed AI. Agency
       white-label. Real-time presence indicators.

[ ] v3.0 — Parity (12–18 months)
    └─ Figma / screenshot import. Native A/B testing. AEO
       citation tracking. WooCommerce. Static HTML export.
       Design system tokens (variants, semantic, dark-mode).
       Site graph + coherence scoring.
```

---

## Milestones — pre-launch (working back from v1.0)

| Week | Focus | Deliverables |
|------|-------|--------------|
| -12 | M0 spike | Hello + Elementor Pro on Local; 50-line plugin; one Claude-written page survives human edit |
| -11 | Plugin scaffold | PSR-4 namespace, DI container, REST controller base, AuditLogger, Hasher, IDGenerator |
| -10 | Document write pipeline | `DocumentWriter::save()` with all 6 failure-mode constraints; PatchEngine; LockManager |
| -9 | Schema introspection | `WidgetCatalog::refresh()` + `SchemaValidator::validateTree()` covering all stock Elementor widgets + Pro |
| -8 | Pages + Elements REST | §6 + §7 endpoints with OCC, dry-run, surgical patches |
| -7 | Widgets + Kit REST | §8 + §9 endpoints; widget validate endpoint; Kit import/export |
| -6 | Theme Builder + Media + Menus | §10 + §11 + §12 endpoints |
| -5 | Plugins + SEO + Health | §13 + §14 + §16; SEO adapters (Yoast, RankMath, AIOSEO, native); preflight validator |
| -4 | Plan Mode end-to-end | PlanStore + PlanExecutor + admin approval UI + webhook |
| -3 | MCP server + skill | TypeScript MCP server; `/elementor-build` `/elementor-edit` `/elementor-audit` skills |
| -2 | CLI + anti-slop gen | `joist connect`; SlopDetector; CopyGenerator with brand kit; ImageGenerator router |
| -1 | Polish + docs + wp.org prep | readme.txt; screenshots; INSTALL/QUICKSTART/FAQ; security review; SiteGround real-site test |

---

## Launch week (v1.0)

| Day | Activity |
|-----|----------|
| Mon | Submit plugin to wp.org review queue; final QA pass on production site |
| Tue | GitHub repo public; release tagged v1.0.0; npm publish CLI + MCP server |
| Wed | Launch post on personal/tenet blog; submit to HN (Show HN), Reddit r/WordPress, r/ClaudeAI, r/elementor |
| Thu | Outreach to WP/Elementor newsletter editors (WP Tavern, WP Mayor, ManageWP, Post Status) |
| Fri | First-week stats review: installs, GitHub stars, support tickets, identified blockers |

---

## Post-launch

| Week | Focus |
|------|-------|
| +1 | Bug triage from real-world installs; SiteGround / WP Engine / Kinsta edge cases |
| +2 | First v1.0.1 patch release; v1.1 scoped from user feedback |
| +4 | Begin v1.5 (SEO depth, a11y, WPML) based on most-requested features |
| +8 | First beta agency for paid SaaS layer (v2 prep) |

---

## Dependencies

### Blockers (must resolve before v1.0)
- WordPress 7.0.1+ stability (7.0 shipped May 20; wait for first patch)
- Elementor 4.0 atomic-schema bug fixes (#35888, #35625) OR our adapter handles it
- `WordPress/mcp-adapter` post-#177 commit pinned
- Elementor Pro license for development + automated testing

### External dependencies
- Elementor 3.33–3.34.x stability (skip 4.0.x for first smoke test until atomic-save bugs fix)
- Anthropic API availability + pricing (June 15 billing-split for Agent SDK noted)
- wp.org plugin review timelines (usually ~5–14 days)

### Internal dependencies
- v0.1 spike must validate the round-trip discipline before scaling the architecture
- Plan Mode admin UI requires React build pipeline (Webpack config in plugin assets)
- CLI requires single-file binary for cross-platform install (bun build / pkg / similar)

---

## Success metrics

### Launch day (v1.0)
| Metric | Target |
|---|---|
| GitHub stars | 100+ |
| wp.org submission accepted | ✓ |
| Successful install on 5+ host types (SG, Kinsta, WPE, Cloudways, Local) | ✓ |
| First Show HN comment thread | 50+ |

### 30 days post-launch
| Metric | Target |
|---|---|
| wp.org active installs | 500+ |
| GitHub stars | 500+ |
| Active beta agencies | 5+ |
| Open issues (severity: blocker) | <3 |
| Schema drift CI failures | 0 |
| Documented silent-failure bug reports | 0 |

### 90 days
| Metric | Target |
|---|---|
| wp.org active installs | 2,500+ |
| Agency beta MRR (informal) | $5k+ |
| Number of widgets covered by schema validation | 100% Elementor core + Pro |
| Roundtrip-safety incidents reported | 0 |

### 1 year
| Metric | Target |
|---|---|
| wp.org active installs | 25,000+ |
| Paying SaaS accounts (post-v2 launch) | 200+ |
| ARR | $250k+ |
| Default recommendation in r/elementor + r/WordPress AI threads | ✓ |

---

## Team assignments (placeholder — solo founder + AI start)

| Area | Owner | Status |
|---|---|---|
| Product / API spec | Founder | ✓ v0 drafted |
| Plugin engineering (PHP) | Founder + Claude Code | Pending start |
| MCP server (TS) | Founder + Claude Code | Pending start |
| CLI | Founder + Claude Code | Pending start |
| Design / brand identity | `/brandarchitect` skill (output → `knowledge/BRAND_BRIEF.md` input) | Pending |
| Content marketing | `/contentcreator` skill | Pending |
| QA / real-site testing | Founder (own SiteGround sites) + beta users | Pending v0.5 |

---

## Updates log

### 2026-05-29 — Wave 9 design-agent frontier recheck
- Three focused research streams (G/H/I) surfaced load-bearing v0.9 deltas: Anthropic published the canonical generator/evaluator harness 2026-03-24 ([anthropic.com/engineering/harness-design-long-running-apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)); VisRefiner (Feb 2026) and Patterns / Cell Press 2025 cite-evidence that naive critique loops degrade output unless gated by Forced Optimization; AesEval-Bench (Mar 2026) is the public eval target for design judgment quality; three-tier taste substrate (constitution + rules-with-rationale + exemplar pack) is the 2026 H1 state of the art.
- 13 v0.9 deltas catalogued in `specs/WAVE_9_2026-05-29.md`
- Failure-mode constraints extended 20 → 24 (added #21 Forced Optimization gate, #22 anti-cliché diversity check, #23 bounded critique iteration N=5, #24 no autonomous raw-VLM slop filter — each cited)
- v0.9 timeline 4 → 6-7 weeks (absorbs critique loop + 3-tier substrate + active-learning UX)
- v1.0 timeline 16-18 → 18-20 weeks accordingly
- NEW memory: `design_harness_pattern.md` captures the Anthropic two-agent shape + Cursor/Replit/v0/Lovable competitive read
- Existing memory updated: `preference_memory_pattern.md` (3-tier substrate + rationale/superseded_by/last_reinforced_at + sycophancy + taste-collapse mitigations), `architecture_decisions.md` (generator/evaluator harness + Forced Optimization + Glance MCP + AesEval-Bench + safety classifier + Lovable variants-before-build)
- AGENTS.md emission added as a v0.9 free-win (cross-tool standard convergence)
- Public-artifact pass extended: docs/FAILURE_MODES.md gets #21-#24 once the design harness ships
- v0.85 work is NOT invalidated; Wave 9 is purely additive — layering taste capability on top of the substrate that already shipped

### 2026-05-26 — Wave 0 platform recheck
- Six parallel research streams returned with three load-bearing surprises: Novamira Pro shipped May 15 (first direct competitor), WP 7.0 Armstrong shipped May 20 (native AI Client + Connectors API + DataViews + iframed editor), Elementor 4.0 default since March 30 with broken atomic saves
- Inserted **v0.85 "Platform compat pass"** milestone between v0.7 and v0.9 (2 weeks); v1.0 timeline 14–16 → 16–18 weeks
- Version pins refreshed: WP 6.9.4 (not 7.0.0), Elementor 3.33–3.34.x (not 3.21, not 4.x), PHP 8.2 (not 8.4), mcp-adapter at specific commit SHA post-#177
- Failure-mode constraints extended 16 → 20 (added #17 Elementor version detection, #18 no `document.*` from outer admin frame, #19 no `add_meta_box`, #20 chunk multi-page <90s/<500MB)
- Widget Pack: Subgrid widget DELETED (Elementor native after 3.26), View-Transition + Display-swap SIMPLIFIED, Anchored Pop ADDED (Anchor Positioning Baseline 2026), Pin-Scroll `@supports` gate added
- Architecture: adopt `memory_20250818` substrate for `preference_memory`, register Joist via WP 7.0 Connectors API, use `context: fork` + CLAUDE_CODE_FORK_SUBAGENT=1, Task tools replace TodoWrite in SDK, document June 15 Agent SDK billing split with `JOIST_USE_API_KEY` escape hatch
- Plan Mode UI substrate: `@wordpress/dataviews` + `@wordpress/dataform` + PluginSidebar with per-step approval + blast-radius column (open-space differentiator)
- Brand pipeline: FLUX.2 [dev] + per-site LoRA via fal.ai (image), Claude Opus 4.7 + cached brand block (copy), Ozigi two-layer slop validator
- Public-artifact commitment added for v1.0: failure-mode catalogue + acceptance suite become public docs (positioning differentiator vs Novamira)
- Full synthesis in `specs/WAVE_0_2026-05-26.md`

### 2026-05-10 (later)
- v1 hardening pass — 5-way red-team critique synthesized into `specs/HARDENING_v1.md`
- §20 failure-mode constraints extended from 16 → 30 (PLUGIN_API.md)
- Roadmap updated: v1.0 timeline 12 → 14–16 weeks; new v0.7 (agency-ready) and v0.95 (security audit) milestones
- Bulk fleet CLI brought forward from v2 to v1
- README hardened: status warning to top, support strategy, recommended-for tiers, "what survives if maintainer disappears"
- New memory: `v1_hard_requirements.md` consolidates non-negotiables from critique

### 2026-05-10 (earlier)
- Workspace initialized via `tenet init`
- API spec v0 drafted (`specs/PLUGIN_API.md` — 1200+ lines covering §1–§22)
- Architecture spec v0 drafted (`specs/ARCHITECTURE.md`)
- Competitive landscape, failure-mode constraints, and taste rules saved to memory
- Knowledge layer filled in: VISION, THESIS, NARRATIVE, ROADMAP, CONSTITUTION, BRAND_BRIEF
- Private GitHub repo created
- Ready to begin v0.1 M0 spike

# Roadmap

> Phased delivery from v0 spike to v3+ feature parity with Webflow/Framer/10Web. Cuts matter more than additions — every phase ships the v(N) scope ruthlessly, then scopes v(N+1) against real user feedback.

---

## Launch target

**v1.0 OSS plugin on wp.org: ~14–16 weeks from start of focused engineering.**

Updated 2026-05-10 after the v1 hardening pass (`specs/HARDENING_v1.md`) — original 12-week target slipped 2–4 weeks to absorb: bulk fleet CLI brought forward from v2, multisite handling, custom `joist_agent` role, PolicyGuard refusals, async I/O refactor, third-party security audit, and the 14 new failure-mode constraints (#17–#30).

- **Weeks 1–6 (v0.5)**: full API surface + all 30 failure-mode constraints + multisite + custom role + PolicyGuard + async I/O
- **Weeks 7–8 (v0.7 — NEW)**: bulk fleet CLI, observer/quiet/kill-switch modes, client changelog export, Discord channel live
- **Weeks 9–12 (v0.9)**: Plan Mode end-to-end + anti-slop AI gen + SiteGround GrowBig real-site testing + preview render + iteration context
- **Week 13 (v0.95 — NEW)**: third-party security audit + remediation pass
- **Weeks 14–16 (v1.0)**: wp.org submission + public launch

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

[ ] v0.7 — Agency-ready (2 weeks) — NEW
    └─ Bulk fleet CLI (`connect --config sites.yaml`).
       Observer / quiet / kill-switch / staging-mandatory modes.
       Client-facing changelog export (HTML/CSV/PDF).
       Discord channel + GitHub Discussions live.
       SiteGround GrowBig compat matrix documented.

[ ] v0.9 — Beta (4 weeks)
    └─ Plan Mode end-to-end with WP-admin React approval UI built on
       @wordpress/components. Anti-slop AI gen for copy + images.
       Quality gates. SiteGround real-site testing.
       POST /preview/render with sandboxed iframe + CSS-diff.
       Iteration context endpoint. Claude Code skill bundle.

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
- WordPress 6.9 / Abilities API GA (currently still rolling out)
- `WordPress/mcp-adapter` v1.0 stability
- Elementor Pro license for development + automated testing

### External dependencies
- Elementor 3.21 stability (potential 4.0 Atomic widgets release lurking — version-pin and graceful degrade)
- Anthropic API availability + pricing
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

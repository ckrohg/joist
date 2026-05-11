# Roadmap

> Phased delivery from v0 spike to v3+ feature parity with Webflow/Framer/10Web. Cuts matter more than additions — every phase ships the v(N) scope ruthlessly, then scopes v(N+1) against real user feedback.

---

## Launch target

**v1.0 OSS plugin on wp.org: ~3 months from start of focused engineering.**

Working backward from a 3-month v1.0:
- **Month 1**: M0 spike + plugin scaffold + core write pipeline
- **Month 2**: All §1–§18 API endpoints + 16 failure-mode constraints enforced
- **Month 3**: Plan Mode + anti-slop AI gen + Claude Code skills + CLI + wp.org submission

---

## Phase plan

```
[ ] v0.1 — M0 Spike (1–2 days)
    └─ Bare-minimum plugin proves the loop. "Claude wrote this page,
       I can edit it in Elementor, nothing broke."

[ ] v0.5 — Plugin Alpha (4–6 weeks)
    └─ Full §1–§18 API. All 16 failure-mode constraints enforced.
       Schema-validated writes. Atomic rollback. Hash-based OCC.

[ ] v0.9 — Beta (8–10 weeks)
    └─ Plan Mode end-to-end. Anti-slop AI gen for copy + images.
       Quality gates. SiteGround tested. Claude Code skill bundle.

[ ] v1.0 — OSS Launch (12 weeks)
    └─ wp.org-listed. Documented. CLI for one-shot setup.
       Hello + Elementor Pro fully supported. Audit log + rollback
       proven in production with beta users.

[ ] v1.5 — Depth (6 months)
    └─ SEO depth (schema markup, llms.txt). A11y scanner (axe-core).
       Multilingual via WPML adapter. Forms (Pro) integration.
       Staging mode for hosts that support it.

[ ] v2.0 — SaaS Launch (9–12 months)
    └─ Hosted control plane. Multi-site dashboard. Post-launch
       autonomous agents. Brand kit cloud storage. Optional managed
       AI. Agency white-label.

[ ] v3.0 — Parity (12–18 months)
    └─ Figma / screenshot import. Native A/B testing. AEO citation
       tracking. WooCommerce. Static HTML export.
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
| -2 | CLI + anti-slop gen | `tenet-elementor connect`; SlopDetector; CopyGenerator with brand kit; ImageGenerator router |
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

### 2026-05-10
- Workspace initialized via `tenet init`
- API spec v0 drafted (`specs/PLUGIN_API.md` — 1200+ lines covering §1–§22)
- Architecture spec v0 drafted (`specs/ARCHITECTURE.md`)
- Competitive landscape, failure-mode constraints, and taste rules saved to memory
- Knowledge layer filled in: VISION, THESIS, NARRATIVE, ROADMAP, CONSTITUTION, BRAND_BRIEF
- Private GitHub repo created
- Ready to begin v0.1 M0 spike

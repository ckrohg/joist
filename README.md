# tenet-elementor

> Open-source agentic backbone for Elementor (WordPress) sites. A plugin + Claude Code skill + CLI that gives an AI agent safe, schema-validated, audit-logged read/write access to any Elementor site — so AI can build new sites, edit existing pages surgically, and refresh content as a trusted teammate, not a magic button.

**Status:** pre-v0.1 — workspace bootstrapped, API + architecture specs drafted, no code yet.

---

## Why

The AI website builder space converged on the wrong product. Wix AI, 10Web, Framer AI, Lovable — all optimized for *one-shot generation* of new sites. They fail the moment a real builder tries to use them on a production site:

- Output looks generic (indigo gradients, "Build the future of X," AI 3D blobs)
- Edits regenerate the whole page and destroy prior human work
- They can't operate on an existing site
- Tools return `success: true` while silently breaking the page (the canonical bug: [msrbuilds/elementor-mcp #32](https://github.com/msrbuilds/elementor-mcp/issues/32))
- Vendor lock-in to the AI builder's own hosting and tooling

We took the opposite bet: AI as a **trusted collaborator** for an existing builder, not a replacement for it. We picked Elementor — the dominant WordPress page builder, ~13M sites — because it has the largest underserved surface in this market, and because WordPress core just shipped the Abilities API + official `mcp-adapter` (Feb 2026) that makes this finally standardized.

---

## How it works

```
Claude Code (your machine)
   │
   │  MCP tool calls (over HTTPS, App Password auth)
   ▼
WordPress site
   ├─ our plugin: tenet-elementor-agent
   │     ├─ registers WP Abilities (Abilities API)
   │     ├─ exposed as MCP tools via WordPress/mcp-adapter
   │     ├─ schema-validates every widget setting before write
   │     ├─ writes via Elementor's own Document::save() (never raw postmeta)
   │     ├─ snapshots every change; atomic rollback on failure
   │     └─ audit-logs every edit with attribution
   ▼
Elementor (unchanged) → wp_postmeta._elementor_data → frontend
```

The plugin enforces 16 hard product invariants distilled from public bug reports + postmortems of every prior attempt. See [`specs/PLUGIN_API.md §20`](specs/PLUGIN_API.md).

---

## What's in this repo

```
specs/
├── PLUGIN_API.md           # full REST + MCP surface (~1200 lines)
└── ARCHITECTURE.md         # v1 implementation architecture

knowledge/                   # strategy + brand
├── VISION.md
├── THESIS.md
├── NARRATIVE.md
├── ROADMAP.md
├── CONSTITUTION.md
└── BRAND_BRIEF.md

(when implementation begins)
plugin/                      # WordPress plugin (PHP, GPL)
mcp-server/                  # Claude Code MCP server (TypeScript, MIT)
cli/                         # setup CLI (Node, MIT)
skills/                      # Claude Code skills
docs/                        # user-facing documentation
```

---

## Roadmap (summary)

- **v0.1** — M0 spike. 50-line plugin proves Claude can write an Elementor page and humans can edit it without breaking. (1–2 days)
- **v0.5** — Plugin alpha. Full API surface §1–§18, all 16 failure-mode constraints enforced. (4–6 weeks)
- **v0.9** — Beta. Plan Mode end-to-end. Anti-slop AI gen. SiteGround tested. (8–10 weeks)
- **v1.0** — Production OSS release on wp.org. Documented. CLI for one-shot setup. (~12 weeks)
- **v2.0** — Hosted SaaS layer for agencies. Multi-site dashboard, post-launch autonomous agents.

Full plan in [`knowledge/ROADMAP.md`](knowledge/ROADMAP.md).

---

## Differentiation

Every prior attempt in this category has shipped with documented silent-failure bugs, destructive regenerations, or hosting lock-in. Our design constraints make those bugs structurally impossible:

1. **Validate every widget write against the live introspected schema.** Unknown keys → 422, never silent passthrough.
2. **Read-after-write on every mutation.** Tools return the verified post-save state, never `{success: true}`.
3. **Surgical diff-based edits only.** No full-page regenerate as a single op.
4. **Atomic rollback** via snapshot-then-save on every multi-step edit.
5. **Optimistic concurrency** via canonicalized SHA-256 content hashes — humans and agents co-edit safely.
6. **Plan Mode** — every multi-step write goes through human approval in WP admin.
7. **Anti-slop quality gates** — refuses indigo-500 gradients, "Build the future of X" headlines, generic AI 3D blobs.
8. **First-class export, always.** No lock-in. Kit `.zip`, Elementor template JSON, WXR, static HTML.

Full list of 16 constraints in [`specs/PLUGIN_API.md §20`](specs/PLUGIN_API.md). The constitutional principles behind them: [`knowledge/CONSTITUTION.md`](knowledge/CONSTITUTION.md).

---

## License

- Plugin (PHP): GPL-2.0-or-later (required for wp.org)
- MCP server (TypeScript): MIT
- CLI (Node): MIT
- Specs + knowledge docs: CC-BY-4.0

---

## Status

Private development repo. Public OSS launch targeted for v1.0 (~3 months from focused engineering start).

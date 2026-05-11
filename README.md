# tenet-elementor

> [!WARNING]
> **Status: pre-v0.1 — specs only, no plugin code yet.** Do not install on production sites. Target v1.0 OSS launch: ~14–16 weeks of focused engineering from start. Watch the repo if you want to follow along; install on a staging site at v0.5; install on a non-critical client site at v1.0; install on important client sites only after v1.0 has been in the wild for 60+ days.

> Open-source agentic backbone for Elementor (WordPress) sites. A plugin + Claude Code skill + CLI that gives an AI agent safe, schema-validated, audit-logged read/write access to any Elementor site — so AI can build new sites, edit existing pages surgically, and refresh content as a trusted teammate, not a magic button.

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

## Recommended for

**v1.0 target users:**
- Solo Elementor builders and freelancers running 1–5 client sites
- Small studios (1–3 people) who are Claude-Code-fluent
- WordPress devs evaluating agentic AI tooling for client work

**Wait for v2 SaaS (~9–12 months out):**
- Agencies running 10+ client sites who need bulk fleet management with a web dashboard, autonomous post-launch agents, white-label
- Anyone who needs a designer team (non-developers) to drive the agent without going through Claude Code

The v1 OSS CLI includes a `--config sites.yaml` bulk-onboarding mode for fleet operators, but the full multi-site management surface is the v2 paid tier.

---

## Support

- **GitHub Discussions** — technical questions, contribution discussion *(set up at v0.5)*
- **Discord** — real-time support, office hours *(set up at v0.5)*
- **Bug triage SLA** — best-effort, business-hours US, critical bugs (data loss, security) triaged within 48 hours of report *(once v1.0 ships)*

**What if the maintainer disappears?** The plugin is GPL. The MCP server + CLI are MIT. The schema validator is self-contained — fork the repo and run. The custom database tables (`wp_tenet_el_*`) are documented in `specs/ARCHITECTURE.md §6`. Every AI-generated edit lives in native `_elementor_data`, so uninstalling the plugin doesn't remove your pages.

---

## License

- Plugin (PHP): GPL-2.0-or-later (required for wp.org)
- MCP server (TypeScript): MIT
- CLI (Node): MIT
- Specs + knowledge docs: CC-BY-4.0

---

## Repo status

Private during pre-v0.5 development. Will go public when v0.5 plugin alpha is ready for community feedback. Public OSS launch (v1.0 → wp.org) targeted ~14–16 weeks from focused engineering start.

See `specs/HARDENING_v1.md` for the detailed v1 scope after the 5-way red-team critique pass.

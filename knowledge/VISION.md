# Vision

## The one-liner

**An open-source agentic backbone that turns every Elementor (WordPress) site into a co-editable artifact — built, edited, and maintained by AI agents working alongside humans without breaking what's already there.**

---

## The problem

Every AI website builder shipping today optimizes for *new-site, one-shot generation*. Press a button, get a site. Then the site doesn't survive contact with reality:

- The output is generic (indigo gradients, Inter, "Build the future of X" headlines).
- Edits regenerate the whole page and destroy prior work.
- AI-only tools rebrand themselves as "no-code"; serious builders can't trust them on real client sites.
- WordPress — which runs ~43% of the web and where Elementor alone powers millions of sites — has been left with a fragmented, half-broken AI ecosystem: a half-dozen open-source MCP servers with silent-failure bugs, Elementor's own Angie (announced, not shipped for full site building), and 10Web's commercial agentic builder locked to its own hosting.

**Who feels this:**
- Solo Elementor builders running 1–5 client sites who want a coding-grade teammate but can't trust current tools
- Small agencies running 10–100 client sites whose junior implementers spend hours on copy/image/section work
- WordPress freelancers losing pitches to Webflow / Framer because their AI workflow lags

---

## The solution

A WordPress plugin + Claude Code skill that gives an AI agent safe, schema-validated, audit-logged read/write access to any Elementor site. The agent:

- **Builds** new pages and entire sites from a brief — sitemap, IA, copy, images, kit.
- **Edits** existing pages surgically by element ID — never regenerates and clobbers.
- **Round-trips** with human editors — every AI change is hashed, attributed, and revertible; humans can keep editing in the Elementor UI and the agent picks up where they left off without breaking anything.
- **Refuses to ship slop** — anti-slop quality gates reject indigo gradients, generic headlines, AI 3D blobs; biases output toward 2026 cutting-edge aesthetics (shadcn / Aceternity / Awwwards taste over Envato/Jupiter kits).
- **Refuses to silently fail** — schema validation, read-after-write verification, atomic rollback, and audit logs ensure every operation either lands cleanly or surfaces a hard error.

---

## The shift

**Before:** AI website builders are a magic button. You press it, get something that looks impressive in a demo and falls apart in production. Humans can't co-edit because the AI doesn't know what they touched. Output is generic. You're locked into one vendor's hosting + closed-source tooling.

**After:** AI is a trusted collaborator on the world's most popular CMS. You give it a brief or a directive ("redesign the hero with a bento layout"), it proposes a structured plan, you review and approve in WP admin, it executes with rollback. Every edit is yours to keep, revert, or modify by hand. Your data is yours. The plugin is open source. You run it on the host you already pay for.

---

## Why now

Four things converged in early 2026 that make this the right moment:

1. **WordPress core shipped the Abilities API + official `mcp-adapter`** (Feb 2026) — the canonical way to expose WP operations as MCP tools. The plumbing is now standardized.
2. **Claude Code matured into a daily-driver agent surface** for developers and prosumers — the natural client for an MCP-backed plugin.
3. **Elementor's own Angie launched in March 2026** but is currently focused on code/widget generation, not full site building. "Angie Agents" for autonomous workflows is announced for late 2026 — a 6–12 month window for a community-first alternative to establish itself.
4. **The failure modes of every prior attempt are now documented in public bug trackers**, giving us a precise design-around list. We don't have to discover the silent-failure bugs ourselves; we can engineer them out from day one.

---

## The end state

**3 years out** — joist is the default agentic layer for the WordPress + Elementor ecosystem:

- The free OSS plugin distributes via wp.org and reaches 100k+ active Elementor sites.
- The hosted SaaS layer serves 1,000+ agencies running multi-site dashboards, autonomous post-launch agents, and white-label client portals.
- Claude Code, Cursor, Windsurf, Postman, and any future MCP-aware client can drive WordPress + Elementor sites natively.
- "Built with Claude on Elementor" is a recognized signal of quality, not slop.

We are not Elementor's competitor. We are Elementor's agentic backbone — the layer that turns Elementor sites into AI-co-edited artifacts without compromising the Elementor experience for the humans who edit them.

---

## Quick reference

| Question | Answer |
|----------|--------|
| What do you do? | Open-source agentic backbone for Elementor WordPress sites |
| For whom? | Elementor builders, freelancers, and agencies running real client sites |
| Why does it matter? | The largest CMS ecosystem on earth lacks a trustworthy AI co-editor |
| Why will you win? | Round-trip discipline + schema validation + taste curation, distributed free as OSS |

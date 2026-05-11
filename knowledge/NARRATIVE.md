# Narrative

## The narrative stack

### Tagline (5 words)
**An AI teammate for Elementor.**

### Tweet (280 chars)
> Open-source agent for WordPress + Elementor. Build sites from a brief, edit pages by conversation, refresh blogs in bulk — with schema-validated writes, audit logs, and atomic rollback. Round-trip safe with human editors. Free plugin on wp.org. Works with your existing sites.

### Elevator pitch (30 seconds)
> Every AI website builder today is a one-shot magic button — generic output, destructive edits, no way for humans to co-edit. We built an open-source plugin that gives Claude Code safe, schema-validated, audit-logged read/write access to any Elementor site. The agent proposes a plan, you approve in WordPress admin, it executes with atomic rollback. You can keep editing in the Elementor UI; the agent picks up where you left off without breaking anything. Free plugin, works on your existing sites, your data stays yours.

### One-pager (2 min)
The AI website builder space converged on the wrong product. Wix AI, 10Web, Framer AI, Lovable — all optimize for *one-shot generation*: press a button, get a site. That works for demos. It fails the second a real builder tries to use it on a client site.

We took the opposite bet. AI as a **trusted collaborator** for an existing builder ecosystem — not a replacement for the editor, but a peer who can be assigned partial work and review-gated to ship.

We picked Elementor (the dominant WordPress page builder, ~13M sites) because it has the largest underserved surface in the AI-builder market. WordPress.com just enabled full MCP write access. WordPress core just shipped the Abilities API. Elementor's own Angie is announced but currently limited to code/widget generation. The window is open for a community-first, OSS-distributed agent layer.

Our differentiation is **discipline**:
- Every widget setting validated against the live schema before write (the bug that killed every prior open-source attempt)
- Read-after-write verification on every mutation
- Atomic rollback via snapshot-then-save
- Optimistic concurrency hashes so humans + agents can co-edit without clobbering
- Plan Mode — agent proposes, human approves, executor runs
- Audit log — every AI edit attributed and revertible
- Anti-slop quality gates — refuses indigo-500 gradients, "Build the future of X" headlines, AI 3D blobs

We ship as a free OSS plugin (the distribution wedge), with a paid SaaS layer for agencies running 10+ client sites (the revenue moat). It's the playbook Yoast / Elementor itself / Astra / GravityForms have all run successfully — adapted for the agentic era.

### Full story (10 min — for landing page / sales deck / pitch)

**Act I — the problem (set the stage):**
The AI website builder gold rush of 2024–2026 produced a category that doesn't survive contact with reality. Users press the button, get something that looks impressive in a demo, then discover:

- It looks the same as every other AI-built site (indigo-500, Inter, "Build the future of work")
- The next edit regenerates the whole page and destroys their prior work (Wix Harmony, 10Web — documented complaints)
- They can't bring an existing site to it; it only generates new ones
- They're locked into one vendor's hosting and tooling
- When the AI fails, it returns "success: true" and silently breaks the page (msrbuilds/elementor-mcp issue #32 is the canonical example: tool wrote `justify_content` instead of `flex_justify_content`, success returned, frontend renders wrong)
- The output won't pass a code review, a design review, or a Lighthouse audit

These aren't theoretical risks — they're documented in public bug trackers, Reddit threads, and Trustpilot reviews of every product in the category.

**Act II — the insight:**
The failures share one root cause: these tools treat AI as a *one-shot generator* instead of a *trusted collaborator*. They optimize for "give me a site in 60 seconds" instead of "let me give you partial work and review what comes back."

The correct product is an agent that:
- Reads the site's current state, including what humans changed since the last AI run
- Proposes a structured plan and waits for approval
- Executes surgical edits (not full regenerations)
- Validates every change against the live system's schema
- Confirms the change actually landed
- Logs every edit so humans can see and revert exactly what was touched
- Refuses to ship slop output, by name and pattern

This is a different product than "AI website builder." It's an **agentic backbone** for an existing builder.

**Act III — why now:**
Four things converged in early 2026:

1. WordPress core shipped the Abilities API (the standardized way to expose WP operations to AI) and the official `mcp-adapter` (Feb 2026).
2. Claude Code matured into a daily-use development environment for prosumers and developers.
3. Elementor's own Angie agent launched (March 2026) but is currently scoped to code/widget generation, not full site building — leaving a 6–12 month window before they ship Angie Agents.
4. Every prior failure mode in this category is now publicly documented, so we can engineer around them from day one.

**Act IV — the invitation:**
We're building the OSS plugin in public, on GitHub. The first version ships in 3 months. We're starting with SiteGround-hosted Elementor sites because that's the realistic target customer's stack today. If you run Elementor sites for clients — or you're an agency tired of generic AI tools that don't survive your QA — this is for you. Join the beta. File issues. Push back on the spec.

---

## Audience-specific narratives

### For developers / open-source builders
> The technical bar is the differentiator. Schema-validated writes via `\Elementor\Plugin::$instance->documents->get($id)->save([...])`. OCC via canonicalized SHA-256 hashes. Atomic rollback via custom revisions table. Native WP Abilities API + `mcp-adapter` integration. The plugin is GPL, the MCP server is MIT, the architecture spec is in the repo. Read the failure-mode constraints document — if you've shipped to wp.org you'll recognize every bug we're engineering around.

### For Elementor freelancers / small studios
> You charge clients for hours you currently spend on copy, image generation, section building, SEO meta, and blog refreshes. This plugin gives you a reviewable AI teammate that handles the grind. You stay the editor of record. Every change is in your audit log, attributable to you, revertible with one click. Free, open source, works on the sites you already manage.

### For agency owners (10+ client sites)
> The SaaS layer ($99–$299/mo) gives you one dashboard across all your client sites. Background agents run weekly content refreshes, SEO sweeps, performance audits, accessibility scans across every site you manage. White-label the editor, bill clients monthly, stop hiring junior implementers. Stripe revenue, your branding, your data.

### For investors
> The OSS-plugin-to-SaaS playbook has been proven on WordPress by Yoast (acquired $300M), Elementor itself ($165M Series B → $700M valuation), Astra/Brainstorm Force (~$50M ARR), GravityForms (>$20M ARR). We're applying it to the agentic era on the largest CMS ecosystem on earth, at the moment Elementor's own AI gap is most visible and the WordPress MCP plumbing is most standardized.

### For press / media
> The story: while every venture-backed AI website builder optimized for one-shot generation, the open-source WordPress community kept asking for an AI tool that works on their existing sites without destroying them. We built that. The plugin is free, the company is bootstrapped to start, the customer is the millions of Elementor sites that the gold rush ignored.

---

## Key messages

### Must always say
- **Open source** (the wedge that distinguishes us from Webflow / Wix / 10Web / Framer)
- **Round-trip safe with humans** (the technical core)
- **Works on your existing sites** (not just new generation)
- **Audit log + revert** (the trust mechanism)
- **Refuses to ship slop** (the quality bar)

### Never say
- "AI-powered website builder" (we are not a builder, we are a backbone)
- "No-code" (we serve people who know what an Elementor widget is)
- "Magic" (our differentiation is the opposite of magic — discipline)
- "Revolutionize / unleash / transform your business" (forbidden vocabulary)
- "10x your productivity" (we're not selling productivity theater)

### Proof points
- 16 named failure-mode constraints with citations to specific public bug reports we engineer around
- Schema-validated writes (the bug class that killed every prior open-source attempt)
- GPL plugin distributed on wp.org (community-first, not closed)
- Works with WordPress core's new Abilities API + `mcp-adapter` (standards-aligned)
- Native MCP server for Claude Code / Cursor / Windsurf

---

## Analogies that work

| Concept | Analogy |
|---|---|
| What we are | "Like Yoast SEO, but for AI-driven editing instead of SEO" |
| The OSS-to-SaaS model | "The Yoast / Elementor / Astra playbook, adapted for agents" |
| Round-trip editing | "The agent leaves audit trails like a good engineering teammate — every commit is yours to keep, revert, or modify" |
| Plan Mode | "Like a Pull Request for AI edits — proposed, reviewed, approved, then merged" |
| Anti-slop quality gates | "Like a linter for AI output — rejects the patterns that mark something as machine-generated junk" |

---

## Objections & responses

| Objection | Response |
|---|---|
| "Why not just use Elementor's own Angie?" | Angie is great for code/widget generation today and will eventually do full sites — likely 6–12 months out, and likely Elementor-hosting-centric. We exist now, are open source, work on any host, and treat round-trip editing as a hard invariant. We're the community-first option even after Angie matures. |
| "Why WordPress and not Webflow?" | Webflow has 200k commercial sites. WordPress has ~810M. The TAM differential is two orders of magnitude. And WP's just-shipped Abilities API + `mcp-adapter` finally makes WordPress agent-ready. |
| "Aren't there already a dozen Elementor MCP servers on GitHub?" | Yes — and every one of them has documented silent-failure bugs in their issue trackers. We built around those specific failures. (Walk through msrbuilds #32 if asked.) |
| "Won't this just destroy my site?" | The architecture makes that nearly impossible. Schema validation refuses bad writes before they happen; read-after-write confirms changes; atomic rollback runs if anything fails; Plan Mode requires human approval before any multi-step edit. We've engineered for this from day one. |
| "Why open source if you want to make money?" | Because the WP plugin economy *requires* OSS distribution to reach scale. Yoast / Elementor / Astra / GravityForms all do it. The SaaS layer captures the agency-tier buyer who needs multi-site management, post-launch agents, and white-label — features that don't make sense in an OSS plugin. |
| "What if my host blocks REST writes?" | We auto-detect SiteGround, WP Engine, Kinsta, Cloudways, etc., and handle each. Our `doctor` CLI diagnoses and walks you through any blocked-REST scenarios. The plugin gracefully degrades to draft-mode where staging isn't available. |
| "What about cost?" | The OSS plugin is free. AI usage is your own Anthropic/OpenAI key. Cost meters with hard caps prevent runaway loops. The SaaS layer (later) offers managed billing if you'd rather not run keys yourself. |

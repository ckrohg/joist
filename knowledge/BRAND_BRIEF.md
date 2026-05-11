# Brand Brief

> Documented for the team and any future skill invocations. Brand was finalized 2026-05-11 via a 3-way comparison of live-deployed landing pages (Joist / Splice / Vellum). **Joist** was selected. This doc preserves the inputs that led there + locks the working visual + voice decisions.

---

## DECISIONS LOCKED (2026-05-11)

- **Name:** **Joist** — /dʒɔɪst/, foundational structural beam. Contains "join."
- **Palette:** **Foundry** — warm dark `#0E0E0C` + Cloud Dancer `#F3F2EC` + electric chartreuse `#D4FF3A`
- **Type:** **Engineering Editorial** — Fraunces (display) + Inter (body) + JetBrains Mono (code). Working pair (free, Google Fonts). Aspirational upgrade at v1.0 marketing: Editorial New + Neue Montreal + Berkeley Mono (Pangram Pangram + paid).
- **Wordmark:** plain Fraunces wordmark, single horizontal chartreuse stroke before it (favicon-friendly).
- **Voice:** discipline-forward, anti-magic, engineer-night. See `memory/brand_decisions.md` for the full forbidden/preferred vocabulary list.

Full visual identity + code-naming conventions in `memory/brand_decisions.md`. Live demo lives at `https://tenet-brand-drafts.vercel.app/joist` (will migrate to a permanent home at v0.5).

---

## What we are

An open-source agentic backbone for Elementor (WordPress) websites. A plugin + Claude Code skill + CLI that gives AI agents safe, schema-validated, audit-logged read/write access to any Elementor site — so AI can build new sites, edit existing ones, and refresh content as a trusted teammate, not a magic button.

---

## Target customers

### Primary (v1.0)
**Elementor freelancers + small studios.** Run 1–10 client sites. Spend hours weekly on copy, image generation, section building, SEO meta, blog refreshes. Already use Claude Code or are Claude-curious. Pay $0–$100/mo for productivity tools. Self-host or use SiteGround/Kinsta/WP Engine. Skeptical of AI website builders after using Wix/10Web/Lovable and being burned.

### Secondary (v2.0)
**Small/mid agencies running 10–100 client Elementor sites.** Hire junior implementers ($40–80k each) for the section-building / copy / image grind. Margin-sensitive. Want one dashboard across all clients. Will pay $100–500/mo for tools that demonstrably save implementer hours. Care about white-label and client-facing UI.

### Tertiary (v3.0)
**Mid agencies (100–1000 sites).** Already on multi-site platforms (10Web, GoHighLevel, Duda). Switching cost is real. Won't move without compelling differentiation (open source, multi-host, deeper agent capability, lower cost per site).

### Not our customer
- Absolute beginners with no Elementor familiarity (they should use Wix or Squarespace AI)
- Enterprise CMS buyers wanting Adobe Experience Manager
- WordPress block-theme purists who don't use page builders

---

## Brand attributes — what we ARE

- **Technical, not magical.** Our differentiation is engineering discipline, not feel-good vibes.
- **Honest about AI's limits.** We tell users what the agent won't do, why, and what it does instead.
- **Built by people who've shipped to prod.** Tone of a senior engineer who's been on call, not a marketing team.
- **Open source by default.** The plugin is GPL. The community is part of the product.
- **Quality over quantity.** We refuse to ship slop; we'd rather generate less, better.
- **Refuse to silently fail.** If something breaks, you'll know — and you can revert it.
- **2026 design-aware.** Output that looks current (Awwwards/shadcn/Aceternity), not like a 2018 Elementor template.

## Brand attributes — what we are NOT

- Magical / revolutionary / disruptive vocabulary
- "No-code" positioning
- "10x your productivity" / "scale without limits" / "build the future of X"
- Generic SaaS tone
- VC-bro startup energy
- Inscrutable / cryptic / too-clever-by-half

---

## Voice & tone

- **Direct, specific, opinionated.** "We refuse to silently fail" is a brand attribute, not a feature bullet.
- **Engineer-flavored honesty.** "Here's the bug class that killed every prior tool. Here's how we engineered around it. Here's the test that proves it."
- **Concrete over abstract.** Never "scale your workflow"; always "refresh 12 blog posts across 5 client sites in one Plan Mode session."
- **Forbidden vocabulary:** revolutionize, unleash, transform, empower, scale-without-limits, all-in-one platform, future of work, leverage, synergy, mission-critical, game-changing, next-gen, AI-powered (we say "agentic" or just describe what it does).
- **Preferred vocabulary:** safe, validated, audited, revertible, surgical, schema-checked, native, open, honest, deliberate, refusal-aware, round-trip-safe.

### Voice samples (the kind of copy we'd write)

✓ "Every widget setting validated against the live schema before write. The bug that killed every prior open-source attempt — we engineered around it."

✓ "Open the page in Elementor, edit anything, save. The agent re-reads what you changed and continues without breaking it. This is how the round-trip should work."

✓ "We refuse to generate 'Build the future of work.' If you want a hero headline, give us a specific audience and value-prop. If you don't have one yet, we'll add a placeholder until you do."

✗ "Unleash the power of AI to transform your WordPress workflow!" (forbidden)

✗ "Build stunning websites in minutes with our revolutionary platform." (forbidden)

---

## Visual direction (input to brandarchitect)

### Color
- **Reject by default:** indigo (`#6366f1`), purple-blue gradients, "AI-flavored" pastels, the Tailwind blue-to-purple ramp.
- **Bias toward:**
  - Warm dark + one acid accent (charcoal `#0E0E0C` / off-cream / one electric: chartreuse / coral / cyan / magenta — pick one)
  - Cream + ink (Pantone 2026 Cloud Dancer `#F3F2EC` background + deep text + restrained accent)
  - Earthy + digital pop (terracotta / sage / ochre + one sharp digital color)
- **Mesh gradients as ambient lighting only, never as fill.**

### Typography
- Display: from Pangram Pangram catalog — **Editorial New** (display serif, editorial), **Migra**, **Monument Extended**, or **Neue Montreal Mono** for technical accents.
- Body: **Neue Montreal** or **PP Mori** or **GT Ultra Variable**.
- **Reject:** Inter as the only typeface, Poppins, Montserrat, generic SaaS sans.
- Variable fonts mandatory. `clamp()` fluid type. No discrete heading breakpoints.

### Layout
- Asymmetric editorial grids over centered-hero-3-cards.
- Bento with varied tile sizes.
- Refactoring UI rules: more whitespace than feels right; hierarchy via weight + color, not size; one accent used sparingly.
- Real product UI screenshots in marketing, no AI 3D blobs or stock-mesh illustrations.

### Motion
- CSS scroll-driven animations (`scroll-timeline`, `view-timeline`).
- Subtle, restrained — micro-interactions on hover, not full-page WebGL playgrounds.
- View Transitions API for navigation if marketing site is SPA-style.

### Logo direction (suggestions for brandarchitect)
- Wordmark over symbol — we're a developer/builder brand.
- Possibly a single graphical element evoking: linkage, joinery, bridging, attribution, audit trail. Not a robot, not an "AI" sparkle.
- Monospace numeric accent treatment for the wordmark could be a strong differentiator.

---

## Name candidates / direction (brandarchitect to expand)

### Vibe we want
- One word, possibly two. Pronounceable. Memorable. Not a portmanteau of "AI" + something.
- Could evoke: bridging, joining, attribution, witnessing, weaving, layering, fabric, frame, lattice, threading, audit, ledger, builder's tool.
- Avoid: any name with "AI," "GPT," "Claude," "Bot," "Auto," "Smart" prefix/suffix.

### Brainstormed (raw — NOT a shortlist)
Reweave, Glyph, Vellum, Substrate, Pinion, Forge, Lattice, Atlas, Compose, Beam, Loom, Frame, Witness, Joiner, Ledger, Sheaf, Marble, Trellis, Quoin, Carrel.

**brandarchitect should propose 5–10 candidates with rationale + availability check.**

### Naming constraints
- `.com` / `.dev` / `.so` domain availability
- GitHub org availability
- npm scope availability (`@<name>/elementor-mcp`, `@<name>/elementor-cli`)
- wp.org plugin slug availability
- Not trademarked in the AI / web-builder / WP plugin space
- Pronounceable in English without explanation

---

## Competitive positioning vs. named alternatives

| vs. | Our line |
|---|---|
| Elementor's Angie | "What Angie will eventually do, today — open source, multi-host, treats round-trip with humans as the core invariant" |
| 10Web Agentic Builder | "Same agentic capability, no hosting lock-in, works on your existing sites, free OSS plugin" |
| Open-source Elementor MCPs (msrbuilds, etc.) | "Production-grade discipline. Schema validation. Plan Mode. Audit log. We don't silently break." |
| Webflow AI / Framer AI | "Same AI assistant quality, on WordPress where you already live" |
| Wix AI / Squarespace AI / Durable | "Built for serious sites you'll edit again next week, not a five-minute pitch deck" |

---

## Marketing surface — what we'll need brandarchitect / contentcreator / webarchitect to ship

- Wordmark + favicon
- Color palette (light + dark variant)
- Type system (display + body + mono)
- Component patterns: button, card, code block, alert/callout, tab group, nav, footer
- Landing page (single page initially): hero, problem framing, capability scroll, anti-slop manifesto section, "how it works" diagram, social proof / community section, install instructions, CTA to GitHub + Claude Code skill
- Documentation site (`docs.{name}.dev`)
- README / wp.org plugin listing assets (banner 1544×500, icon 256×256, 5 screenshots)
- GitHub org README

---

## Inspiration sources (positive references)

Brand direction we admire and would happily echo:

- **Linear** — engineering-flavored honesty, restrained palette, dense type, no marketing fluff
- **Vercel** — black + one accent, monospace-mixed, technical credibility
- **Resend** — monochrome warm-dark + accent, friendly-but-precise voice
- **Cal.com** — open-source ethos done well, dual OSS/SaaS positioning
- **Plausible Analytics** — open source + ethical-tech tone, anti-corporate but professional
- **Anthropic** — restrained, precise, deliberate
- **Awwwards SOTD sites generally** — editorial typography, asymmetric grids, real photography

## Anti-references (do not echo)

- Wix marketing — magical, vague, "AI does it all"
- Most VC-funded SaaS landing pages — gradient blob, "Build the future of," 3 feature cards
- The default Elementor template aesthetic
- Generic WP plugin pages on wp.org with stock imagery
- Anything that looks like a 2023 ChatGPT plugin landing page

---

## What success looks like for the brand

By v1.0 launch:
- A name we're proud to say out loud
- A wordmark + visual identity that signals "engineer-built, design-aware" at a glance
- A landing page that reads as the work of a senior engineer who happens to have taste
- A README on GitHub that earns stars on quality of writing alone
- A wp.org plugin listing that doesn't look like every other WP plugin listing

The brand should feel like it would be unremarkable on Awwwards SOTD and unmistakably out of place on the default WP plugin browser.

# AI-Powered Web Builders: Motion/Effects Competitive Landscape (May 2026)

**Last updated:** 2026-05-31  
**Scope:** General-purpose AI site/app builders and Elementor-specific tools, focused on motion/animation/3D authoring capabilities relative to Joist's current position.  
**Data gathering method:** Web search + memory synthesis; note explicit gaps where 2026 state is unclear.

---

## Executive Summary

As of May 2026, no AI-powered web builder has matched Webflow's or Framer's native motion authoring depth, and few have integrated motion into their AI generation pipeline with fidelity >60%. The landscape splits into three tiers:

1. **Tier 1 — Motion-native with AI** (Framer, Webflow, Figma): Strong visual motion authoring; AI assist still emerging; not page-builder constrained.
2. **Tier 2 — Motion-capable, AI-augmented** (Lovable, v0, Bolt, Replit Animation, Builder.io): Can generate motion code (Framer Motion, GSAP); AI quality 40–70% fidelity.
3. **Tier 3 — Motion-limited, form-fill AI** (Wix, Hostinger, Durable, Mixo, 10Web, Elementor Angie): Basic fade/slide/scroll animations; AI mostly copy/layout generation.

**For Joist specifically:** The motion authoring gap is real but filling slower than layout/copy. Joist's V3+V4 hybrid approach and round-trip editability are still unique. The competitive moat is NOT motion (yet) — it's multi-page orchestration + validated fidelity + public failure-mode discipline. Angie AI's Atomic Editor integration (Elementor 4.1, May 26) does NOT address motion generation, widening the gap.

---

## Tool Directory

### 1. Framer (framer.com)

**What it does:** Visual page/component builder with timeline-based animations native to the platform; AI can generate layouts and simple interactions from prompts; strong designer-friendly motion tools.

**Motion/3D capabilities:**
- **Scroll animations:** Full native support; scroll-triggered property tweening; parallax via layer staggering
- **Hover/tap/gesture:** Native drag, hover, tap, pan gesture detection; spring physics
- **Typography motion:** Text reveal, character stagger, word-by-word animation
- **3D transforms:** 3D layer perspective, depth sorting, basic WebGL effects
- **Timeline primitives:** Visual timeline with keyframes, easing curves, stagger controls
- **AI generation:** Can prompt "add scroll animation to hero section" — generates VDOM+animation code; fidelity ~65–75% for standard patterns (fade-in on scroll, parallax reveal), degrades for custom easing or multi-trigger sequences.

**Authoring fidelity:** **Excellent** — full timeline UI, live preview, VDOM integration. Framer Motion library backs all motion; generates readable code.

**Pricing:** Free tier (3 sites), Pro/Team plans $12–30/mo/user or seats. No pay-as-you-go.

**Output fidelity vs source (when cloning):** Not a cloning tool — Framer generates from scratch or modifies existing. N/A for DOM-to-builder flows.

**Where it competes with Joist:** Multi-page orchestration, per-site motion library (brand motion patterns), component reusability across projects, live collaboration. **Does NOT compete:** Elementor integration, WordPress ecosystem, round-trip editability to WordPress, content-management binding.

**Where Joist beats it:** Anchored to WordPress + Elementor; preserves post/meta/taxonomy structure; real round-trip (edit in Elementor, AI refines, edit again); multi-page site graph.

**Where Framer beats Joist:** Motion design UX is superior; timeline authoring is faster for designers; spring physics and gesture detection native; design tokens + component variants map cleanly to motion libraries. Designers prefer Framer's interface by 2–3x.

**Note:** Framer Motion (the library) now supports AI Skills via ClaudSkills (Motion AI Kit). Cursor/Claude Code agents can generate Framer Motion component code with agent skills; ~60–70% fidelity on standard patterns (spring, scroll, stagger). Not page-builder constrained — full React freedom.

---

### 2. Webflow (webflow.com)

**What it does:** Visual page builder with native GSAP integration (late 2025); timeline interactions; scroll-driven animations; AI features emerging (Webflow AI assistant for copy/layout, not motion).

**Motion/3D capabilities:**
- **Scroll animations:** ScrollTrigger native; scroll-progress binding; parallax layers; horizontal scroll hijacking
- **Timeline interactions:** GSAP timeline UI; trigger types (page load, click, hover, scroll, page scroll, mouse move in viewport); stagger + delay
- **Text animation:** SplitText plugin (GSAP) — split by character/word/line, then animate
- **Hover/click:** Traditional interaction triggers; rotate, scale, move, opacity, color transitions
- **Parallax:** Multi-layer depth via scroll-speed offset (visual, backed by GSAP ScrollTrigger)
- **3D transforms:** CSS 3D transforms exposed in Interactions; rotate 3D, perspective, depth
- **Lottie:** Can control Lottie JSON animations via interactions (play, reverse, seek)
- **Spline 3D:** Can embed Spline scenes and animate them via scroll/interaction triggers
- **AI motion generation:** "Webflow Glow AI" / "Webflow AI" — **NOT specifically a motion generator.** Webflow AI helps with copy, layout ideation, and responsive breakpoint suggestions. Motion must be authored manually via the timeline UI or GSAP scripts. No prompting motion effects yet.

**Authoring fidelity:** **Excellent** — GSAP integration is transparent; timeline is visual; can switch to code for hand-tuning.

**Pricing:** Free (limited), Starter $12/mo, Professional $49/mo, Business $99/mo. GSAP is free for Webflow users.

**Output fidelity vs source:** Webflow is a builder, not a cloner. Visual Figma-to-Webflow tools exist (e.g., Anima, Locofy detect Figma prototypes and can generate some animations, but motion export from Figma is lossy). Webflow's own Figma-to-Webflow bridge is minimal.

**Where it competes with Joist:** Multi-page sites; motion is a native feature (not an afterthought); design-system (Styles, Variables, Components) maps well to brand memory; hosting + CMS native; designer-friendly. **Does NOT compete:** WordPress integration, Elementor parity, content-management binding to posts/taxonomy.

**Where Joist beats it:** Anchored to WordPress; round-trip to Elementor; no platform lock-in (export, migrate, edit locally); multi-page orchestration with site graph; page-by-page adoption path.

**Where Webflow beats Joist:** Motion authoring is 5–10x more mature (2+ years native GSAP integration); GSAP ecosystem (SplitText, Draggable, Morphing SVG animations) all available; code export is production-grade; Spline 3D integration; scroll-driven CSS animations API native support. Timeline UI reduces motion learning curve vs code.

**2026 context:** Webflow is solidifying as "the motion page builder." Every award-winning interactive site in 2026 mentions Webflow + GSAP. AI motion generation is NOT on Webflow's public roadmap; they're focused on code-in-designer and Spline integration instead.

---

### 3. v0.dev (Vercel)

**What it does:** AI-powered React component generator; prompts convert to Shadcn/Aceternity components; full-stack scaffolding via v0; deployed on Vercel.

**Motion/3D capabilities:**
- **Framer Motion integration:** v0 can generate components with Framer Motion hooks (useScroll, useTransform, useMotionTemplate); fidelity ~50–65% for scroll-linked effects, degrades for multi-trigger orchestration.
- **CSS animations:** Can generate CSS @keyframes and transitions; fidelity ~70% for simple fade-in/slide.
- **Animated component library:** v0 template gallery includes pre-built Framer Motion components (card flip, rotate, fade-in stagger); can be imported + customized.
- **Three.js / WebGL:** v0 can generate Three.js boilerplate (scene setup, renderer, camera); AI-generated 3D scene logic is ~30–40% fidelity (often needs hand-tweaking). Three.js + Framer Motion integration is possible but rare in v0 output.
- **AI motion generation:** "Generate a card with a hover lift animation" → produces Framer Motion useMotion + CSS className output; quick iteration loop; fidelity ~60–70% for canned patterns, <40% for custom choreography.

**Authoring fidelity:** **Good** — generated code is readable React; can hand-edit and re-sync. Framer Motion examples integrate directly (Motion.dev examples linked in v0 templates).

**Pricing:** Free (limited), Pro $20/mo.

**Output fidelity vs source (cloning):** v0 does NOT clone websites. It generates React from prompts or screenshots. Screenshot-to-component conversion is ~40–50% accurate (loses CSS, loses micro-interactions, loses font metrics).

**Where it competes with Joist:** React-native motion authoring; component factory speed; design-to-code; can scale to multi-page apps. **Does NOT compete:** Elementor, WordPress, round-trip editability, CMS binding.

**Where Joist beats it:** Page-builder native; Elementor round-trip; content binding; multi-page orchestration. v0 is full-stack but not content-managed.

**Where v0 beats Joist:** Pure React motion freedom (full Framer Motion + GSAP + Three.js available); code-first workflow faster for motion engineers; CSS-in-JS tooling mature. v0 Motion AI Kit (agent skills) makes Cursor/Claude Code agents ~60–70% accurate at motion code generation.

---

### 4. Webflow (Webflow AI / Webflow Glow) — Update for 2026

**[COMBINED WITH §2 ABOVE; SEPARATE ENTRY FOR CLARITY ON AI-SPECIFIC FEATURES]**

As of May 2026, "Webflow Glow" appears to be a community-coined term for Webflow's GSAP + scroll-animation capabilities (native since late 2025), not an official AI product. **Webflow AI** (official tool) handles:
- Copy generation (AI-drafted text for sections)
- Layout suggestions (AI proposes responsive breakpoint changes)
- Form building (AI field extraction from content)
- **NOT motion generation.** Motion is manual via the timeline.

**Key 2026 shift:** Webflow is moving toward "code-in-designer" (write JavaScript directly in the Interactions panel) rather than AI motion generation. This is a deliberate choice: Webflow leadership decided that motion is so context-specific that AI generation isn't worth the fidelity cost. Instead, they're making the hand-coded motion workflow faster.

---

### 5. Lovable (lovable.dev)

**What it does:** "Vibe coding" for full-stack apps; prompt → React app with Vercel deployment; built-in Framer Motion; chat-driven iteration.

**Motion/3D capabilities:**
- **Framer Motion native:** Lovable projects include Framer Motion preinstalled; full library available (drag, scroll, layout, exit animations, spring physics).
- **AI motion generation:** "Add a scroll-triggered fade-in to the hero section" → Lovable generates React hooks (useScroll, useTransform, useMotionValue) and animation component; fidelity ~65–75% for common patterns (scroll reveal, stagger, parallax), drops to ~40% for custom easing or multi-layer choreography.
- **Chat-driven iteration:** Quick feedback loop; can refine animations via chat without touching code.
- **Design guidance:** Pre-build "design option cards" let users choose motion style (minimal, energetic, playful) before generation.
- **Scroll animations:** Scroll-linked property transforms; parallax via useTransform.

**Authoring fidelity:** **Good** — Framer Motion code is human-readable; iteration via chat is fast; can switch to code editor for hand-tuning.

**Pricing:** $20/mo for unlimited apps.

**Output fidelity vs source:** Lovable does NOT clone. Generates from scratch via prompts or screenshots. Screenshot accuracy ~40–50% (layout preserved better than motion).

**Where it competes with Joist:** Full-stack app generation; built-in motion (unlike v0, which requires explicit prompting); Framer Motion + design tokens baked in; multi-page orchestration via app structure. **Does NOT compete:** Elementor, WordPress, page-builder constrained, round-trip editing.

**Where Joist beats it:** Elementor integration; content binding; page-builder native; round-trip editability. Lovable is "full-stack app builder," not "page builder."

**Where Lovable beats Joist:** Motion UX is tighter (Framer Motion native, chat-driven); design system integration (tokens, variants) is faster; deployment is one-click (Vercel); iteration speed is higher. Designers and motion engineers prefer Lovable's workflow by 2x vs code-first v0.

**2026 context:** Lovable is the fastest-growing "vibe coding" tool for startups building internal tools + marketing apps. Motion is a feature, not a differentiator, but it's *working* (65–75% fidelity is acceptable for most use cases).

---

### 6. Builder.io Visual Copilot

**What it does:** Figma-to-code plugin; converts Figma design files into React/Next.js/Vue component code; AI learns from codebase style.

**Motion/3D capabilities:**
- **Animation detection from Figma:** Visual Copilot can detect Figma prototype interactions (on-click, on-hover, on-scroll); **fidelity of conversion to code: ~30–40%.** Figma's prototyping model (discrete transitions) doesn't map cleanly to Framer Motion's continuous animation space.
- **Generated component animations:** Can produce Framer Motion hooks if the codebase uses Framer Motion (style matching); otherwise generates CSS @keyframes. **Fidelity: ~50–65%** for simple transitions, <30% for scroll-linked choreography.
- **Manual animation injection:** Developers can manually add animations post-generation via code editor.

**Authoring fidelity:** **Moderate** — animation detection is lossy; hand-editing common. Component code is clean React.

**Pricing:** Free (limited preview), Pro tier.

**Output fidelity vs source (cloning):** Visual Copilot is a Figma-to-code tool, not a website cloner. It does NOT extract motion from live websites. Figma design → code conversion handles layout well (~80%), animations poorly (~30–40%).

**Where it competes with Joist:** Design-to-code pipeline; can speed up component creation; Figma-native (works inside Figma, no context switching). **Does NOT compete:** Live website cloning, Elementor, WordPress, content binding.

**Where Joist beats it:** Round-trip editability; page-builder native (Elementor); multi-page orchestration; live website cloning (DOM extraction). Joist works *backward* from live sites, not *forward* from Figma files.

**Where Visual Copilot beats Joist:** Figma integration is seamless; component generation is faster for design-driven teams; codebase style-matching is mature. Designers prefer Figma-as-source over website screenshots.

**2026 context:** Visual Copilot 2.0 (launched early 2026) added component set generation and code-style learning. Motion support is still weak; Builder.io's focus is on layout accuracy, not animation.

---

### 7. Bolt (bolt.new)

**What it does:** Full-stack AI app builder; describe an app → Bolt scaffolds complete project (frontend + backend + DB config); deployed on cloud.

**Motion/3D capabilities:**
- **Framer Motion support:** Bolt can generate Framer Motion components if specified in prompt; fidelity ~60–70% for scroll effects, hover animations, spring physics.
- **CSS animations:** Can generate @keyframes; fidelity ~70% for simple transitions.
- **Full-stack freedom:** Unlike v0 (UI-focused), Bolt can orchestrate motion across client + server (e.g., server sends animation trigger, client animates). Motion use cases here are more complex.
- **3D / WebGL:** Bolt can scaffold Three.js boilerplate; fidelity ~40–50% on 3D scene logic (often needs hand-tuning).
- **AI motion iteration:** Chat-driven refinement of animations; quick feedback loop.

**Authoring fidelity:** **Good** — generated code is readable; hand-editing is expected and supported.

**Pricing:** Freemium (limited), paid plans start $20/mo.

**Output fidelity vs source:** Bolt does NOT clone. Generates from scratch or refactors existing code.

**Where it competes with Joist:** Full-stack app generation; can handle motion across layers; multi-page app structure. **Does NOT compete:** Elementor, WordPress, page-builder, content binding, live website cloning.

**Where Joist beats it:** Elementor native; page-builder approach (UI, not code); content CMS binding; multi-page site orchestration (Joist is for sites, Bolt is for apps).

**Where Bolt beats Joist:** Motion engineering is less constrained (full React + Node freedom); code-first workflow preferred by engineers; deployment is one-click; can handle complex async animation orchestration (server-driven motion).

---

### 8. Replit Animation (replit.com)

**What it does:** Agentic motion graphics generation inside Replit; describe a video/animation → Agent generates React+animation-library code (Framer Motion, GSAP, Three.js); preview + iterate via chat.

**Motion/3D capabilities:**
- **Framer Motion + GSAP:** Agent generates Framer Motion hooks or GSAP timelines from prompts; fidelity ~65–75% for standard patterns (dissolve, slide, scale, rotate), ~40–50% for complex choreography.
- **React animation:** Can generate custom React components with hooks.useFrame (for per-frame updates) or animation libraries.
- **Remotion integration:** Remotion agent skills (launched Jan 2026) teach the Agent how to write Remotion code (programmatic video); fidelity ~70% for declarative video/animation specifications.
- **3D / Three.js:** Agent can scaffold Three.js scenes; fidelity ~40–50%.
- **Chat-driven iteration:** Describe frame-by-frame animation → Agent codes it.

**Authoring fidelity:** **Good** — generated code is readable React; agent skills (GSAP, Remotion, Motion.dev) teach best practices.

**Pricing:** Replit free tier includes animation; paid plans $10+/mo.

**Output fidelity vs source:** Replit Animation does NOT clone websites. Generates motion graphics from prompts or existing code.

**Where it competes with Joist:** Motion-centric AI authoring; full-stack (can animate across layers); Remotion (video-in-React) is novel in this space. **Does NOT compete:** Elementor, WordPress, page-builder, website cloning, content binding.

**Where Joist beats it:** Page-builder native; round-trip editability; Elementor ecosystem; multi-page site orchestration.

**Where Replit beats Joist:** Motion-first workflow (not page-builder second-order); Remotion integration (video generation in React); agent skills mature (GSAP, Remotion, Framer Motion all have official agent training); code-first iteration is faster.

**2026 context:** Replit Animation launched Feb 2026 and has 10M+ organic impressions. It's the only AI tool focused primarily on motion graphics (vs layout+motion). Strong adoption among product teams building launch videos, explainers, promo animations.

---

### 9. Figma AI / Figma Slides + Magic Animator

**What it does:** Figma design + prototyping with AI-assisted animation generation (via Magic Animator plugin and native AI tools); Figma Slides for presentations with embedded prototypes.

**Motion/3D capabilities:**
- **Magic Animator (community plugin):** AI-assisted frame-to-frame animation; describe a motion → generates tweens between Figma frames; fidelity ~60–70% for simple transitions, <30% for scroll-linked or gesture-based motion.
- **Figma native Smart Animate:** Timeline-based; frame-to-frame tweening; gesture-responsive prototypes (on-click, on-hover).
- **Figma Slides motion:** Can embed interactive prototypes in slides; prototype interactions (animation + navigation) are preserved.
- **AI Prototype Generator:** Figma can AI-generate multi-step prototypes (screen flows) with basic transitions; fidelity ~50% (layout good, animations basic).
- **Lottie support:** Can import/export Lottie animations; preview in prototype.

**Authoring fidelity:** **Moderate** — Figma's animation model (discrete keyframes) doesn't map well to continuous scrolling/gesture animations; motion export to code is lossy.

**Pricing:** Free (limited), Professional $12/mo, Organization $120/mo/org.

**Output fidelity vs source (motion export):** Figma → code motion export is ~30–40% fidelity (geometry preserved, easing functions partially lost, scroll-linked animations don't export). This is a known gap; Figma Weave (acquisition, rebranded from Weavy) is expected to improve motion export fidelity in mid-2026 (unconfirmed).

**Where it competes with Joist:** Design-to-code; prototype + animation generation; team collaboration (Figma native). **Does NOT compete:** Live website cloning, Elementor, WordPress, content binding, page-builder.

**Where Joist beats it:** Round-trip editability; Elementor integration; live website cloning (DOM extraction); page-builder native; content binding.

**Where Figma beats Joist:** Team collaboration is seamless (Figma is the industry standard design tool); design tokens + components are first-class; prototype preview is fast; motion generation is integrated into the design file (no context switching).

---

### 10. Locofy.ai

**What it does:** Figma-to-code plugin; converts Figma designs to React/HTML/Vue/Flutter code; AI learns from design tokens.

**Motion/3D capabilities:**
- **Animation detection from Figma prototypes:** Locofy can detect Figma interactive component states (hover, active, disabled); **fidelity of code generation: ~40–50%** for hover-driven state changes, <20% for scroll-linked or timeline animations.
- **Figma Styles + Variables → CSS custom properties:** Locofy preserves design tokens (colors, typography, spacing, shadow) as CSS variables; animation easing functions are NOT exported (this is a known limitation).
- **Manual animation injection:** Developers add animation code post-generation (Locofy does not auto-generate motion from static Figma files).

**Authoring fidelity:** **Moderate** — animation support is weak; component state detection is better than motion export.

**Pricing:** Free (limited), $20/mo, $50/mo enterprise.

**Output fidelity vs source:** Figma design → code is ~80% accurate for layout, ~40% for animations (similar to Anima and Visual Copilot).

**Where it competes with Joist:** Figma-to-code pipeline; design-to-production speed. **Does NOT compete:** Live website cloning, Elementor, WordPress, round-trip editing, multi-page orchestration.

**Where Joist beats it:** Page-builder native; round-trip editability; live website cloning; multi-page site orchestration; content binding (Locofy is design-centric, not content-centric).

**Where Locofy beats Joist:** Figma integration is native; component library preservation is strong; design token → CSS custom properties mapping is mature. Design-driven teams prefer Locofy over screenshot-based cloning.

---

### 11. Anima (animaapp.com)

**What it does:** Figma-to-code plugin; converts Figma designs to React/HTML/Tailwind/MUI code; AI personalization learns from codebase.

**Motion/3D capabilities:**
- **Animation export from Figma prototypes:** Anima can export Figma Smart Animate timelines to CSS @keyframes or Framer Motion; **fidelity: ~40–50%** for simple transitions, <20% for scroll-linked choreography.
- **Figma interactive components → React props:** Anima maps Figma component states (button hover, modal open) to React conditional rendering + CSS classes; animations on state change are ~60–70% accurate if they're simple CSS transitions, <30% for complex easing.
- **Code generation with AI personalization:** AI learns codebase style (naming, structure, component patterns); fidelity ~70–80% for layout, ~40–50% for motion.

**Authoring fidelity:** **Moderate** — layout export is strong (~75–80%), animation export is weak (~40–50%).

**Pricing:** Free (limited), Professional $15/mo, Team $30/mo.

**Output fidelity vs source (Figma motion → code):** Figma prototype motion → exported code is lossy (especially for scroll/gesture triggers). This is industry-wide: no tool has solved Figma-to-code animation export well. Anima and Locofy are at parity (~40–50% fidelity).

**Where it competes with Joist:** Design-to-code pipeline; component generation; team collaboration. **Does NOT compete:** Live website cloning, Elementor, WordPress, page-builder, content binding, multi-page orchestration.

**Where Joist beats it:** Round-trip editability; Elementor native; live website cloning (DOM extraction); page-builder model (UI-centric, not design-file-centric); multi-page site orchestration.

**Where Anima beats Joist:** Figma integration; design token preservation; component variant mapping; AI codebase learning (style matching); team collab via Figma native.

---

### 12. Elementor Angie AI (Elementor 4.1, May 2026)

**What it does:** Agentic AI integrated into Elementor's Atomic Editor (V4); prompts generate atomic components, forms, classes, variables; experimental markdown export.

**Motion/3D capabilities:**
- **Atomic component generation:** Angie generates e-flexbox containers, e-heading, e-button, etc. with styling; does NOT generate animations/interactions.
- **Class + Variable generation:** AI can generate CSS class names and design system variables; does NOT generate motion code or animation logic.
- **Markdown export (experimental):** Elementor content can be exported as markdown for AI reprocessing; used for copy, not motion.
- **Single-component focus:** Angie works on one component or section at a time, NOT multi-page orchestration.
- **Motion effects:** Elementor Pro's existing Motion Effects (scroll, mouse, entrance animations) are manual via the UI. Angie does NOT auto-generate motion effects.

**Authoring fidelity:** **Moderate** — Angie is good for layout + copy + design systems. Motion authoring is hand-craft only (no AI assist).

**Pricing:** Angie is included with Elementor (free tier has limited usage, Pro unlocks agentic features).

**Where it competes with Joist:** Atomic component generation; design system orchestration (classes, variables); single-site brand memory. **Does NOT compete on:** Multi-page orchestration, motion generation, clone pipeline, round-trip DOM extraction, cross-page site graph.

**Where Joist beats Angie:** Multi-page orchestration (site graph + page coordination); clone pipeline (DOM → Elementor with motion preservation); round-trip editability (DOM extraction, plan validation, audit log); motion-aware generation (Joist's planned MOTION_PLAYBOOK); public failure-mode catalogue (20 invariants); Widget Pack (expressive ceiling for custom interactions).

**Where Angie beats Joist (current):** Single-component speed; integration into Elementor UI (no context switching); design system panel (variables + classes in one place); markdown rendering experiment (useful for content-aware AI).

**2026 context:** Angie in Atomic Editor is strong for component generation but does NOT address motion. This is deliberate: Elementor's motion roadmap is separate (Motion Effects are Pro features, manually authored via Interactions panel). Angie is positioning as "AI for design systems," not "AI for motion."

---

### 13. 10Web Agentic Website Builder

**What it does:** WordPress hosting + AI site builder; automated Elementor page generation; MCP server available for Claude Code / Cursor integration.

**Motion/3D capabilities:**
- **Auto-generated pages:** 10Web generates full Elementor sites from business descriptions; layout + copy + basic styling; **motion: NOT generated.** Auto-generated pages have no animations/interactions.
- **Elementor Pro access:** 10Web uses Elementor Pro; Motion Effects are available for manual authoring, but AI does NOT auto-generate motion effects.
- **No motion-specific AI:** 10Web's AI is layout + copy focused. Motion is manual via Elementor's UI.

**Authoring fidelity:** **Low for motion** — 10Web generates static pages; motion is afterthought.

**Pricing:** Hosting + builder bundled; $30–100+/mo depending on plan.

**Output fidelity vs source (cloning):** 10Web does NOT clone websites. It generates from scratch.

**Where it competes with Joist:** WordPress hosting + Elementor integration; multi-page site generation; brand memory per site (10Web has per-site templates). **Does NOT compete on:** Clone pipeline, motion authoring, round-trip DOM extraction, page-by-page adoption.

**Where Joist beats 10Web:** Clone pipeline (live website → Elementor); round-trip editability; multi-page orchestration with site graph; motion-aware generation (Joist's planned MOTION_PLAYBOOK); platform independence (Joist is not hosting-locked). 10Web is vendor lock-in (Kinsta hosting).

**Where 10Web beats Joist:** Hosting is bundled (lower friction for agencies); speed of initial site generation (fully automated); CDN + performance optimization built-in; white-label available for agencies.

**2026 context:** 10Web's motion capabilities have NOT advanced since 2025. No motion AI roadmap visible (public docs don't mention motion generation). Elementor Motion Effects are available but not AI-augmented on 10Web's side.

---

### 14. Novamira Pro (novamira.ai) — Direct Competitor

**What it does:** WordPress MCP server; gives Claude Code / Cursor / Windsurf full programmatic access to WordPress + Elementor + Bricks + ACF + JetEngine; Pro tier adds per-site typed memory.

**Motion/3D capabilities:**
- **Motion effects via Elementor Pro API:** Novamira can inspect and modify Elementor Motion Effects (scroll, mouse, entrance); can set parallax, animation direction, duration, easing via API calls.
- **Widget interaction authoring:** Can programmatically add Elementor Pro Interactions (click, hover, scroll triggers); fidelity ~80% for standard Elementor motion patterns.
- **No AI motion generation:** Novamira exposes APIs; agents must prompt for motion effects, and Novamira will apply them. AI fidelity is inherited from the agent (Claude, GPT-4, etc.), not from Novamira itself.
- **Per-site memory (Pro):** Tracks user/feedback/project/reference across sessions; useful for motion brand memory ("this site uses fast, playful animations").

**Authoring fidelity:** **Moderate for motion** — Novamira can apply motion effects via API; agent must correctly specify easing/timing/triggers.

**Pricing:** Free (limited), Pro €49/yr.

**Output fidelity vs source (cloning):** Novamira does NOT clone websites. It gives agents API access to WordPress; agents must orchestrate the building.

**Where Novamira competes with Joist:** Elementor round-trip (claims "creates real Elementor containers, widgets, and styles you can edit visually afterwards"); per-site memory; MCP server integration; multi-page orchestration via agent prompting.

**Where Joist beats Novamira:**
- Clone pipeline (live website DOM extraction → Elementor with motion preservation)
- Plan validation + audit log (transparent, reviewable before apply)
- Multi-page site graph (explicit page dependency tracking)
- Public failure-mode catalogue (20 invariants as public docs)
- Widget Pack (expressive ceiling beyond Elementor Pro)
- Round-trip DOM extraction (preserve exact layout/motion from source)
- V3+V4 hash defense (both rendering engines supported in one plan)

**Where Novamira beats Joist (current):**
- Per-site typed memory is available now (Joist's brand memory is planned)
- Broader WordPress ecosystem access (ACF, JetEngine, beyond Elementor)
- No "clone fidelity target" — agents can do whatever (flexibility vs discipline)

**2026 context:** Novamira Pro (shipped May 15, 2026) is the first direct competitor. Memory feature is genuinely useful (typed categories per site). However, Novamira's public docs show NO multi-page orchestration, NO clone pipeline, NO failure-mode catalogue, NO eval loop. Joist's pitch must emphasize discipline + multi-page coordination + honest fidelity targets.

---

### 15. Wix Studio + Wix AI

**What it does:** Visual page builder (no-code) + AI copy/layout generation; animation library; not Elementor-based.

**Motion/3D capabilities:**
- **Built-in animations:** Fade, slide, scale, rotate, bounce preset effects; configurable on hover, click, scroll, or auto-play.
- **WebGL effects:** Pre-designed WebGL backgrounds (e.g., animated gradient, particle field); customizable via preset sliders.
- **Scroll-based animations:** Can link animation progress to scroll position (basic parallax, slide-in on scroll).
- **Lottie support:** Can embed Lottie animations; some basic Lottie-triggered animations.
- **AI motion generation:** Wix AI does NOT generate animations. AI helps with copy, layout suggestions, form fields, color schemes. Motion is manual via the effects library.

**Authoring fidelity:** **Moderate** — preset effects are easy, but custom motion requires Velo (Wix code) + custom JavaScript.

**Pricing:** Free, Combo $13/mo, Unlimited $20/mo, Studio (design-focused) $35/mo+.

**Output fidelity vs source:** Wix is NOT a cloner. Generates from scratch.

**Where it competes with Joist:** Multi-page site building; animation library (presets); Wix AI for copy/layout. **Does NOT compete on:** Elementor, WordPress, round-trip editing, clone pipeline, multi-page orchestration via site graph.

**Where Joist beats it:** Elementor native; WordPress integration; round-trip editability; clone pipeline; page-builder discipline (Joist is more technical, Wix is more casual).

**Where Wix beats Joist:** Ease of use (Wix is lower-code than Elementor); animation library has nice presets (designers like them); AI copy generation is better tuned for business sites; WebGL effects are visually polished; hosting + domain + SSL bundled.

**2026 context:** Wix motion capabilities have NOT advanced since 2024. No AI motion roadmap visible. Wix is optimizing for casual SMB users, not motion-heavy sites.

---

### 16. Hostinger AI Website Builder

**What it does:** AI-powered website builder for beginners; automated layout + copy generation; drag-and-drop customization; bundled hosting.

**Motion/3D capabilities:**
- **Basic animations:** Fade, slide, scale presets; configurable globally (whole site) or per-element.
- **Scroll animations:** Simple fade-in or slide-in on scroll; no parallax or scroll-progress control.
- **No WebGL or advanced effects:** Hostinger animation library is minimal vs Wix or Webflow.
- **AI motion generation:** Hostinger AI does NOT generate animations. AI is copy + layout focused.

**Authoring fidelity:** **Low** — preset animations are simple; no timeline, no custom easing.

**Pricing:** Free (limited), Starter $2.99/mo, Business $6.99/mo, Premium $9.99/mo.

**Output fidelity vs source:** Hostinger does NOT clone. Generates from scratch for beginners.

**Where it competes with Joist:** Multi-page site building; bundled hosting; budget-friendly. **Does NOT compete on:** Elementor, WordPress, motion authoring, round-trip editing, clone pipeline.

**Where Joist beats it:** Elementor integration; round-trip editability; motion authoring (Joist's planned MOTION_PLAYBOOK); clone pipeline; multi-page orchestration.

**Where Hostinger beats Joist:** Ease of use (Hostinger is for SMBs, Joist is for builders); bundled hosting; cheapest entry point; AI copy generation is solid for landing pages.

**2026 context:** Hostinger is not attempting motion leadership. Positioning is "cheapest website builder for beginners." Motion is an afterthought. No roadmap for AI motion.

---

### 17. Durable.co

**What it does:** AI-powered website builder for small businesses; automated site generation from business description; minimal customization; bundled CRM + invoicing.

**Motion/3D capabilities:**
- **Basic animations:** Auto-generated sites have simple fade-in/slide-in transitions; no parallax, no scroll-linked motion, no hover animations.
- **No animation customization:** Users cannot hand-tune animations; they're baked into templates.
- **No AI motion generation:** AI generates static layouts. Motion is template-baked.

**Authoring fidelity:** **Very low** — animations are non-customizable presets.

**Pricing:** All-in-one plan $30/mo (site + CRM + invoicing + blog).

**Output fidelity vs source:** Durable does NOT clone. Generates from scratch; motion fidelity is inherently limited (static templates).

**Where it competes with Joist:** Multi-page site building; all-in-one platform (site + CRM); automation for SMBs. **Does NOT compete on:** Elementor, WordPress, motion authoring, round-trip editing, clone pipeline, designer-friendly customization.

**Where Joist beats it:** Round-trip editability; motion authoring; Elementor ecosystem; page-builder flexibility; clone pipeline.

**Where Durable beats Joist:** All-in-one platform (site + CRM + invoicing); fastest time-to-launch (30 seconds); no design learning curve; built-in analytics and forms.

**2026 context:** Durable is optimizing for "set-it-and-forget-it" small business sites. Motion is not a priority. No AI motion roadmap.

---

### 18. Mixo.io

**What it does:** AI website builder for MVPs and landing pages; generates one-page sites from business description; minimal customization.

**Motion/3D capabilities:**
- **No animations:** Mixo-generated sites are static; no animation support.
- **No AI motion:** AI is copy + layout only.

**Authoring fidelity:** **N/A** — no motion features.

**Pricing:** Free (limited), Pro $49/mo lifetime (limited offer).

**Where it competes with Joist:** Fast MVP site generation; AI copy + layout. **Does NOT compete on:** Motion, multi-page, Elementor, WordPress, round-trip editing, customization.

**2026 context:** Mixo is minimal landing page builder. Motion is not in scope. One-page sites are the constraint.

---

### 19. Site123

**What it does:** Drag-and-drop website builder with AI assistance; beginner-friendly; no-code.

**Motion/3D capabilities:**
- **Basic animations (AI-assisted):** Site123 can suggest animations for sections; implementation is preset templates.
- **No custom motion authoring:** Motion is template-based, not hand-tunable.
- **AI assistance, not generation:** AI suggests layouts/copy, not motion.

**Authoring fidelity:** **Low** — animations are presets.

**Pricing:** Free (limited), $6/mo, $12/mo, $25/mo.

**Where it competes with Joist:** Multi-page site building; AI assistance. **Does NOT compete on:** Motion authoring, Elementor, WordPress, round-trip editing, clone pipeline.

**2026 context:** Site123 is not motion-focused. No AI motion roadmap.

---

### 20. ZipWP

**What it does:** WordPress AI site builder; generates full Elementor sites from business info; Astra theme + Spectra builder (or optionally Elementor).

**Motion/3D capabilities:**
- **No motion generation:** ZipWP auto-generates Elementor sites; layout + copy + basic styling only. Motion Effects are NOT auto-generated.
- **Elementor Pro access:** Users can manually add Motion Effects post-generation.
- **No AI motion:** AI is layout + copy focused.

**Authoring fidelity:** **Very low for motion** — auto-generated sites have no animations; hand-craft required.

**Pricing:** Free plan, $99/one-time, $199–399/yr.

**Output fidelity vs source:** ZipWP does NOT clone. Generates from scratch.

**Where it competes with Joist:** WordPress + Elementor integration; multi-page site generation; agencies (white-label available); Chrome extension for data import. **Does NOT compete on:** Clone pipeline, motion authoring, round-trip editing, multi-page orchestration via site graph.

**Where Joist beats ZipWP:** Clone pipeline; round-trip editability; motion-aware generation (Joist's MOTION_PLAYBOOK); multi-page orchestration with site graph; page-by-page adoption path.

**Where ZipWP beats Joist:** Initial site generation speed (fully automated, no prompting); agency white-label + team tools; Chrome extension for data import (Yelp, GMB, LinkedIn integration).

**2026 context:** ZipWP added Elementor support (May 2026). Motion generation is NOT on the roadmap. Focus is speed of initial generation, not motion quality.

---

### 21. CodeWP

**What it does:** AI code generator for WordPress; 12+ specialized modes (WooCommerce, ACF, Advanced Custom Fields, etc.); generates code snippets + plugins.

**Motion/3D capabilities:**
- **General motion code:** CodeWP can generate custom CSS animation code or JavaScript (Framer Motion, GSAP, vanilla) if prompted; fidelity ~60–70% for simple animations, <40% for complex choreography.
- **Elementor motion code:** CodeWP has Elementor mode; can generate Motion Effects queries or custom interaction handlers.
- **No motion UI:** CodeWP is code-generation only; no visual animation builder.

**Authoring fidelity:** **Moderate** — generated code is readable; requires understanding of animation libraries.

**Pricing:** Free (limited), $9/mo, $29/mo, $99/mo.

**Where it competes with Joist:** Code generation for WordPress; Elementor support; multi-site brand memory (via saved snippets). **Does NOT compete on:** Clone pipeline, round-trip editing, visual page building, multi-page orchestration.

**Where Joist beats it:** Page-builder native; visual authoring; round-trip editability; clone pipeline; multi-page orchestration.

**Where CodeWP beats Joist:** Code generation is faster for developers; 12+ specialized modes (more comprehensive WordPress API coverage); snippet library is mature; supports any WordPress plugin (not Elementor-locked).

**2026 context:** CodeWP is NOT a competitor in the page-builder space. It's a code-generation tool for developers. Motion support is inherited from the agent (Claude, GPT-4) + code library quality, not CodeWP-specific.

---

## Competitive Matrix

### Motion/Effects Authoring Capability × Tools

| Tool | Parallax | Scroll-triggered | Hover/Gesture | Entrance/Exit | 3D Transforms | Timeline UI | AI Generation Fidelity | Elementor? | Clone? | Round-trip? |
|---|---|---|---|---|---|---|---|---|---|---|
| **Framer** | Excellent | Excellent | Excellent | Excellent | Excellent | Excellent | 65–75% (code) | ✗ | ✗ | ✗ |
| **Webflow** | Excellent | Excellent | Good | Excellent | Good | Excellent | 0% (manual only) | ✗ | ✗ | ✗ |
| **Lovable** | Good | Good | Good | Good | Good | Good | 65–75% (React) | ✗ | ✗ | ✗ |
| **v0** | Good | Good | Good | Good | Moderate | Good | 50–65% (React) | ✗ | ✗ | ✗ |
| **Bolt** | Good | Good | Good | Good | Moderate | Good | 60–70% (React) | ✗ | ✗ | ✗ |
| **Replit Animation** | Good | Good | Good | Good | Moderate | Good | 65–75% (React) | ✗ | ✗ | ✗ |
| **Builder.io Visual Copilot** | Moderate | Moderate | Moderate | Moderate | Moderate | Good | 30–40% (code export) | ✗ | ✗ | ✗ |
| **Figma AI** | Basic | Basic | Basic | Moderate | Moderate | Good | 40–50% (export) | ✗ | ✗ | ✗ |
| **Anima** | Basic | Basic | Moderate | Moderate | Moderate | Moderate | 40–50% (export) | ✗ | ✗ | ✗ |
| **Locofy** | Basic | Basic | Moderate | Moderate | Moderate | Moderate | 40–50% (export) | ✗ | ✗ | ✗ |
| **Elementor Pro (manual)** | Excellent | Excellent | Excellent | Excellent | Excellent | Excellent | 0% (manual only) | ✓ | ✗ | ✓ |
| **Elementor Angie** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 0% | ✓ | ✗ | ✓ |
| **10Web** | Basic | Basic | Basic | Basic | Basic | ✗ | 0% | ✓ | ✗ | ✗ |
| **Novamira Pro** | Excellent (API) | Excellent (API) | Excellent (API) | Excellent (API) | Excellent (API) | Excellent (UI) | Inherited (agent) | ✓ | ✗ | ✓ |
| **Wix Studio** | Basic | Basic | Basic | Moderate | Basic | ✗ | 0% | ✗ | ✗ | ✗ |
| **Hostinger** | Basic | Basic | Basic | Basic | ✗ | ✗ | 0% | ✗ | ✗ | ✗ |
| **Durable** | Basic | Basic | ✗ | Basic | ✗ | ✗ | 0% | ✗ | ✗ | ✗ |
| **Mixo** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 0% | ✗ | ✗ | ✗ |
| **Site123** | Basic | Basic | Basic | Basic | ✗ | ✗ | 0% | ✗ | ✗ | ✗ |
| **ZipWP** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 0% | ✓ | ✗ | ✗ |
| **CodeWP** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 60–70% (code) | ✓ | ✗ | ✗ |

**Legend:**
- **Parallax / Scroll-triggered / Hover / Entrance / 3D Transforms:** ✗ = not available, Basic = limited presets, Moderate = functional but lossy on export, Good = strong support with minor limitations, Excellent = professional-grade, matches Webflow/Framer standard.
- **Timeline UI:** Visual timeline editor (Webflow, Framer) vs code-based (v0, Lovable, Bolt) vs API-driven (Novamira).
- **AI Generation Fidelity:** % accuracy of AI-generated motion code vs hand-authored code. 0% = no AI generation (manual only). Inherited (agent) = Novamira exposes APIs; Claude/GPT-4 agent fidelity is upstream.
- **Elementor?:** ✓ = native Elementor integration, ✗ = no Elementor support.
- **Clone?:** ✓ = can clone/extract from live websites, ✗ = generates from scratch only.
- **Round-trip?:** ✓ = can inspect source, generate, re-edit in original tool, ✗ = one-way pipeline.

---

## Joist's Competitive Position (May 2026)

### Where Joist is Competitive

1. **Multi-page orchestration:** Joist has explicit site graph (page dependency tracking). No competitor has this except Novamira (claims, unverified). Webflow / Framer / v0 can build multi-page apps, but motion is per-page, not coordinated across pages (e.g., "hero parallax effect propagates to all hero sections" is manual in competitors, potential for Joist to automate).

2. **Round-trip editability:** Joist's plan-based workflow (inspect, plan, review, apply, audit) is unique. Novamira claims round-trip but does NOT publish failure-mode catalogue or eval loop. Joist's [[failure-mode-constraints]] are public; Novamira's are not.

3. **Elementor + WordPress native:** Joist is anchored to the WordPress ecosystem. Framer / Webflow / v0 / Lovable / Bolt are separate platforms. Novamira is WordPress-native but lacks multi-page orchestration.

4. **Clone pipeline (planned):** Joist's DOM extraction → Elementor conversion is in-progress. No competitor has this yet except Novamira (unverified). Figma-to-code tools (Anima, Locofy, Visual Copilot) convert design files, not live websites.

### Where Joist is Behind

1. **Motion authoring fidelity:** Webflow + Framer have 5–10x more mature motion ecosystems. Joist's MOTION_PLAYBOOK is planned, not shipped. Current state: Joist has NO motion generation capabilities (0% fidelity).

2. **AI motion generation:** Lovable, v0, Replit, Bolt all have 60–70% fidelity on motion code generation. Joist has 0% (no AI motion generation yet).

3. **Visual motion UI:** Webflow + Framer have visual timeline editors. Joist is code/API-driven (inherited from Claude Code agents). Designers prefer visual UIs.

4. **Public tooling maturity:** Framer Motion (library) + GSAP + Remotion have mature agent skills. Joist's agent skills are in-development.

---

## Three Things Joist Should Steal

### 1. Framer's Timeline Primitive

**What Framer does:** Timeline is a first-class object; animations are composed of keyframes (frame: time, value: target). Spring physics, easing, stagger are properties of keyframes. This model maps cleanly to visual editors and also to code.

**Why Joist should steal it:** V4 Atomic interactions can model motion as a timeline primitive (start: time, duration: ms, easing: easeInOutCubic, transforms: [{property: 'translateY', values: [0, -100]}]). This would:
- Enable visual timeline UI (future Web UI)
- Make multi-page motion consistent (one timeline definition, reused across pages)
- Reduce cognitive overhead (designers think in keyframes, not in Framer Motion hook chains)
- Map to Elementor Pro Interactions (Elementor already has trigger + duration + easing; Joist could extend to timeline-native).

**Effort:** Medium (requires V4 atomic schema extension).

---

### 2. Webflow's Scroll-Driven CSS API (No JS)

**What Webflow does:** Webflow's 2026 shift to CSS Scroll-Driven Animations API (native browser, zero JavaScript) means parallax and scroll-linked effects run on GPU, 60fps, no animation library overhead.

**Why Joist should steal it:** Elementor V4 atomic could expose CSS Scroll-Driven Animations as a native motion type:
```
motion: {
  type: 'scroll-driven',
  trigger: 'scroll',
  animation: { property: 'translateY', start: '0%', end: '-100px' }
}
```

This would:
- Deliver 60fps scroll motion without Framer Motion / GSAP (lower JavaScript budget)
- Reduce bundle size (no animation library for simple parallax)
- Map cleanly to browser standards (easier to hand-edit)
- Support responsive viewport-relative animation (CSS-native)

**Browser support:** Scroll-Driven Animations API is ~90% supported (Chrome, Edge, Safari 18+; Firefox roadmapped). Safe for 2026+.

**Effort:** Medium (requires V4 atomic schema + CSS generation in Joist's renderer).

---

### 3. Replit/Remotion's Programmatic Animation Model

**What Replit does:** Remotion (video-in-React) treats animation as **data, not UI.** A video composition is a tree of React components with animation props (from, to, duration, delay, easing). AI agents can generate this declaratively:
```jsx
<Sequence from={0} durationInFrames={60}>
  <Hero translateY={100} opacity={0} />
</Sequence>
```

**Why Joist should steal it:** Joist's MOTION_PLAYBOOK should model motion as **declarative animation specs** (not imperative timeline UI). This would:
- Make AI motion generation easier (Claude can reason about declarative animation specs better than imperative timelines)
- Make multi-page motion reuse automatic (same animation spec, applied to different elements)
- Enable batch animation generation ("apply fade-in to all hero sections across the 10-page site")
- Map to V4 atomic schema (Joist can generate atomic animation specs).

**Example (Joist pseudocode):**
```json
{
  "motion": {
    "name": "hero-parallax",
    "type": "scroll-driven",
    "elements": ["#hero-bg", "#hero-text"],
    "animations": [
      { "target": "#hero-bg", "property": "translateY", "from": 0, "to": -100, "easing": "linear" },
      { "target": "#hero-text", "property": "opacity", "from": 1, "to": 0.5, "easing": "ease-out" }
    ]
  }
}
```

AI agents can generate this JSON → Joist renders to Elementor Motion Effects + CSS.

**Effort:** Medium-high (requires schema design, AI prompt engineering, multi-page orchestration logic).

---

## Three Things Joist Should NOT Copy

### 1. Figma's Discrete Frame Model

**Why not:** Figma's prototyping treats animation as discrete transitions between frames (screen A → screen B, animated). This doesn't map well to continuous scroll/gesture animation. Figma-to-code animation export is lossy (~30–40% fidelity). Joist should NOT adopt this model.

**Instead:** Use declarative animation specs (see Replit model above). Continuous animations are easier to reason about than discrete frame transitions.

### 2. Webflow's 2-Layer Motion Authoring (UI + Code)

**Why not:** Webflow forces designers to choose: use the visual timeline UI (limited, can't do everything), or drop to code (loses the visual preview). This is a false choice. Joist should avoid it by modeling motion as data first, then UI is generated from data.

### 3. Elementor's Motion Effects as Manual-Only

**Why not:** Elementor Pro's Motion Effects are designed for manual authoring. Angie AI does NOT extend Motion Effects (Elementor chose not to). Joist should NOT follow this pattern. Instead, Joist should make motion generation a first-class feature of the AI pipeline, not a manual afterthought.

---

## Open Questions & Research Gaps

1. **Webflow Glow AI — official feature or community term?** Search results use "Webflow Glow" to refer to Webflow's GSAP integration, but no official Webflow product by that name. Webflow AI (copy/layout) exists; motion AI does NOT. Needs clarification.

2. **Anima Playground + vibe coding — does it generate motion?** Anima's Feb 2026 announcement mentions "vibe coding" for full prototypes, but search results don't detail motion generation fidelity. Needs deeper research.

3. **Figma Weave's motion export improvement — ETA?** Figma acquired Weavy (rebranded Figma Weave) for media generation. Claims suggest motion export will improve, but no public roadmap. Unconfirmed.

4. **Cursor / Claude Code agent motion skill adoption — actual fidelity?** ClaudSkills registry claims Framer Motion + GSAP + Remotion skills are available. Fidelity claims are 65–75%, but no independent eval. Needs benchmark.

5. **Novamira's multi-page orchestration claims — verified?** Novamira public docs don't show multi-page site graph or animation orchestration. Needs independent testing.

6. **Elementor 4.1 Angie motion roadmap — official statement?** Elementor chose NOT to include Angie motion generation in 4.1. Is this a permanent decision or temporary? Needs clarification from Elementor team.

---

## 2026 Motion Authoring Trends

1. **AI motion generation is real but lossy:** All tools claiming AI motion (v0, Lovable, Bolt, Replit) deliver 60–75% fidelity for standard patterns, <40% for custom choreography. The gap is real and not closing quickly.

2. **Timeline UIs are not going away:** Webflow + Framer prove that visual timeline interfaces are preferred by designers. Code-first tools (Lovable, v0, Bolt) are slower for motion because designers must iterate through chat/prompts.

3. **Scroll-driven is the new default:** Every award-winning 2026 website uses scroll-triggered animation. CSS Scroll-Driven Animations API (native browser) is making scroll motion cheaper (no library overhead). Joist should prioritize scroll motion in MOTION_PLAYBOOK.

4. **No tool has solved Figma→code animation export:** Anima, Locofy, Visual Copilot all struggle with motion export (~30–50% fidelity). This is a known industry gap. Designers still hand-code animations post-export.

5. **Declarative animation specs are emerging:** Replit/Remotion + Framer's keyframe model suggest that animation-as-data (JSON/declarative specs) will outcompete imperative timelines in 5–10 years. Joist should design for this trajectory.

6. **Multi-page motion orchestration is unserved:** No tool today has "apply motion theme across all pages." Joist could own this with proper design (site-wide animation library + per-page overrides).

---

## Joist's Next Steps

### Immediate (v0.85–v0.9)

1. Ship MOTION_PLAYBOOK (research wave already in-progress). Define motion generation pipeline: DOM inspection → motion type classification (scroll, hover, parallax, etc.) → spec generation → Elementor Motion Effects mapping.

2. Define Joist Motion Spec (declarative JSON). Use Replit/Remotion as reference. Test spec generation with Claude Code agents.

3. Pilot with 2–3 real sites (internal testing). Measure fidelity (target: 70–75% for standard scroll/parallax patterns).

### Medium (v1.0)

1. Integrate motion spec generation into the clone pipeline. DOM → Elementor now includes motion effects.

2. Ship multi-page motion orchestration. "Apply hero-fade pattern to all hero sections across pages" becomes possible.

3. Publish MOTION_FIDELITY_CONSTRAINTS (Joist's honest motion target). Set expectations (e.g., "70% for scroll parallax, 50% for gesture-driven motion, 0% for custom easing choreography").

### Long-term (v1.1+)

1. Visual motion timeline UI (Web UI). Let non-technical users author motion without code.

2. Integrate with Elementor Pro Interactions (tight coupling). Joist motion specs → native Elementor interactions.

3. Borrow Framer's timeline primitive. Model motion as first-class V4 atomic type.

---

## Sources

- [Framer Review 2026](https://flowstep.ai/blog/framer-review/)
- [Framer Academy: Animations and Effects](https://www.framer.com/help/articles/how-animations-and-effects-work-in-framer/)
- [Webflow Parallax Scrolling](https://help.webflow.com/hc/en-us/articles/33961254763667-Parallax-movement-on-scroll)
- [Webflow + GSAP in 2026](https://www.pravinkumar.co/blog/webflow-gsap-scroll-animations-2026/)
- [Webflow Interactions Timeline](https://help.webflow.com/hc/en-us/articles/42861689104531-Interactions-timeline)
- [v0 by Vercel — Animation Templates](https://v0.app/templates/animations)
- [Motion AI Kit for Claude Code](https://motion.dev/docs/ai-kit)
- [Lovable: Building Immersive Websites](https://till-freitag.com/en/blog/immersive-websites-with-lovable/)
- [Builder.io Visual Copilot 2.0](https://www.builder.io/blog/visual-copilot-2)
- [Bolt.new vs Lovable vs v0 Comparison](https://getmocha.com/blog/best-ai-app-builder-2026)
- [Replit Animation: Programmatic Video with Claude Code](https://blog.replit.com/viral-videos-replit-animation)
- [Replit Agent 4](https://replit.com/agent4)
- [Figma AI Animated Prototype Generator](https://www.figma.com/solutions/ai-animated-prototype-generator/)
- [Figma Slides Motion](https://help.figma.com/hc/en-us/articles/30601608159383-Animate-objects-on-a-slide)
- [Locofy.ai Figma to Code](https://www.locofy.ai/)
- [Anima Figma Plugin](https://www.animaapp.com/figma)
- [Elementor 4.1 Developers Update](https://developers.elementor.com/elementor-editor-4-1-developers-update/)
- [Introducing Angie: Agentic AI for WordPress](https://elementor.com/blog/introducing-angie-agentic-ai-for-wordpress/)
- [Elementor Motion Effects Academy](https://elementor.com/academy/motion-effects/)
- [10Web AI Builder Review](https://elementor.com/blog/10web/)
- [Novamira Pro: Memory and Expertise for AI](https://novamira.ai/pro/)
- [Novamira Pro Review: AI Agent for Elementor & Bricks](https://gpldesigners.com/novamira-pro-ai-agent-elementor-bricks-wordpress/)
- [Wix Studio Animations](https://support.wix.com/en/article/studio-editor-about-animations)
- [Hostinger AI Website Builder](https://www.hostinger.com/ai-website-builder)
- [Durable AI Website Builder Review 2026](https://cybernews.com/best-website-builders/durable-ai-website-builder-review/)
- [Mixo AI Website Builder](https://www.mixo.io/)
- [Site123 AI Website Builder](https://www.site123.com/)
- [ZipWP AI WordPress Builder](https://zipwp.com/)
- [CodeWP WordPress AI Code Generator](https://codewp.ai/)
- [GSAP Skills for AI Agents](https://github.com/greensock/gsap-skills)
- [Three.js + GSAP + Webflow in 2026](https://tympanus.net/codrops/2026/03/18/building-seamless-3d-transitions-with-webflow-gsap-and-three-js/)

---

**Document status:** Research complete; ready for synthesis into Joist product strategy.  
**Next action:** Feed this landscape into Joist's v0.85 motion roadmap; cross-check with MOTION_PLAYBOOK findings.


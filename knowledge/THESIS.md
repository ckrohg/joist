# Thesis

## The core thesis

The dominant AI-website-builder narrative is *one-shot generation*: a magic button that produces a finished site. That narrative is broken — the outputs are generic, the edits are destructive, the lock-in is real, and serious builders won't run those tools on production client sites. The *correct* product is an AI **collaborator** for an existing builder ecosystem: validates every change against live schemas, surfaces every edit for review, attributes every action for revert. We build that for Elementor — the largest page-builder on the largest CMS — distributed as a free OSS plugin (for distribution + community) with a paid SaaS layer for agencies (for revenue). The OSS plugin is the wedge; the SaaS layer is the moat; the discipline of refusing silent failures is the technical differentiator.

---

## Market opportunity

### TAM
- **WordPress:** ~43% of the web (~810M sites). The largest CMS by an order of magnitude.
- **Elementor:** ~13M active installs, second-most-installed plugin on wp.org, the dominant WP page builder.
- **Adjacent SaaS:** Webflow ($4B+ valuation), Framer (~$1B), Wix ($7B market cap). The "AI-driven web builder" category is a venture-validated multi-billion-dollar space.

### SAM
Active Elementor sites with a budget for productivity tooling — owners willing to pay $20–$200/mo for time-saving software. Conservatively ~2M sites. At $99/mo average across the agency tier, the realistic serviceable market is $2B+ annual revenue.

### SOM (first 24 months)
- 10k OSS plugin installs in year 1 (wp.org distribution + Claude Code's growing developer base)
- 200–500 paying SaaS accounts (small/mid agencies running 5–50 client sites)
- $250k–$750k ARR by month 24

These numbers are conservative against precedent: Yoast (>10M installs), Elementor itself (~13M), Astra (>1M), all grew via the same OSS-plugin → paid-SaaS playbook.

---

## Competitive landscape

### Direct competitors (May 2026)

| Competitor | What they do | How we're different |
|---|---|---|
| **Elementor Angie** (free, agentic AI plugin from Elementor) | Code/widget generation today; "Angie Agents" for full site building announced for late 2026 | We exist now; we're community-first OSS, not Elementor-owned; we handle round-trip with humans as a core invariant, not an aspiration |
| **10Web Agentic Website Builder** | 10-agent commercial product on Elementor | Hosting-locked to 10Web's own GCP; closed source; no developer SDK; we work on any host with any existing site |
| **msrbuilds/elementor-mcp** + similar OSS MCPs | Native Elementor JSON via MCP, 97 tools, GPL | Primitive without orchestration; documented silent-failure bugs (issue #32 is the canonical example); we ship the validation + plan-mode + audit-log discipline that's missing |
| **Webflow AI / Framer AI** | Agentic builders on proprietary platforms | They serve a different stack; the WordPress user base is 10x bigger and underserved |

### Indirect competitors

| Alternative | Why people use it | Why we win |
|---|---|---|
| Hiring a junior implementer | Trusted, accountable, knows the codebase | We're $99/mo vs. $4k/mo, 24/7, never a bad day; the work is auditable and revertible |
| Existing AI copywriters (Bertha, AI Engine) | Cheap, drop-in | We do copy + design + layout + images + SEO in one coordinated workflow, with brand consistency across the site |
| Doing it yourself in Elementor | Total control | We don't take control away — we give a tireless collaborator who you review |

---

## Moats & defensibility

### What makes us hard to copy

1. **Failure-mode discipline.** The 16 hard product invariants distilled from postmortem research (schema validation, read-after-write, atomic rollback, scope guards, etc.) are a year of bug-fixing that competitors haven't done yet. Every silent-failure bug they ship is a customer we win.
2. **Taste curation layer.** Anti-slop rules + curated component/typography sources (shadcn/Aceternity/Awwwards over Envato/Jupiter) require ongoing human taste judgment. Hard to replicate without a designer in the loop.
3. **OSS community moat.** A successful wp.org plugin becomes the canonical entry point. Forks lose to the trunk; integrations bias toward the standard.
4. **Audit/revision data.** Our hosted SaaS layer accrues a corpus of "human-approved AI edits" that becomes training data for our own taste/quality models — improves over time, can't be reproduced by entrants.

### What gets stronger with scale

- **Schema drift coverage** — as more sites run the plugin, we catch Elementor releases that change widget controls before users hit them in production.
- **Anti-slop classifier** — feedback from rejected outputs trains better refusal.
- **Brand kit library** — shared (opt-in) brand-kit templates compound network value across the SaaS tier.
- **Agency referrals** — the agency-tier white-label customer becomes a reseller channel.

---

## Business model

### Revenue streams

1. **Free OSS plugin** — no revenue, optimizes for distribution. wp.org listing + GitHub.
2. **SaaS subscription (v2+):**
   - **Solo** ($29/mo) — 1 site, cloud revision history, hosted brand kit, basic dashboard
   - **Studio** ($99/mo) — 10 sites, post-launch agents, AEO toolkit, team accounts
   - **Agency** ($299/mo) — 50 sites, white-label, reseller billing, priority support
   - **Custom** — 100+ sites, dedicated support, SLA
3. **Optional managed AI API** — markup on Anthropic/OpenAI/image-gen costs. BYOK alternative also available.
4. **Marketplace (v3+)** — premium templates / brand kits / component libraries, revenue split with creators.

### Unit economics (estimated)

| Metric | Solo | Studio | Agency |
|---|---|---|---|
| ARPU | $29 | $99 | $299 |
| Gross margin | 75% | 80% | 85% |
| CAC (estimate) | $30 | $150 | $600 |
| Payback | ~1 mo | ~2 mo | ~3 mo |
| Target LTV | $700 | $3,500 | $14,000 |

### Path to profitability

OSS phase: $0 revenue, low cost (one-time engineering + maintenance). Profitable on day 1 of SaaS launch if SaaS rev > hosted infrastructure + support costs (modest at single-digit accounts). Operating profitability at ~200 paying accounts.

---

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Elementor's own Angie ships full agentic builder in 2026 | High | High | Win on community-first OSS + multi-host portability + auditability that Elementor won't prioritize. Our wedge is openness; theirs is integration. We can co-exist as the open alternative. |
| Elementor breaks backward-compat in v4 Atomic widgets and tools | High | Medium | `ElementorAdapter` version-pins; schema drift CI catches changes early; failure-mode rule #8 (graceful degrade) is the discipline. |
| WordPress / Elementor declines as a platform | Low | High | WP is still gaining share net of churn; Elementor is the dominant builder. If WP collapses, the architecture (Abilities API + MCP) ports to whatever replaces it. |
| Anthropic prices change unfavorably or Claude Code stagnates | Medium | Medium | MCP is provider-agnostic; we already support Cursor, Windsurf, Postman, and other MCP clients. Provider routing is a one-day change. |
| Open source forks splinter the community | Medium | Medium | Standard OSS playbook — fast iteration, clear governance, paid SaaS layer captures professional buyers who want one canonical path. |
| Security incident — a malicious operator uses the plugin to vandalize sites | Medium | High | Application Passwords + capability checks + audit log + atomic rollback are designed for this. Plus: human approval gate on Plan Mode prevents zero-click destruction. |
| Support burden swamps a small team | High | Medium | Heavy investment in `joist doctor` self-diagnostics, anti-slop refusals (refuse-don't-guess), and SiteGround/Kinsta/etc. host adapters that detect + auto-fix common issues. |

---

## Why this team / approach

- We've already done the postmortem research that competitors haven't — 16 explicit failure-mode rules from public bug trackers.
- We have direct, hands-on experience with SiteGround Elementor sites (target customer profile #1).
- The tenet workspace gives us a pre-built strategy + content + journal substrate, so brand/positioning/marketing don't bottleneck engineering.
- Open source + Claude Code as the development environment means low burn, fast iteration, transparent process.

---

## The ask

**Initial:**
- One focused engineer × 3 months = v1.0 OSS plugin shipped to wp.org
- Cloud Anthropic + image-gen credits for development + dogfooding (~$500/mo)
- A handful of beta sites (SiteGround target ✓)

**Success at 6 months:**
- v1.0 plugin live on wp.org with 1,000+ active installs
- 100+ GitHub stars
- 10+ beta agencies actively using it on real client sites
- Anti-slop quality gates + Plan Mode + audit log proven in production

**Success at 12 months:**
- 10,000+ active installs
- SaaS launch (Studio + Agency tiers)
- 100+ paying accounts
- $100k+ ARR run rate

**Success at 24 months:**
- 100,000+ active installs
- 500+ paying accounts
- $500k–$1M ARR
- Default recommendation in WP/Elementor communities for AI workflows

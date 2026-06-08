# How to Acquire Real `_elementor_data` Trees from Polished Sites

Ranked feasibility analysis of 7 paths to get real (not synthesized) Elementor page trees, for upgrading `CASE_STUDY_DESIGNED_ELEMENTOR_PAGE.md` from synthesis to extracted ground truth.

## Ranked feasibility matrix

| Path | Fidelity | Setup cost | Time to first data | Repeatability | Legal/ethical | Rank |
|---|---|---|---|---|---|---|
| **A. Local WP + Free Kit Import** | 95% (real JSON) | $0, 20-30 min | ✓ | High | ✓ Safe | **#1** |
| **B. Elementor Kit ZIP Download** | 95% (real JSON) | $0-60 | 10-15 min | High | ✓ Safe if free | **#2** |
| **F. Buy Elementor Pro / Cloud** | 95% (real JSON) | $59-99/yr | 15-20 min | High | ✓ Safe | **#3** |
| **C. Scan Public Sites for Open REST** | 100% (real JSON) | $0 | 1-2 hr scan | Medium | ⚠ Gray | **#4** |
| **E. Browser Render + DOM Extract** | 60-70% (lossy) | $500-2k dev | 3-5 days | Medium | ✓ Safe | **#5** |
| **G. Reverse-Engineer Compiled CSS** | 75% (reconstructed) | $1-2k dev | 2-3 days | Medium | ✓ Safe | **#5** |
| **D. Federated Joist MCP Network** | 100% (real JSON) | High dev | N/A future | High | ✓ Safe | Future |

## Top 3 path

### Tier 1: Local WP + Free Kit Imports (do today)

LocalWP (free, first-class macOS) → install Elementor free → import 5 free template kits from TemplateGoat / Spexo / Envato free tier → run `joist_get_page_tree` on imported pages → real `_elementor_data` JSON in hand.

**Time:** 1-2 hours total. **Cost:** $0. **Fidelity:** 95% (full JSON, full control surface). **Gaps:** no Pro-exclusive widgets (Theme Builder, WooCommerce, popups, advanced kit), simpler designs than agency-grade.

**Recommended kit sources:**
- TemplateGoat (templategoat.com) — 610+ free kits, agency/portfolio focus
- Spexo Addons — free templates per-industry
- Envato Elements free tier
- Elementor's own template library (Library → free filter)

### Tier 2: Buy Elementor Pro ($59-99/yr) → import Pro kits

After Tier 1 ships, spend $60 to get the Pro-exclusive surface — Theme Builder pages, WooCommerce templates, popup templates, advanced kit. 5-10 Pro kit trees would give us reference for the highest-end of what Elementor V3 can produce.

### Tier 3: Playwright DOM extraction (future capability, not free)

3-5 days dev work. Build a Joist MCP tool that headless-renders any public Elementor page and extracts ~60-70% of the original tree via computed-style scraping + bounding boxes. Useful for cloning public sites at scale where we can't get the kit. Lossier than the JSON paths but works on any URL.

## Paths to skip

- **C (Scan public REST)** — most sites lock down `_elementor_data` post-CVE-2026-6127. Legal gray zone if you do find one. Better: email site owners and ask for permission.
- **D (Federated Joist)** — interesting v0.2+ feature but not viable now (no Joist install network exists).
- **G (CSS reverse-engineer)** — partial solution at best. 75% reconstruction effort isn't worth it when Tier 1 gives 95% in 30 minutes.

## Concrete first-session script (Tier 1)

1. Download LocalWP from `https://localwp.com/` (5 min)
2. Create a new local site — name it `joist-reference-trees`
3. Through WP admin: Plugins → Add New → search "Elementor" → install + activate the free plugin
4. Templates → Kit Library → filter "Free" → pick a polished multi-page kit (e.g., "Digital Agency", "Photography Portfolio", "Restaurant")
5. Import the kit, publish the homepage
6. Install Joist plugin (upload the same `joist-smoke.zip` we use on georges232)
7. Set up Application Password for Joist's agent user
8. From Claude Code: `joist_get_page_tree` with the imported homepage's page_id
9. Save the returned tree to `knowledge/CASE_STUDY_DESIGNED_ELEMENTOR_PAGE_REAL_FREEKIT.md` with annotations
10. Repeat for 4-5 more kits

This produces a real-trees knowledge base **in one session** and upgrades the synthesis case study to ground truth.

## Legal/ethical guidance

- **Local imports of free templates:** unambiguously safe.
- **Buying Pro kits:** you own a license, study and extract freely.
- **Scraping public sites:** equivalent to reading their HTML. OK to study; not OK to republish raw extracts without credit.
- **Rendering competitor sites via Playwright:** equivalent to screenshot + vision (Joist already does this). Same risk profile.
- **Cross-site REST hits without permission:** gray. Don't make Joist do this automatically.

Email site owners when in doubt — many agencies are proud to contribute reference trees for AI-tooling case studies.

## Sources

- LocalWP (https://localwp.com/)
- TemplateGoat (https://templategoat.com/)
- Elementor Template Library (https://elementor.com/help/template-library/)
- Elementor Pro pricing (https://elementor.com/pricing/)
- WP Studio by WordPress.com (https://developer.wordpress.com/studio/)
- CVE-2026-6127 — Elementor REST exposure context

## What ships next

If user agrees: Tier 1 today (LocalWP + 5 free kits → trees in `knowledge/`). Tier 3 (Playwright DOM extraction) gets its own research stream — see in-flight research at `(launched 2026-06-01)`.

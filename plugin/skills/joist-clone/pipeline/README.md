# joist-clone deterministic pipeline (fast-path)

The **deterministic** clone path the joist-clone skill runs as its primary (fast) path: a single command
that captures a source page's real DOM, builds a NATIVE Elementor widget tree (hybrid: editable simple
sections + rastered hard sections), writes it to the target page via the Joist REST API, and grades it.

No vision loop, no iteration — one pass (~3-5 min). On standard marketing/SaaS sites it lands ~0.80–0.84
composite with real editable widgets (measured: supabase 0.844, notion 0.822, cal.com 0.803 first-try).

## Setup (once)

```bash
cd pipeline
npm install
npx playwright install chromium     # ~150MB browser binary
```

## Run

```bash
export JOIST_BASE="https://your-wp-site.com"
export JOIST_AUTH_B64="$(printf 'user:app-password' | base64)"   # WP application password
node clone-fast.mjs --source https://example.com --page <existing_page_id>
```

Returns the grade (composite + per-dimension) and the live URL.

## When to use this vs the vision loop

- **This (deterministic):** DEFAULT for a first pass — faster, editable, measured. **But its quality is
  site-dependent and NOT guaranteed (see the boundary below) — always LOOK at the result and fall back.**
- **Vision loop (skill phases 1–6):** the fallback whenever this is weak/fails — heavy SPAs that don't fully
  render headless, sparsely-reconstructed pages, or when pixel/motion fidelity matters over editability.

## Honest boundary (evidence-based, do NOT assume "marketing/SaaS = good")

Quality is **site-structure + render dependent**, measured on the trustworthy grade-structure objective
(0–1: visual + visual-coupled editability + design-system + mobile). Two failure modes the term "marketing/SaaS"
does NOT predict:

| outcome | example (composite) | why |
|---|---|---|
| **Good** (~0.80–0.84, editable) | cal.com 0.80 · supabase 0.84 · notion 0.82 | renders fully in headless + clean full-width section structure |
| **Weak** (~0.5–0.6, sparse) | clerk.com 0.56 | renders, but middle sections reconstruct sparsely |
| **Fails** (~0.4, ~1 flat section) | posthog.com 0.44 | heavy SPA — only the initial viewport renders in headless (`pageH≈900`) |

So **~0.8 is the ceiling on the sites it suits, not a floor.** ALWAYS screenshot the result and judge it by eye;
if it's sparse, flat, or short (capture didn't render the full page), fall back to the vision loop. Code-heavy
docs and motion/image-heavy sites are partially rasterized (faithful look, less editable). Not pixel-perfect or
animation-faithful.

## Files
- `clone-fast.mjs` — entry (build-hybrid → grade-structure)
- `build-hybrid.mjs` — capture + native-tree builder
- `abs-positioning.mjs` — abs-layout primitives (rare, for genuinely-layered sections)
- `grade-structure.mjs` — the objective grader
- Snapshotted from `eval/grader/` (source of truth). Re-sync after pipeline changes there.

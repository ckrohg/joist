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

- **This (deterministic):** standard marketing/SaaS landing pages — faster, editable, measured. DEFAULT.
- **Vision loop (skill phases 1–6):** fallback when this fails (headless-unrenderable / heavily animated
  sites), or when pixel/motion fidelity matters more than round-trip editability.

## Honest boundary

Clones standard marketing/SaaS pages to ~85% with real editable widgets. Code-heavy docs and
motion/image-heavy sites are partially rasterized (faithful look, less editable). Not pixel-perfect or
animation-faithful. Grades on the trustworthy grade-structure objective (visual + visual-coupled editability
+ design-system + mobile responsive).

## Files
- `clone-fast.mjs` — entry (build-hybrid → grade-structure)
- `build-hybrid.mjs` — capture + native-tree builder
- `abs-positioning.mjs` — abs-layout primitives (rare, for genuinely-layered sections)
- `grade-structure.mjs` — the objective grader
- Snapshotted from `eval/grader/` (source of truth). Re-sync after pipeline changes there.

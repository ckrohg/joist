export const meta = {
  name: 'synthetic-bench',
  description: 'ROADMAP #3 (scalability force-multiplier, user-selected): a DETERMINISTIC synthetic ground-truth bench. This session lost MANY rounds to measurement variance (contaminated backups, RLG flake, live-site capture variance, median-of-N bandaids). A bench of hand-authored STATIC ground-truth blocks (no JS/animation/lazy-load/CDN-fonts/network-images -> 100% reproducible capture) run through the FULL pipeline (capture -> build-absolute -> grade) gives: (a) DETERMINISTIC scores (run-twice spread ~0 vs live ~0.04) so future A/B is trustworthy + fast, (b) BUILDER-BUG ISOLATION (simple known input -> a low score is a builder bug, not capture noise), (c) a REGRESSION SUITE (re-run after any change -> gains become monotonic, catches breakage across the whole block set). New files ONLY (eval/grader/bench/*) — zero edits to capture/build/grade -> low risk. GATE: bench runs end-to-end on all blocks + DETERMINISTIC (run-twice spread < 0.01, far tighter than live) + per-block + per-channel attribution + >=1 simple block scores high (pipeline works on clean input) + reusable, else record findings.',
  phases: [
    { title: 'Build', detail: 'author 5-6 static ground-truth blocks (hero/card-grid/nav/pricing/feature/footer) + bench-run.mjs (serve static -> capture -> build-absolute -> grade, per-block, run-twice determinism)' },
    { title: 'Prove', detail: 'run the bench: per-block composite + sub-scores + determinism spread + builder-bug isolation on known-simple input' },
    { title: 'Gate', detail: 'keep iff end-to-end + deterministic (spread<0.01) + per-block/channel attribution + a clean block scores high + reusable regression suite' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && export JOIST_BASE="${JOIST_BASE:-http://localhost:8001}"; case "$JOIST_BASE" in *sg-host.com*|*georges232*|*35.212.46.254*) echo "FATAL: JOIST_BASE=$JOIST_BASE is a blocked/paused host (host-guard allowlist; renders only target localhost:8001 or JOIST_TRAINING_BASE)"; exit 1;; esac'
const HARD = 'Create NEW files ONLY under ' + GRADER + '/bench/ (blocks/*.html + bench-run.mjs). Do NOT edit capture-layout/build-absolute/grade-sections/perelement. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Use scratch WP page ids for grading (reuse the framer slot 2990 + allocate a couple disposable ids; the bench OVERWRITES them per run, that is fine).'

const impl = await agent([HARD,
  'BUILD a deterministic synthetic ground-truth bench. Work in ' + GRADER + '.',
  'STEP 1 — author 5-6 STATIC ground-truth blocks as self-contained HTML files in bench/blocks/ (hero.html, card-grid.html, nav.html, pricing.html, feature-image.html, footer.html). HARD determinism rules so capture is 100% reproducible: NO JavaScript, NO CSS animation/transition, NO lazy-load, NO CDN webfonts (use system font stacks like -apple-system/Arial), NO network images (use inline SVG, solid-color or linear-gradient divs, or small data: URI images). Each block = a realistic but SIMPLE, fully-specified layout with inline styles (so the rendered geometry/color/typography is exact + deterministic). These are the GROUND TRUTH — a faithful clone should score very high on them.',
  'STEP 2 — bench-run.mjs: (a) start a tiny local static server (node http) serving bench/blocks/ on a port; (b) for each block: capture (node capture-layout.mjs --source http://localhost:PORT/<block>.html --out /tmp/bench-<block>.json), build-absolute to a scratch page (--publish), grade (node grade-sections.mjs --source http://localhost:PORT/<block>.html --clone "$JOIST_BASE/?page_id=<scratch>"); (c) DETERMINISM: run capture+grade TWICE per block, record composite spread; (d) report per-block {composite, visual, editability, structural, responsive, coverage, spread} + a corpus-bench mean. Keep it bounded + robust (try/catch per block, fixed timeouts, no hang). Shut the server down at the end.',
  'STEP 3 — make it a REGRESSION SUITE: write the per-block baseline to bench/baseline.json on first run; on subsequent runs, flag any block whose composite drops > 0.01 vs baseline. node --check bench-run.mjs.',
  'SMOKE: run node bench/bench-run.mjs once -> confirm it completes, produces per-block scores, and the run-twice spread per block is SMALL (< 0.01, much tighter than live sites ~0.04). Confirm a simple clean block (e.g. nav or hero) scores HIGH (the pipeline reproduces clean known input well); if a block scores LOW, that is a pinpointed builder bug on known input (report it — that is the bench doing its job).',
  'Return "OK:" with the per-block composites + per-block run-twice spreads + the bench mean + any builder-bug a block exposed, or "FAILED:" with why.',
].join('\n'), { label: 'build:synthetic-bench', phase: 'Build' })
log('IMPL: ' + String(impl || '').slice(0, 320))

const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bFAILED:/i.test(String(impl || ''))
let verify = null
if (okImpl) {
  phase('Gate')
  const VS = { type: 'object', additionalProperties: false, properties: {
    ranEndToEnd: { type: 'boolean' }, blockCount: { type: 'number' }, benchMean: { type: 'number' },
    maxSpread: { type: 'number' }, deterministic: { type: 'boolean' },
    perBlock: { type: 'array', items: { type: 'object', additionalProperties: true } },
    highBlockScore: { type: 'number' }, builderBugsExposed: { type: 'array', items: { type: 'string' } },
    reusableRegressionSuite: { type: 'boolean' }, ok: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['ranEndToEnd', 'blockCount', 'maxSpread', 'deterministic', 'highBlockScore', 'reusableRegressionSuite', 'ok', 'verdict'] }
  verify = await agent([HARD.replace('Create NEW files ONLY under ' + GRADER + '/bench/ (blocks/*.html + bench-run.mjs). ', 'VERIFY ONLY — do NOT create/edit files beyond re-running the bench. '),
    'INDEPENDENTLY VERIFY the synthetic bench. Work in ' + GRADER + '. ' + AUTH + '. Prior report: ' + String(impl||'').slice(0,300) + '. You MUST end by calling StructuredOutput.',
    'Run node bench/bench-run.mjs yourself. (1) ranEndToEnd: did it complete on all blocks? blockCount. benchMean (mean composite). (2) DETERMINISM (the core value): maxSpread = the largest per-block run-twice composite spread; deterministic=true iff maxSpread < 0.01 (much tighter than live sites ~0.04). (3) perBlock = [{block, composite, spread}]. (4) highBlockScore = the best block composite (a clean simple block should score HIGH — proves the pipeline reproduces known-good input; if even the simplest block scores low, the bench has exposed a real builder bug -> list in builderBugsExposed). (5) reusableRegressionSuite: does it write/compare a baseline so re-runs flag regressions? (6) builderBugsExposed = any block scoring surprisingly low (a pinpointed builder bug on known input — VALUABLE).',
    'ok = ranEndToEnd AND deterministic (maxSpread<0.01) AND reusableRegressionSuite AND highBlockScore reasonable. Return all fields + verdict.',
  ].join('\n'), { label: 'verify:synthetic-bench', phase: 'Gate', schema: VS })
  log('VERIFY: ranE2E=' + (verify&&verify.ranEndToEnd) + ' blocks=' + (verify&&verify.blockCount) + ' mean=' + (verify&&verify.benchMean) + ' maxSpread=' + (verify&&verify.maxSpread) + ' deterministic=' + (verify&&verify.deterministic) + ' highBlock=' + (verify&&verify.highBlockScore) + ' ok=' + (verify&&verify.ok))
}

phase('Gate')
let verdict
if (!okImpl) {
  verdict = 'NOT BUILT — bench impl failed: ' + String(impl||'').slice(0,200)
} else if (verify && verify.ok) {
  verdict = 'ADOPTED — deterministic synthetic bench LIVE: ' + verify.blockCount + ' ground-truth blocks, bench mean ' + verify.benchMean + ', maxSpread ' + verify.maxSpread + ' (<0.01 — DETERMINISTIC vs live ~0.04), highBlock ' + verify.highBlockScore + ', reusable regression suite. ' + ((verify.builderBugsExposed||[]).length ? 'Builder bugs exposed on known input: ' + JSON.stringify(verify.builderBugsExposed) + ' (the bench doing its job). ' : '') + 'Future rounds can now iterate FAST + TRUSTWORTHY + isolate builder/capture/grader bugs. Scalability force-multiplier landed (roadmap #3).'
} else {
  verdict = 'PARTIAL/NO-KEEP — bench built but did not meet the bar: ' + JSON.stringify(verify || {}).slice(0, 300) + '. Files left in bench/ for inspection (new files, no pipeline impact); refine next.'
}
log('SYNTHETIC-BENCH: ' + verdict)
return { verdict, impl: String(impl||'').slice(0,500), verify }

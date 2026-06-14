export const meta = {
  name: 'eval-harness',
  description: 'OUTER-LOOP EVAL (on top of per-clone grader history) — the missing guard the user asked for (2026-06-05). Two jobs the per-clone grade cannot do alone: (1) HELD-OUT TRAJECTORY — clone+grade a FIXED set of EVAL-ONLY sites that are DISJOINT from the dev/training corpus (tailwind/supabase/resend/framer/linear/vercel/reactdev) and the breadth corpus, so a gain here is real GENERALIZATION, not recipe overfit; track composite over time and FLAG overfit (held-out down while dev-corpus up) or plateau. (2) GRADER CALIBRATION — for each held-out clone, compute the grader composite AND an independent LIVED-EXPERIENCE score from objective checks the grader may miss (horizontal-overflow@1280, nav-brand-correctness, render-not-blank, content-not-stacked, mobile-overflow@390); the gap = grader-dishonesty (this is what would have caught the user 0.586-vs-not-close). Emits evalHistory + calibrationGap + overfitFlag + the next eval-driven fix target. READ-ONLY on cloner code (build+grade+screenshot only). Runs as a standing outer-loop tier on an evalEvery cadence.',
  phases: [
    { title: 'Held-out', detail: 'clone+grade + lived-experience checks on the reserved eval-only set (parallel)' },
    { title: 'Calibrate', detail: 'grader-vs-experience calibration gap + overfit/regression flag + next eval target' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && export JOIST_BASE="${JOIST_BASE:-http://localhost:8001}"; case "$JOIST_BASE" in *sg-host.com*|*georges232*|*35.212.46.254*) echo "FATAL: JOIST_BASE=$JOIST_BASE is a blocked/paused host (host-guard allowlist; renders only target localhost:8001 or JOIST_TRAINING_BASE)"; exit 1;; esac'
// RESERVED EVAL-ONLY sites — DISJOINT from the dev corpus + breadth corpus, so gains here measure generalization, not overfit.
// Pages 9101-9104 are reserved for the eval harness only. Override via args:{sites:[...]} if needed.
const EVAL_SITES = (args && args.sites) || [
  { name: 'stripe', url: 'https://stripe.com', archetype: 'premium dynamic marketing (hard capture)', page: 9101 },
  { name: 'github', url: 'https://github.com', archetype: 'dense product / dev platform', page: 9102 },
  { name: 'clerk', url: 'https://clerk.com', archetype: 'dev-marketing (NOT in corpus)', page: 9103 },
  { name: 'notion', url: 'https://www.notion.so', archetype: 'product / app marketing', page: 9104 },
]
const DEV_CORPUS_MEAN = (args && args.devCorpusMean) || 0.586 // current dev-marketing composite, for the overfit comparison
const PRIOR_EVAL_MEAN = (args && args.priorEvalMean) // last eval-harness composite, for regression detection (undefined on first run)

phase('Held-out')
const RSCHEMA = { type: 'object', additionalProperties: false, properties: {
  site: { type: 'string' }, rendered: { type: 'boolean' }, built: { type: 'boolean' },
  composite: { type: 'number' }, visual: { type: 'number' }, structural: { type: 'number' }, responsive: { type: 'number' },
  // lived-experience objective checks (grader-independent):
  overflowPx1280: { type: 'number' }, horizontalScroll: { type: 'boolean' }, overflowPx390: { type: 'number' },
  navBrandRight: { type: 'boolean' }, rendersContent: { type: 'boolean' }, contentStacked: { type: 'boolean' },
  experienceScore: { type: 'number' }, graderVsExperienceGap: { type: 'number' }, notes: { type: 'string' },
}, required: ['site', 'rendered', 'built', 'composite', 'overflowPx1280', 'horizontalScroll', 'experienceScore', 'graderVsExperienceGap'] }
const results = await parallel(EVAL_SITES.map((s) => () => agent([
  'EVAL one HELD-OUT site on the CURRENT pipeline (read-only on cloner code: build + grade + Playwright checks only; do NOT edit any builder/grader). Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' archetype=' + s.archetype + ' page=' + s.page + '. ' + AUTH + ' before every WP command. Never print JOIST_AUTH_B64. You MUST end by calling StructuredOutput.',
  'STEP 0: ensure scratch eval page ' + s.page + ' exists — GET $JOIST_BASE/wp-json/wp/v2/pages/' + s.page + '; if 404, POST $JOIST_BASE/wp-json/wp/v2/pages {title:"eval-' + s.name + '", status:"publish"} and use the returned id (note it).',
  'STEP 1 RENDER CHECK: load ' + s.url + ' in Playwright @1440 — does it render real content headless (rendered=true) or is it bot-walled/blank (rendered=false, note why)?',
  'STEP 2 BUILD: node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/eval-' + s.name + '.json --passes 2 (fallback capture-layout.mjs); then build via the CURRENT default builder (node build-absolute.mjs --layout /tmp/eval-' + s.name + '.json --page <id> --publish). built=false + reason if it fails.',
  'STEP 3 GRADE: node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=<id>" -> composite/visual/structural/responsive.',
  'STEP 4 LIVED-EXPERIENCE (grader-independent objective checks — the calibration probes): Playwright load "$JOIST_BASE/?page_id=<id>". (a) @1280x900: overflowPx1280 = documentElement.scrollWidth - innerWidth; horizontalScroll = overflowPx1280>2. (b) @390x844: overflowPx390 = scrollWidth - innerWidth (mobile horizontal overflow). (c) navBrandRight = does the top nav show the real brand/logo (NOT a hero tagline or wrong text) + plausible nav items? (d) rendersContent = is there real visible content (not blank/fallback)? (e) contentStacked = is content overlapping/stacked into a narrow column instead of laid out? ',
  'STEP 5 EXPERIENCE SCORE (0..1, grader-INDEPENDENT): start 1.0; subtract 0.35 if horizontalScroll, 0.15 if overflowPx390>2, 0.20 if NOT navBrandRight, 0.40 if NOT rendersContent, 0.20 if contentStacked; clamp [0,1]. graderVsExperienceGap = composite - experienceScore (POSITIVE = grader OVER-credits vs lived experience = the dishonesty the user caught).',
  'Return {site, rendered, built, composite, visual, structural, responsive, overflowPx1280, horizontalScroll, overflowPx390, navBrandRight, rendersContent, contentStacked, experienceScore, graderVsExperienceGap, notes}.',
].join('\n'), { label: 'eval:' + s.name, phase: 'Held-out', schema: RSCHEMA }))).then((rs) => rs.filter(Boolean))
for (const r of results) log('EVAL ' + r.site + ': comp ' + r.composite + ' exp ' + r.experienceScore + ' GAP ' + (Math.round((r.graderVsExperienceGap||0)*1000)/1000) + ' | hScroll@1280 ' + r.overflowPx1280 + 'px navOk ' + r.navBrandRight + ' renders ' + r.rendersContent)

phase('Calibrate')
const built = results.filter((r) => r.built)
const mean = (f) => built.length ? Math.round(built.reduce((a, r) => a + (f(r) || 0), 0) / built.length * 10000) / 10000 : 0
const evalMean = mean((r) => r.composite)
const expMean = mean((r) => r.experienceScore)
const calibrationGap = Math.round((evalMean - expMean) * 10000) / 10000 // + = grader over-credits vs experience
const CSCHEMA = { type: 'object', additionalProperties: false, properties: {
  evalMean: { type: 'number' }, expMean: { type: 'number' }, calibrationGap: { type: 'number' },
  overfit: { type: 'boolean' }, overfitEvidence: { type: 'string' }, regressedVsPriorEval: { type: 'boolean' },
  graderDishonest: { type: 'boolean' }, worstCalibrationSite: { type: 'string' }, missedDimensions: { type: 'array', items: { type: 'string' } },
  nextEvalTarget: { type: 'string' }, verdict: { type: 'string' },
}, required: ['evalMean', 'expMean', 'calibrationGap', 'overfit', 'graderDishonest', 'nextEvalTarget', 'verdict'] }
const calib = await agent([
  'CALIBRATE the grader against held-out lived experience and detect overfit. Held-out (EVAL-ONLY, disjoint from dev corpus) results: ' + JSON.stringify(results.map((r) => ({ site: r.site, built: r.built, composite: r.composite, exp: r.experienceScore, gap: r.graderVsExperienceGap, hScroll: r.overflowPx1280, navOk: r.navBrandRight, renders: r.rendersContent, stacked: r.contentStacked }))) + '. Held-out composite mean=' + evalMean + ', experience mean=' + expMean + ', calibrationGap=' + calibrationGap + '. Dev-corpus mean=' + DEV_CORPUS_MEAN + (PRIOR_EVAL_MEAN != null ? ', prior eval-harness mean=' + PRIOR_EVAL_MEAN : ', (first eval run — no prior)') + '. You MUST end by calling StructuredOutput.',
  'Produce: overfit = is the held-out mean MUCH lower than the dev-corpus mean (gap > ~0.1) indicating recipes overfit the training corpus? overfitEvidence (specifics). regressedVsPriorEval = (prior given AND evalMean < priorEval - 0.01). graderDishonest = is calibrationGap large (> ~0.12) OR does any site have a big positive graderVsExperienceGap (grader says good, experience says broken — e.g. composite high but horizontalScroll true / navBrandRight false / rendersContent false)? worstCalibrationSite + missedDimensions = which lived-experience dimensions the grader fails to penalize (e.g. "horizontal-overflow", "nav-brand", "render-blank", "stacked-content"). nextEvalTarget = the single highest-value fix this eval surfaces — EITHER a grader-honesty fix (add the missed dimension to grade-sections) OR a builder fix (the dominant held-out defect). verdict = 2-3 honest sentences on generalization + grader honesty.',
].join('\n'), { label: 'calibrate', phase: 'Calibrate', schema: CSCHEMA })
log('CALIBRATE: evalMean ' + calib.evalMean + ' vs dev ' + DEV_CORPUS_MEAN + ' | calibrationGap ' + calib.calibrationGap + ' | overfit ' + calib.overfit + ' | graderDishonest ' + calib.graderDishonest + ' | next: ' + String(calib.nextEvalTarget).slice(0, 90))

return {
  evalMean, expMean, calibrationGap,
  perSite: results.map((r) => ({ site: r.site, built: r.built, composite: r.composite, experienceScore: r.experienceScore, graderVsExperienceGap: r.graderVsExperienceGap, overflowPx1280: r.overflowPx1280, horizontalScroll: r.horizontalScroll, navBrandRight: r.navBrandRight, rendersContent: r.rendersContent })),
  calibration: calib,
  // the driver records this into overnight-state.evalHistory[] and resets roundsSinceEval=0
  evalHistoryEntry: { t: 'STAMP_AT_RECORD', evalMean, expMean, calibrationGap, overfit: calib.overfit, graderDishonest: calib.graderDishonest, nextEvalTarget: calib.nextEvalTarget },
}

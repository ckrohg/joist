export const meta = {
  name: 'directed-fix',
  description: 'Reusable Phase-5 fix engine: applies ONE specific directive (from the discovery gap-map backlog) to the cloner, self-tests, and corpus-gates with the standard intersection-mean + noise-aware + structural-aware gate (keep iff mean OR struct rises, no per-site regression beyond measured noise, else auto-restore). The driver rewrites the FIX_* consts each round from overnight-state.json phase5backlog.',
  phases: [
    { title: 'Baseline', detail: 're-clone+grade corpus K times (median, intersection-safe)' },
    { title: 'Fix', detail: 'apply the directive surgically; self-test=1.0' },
    { title: 'Gate', detail: 're-clone+grade with the fix' },
    { title: 'Decide', detail: 'keep iff mean/struct up + no regression, else restore' },
  ],
}
// ===== DRIVER-EDITED FIX SPEC (rewritten each round from the ranked backlog) =====
const FIX_LABEL = 'capture-lazy-image-decode'
const FIX_FILES = 'capture-layout.mjs'
const FIX_DIRECTIVE = 'Force-load + decode LAZY images that capture as blank/zero-box (they ARE in the source end-state, just deferred — END-STATE-FAITHFUL, unlike recycled harvest). FIX (capture-layout.mjs ONLY, gated CAPTURE_NO_LAZYIMG=1 default ON): as a RESTING-STATE pass (after the existing step-scroll-to-bottom-then-top reveal-pass, before geometry/raster), promote deferred image sources to real ones: for every <img>, copy data-src/data-lazy-src->src and data-srcset->srcset; for elements with data-bg/data-background or a lazy bg, set the background-image; then AWAIT Promise.all(allImages.map(i=>i.decode().catch(()=>{}))) so decoded pixels + intrinsic boxes are available to the walk. Idempotent, resting-state only (never mid-animation), per-image try/catch, wrapped so it never throws. Non-lazy sites: src already set -> no-op -> byte-identical. capture-layout.mjs ONLY. node --check.'
const FIX_EXPECT = 'lazy/deferred images that captured as blank/zero-box now load + decode -> media leaves get real boxes + pixels -> per-element COLOR (lowest sub-score) + areaCoverage RISE on media-heavy grids (the images ARE in the end-state). Non-lazy sites neutral/byte-identical. Self-test 1.0. If it regresses any site, the corpus-gate AUTO-RESTORES (and the new baseline-validity guard blocks any glitched-baseline spurious keep).'
// ===== end driver-edited =====

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const EPS = 0.01, REG_FLOOR = 0.025, REG_CAP = 0.06, STRUCT_EPS = 0.005, K = 2
const SITES = [
  { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146 },
  { name: 'supabase', url: 'https://supabase.com', page: 2986 },
  { name: 'resend', url: 'https://resend.com', page: 2988 },
  { name: 'framer', url: 'https://www.framer.com', page: 2990 },
  { name: 'linear', url: 'https://linear.app', page: 4297 },
  { name: 'vercel', url: 'https://vercel.com', page: 4296 },
  { name: 'reactdev', url: 'https://react.dev', page: 4771 },
]
const cloneUrl = (p) => 'https://georges232.sg-host.com/?page_id=' + p
const GRADE_SCHEMA = { type: 'object', additionalProperties: false, properties: { site: { type: 'string' }, composite: { type: 'number' }, composites: { type: 'array', items: { type: 'number' } }, structuralFidelity: { type: 'number' }, visual: { type: 'number' }, editability: { type: 'number' } }, required: ['site', 'composite', 'composites', 'structuralFidelity'] }

function gradeRepsPrompt(s) {
  return [
    'Re-clone (capture+build) then grade ONE site ' + K + ' times IN SEQUENCE to denoise. Work in ' + GRADER + '. Do NOT edit any cloner file.',
    'For EACH rep (1..' + K + '), run EXACTLY, waiting for each (1-3 min):',
    '  source /tmp/joist-auth.env',
    '  node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/ev-' + s.name + '.json --passes 2',
    '  node build-absolute.mjs --layout /tmp/ev-' + s.name + '.json --page ' + s.page,
    '  node grade-sections.mjs --source ' + s.url + ' --clone "' + cloneUrl(s.page) + '" --out /tmp/evg-' + s.name,
    '  then read /tmp/evg-' + s.name + '/sections.json: note report.composite, report.structuralFidelity, report.visualMean (or visual), report.editabilityMean (or editability).',
    'Run reps STRICTLY SEQUENTIALLY on page ' + s.page + ' (never concurrent).',
    'Return site="' + s.name + '", composites=[the ' + K + '], composite=MEDIAN, structuralFidelity=MEDIAN, visual=MEDIAN, editability=MEDIAN.',
  ].join('\n')
}
async function gradeAll(phaseName, tag) {
  const run = (s, extra) => agent(gradeRepsPrompt(s) + (extra || ''), { label: tag + ':' + s.name, phase: phaseName, schema: GRADE_SCHEMA })
  const results = await parallel(SITES.map((s) => () => run(s)))
  const miss = []; for (let i = 0; i < results.length; i++) if (!results[i]) miss.push(i)
  if (miss.length) {
    log('retrying ' + miss.length + ' dropped: ' + miss.map((i) => SITES[i].name).join(','))
    const retry = await parallel(miss.map((i) => () => run(SITES[i], '\n\nRETRY: you MUST end by calling StructuredOutput.')))
    miss.forEach((i, k) => { if (retry[k]) results[i] = retry[k] })
  }
  return results.filter(Boolean)
}

phase('Baseline')
const base = await gradeAll('Baseline', 'base')
const baseBy = {}, baseStructBy = {}, noiseBy = {}
for (const r of base) { baseBy[r.site] = r.composite; baseStructBy[r.site] = r.structuralFidelity || 0; const x = (r.composites || []).filter((n) => typeof n === 'number'); noiseBy[r.site] = x.length > 1 ? +(Math.max(...x) - Math.min(...x)).toFixed(3) : 0 }
log('baseline composite by site: ' + JSON.stringify(baseBy) + ' | FIX: ' + FIX_LABEL)

phase('Fix')
const FIX_SCHEMA = { type: 'object', additionalProperties: false, properties: { applied: { type: 'boolean' }, selfTestPass: { type: 'boolean' }, diffSummary: { type: 'string' }, note: { type: 'string' } }, required: ['applied', 'selfTestPass'] }
const fixPrompt = [
  'You are applying ONE surgical, pre-diagnosed fix to a website-cloner. Work in ' + GRADER + '. Be precise + SAFE.',
  'FIX: ' + FIX_DIRECTIVE,
  'Expected effect: ' + FIX_EXPECT,
  'RULES: edit ONLY ' + FIX_FILES + ' (and capture-layout.mjs/build-absolute.mjs if the directive explicitly spans both). Do NOT touch grade-sections.mjs or any scoring. Do NOT rasterize MORE text (rebuild, never screenshot words). Keep all existing kept-recipe behavior intact.',
  'STEP 0: cp capture-layout.mjs /tmp/ev-bk-capture.mjs ; cp build-absolute.mjs /tmp/ev-bk-build.mjs',
  'STEP 1: read the relevant code to ground the change, then implement the directive surgically. node --check the edited file(s).',
  'STEP 2: self-test: source /tmp/joist-auth.env ; node grade-sections.mjs --source https://resend.com --selftest -> MUST print PASS (composite 1.0). If not, restore both backups and report applied=false, selfTestPass=false.',
  'STEP 3 (optional sanity): if quick, build+grade ONE relevant site to confirm the change moves the intended sub-metric in the right direction; mention it in note. Do NOT corpus-grade — the engine does that.',
  'Report {applied, selfTestPass, diffSummary, note}.',
].join('\n')
const fix = await agent(fixPrompt, { label: 'fix:' + FIX_LABEL, phase: 'Fix', schema: FIX_SCHEMA })

let verdict
if (!fix || !fix.applied || !fix.selfTestPass) {
  verdict = 'NO-OP — not applied / self-test failed. note: ' + (fix ? fix.note : 'no result')
} else {
  phase('Gate')
  const after = await gradeAll('Gate', 'gate')
  const common = new Set(after.map((r) => r.site).filter((s) => base.some((b) => b.site === s)))
  const cAvg = (arr, key) => { const xs = arr.filter((r) => common.has(r.site)); return xs.length ? +(xs.reduce((a, r) => a + (r[key] || 0), 0) / xs.length).toFixed(3) : 0 }
  const baseMeanC = cAvg(base, 'composite'), baseStructC = cAvg(base, 'structuralFidelity')
  const afterMean = cAvg(after, 'composite'), afterStructC = cAvg(after, 'structuralFidelity')
  const afterVisualC = cAvg(after, 'visual'), baseVisualC = cAvg(base, 'visual'), afterEditC = cAvg(after, 'editability'), baseEditC = cAvg(base, 'editability')
  const perSite = after.map((r) => { const tol = Math.min(REG_CAP, Math.max(REG_FLOOR, noiseBy[r.site] || 0)); const delta = +((r.composite || 0) - (baseBy[r.site] || 0)).toFixed(3); return { site: r.site, before: baseBy[r.site], after: r.composite, delta, tol: +tol.toFixed(3) } })
  const regressions = perSite.filter((p) => p.delta < -p.tol)
  // BASELINE-VALIDITY GUARD: grades MUST be in [0,1]; a negative/implausible baseline (or after) means the
  // grading GLITCHED this run -> the gate cannot be trusted (any fix "beats" a broken baseline). Force no-keep + flag.
  const inRange = (r) => typeof r.composite === 'number' && r.composite >= 0 && r.composite <= 1.01
  const baselineValid = base.every(inRange) && after.every(inRange) && baseMeanC >= 0.05
  phase('Decide')
  const meanUp = afterMean > baseMeanC + EPS
  const structUp = afterStructC > baseStructC + STRUCT_EPS
  const editUp = afterEditC > baseEditC + EPS
  const visualUp = afterVisualC > baseVisualC + EPS
  // editability + visual are FIRST-CLASS metrics (0.3 + 0.4 of composite; editability is a hard product
  // requirement). A change that lifts ANY sub-metric past its epsilon with NO per-site composite regression is
  // a real win -> keep (the gate previously only checked mean/struct and silently rejected editability/visual wins).
  const keep = baselineValid && regressions.length === 0 && common.size >= 2 && (meanUp || structUp || editUp || visualUp)
  const drove = meanUp ? 'mean' : structUp ? 'struct' : editUp ? 'editability' : visualUp ? 'visual' : 'none'
  if (!keep) {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-capture.mjs capture-layout.mjs && cp /tmp/ev-bk-build.mjs build-absolute.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Decide' })
    verdict = (!baselineValid ? 'INVALID-BASELINE + RESTORED (' + FIX_LABEL + ') — baseline/after grades out of [0,1] (baseMean ' + baseMeanC + ', afterMean ' + afterMean + ') => grading GLITCHED this run, gate UNTRUSTWORTHY, no-keep + flagged for re-run' : 'REJECTED + RESTORED (' + FIX_LABEL + ') — ' + (regressions.length ? 'regressed: ' + regressions.map((r) => r.site + ' ' + r.delta).join(',') : 'no mean/struct gain (mean ' + baseMeanC + '->' + afterMean + ', struct ' + baseStructC + '->' + afterStructC + ', visual ' + baseVisualC + '->' + afterVisualC + ', edit ' + baseEditC + '->' + afterEditC + ')'))
  } else {
    verdict = 'KEPT (' + FIX_LABEL + ', via ' + drove + ') — mean ' + baseMeanC + '->' + afterMean + ', struct ' + baseStructC + '->' + afterStructC + ', visual ' + baseVisualC + '->' + afterVisualC + ', edit ' + baseEditC + '->' + afterEditC + ', no regression. Per-site: ' + JSON.stringify(perSite.map((p) => p.site + ':' + p.after))
  }
}
log('DIRECTED-FIX[' + FIX_LABEL + '] verdict: ' + verdict)
return { verdict, fix, label: FIX_LABEL }

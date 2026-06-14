export const meta = {
  name: 'capture-coverage-fix',
  description: 'THE bottleneck (rounds 6-11): the proven landing emitters (list text-editor, video html-iframe) work, but capture-layout/capture-ensemble never EXTRACTS most source blocks (lazy/scroll-triggered/dynamic content) so there is nothing to rebuild. This round improves capture to scroll-trigger + wait for lazy media and dynamic content, verifies more source blocks get extracted (resend videos 1->~4; framer 0.413 floor), then corpus-gates. Unblocks the whole structural tier + framer editability.',
  phases: [
    { title: 'Baseline', detail: 're-clone+grade corpus K times (median, intersection-safe)' },
    { title: 'Fix', detail: 'improve capture-layout/capture-ensemble lazy+dynamic coverage; verify resend video NODES rise' },
    { title: 'Gate', detail: 're-clone+grade with the fix' },
    { title: 'Decide', detail: 'keep iff struct/mean up + no regression beyond noise, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const EPS = 0.01, REG_FLOOR = 0.025, REG_CAP = 0.06, STRUCT_EPS = 0.005, K = 2
const SITES = [
  { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146 },
  { name: 'supabase', url: 'https://supabase.com', page: 2986 },
  { name: 'resend', url: 'https://resend.com', page: 2988 },
  { name: 'framer', url: 'https://www.framer.com', page: 2990 },
]
const cloneUrl = (p) => '' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/?page_id=' + p
const GRADE_SCHEMA = { type: 'object', additionalProperties: false, properties: { site: { type: 'string' }, composite: { type: 'number' }, composites: { type: 'array', items: { type: 'number' } }, structuralFidelity: { type: 'number' }, editability: { type: 'number' }, defects: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { why: { type: 'array', items: { type: 'string' } } }, required: ['why'] } } }, required: ['site', 'composite', 'composites', 'structuralFidelity'] }

function gradeRepsPrompt(s) {
  return [
    'Re-clone (capture+build) then grade ONE site ' + K + ' times IN SEQUENCE to denoise. Work in ' + GRADER + '. Do NOT edit any cloner file.',
    'For EACH rep (1..' + K + '), run EXACTLY, waiting for each (1-3 min):',
    '  source /tmp/joist-auth.env',
    '  node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/ev-' + s.name + '.json --passes 2',
    '  node build-absolute.mjs --layout /tmp/ev-' + s.name + '.json --page ' + s.page,
    '  node grade-sections.mjs --source ' + s.url + ' --clone "' + cloneUrl(s.page) + '" --out /tmp/evg-' + s.name,
    '  then read /tmp/evg-' + s.name + '/sections.json: note report.composite, report.structuralFidelity, report.editabilityMean (or editability).',
    'Run reps STRICTLY SEQUENTIALLY on page ' + s.page + ' (never concurrent).',
    'Return site="' + s.name + '", composites=[the ' + K + '], composite=MEDIAN, structuralFidelity=MEDIAN, editability=MEDIAN, defects=last rep failing sections.',
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
log('baseline struct by site: ' + JSON.stringify(baseStructBy))

phase('Fix')
const FIX_SCHEMA = { type: 'object', additionalProperties: false, properties: { applied: { type: 'boolean' }, resendVideoNodesBefore: { type: 'number' }, resendVideoNodesAfter: { type: 'number' }, framerNodesAfter: { type: 'number' }, selfTestPass: { type: 'boolean' }, file: { type: 'string' }, diffSummary: { type: 'string' }, note: { type: 'string' } }, required: ['applied', 'resendVideoNodesAfter', 'selfTestPass'] }
const fixPrompt = [
  'You are fixing the #1 bottleneck of a website-cloner: CAPTURE-COVERAGE. The proven landing emitters work (list, video render countably on the clone) but capture-layout.mjs / capture-ensemble.mjs do NOT EXTRACT most source blocks because they are lazy-loaded / scroll-triggered / rendered by client JS after load. Evidence: resend has 4 source videos but capture extracts only 1; framer (a dynamic JS site) extracts almost nothing (structuralFidelity 0). Work in ' + GRADER + '. Be surgical + SAFE — do NOT break the captures that already work (list extraction).',
  'GOAL: capture must extract the lazy/dynamic source content so it CAN be rebuilt. Techniques (apply what fits, read the existing code first to see what is already done — it already scrolls once and click-drives): (1) scroll the page in STEPS top-to-bottom (e.g. viewport-by-viewport) with a short settle wait at each step so IntersectionObserver / lazy-load fires; (2) before extraction, wait for network-idle AND for lazy media to resolve (img[loading=lazy], [data-src], <video>/<iframe> with data-src) — set their src from data-src if present; (3) give client-rendered sites (framer) a longer settle + a final full-scroll back to top so layout settles; (4) ensure <video>/<iframe> elements are reached by walk() after they load. Prefer editing capture-ensemble.mjs (the orchestrator/scroll/wait) and/or the page-prep in capture-layout.mjs; keep walk() detection intact.',
  'RULES: edit ONLY capture-layout.mjs and/or capture-ensemble.mjs. Do NOT touch grade-sections.mjs/build-absolute.mjs/scoring. Do NOT rasterize.',
  'STEP 0: cp capture-layout.mjs /tmp/ev-bk-capture.mjs ; cp capture-ensemble.mjs /tmp/ev-bk-ensemble.mjs ; cp build-absolute.mjs /tmp/ev-bk-build.mjs',
  'STEP 1: read both files; make the coverage improvement. node --check both.',
  'STEP 2 — VERIFY EXTRACTION RISES: source /tmp/joist-auth.env ; node capture-ensemble.mjs --source https://resend.com --out /tmp/cc-resend.json --passes 2 ; then count nodes with kind=="video" in /tmp/cc-resend.json (report resendVideoNodesBefore from a fresh run of the OLD code if feasible, else 1, and resendVideoNodesAfter). Also: node capture-ensemble.mjs --source https://www.framer.com --out /tmp/cc-framer.json --passes 2 ; report framerNodesAfter = total leaf nodes captured (a rough coverage proxy).',
  'STEP 3: self-test (grader is unaffected by capture, should pass): node grade-sections.mjs --source https://resend.com --selftest -> PASS.',
  'STEP 4: if resendVideoNodesAfter did NOT rise above ~1 AND framer coverage did not improve, your change did not help — restore ALL backups (cp /tmp/ev-bk-capture.mjs capture-layout.mjs ; cp /tmp/ev-bk-ensemble.mjs capture-ensemble.mjs) and set applied=false. Otherwise leave applied.',
  'Report {applied, resendVideoNodesBefore, resendVideoNodesAfter, framerNodesAfter, selfTestPass, file, diffSummary, note}. Do NOT corpus-grade — the engine does that.',
].join('\n')
const fix = await agent(fixPrompt, { label: 'fix:capture-coverage', phase: 'Fix', schema: FIX_SCHEMA })

let verdict, finding
if (!fix || !fix.applied || !fix.selfTestPass) {
  verdict = 'NO-OP — capture-coverage change not applied or did not raise extraction (resendVideoNodesAfter=' + (fix ? fix.resendVideoNodesAfter : '?') + ', framerNodes=' + (fix ? fix.framerNodesAfter : '?') + '). note: ' + (fix ? fix.note : 'no result')
  finding = 'no extraction improvement'
} else {
  phase('Gate')
  const after = await gradeAll('Gate', 'gate')
  const common = new Set(after.map((r) => r.site).filter((s) => base.some((b) => b.site === s)))
  const cAvg = (arr, key) => { const xs = arr.filter((r) => common.has(r.site)); return xs.length ? +(xs.reduce((a, r) => a + (r[key] || 0), 0) / xs.length).toFixed(3) : 0 }
  const baseMeanC = cAvg(base, 'composite'), baseStructC = cAvg(base, 'structuralFidelity')
  const afterMean = cAvg(after, 'composite'), afterStructC = cAvg(after, 'structuralFidelity')
  const perSite = after.map((r) => { const tol = Math.min(REG_CAP, Math.max(REG_FLOOR, noiseBy[r.site] || 0)); const delta = +((r.composite || 0) - (baseBy[r.site] || 0)).toFixed(3); return { site: r.site, before: baseBy[r.site], after: r.composite, delta, tol: +tol.toFixed(3), structAfter: r.structuralFidelity || 0 } })
  const regressions = perSite.filter((p) => p.delta < -p.tol)
  phase('Decide')
  const meanUp = afterMean > baseMeanC + EPS
  const structUp = afterStructC > baseStructC + STRUCT_EPS
  const keep = regressions.length === 0 && common.size >= 2 && (meanUp || structUp)
  if (!keep) {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-capture.mjs capture-layout.mjs && cp /tmp/ev-bk-ensemble.mjs capture-ensemble.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Decide' })
    verdict = 'REJECTED + RESTORED — extraction rose (resend video nodes ' + fix.resendVideoNodesBefore + '->' + fix.resendVideoNodesAfter + ') but ' + (regressions.length ? 'regressed: ' + regressions.map((r) => r.site + ' ' + r.delta).join(',') : 'no net mean/struct gain (' + baseMeanC + '->' + afterMean + ' / ' + baseStructC + '->' + afterStructC + '). Likely the extra captured blocks did not all LAND, or added noise.')
  } else {
    verdict = 'KEPT — capture coverage up (resend video nodes ' + fix.resendVideoNodesBefore + '->' + fix.resendVideoNodesAfter + '); mean ' + baseMeanC + '->' + afterMean + ', struct ' + baseStructC + '->' + afterStructC + ', no regression. Per-site struct: ' + JSON.stringify(perSite.map((p) => p.site + ':' + p.structAfter))
  }
  finding = 'resend video nodes ' + fix.resendVideoNodesBefore + '->' + fix.resendVideoNodesAfter + '; framer nodes ' + fix.framerNodesAfter
}
log('CAPTURE-COVERAGE verdict: ' + verdict)
return { verdict, finding, fix }

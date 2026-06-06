export const meta = {
  name: 'framer-mockup-collapse-fix',
  description: 'framer is the corpus FLOOR (composite 0.413, editability 0.246, struct 0). Round 12 root-caused it: framer is fully rendered + VISIBLE (291 visible texts in one tall div), but walk()\'s mockup/passthrough detector COLLAPSES its body into 1 hero + 1 giant raster — the cloner SCREENSHOTTING instead of rebuilding (violates the anti-screenshot principle). This round makes walk() recurse into text-RICH containers instead of rasterizing them, verifies framer leaf-count jumps, then corpus-gates (genuine image mockups on the other sites must still raster — no regression).',
  phases: [
    { title: 'Baseline', detail: 're-clone+grade corpus K times (median, intersection-safe)' },
    { title: 'Fix', detail: 'walk() mockup detector: never collapse a text-rich container; verify framer leaves jump' },
    { title: 'Gate', detail: 're-clone+grade with the fix' },
    { title: 'Decide', detail: 'keep iff framer improves + no regression elsewhere (genuine mockups still raster), else restore' },
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
const cloneUrl = (p) => 'https://georges232.sg-host.com/?page_id=' + p
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
const baseBy = {}, baseStructBy = {}, baseEditBy = {}, noiseBy = {}
for (const r of base) { baseBy[r.site] = r.composite; baseStructBy[r.site] = r.structuralFidelity || 0; baseEditBy[r.site] = r.editability || 0; const x = (r.composites || []).filter((n) => typeof n === 'number'); noiseBy[r.site] = x.length > 1 ? +(Math.max(...x) - Math.min(...x)).toFixed(3) : 0 }
log('baseline framer composite=' + (baseBy.framer) + ' struct=' + (baseStructBy.framer) + ' edit=' + (baseEditBy.framer))

phase('Fix')
const FIX_SCHEMA = { type: 'object', additionalProperties: false, properties: { applied: { type: 'boolean' }, framerLeavesBefore: { type: 'number' }, framerLeavesAfter: { type: 'number' }, selfTestPass: { type: 'boolean' }, diffSummary: { type: 'string' }, note: { type: 'string' } }, required: ['applied', 'framerLeavesAfter', 'selfTestPass'] }
const fixPrompt = [
  'You are fixing the corpus FLOOR site (framer, composite 0.413) of a website-cloner. Root cause (already diagnosed): framer.com is fully rendered and VISIBLE at capture time (291 visible text nodes in one ~12555px container), but capture-layout.mjs walk()\'s MOCKUP / passthrough-collapse detector treats framer\'s main content container as a single "mockup" and RASTERIZES it (screenshots it) instead of recursing into its real headings/paragraphs/sections. This both kills editability (0.246) and structural fidelity (0) AND violates the project\'s hard rule: REBUILD words natively, never screenshot text. Work in ' + GRADER + '. Be SURGICAL.',
  'FIX: in capture-layout.mjs walk(), make the mockup/passthrough detector NEVER collapse a TEXT-RICH container into a mockup raster. Add a text-richness guard: if a candidate-for-mockup element contains many real visible text nodes (e.g. innerText split into words/lines exceeds a threshold, or it has >=N descendant heading/paragraph elements with real text), it is NOT a mockup — recurse into it normally so its headings/paragraphs/lists/media become native leaves. Genuine mockups (dashboard screenshots, image-dominant cards with little/no text) must STILL rasterize. Read the existing mockup detector + the round-1/round-2 mockup-rescue logic (recipe-library.json) first so you tighten, not break, it.',
  'RULES: edit ONLY capture-layout.mjs. Do NOT touch grade-sections.mjs/build-absolute.mjs/capture-ensemble.mjs/scoring. Do NOT rasterize MORE; the goal is to rasterize LESS (rebuild more). Keep the round-1/round-2 mockup-text-rescue + mono-dominance behavior intact.',
  'STEP 0: cp capture-layout.mjs /tmp/ev-bk-capture.mjs ; cp build-absolute.mjs /tmp/ev-bk-build.mjs',
  'STEP 1: implement the text-richness guard. node --check capture-layout.mjs.',
  'STEP 2 — VERIFY framer un-collapses: source /tmp/joist-auth.env ; node capture-ensemble.mjs --source https://www.framer.com --out /tmp/ff-framer.json --passes 2 ; count total leaf nodes (heading/text/button/image/list/video etc — NOT containers) in /tmp/ff-framer.json. Report framerLeavesBefore (~4, the old value) and framerLeavesAfter. It should jump well above 4 (framer has 291 visible texts).',
  'STEP 3 — make sure you did NOT over-un-collapse a real mockup: also re-capture one image-heavy site quickly (node capture-ensemble.mjs --source https://tailwindcss.com --out /tmp/ff-tw.json --passes 1) and sanity-check it still produces sensible output (node --check / no crash).',
  'STEP 4: self-test: node grade-sections.mjs --source https://resend.com --selftest -> must PASS.',
  'STEP 5: if framerLeavesAfter did NOT rise meaningfully above ~4, the guard did not fire — restore (cp /tmp/ev-bk-capture.mjs capture-layout.mjs) and set applied=false.',
  'Report {applied, framerLeavesBefore, framerLeavesAfter, selfTestPass, diffSummary, note}. Do NOT corpus-grade — the engine does that.',
].join('\n')
const fix = await agent(fixPrompt, { label: 'fix:framer-mockup-collapse', phase: 'Fix', schema: FIX_SCHEMA })

let verdict, finding
if (!fix || !fix.applied || !fix.selfTestPass) {
  verdict = 'NO-OP — framer un-collapse not applied or did not raise leaves (framerLeavesAfter=' + (fix ? fix.framerLeavesAfter : '?') + '). note: ' + (fix ? fix.note : 'no result')
  finding = 'framer leaves ' + (fix ? fix.framerLeavesBefore + '->' + fix.framerLeavesAfter : '?')
} else {
  phase('Gate')
  const after = await gradeAll('Gate', 'gate')
  const common = new Set(after.map((r) => r.site).filter((s) => base.some((b) => b.site === s)))
  const cAvg = (arr, key) => { const xs = arr.filter((r) => common.has(r.site)); return xs.length ? +(xs.reduce((a, r) => a + (r[key] || 0), 0) / xs.length).toFixed(3) : 0 }
  const baseMeanC = cAvg(base, 'composite'), baseStructC = cAvg(base, 'structuralFidelity')
  const afterMean = cAvg(after, 'composite'), afterStructC = cAvg(after, 'structuralFidelity')
  const afterBy = {}; for (const r of after) afterBy[r.site] = r.composite
  const perSite = after.map((r) => { const tol = Math.min(REG_CAP, Math.max(REG_FLOOR, noiseBy[r.site] || 0)); const delta = +((r.composite || 0) - (baseBy[r.site] || 0)).toFixed(3); return { site: r.site, before: baseBy[r.site], after: r.composite, delta, tol: +tol.toFixed(3), structAfter: r.structuralFidelity || 0, editAfter: r.editability || 0 } })
  const regressions = perSite.filter((p) => p.delta < -p.tol)
  const framerDelta = (afterBy.framer || 0) - (baseBy.framer || 0)
  phase('Decide')
  const meanUp = afterMean > baseMeanC + EPS
  const structUp = afterStructC > baseStructC + STRUCT_EPS
  const keep = regressions.length === 0 && common.size >= 2 && (meanUp || structUp || framerDelta > EPS)
  if (!keep) {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-capture.mjs capture-layout.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Decide' })
    verdict = 'REJECTED + RESTORED — framer leaves rose ' + fix.framerLeavesBefore + '->' + fix.framerLeavesAfter + ' but ' + (regressions.length ? 'regressed: ' + regressions.map((r) => r.site + ' ' + r.delta).join(',') : 'no net gain (mean ' + baseMeanC + '->' + afterMean + ', framer ' + (baseBy.framer) + '->' + (afterBy.framer) + '). The un-collapsed framer content may not have LANDED/scored, or added noise.')
  } else {
    verdict = 'KEPT — framer un-collapsed (leaves ' + fix.framerLeavesBefore + '->' + fix.framerLeavesAfter + '); framer composite ' + (baseBy.framer) + '->' + (afterBy.framer) + ' (Δ' + framerDelta.toFixed(3) + '); mean ' + baseMeanC + '->' + afterMean + ', struct ' + baseStructC + '->' + afterStructC + ', no regression. Per-site: ' + JSON.stringify(perSite.map((p) => p.site + ':c' + p.after + '/e' + p.editAfter))
  }
  finding = 'framer leaves ' + fix.framerLeavesBefore + '->' + fix.framerLeavesAfter + '; framer composite Δ' + framerDelta.toFixed(3)
}
log('FRAMER-FIX verdict: ' + verdict)
return { verdict, finding, fix }

export const meta = {
  name: 'landing-fix-video',
  description: 'STRUCTURAL-CEILING fix: only text-editor widgets (list) currently LAND countably on the clone; native/html/Pro widgets (video/form/tabs) render zero grader-countable elements. This round forces video to emit an ALWAYS-PRESENT <iframe> (native video widget lazy-loads -> grader never sees it), EMPIRICALLY verifies it lands on resend (definitively learning whether wp_kses strips iframes), then corpus-gates. The kses finding decides the whole non-text-editor structural strategy.',
  phases: [
    { title: 'Baseline', detail: 're-clone+grade corpus K times (median, intersection-safe)' },
    { title: 'Fix', detail: 'emit video as always-present <iframe>; verify it LANDS on resend (blocksClone.video>0) + self-test' },
    { title: 'Gate', detail: 're-clone+grade with the fix; keep iff struct/mean up + no regression' },
    { title: 'Decide', detail: 'keep or restore; report the kses iframe-survival finding' },
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
const GRADE_SCHEMA = { type: 'object', additionalProperties: false, properties: { site: { type: 'string' }, composite: { type: 'number' }, composites: { type: 'array', items: { type: 'number' } }, structuralFidelity: { type: 'number' }, videoClone: { type: 'number', description: 'blocksClone.video from the last rep (how many videos LANDED)' }, defects: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { why: { type: 'array', items: { type: 'string' } }, severity: { type: 'number' } }, required: ['why'] } } }, required: ['site', 'composite', 'composites', 'structuralFidelity'] }

function gradeRepsPrompt(s) {
  return [
    'Re-clone (capture+build) then grade ONE site ' + K + ' times IN SEQUENCE to denoise. Work in ' + GRADER + '. Do NOT edit any cloner file.',
    'For EACH rep (1..' + K + '), run EXACTLY, waiting for each (1-3 min):',
    '  source /tmp/joist-auth.env',
    '  node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/ev-' + s.name + '.json --passes 2',
    '  node build-absolute.mjs --layout /tmp/ev-' + s.name + '.json --page ' + s.page,
    '  node grade-sections.mjs --source ' + s.url + ' --clone "' + cloneUrl(s.page) + '" --out /tmp/evg-' + s.name,
    '  then read /tmp/evg-' + s.name + '/sections.json: note report.composite, report.structuralFidelity, and report.blocksClone.video.',
    'Run the reps STRICTLY SEQUENTIALLY on page ' + s.page + ' (never concurrent).',
    'Return site="' + s.name + '", composites=[the ' + K + ' composites], composite=MEDIAN, structuralFidelity=MEDIAN, videoClone=the LAST rep blocksClone.video, defects=last rep failing sections.',
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
  const ok = results.filter(Boolean)
  if (ok.length < SITES.length) log('WARNING only ' + ok.length + '/' + SITES.length + ' graded (' + phaseName + ')')
  return ok
}

phase('Baseline')
const base = await gradeAll('Baseline', 'base')
const baseBy = {}, baseStructBy = {}, noiseBy = {}
for (const r of base) { baseBy[r.site] = r.composite; baseStructBy[r.site] = r.structuralFidelity || 0; const x = (r.composites || []).filter((n) => typeof n === 'number'); noiseBy[r.site] = x.length > 1 ? +(Math.max(...x) - Math.min(...x)).toFixed(3) : 0 }
const baseVideoClone = base.reduce((a, r) => a + (r.videoClone || 0), 0)
log('baseline: corpus total video LANDED on clones = ' + baseVideoClone + ' (expect ~0 — that is the bug)')

phase('Fix')
const PROPOSE_SCHEMA = { type: 'object', additionalProperties: false, properties: { applied: { type: 'boolean' }, selfTestPass: { type: 'boolean' }, resendVideoCloneAfter: { type: 'number' }, ksesSurvives: { type: 'boolean', description: 'did a real <iframe> appear in the resend clone DOM after the fix' }, diffSummary: { type: 'string' }, note: { type: 'string' } }, required: ['applied', 'selfTestPass', 'resendVideoCloneAfter', 'ksesSurvives'] }
const fixPrompt = [
  'You are fixing a LANDING BUG in a website-cloner (' + GRADER + '). The grader counts a video block as a visible <video> OR an <iframe> whose src matches /youtube|vimeo|wistia|loom/ (grade-sections.mjs L57). Today the cloner emits youtube/vimeo/hosted videos as a NATIVE Elementor `video` widget, but that widget LAZY-LOADS on the live frontend (placeholder image + play button; the real <iframe> only appears after a click), so the grader (captures WITHOUT clicking) sees ZERO iframes -> blocksClone.video=0 -> video never lands (confirmed: resend has 4 source videos, clone 0).',
  'FIX (edit ONLY build-absolute.mjs leafWidget() n.kind===\'video\' branch): emit video as an ALWAYS-PRESENT <iframe> inside an `html` widget for ALL providers, NOT the native video widget. Build the embed URL per provider: youtube -> https://www.youtube.com/embed/<id> (parse the id from watch?v= / youtu.be/ / existing /embed/); vimeo -> https://player.vimeo.com/video/<id>; hosted -> <video src="..." controls> (a real <video> tag, which the grader also counts). Wrap in a sized <div> at the captured box; keep absolute positioning (...P). All inline style ATTRS only. This puts a real <iframe>/<video> in the clone DOM at load.',
  'STEP 0: cp build-absolute.mjs /tmp/ev-bk-build.mjs ; cp capture-layout.mjs /tmp/ev-bk-capture.mjs',
  'STEP 1: make the edit. node --check build-absolute.mjs.',
  'STEP 2 — EMPIRICAL LANDING CHECK (the whole point): source /tmp/joist-auth.env ; node capture-ensemble.mjs --source https://resend.com --out /tmp/lf-resend.json --passes 1 ; node build-absolute.mjs --layout /tmp/lf-resend.json --page 2988 ; node grade-sections.mjs --source https://resend.com --clone "' + cloneUrl(2988) + '" --out /tmp/lf-evg ; then read /tmp/lf-evg/sections.json and report blocksClone.video as resendVideoCloneAfter.',
  'STEP 3: if resendVideoCloneAfter is STILL 0 -> the <iframe> was almost certainly kses-STRIPPED from the html widget. Investigate: does the clone DOM (you may fetch ' + cloneUrl(2988) + ') contain ANY <iframe> tag? Set ksesSurvives accordingly. This finding is CRITICAL (it decides whether ANY non-text-editor structural widget can ever land). If it did not land, restore the backup (cp /tmp/ev-bk-build.mjs build-absolute.mjs) and set applied=false.',
  'STEP 4: self-test: node grade-sections.mjs --source https://resend.com --selftest -> must PASS (else restore, applied=false, selfTestPass=false).',
  'Report {applied, selfTestPass, resendVideoCloneAfter, ksesSurvives, diffSummary, note}. Do NOT corpus-grade — the engine does that.',
].join('\n')
const fix = await agent(fixPrompt, { label: 'fix:video-landing', phase: 'Fix', schema: PROPOSE_SCHEMA })

let verdict, finding
if (!fix || !fix.applied || !fix.selfTestPass) {
  finding = 'iframe kses-survives=' + (fix ? fix.ksesSurvives : '?') + '; resendVideoCloneAfter=' + (fix ? fix.resendVideoCloneAfter : '?')
  verdict = 'NO-OP / NOT-APPLIED — video did not land (' + finding + '). ' + (fix && fix.ksesSurvives === false ? 'KSES STRIPS IFRAMES -> non-text-editor structural blocks need a different strategy (Pro widgets that render server-side, or a grader that counts Elementor placeholders symmetrically).' : '') + ' note: ' + (fix ? fix.note : 'no result')
} else {
  phase('Gate')
  const after = await gradeAll('Gate', 'gate')
  const common = new Set(after.map((r) => r.site).filter((s) => base.some((b) => b.site === s)))
  const cAvg = (arr, key) => { const xs = arr.filter((r) => common.has(r.site)); return xs.length ? +(xs.reduce((a, r) => a + (r[key] || 0), 0) / xs.length).toFixed(3) : 0 }
  const baseMeanC = cAvg(base, 'composite'), baseStructC = cAvg(base, 'structuralFidelity')
  const afterMean = cAvg(after, 'composite'), afterStructC = cAvg(after, 'structuralFidelity')
  const afterVideoClone = after.reduce((a, r) => a + (r.videoClone || 0), 0)
  const perSite = after.map((r) => { const tol = Math.min(REG_CAP, Math.max(REG_FLOOR, noiseBy[r.site] || 0)); const delta = +((r.composite || 0) - (baseBy[r.site] || 0)).toFixed(3); return { site: r.site, before: baseBy[r.site], after: r.composite, delta, tol: +tol.toFixed(3), structAfter: r.structuralFidelity || 0 } })
  const regressions = perSite.filter((p) => p.delta < -p.tol)
  phase('Decide')
  const meanUp = afterMean > baseMeanC + EPS
  const structUp = afterStructC > baseStructC + STRUCT_EPS
  const videoLanded = afterVideoClone > baseVideoClone
  const keep = regressions.length === 0 && common.size >= 2 && (videoLanded && (meanUp || structUp))
  if (!keep) {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-build.mjs build-absolute.mjs && cp /tmp/ev-bk-capture.mjs capture-layout.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Decide' })
    verdict = 'REJECTED + RESTORED — video landed on clones ' + baseVideoClone + '->' + afterVideoClone + ' but ' + (regressions.length ? 'regressed: ' + regressions.map((r) => r.site).join(',') : 'no net mean/struct gain (' + baseMeanC + '->' + afterMean + ' / ' + baseStructC + '->' + afterStructC + ')')
  } else {
    verdict = 'KEPT — video LANDS now (clones ' + baseVideoClone + '->' + afterVideoClone + '); mean ' + baseMeanC + '->' + afterMean + ', struct ' + baseStructC + '->' + afterStructC + ', no regression. The always-present-iframe mechanism works -> generalize to other non-text-editor blocks.'
  }
  finding = 'iframe LANDS (ksesSurvives=' + fix.ksesSurvives + '); corpus video clones ' + baseVideoClone + '->' + afterVideoClone
}
log('LANDING-FIX verdict: ' + verdict)
return { verdict, finding, fix }

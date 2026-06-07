export const meta = {
  name: 'bench-text-coverage',
  description: 'BENCH-DRIVEN BUILDER FIX (first use of the deterministic bench): the synthetic bench isolated a real builder bug on KNOWN-GOOD static input — coverage collapses to ~0.32 on text-heavy hero/pricing blocks (no stacked content -> NOT matcher-starvation -> the absolute builder DROPS/MERGES TEXT NODES or mis-places them so the matcher cannot pair). This was masked on live sites by capture variance + the matcher debate; on the bench it is DETERMINISTIC (spread 0) so it can be fixed + verified cleanly. DIAGNOSE-FIRST: trace the text-node flow on bench/hero + pricing — source-HTML text count -> captured leaves -> built widgets -> graded MATCHED pairs — and PIN where coverage collapses (capture drops/merges text / builder omits or mis-geometries text widgets / abs text-editor structure defeats the matcher). FIX the dominant cause (capture-layout OR build-absolute), behind a flag, self-test 1.0. VERIFY on the bench (deterministic). GATE: bench hero+pricing coverage RISES (0.32->higher) + bench mean rises + NO bench regression on other blocks (vs baseline) + self-test 1.0, else auto-restore.',
  phases: [
    { title: 'Diagnose', detail: 'bench hero+pricing: trace source-text -> capture -> build -> matched pairs; pin where coverage collapses (capture vs build vs matcher-geometry)' },
    { title: 'Fix', detail: 'fix the dominant text-drop cause (capture-layout or build-absolute), behind a flag; node --check + selftest 1.0' },
    { title: 'Verify+Gate', detail: 'bench hero+pricing coverage up + bench mean up + no bench regression + self-test 1.0 (deterministic), else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Back up the file you edit FIRST (cp <file> /tmp/ev-bk-<file>-benchtext.mjs) AND VERIFY the backup is clean (grep the change-token == 0). Edit ONLY the ONE file the diagnosis identifies (capture-layout.mjs OR build-absolute.mjs). Do NOT edit grade-sections/perelement. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Use bench/bench-run.mjs for deterministic A/B (spread 0). 422 silent-save w/ tree persisted = ok.'

const DSCHEMA = { type: 'object', additionalProperties: false, properties: {
  heroSrcTextCount: { type: 'number' }, heroCapturedLeaves: { type: 'number' }, heroBuiltTextWidgets: { type: 'number' }, heroMatchedPairs: { type: 'number' },
  collapsePoint: { type: 'string' }, captureDropsText: { type: 'boolean' }, buildOmitsText: { type: 'boolean' }, matcherGeometryFail: { type: 'boolean' },
  fixFile: { type: 'string' }, fixPlan: { type: 'string' }, feasible: { type: 'boolean' },
}, required: ['heroSrcTextCount', 'heroCapturedLeaves', 'heroBuiltTextWidgets', 'heroMatchedPairs', 'collapsePoint', 'fixFile', 'feasible', 'fixPlan'] }
const diag = await agent([HARD.replace('Back up the file you edit FIRST (cp <file> /tmp/ev-bk-<file>-benchtext.mjs) AND VERIFY the backup is clean (grep the change-token == 0). Edit ONLY the ONE file the diagnosis identifies (capture-layout.mjs OR build-absolute.mjs). ', 'DIAGNOSE — read-only, do NOT edit. '),
  'DIAGNOSE the bench text-coverage collapse. Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput. The bench (bench/bench-run.mjs) shows coverage ~0.32 on hero + pricing static text blocks (deterministic, spread 0). On a SIMPLE static text block there is no stacked content -> the collapse is a real builder/capture bug, not matcher-starvation.',
  'TRACE the text-node flow on bench/blocks/hero.html (+ pricing.html): (1) heroSrcTextCount = count the real text runs in the source HTML (headings, paragraphs, buttons). (2) Run capture (the bench serves it on a local port; or replicate: node capture-layout.mjs --source http://localhost:PORT/hero.html) -> heroCapturedLeaves = how many text leaves capture produced. (3) Build (build-absolute) -> heroBuiltTextWidgets = how many text widgets the builder emitted. (4) Grade -> heroMatchedPairs = how many matched pairs + the areaCoverage. WHERE does it collapse: collapsePoint = "capture" (captured << source: capture drops/merges text), "build" (built << captured: builder omits text), or "matcher" (matched << built but the text IS rendered: geometry/box mismatch defeats the matcher, e.g. the abs text-editor wraps text in a box that does not align with the source text box).',
  'captureDropsText / buildOmitsText / matcherGeometryFail (set the dominant one true). fixFile = capture-layout.mjs (if capture drops/merges) OR build-absolute.mjs (if build omits or mis-geometries the text widget box so the matcher fails). fixPlan = the precise fix. feasible = true iff the collapse is a fixable capture/build bug (not a grader-matcher issue out of scope).',
  'Return {heroSrcTextCount, heroCapturedLeaves, heroBuiltTextWidgets, heroMatchedPairs, collapsePoint, captureDropsText, buildOmitsText, matcherGeometryFail, fixFile, fixPlan, feasible}.',
].join('\n'), { label: 'diagnose:bench-text', phase: 'Diagnose', schema: DSCHEMA })
log('DIAG: hero src=' + (diag&&diag.heroSrcTextCount) + ' captured=' + (diag&&diag.heroCapturedLeaves) + ' built=' + (diag&&diag.heroBuiltTextWidgets) + ' matched=' + (diag&&diag.heroMatchedPairs) + ' collapse=' + (diag&&diag.collapsePoint) + ' fixFile=' + (diag&&diag.fixFile) + ' feasible=' + (diag&&diag.feasible))

let impl = null, verify = null
if (diag && diag.feasible) {
  phase('Fix')
  const FILE = /capture/.test(diag.fixFile) ? 'capture-layout.mjs' : 'build-absolute.mjs'
  const FLAG = /capture/.test(FILE) ? 'NO_BENCHTEXT_CAP' : 'NO_BENCHTEXT_BUILD'
  impl = await agent([HARD,
    'FIX the bench text-coverage collapse. Work in ' + GRADER + '. Edit ' + FILE + '. collapsePoint=' + diag.collapsePoint + ' (captureDropsText=' + diag.captureDropsText + ' buildOmitsText=' + diag.buildOmitsText + ' matcherGeometryFail=' + diag.matcherGeometryFail + '). hero: src=' + diag.heroSrcTextCount + ' captured=' + diag.heroCapturedLeaves + ' built=' + diag.heroBuiltTextWidgets + ' matched=' + diag.heroMatchedPairs + '. fixPlan: ' + String(diag.fixPlan||'').slice(0,450),
    'Implement the fixPlan precisely. If capture drops/merges text -> stop dropping/merging real text runs. If build omits text -> emit the missing text widgets. If matcher-geometry-fail (the text IS built+rendered but its box does not align with the source text box) -> fix the abs text widget box/geometry so it matches the source text box (the abs builder may be sizing the text-editor wrapper to a different box than the captured text). PRESERVE recipes #20-28 + the kept fixes. Do NOT regress other bench blocks.',
    'REVERSIBILITY: gate behind ' + FLAG + '=1. node --check. SELFTEST: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0. STEP 0: cp ' + FILE + ' /tmp/ev-bk-' + FILE.replace(/\..*/,'') + '-benchtext.mjs (verify clean backup). SMOKE: run node bench/bench-run.mjs -> hero+pricing coverage should RISE from ~0.32 + bench mean rise + NO other block regress (vs bench/baseline.json). If node --check / self-test fails -> restore + RESTORED.',
    'Return "OK:" with the bench per-block coverage+composite before->after (hero, pricing, + the others to show no-reg) + bench mean before->after, or "RESTORED:".',
  ].join('\n'), { label: 'fix:bench-text', phase: 'Fix' })
  log('IMPL: ' + String(impl || '').slice(0, 280))

  const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
  if (okImpl) {
    phase('Verify+Gate')
    const FLAG2 = FLAG
    const VS = { type: 'object', additionalProperties: false, properties: {
      heroCovOff: { type: 'number' }, heroCovOn: { type: 'number' }, pricingCovOff: { type: 'number' }, pricingCovOn: { type: 'number' },
      benchMeanOff: { type: 'number' }, benchMeanOn: { type: 'number' }, anyBlockRegressed: { type: 'boolean' }, selftest: { type: 'number' }, deterministic: { type: 'boolean' }, ok: { type: 'boolean' }, verdict: { type: 'string' },
    }, required: ['heroCovOff', 'heroCovOn', 'benchMeanOff', 'benchMeanOn', 'anyBlockRegressed', 'selftest', 'ok', 'verdict'] }
    verify = await agent([HARD.replace('Back up the file you edit FIRST', 'VERIFY ONLY — do NOT edit (run the bench)'),
      'INDEPENDENTLY VERIFY the bench text-coverage fix. Work in ' + GRADER + '. ' + AUTH + '. Prior: ' + String(impl||'').slice(0,250) + '. Flag ' + FLAG2 + '=1 disables. You MUST end by calling StructuredOutput.',
      'Run node bench/bench-run.mjs with the fix ON (default) and with ' + FLAG2 + '=1 (OFF). heroCovOff/On, pricingCovOff/On, benchMeanOff/On. anyBlockRegressed = did any OTHER block (nav/card-grid/feature-image/footer) drop composite >0.01 vs OFF? selftest = grade-sections --source supabase --selftest (1.0). deterministic = is the bench spread still ~0 with the fix? ok = heroCovOn>heroCovOff+0.05 AND benchMeanOn>=benchMeanOff AND !anyBlockRegressed AND selftest==1.0. Return all fields + verdict.',
    ].join('\n'), { label: 'verify:bench-text', phase: 'Verify+Gate', schema: VS })
    log('VERIFY: heroCov ' + (verify&&verify.heroCovOff) + '->' + (verify&&verify.heroCovOn) + ' benchMean ' + (verify&&verify.benchMeanOff) + '->' + (verify&&verify.benchMeanOn) + ' anyReg=' + (verify&&verify.anyBlockRegressed) + ' selftest=' + (verify&&verify.selftest) + ' ok=' + (verify&&verify.ok))
  }
}

phase('Verify+Gate')
let verdict
if (!diag || !diag.feasible) {
  verdict = 'NOT BUILT — diagnosis: text-coverage collapse not a fixable capture/build bug. collapse=' + (diag&&diag.collapsePoint) + ' matcherGeometryFail=' + (diag&&diag.matcherGeometryFail) + '. ' + String(diag&&diag.fixPlan||'').slice(0,200)
} else if (!impl || !/\bOK:/i.test(String(impl)) || /\bRESTORED:/i.test(String(impl))) {
  verdict = 'REVERTED — fix failed/self-test: ' + String(impl||'').slice(0,200)
} else if (verify && verify.ok) {
  verdict = 'ADOPTED — bench-driven text-coverage fix: hero coverage ' + verify.heroCovOff + '->' + verify.heroCovOn + ', pricing ' + verify.pricingCovOff + '->' + verify.pricingCovOn + ', bench mean ' + verify.benchMeanOff + '->' + verify.benchMeanOn + '; no bench regression; self-test 1.0; deterministic. First bench-isolated builder bug FIXED (collapse at ' + diag.collapsePoint + '). This text-drop fix is corpus-wide (every text-heavy clone). Reversible. Re-baseline live corpus.'
} else {
  const FILE = /capture/.test(diag.fixFile) ? 'capture-layout.mjs' : 'build-absolute.mjs'
  await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-' + FILE.replace(/\..*/,'') + '-benchtext.mjs ' + FILE + ' && node --check ' + FILE + ' && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Verify+Gate' })
  verdict = 'REVERTED — bench gate not met: ' + JSON.stringify(verify || {}).slice(0, 280)
}
log('BENCH-TEXT-COVERAGE: ' + verdict)
return { verdict, diag, impl: String(impl||'').slice(0,400), verify }

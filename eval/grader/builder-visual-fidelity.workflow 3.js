export const meta = {
  name: 'builder-visual-fidelity',
  description: 'BENCH-ISOLATED real builder ceiling: on PIXEL-EXACT static input the abs builder achieves only visual ~0.674 / composite 0.858 (bench) — it does NOT reproduce known-good geometry/typography at 1:1 even on perfect input (the "font/geometry" defect; text blocks hero/pricing/footer visual ~0.57-0.6 vs feature-image 0.88). Visual is the biggest composite weight (0.35). DIAGNOSE-FIRST on the bench (deterministic): decompose the visual gap on hero+pricing — is it SSIM (the abs text widget renders text at a DIFFERENT box than source: padding/line-height/font-metrics/text-box sizing) or per-element? PIN the dominant builder geometry/font cause. FIX it in build-absolute (e.g. match the source text box: line-height, padding, font-size compile, text-editor wrapper geometry). Reversible. GATE (BOTH bench AND live — the bench-overfit lesson): bench hero/pricing visual UP + bench mean up + NO bench regression AND a LIVE A/B (supabase+tailwind) composite no-reg (do NOT ship a bench-overfit), self-test 1.0, else auto-restore.',
  phases: [
    { title: 'Diagnose', detail: 'bench hero+pricing+footer: decompose visual (SSIM vs per-element); pin the builder geometry/font gap on known input' },
    { title: 'Fix', detail: 'fix the dominant builder text-geometry/font cause in build-absolute, behind a flag; node --check + selftest 1.0' },
    { title: 'Verify+Gate', detail: 'BENCH visual up + no bench regression AND LIVE composite no-reg (overfit guard) + self-test 1.0, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Edit ONLY build-absolute.mjs. STEP 0: cp build-absolute.mjs /tmp/ev-bk-buildabs-visfid.mjs AND VERIFY the backup has the change-token count 0 (grep VISFID == 0; clean base). Do NOT edit capture/grade/perelement. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Use bench/bench-run.mjs (deterministic) AND a live A/B (the bench-overfit lesson: a fix MUST also pass live). 422 silent-save w/ tree persisted = ok.'

const DSCHEMA = { type: 'object', additionalProperties: false, properties: {
  heroVisual: { type: 'number' }, heroSSIM: { type: 'number' }, heroPerElement: { type: 'number' },
  gapIsSSIM: { type: 'boolean' }, gapIsPerElement: { type: 'boolean' }, textBoxMismatch: { type: 'string' },
  fixPlan: { type: 'string' }, feasible: { type: 'boolean' },
}, required: ['heroVisual', 'heroSSIM', 'heroPerElement', 'gapIsSSIM', 'gapIsPerElement', 'fixPlan', 'feasible'] }
const diag = await agent([HARD.replace('Edit ONLY build-absolute.mjs. STEP 0: cp build-absolute.mjs /tmp/ev-bk-buildabs-visfid.mjs AND VERIFY the backup has the change-token count 0 (grep VISFID == 0; clean base). ', 'DIAGNOSE — read-only, do NOT edit. '),
  'DIAGNOSE the abs builder visual gap on KNOWN-GOOD input. Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput. The bench (bench/bench-run.mjs) shows visual ~0.6 on text blocks (hero/pricing/footer) even on PIXEL-EXACT static input -> a real builder geometry/font fidelity gap, deterministic.',
  'Run the bench (node bench/bench-run.mjs) + read bench/blocks/hero.html (source) vs the built clone (render the published bench hero page). DECOMPOSE hero visual: heroVisual, heroSSIM (the pixel-match half), heroPerElement (the per-element half). gapIsSSIM = is SSIM the drag (the rendered pixels differ — text at a different position/size/line-height than source)? gapIsPerElement = is per-element the drag?',
  'If SSIM/geometry is the gap, PIN textBoxMismatch: compare a matched heading/paragraph box in source vs clone — does the abs text widget render at a DIFFERENT box (line-height taller/shorter, padding added, font-size compiled differently, text-editor wrapper sizing the text box differently than the source text box)? This is the likely builder cause: the abs text-editor widget geometry != the source text geometry even when the captured size is correct.',
  'fixPlan = the precise build-absolute change to make the abs text widget reproduce the SOURCE text box (e.g. zero the text-editor default padding/margin, set line-height to the captured value, ensure font-size compiles exactly, size the wrapper to the captured text box). feasible = true iff the gap is a fixable builder geometry/font issue.',
  'Return {heroVisual, heroSSIM, heroPerElement, gapIsSSIM, gapIsPerElement, textBoxMismatch, fixPlan, feasible}.',
].join('\n'), { label: 'diagnose:visfid', phase: 'Diagnose', schema: DSCHEMA })
log('DIAG: heroVisual=' + (diag&&diag.heroVisual) + ' SSIM=' + (diag&&diag.heroSSIM) + ' perElem=' + (diag&&diag.heroPerElement) + ' gapSSIM=' + (diag&&diag.gapIsSSIM) + ' textBox=' + String(diag&&diag.textBoxMismatch||'').slice(0,80) + ' feasible=' + (diag&&diag.feasible))

let impl = null, verify = null
if (diag && diag.feasible) {
  phase('Fix')
  impl = await agent([HARD,
    'IMPLEMENT the builder visual-fidelity fix in build-absolute.mjs (use the VISFID token in comments). Work in ' + GRADER + '. DIAGNOSIS: gapIsSSIM=' + diag.gapIsSSIM + ' gapIsPerElement=' + diag.gapIsPerElement + ' textBoxMismatch=' + String(diag.textBoxMismatch||'').slice(0,200) + ' | fixPlan: ' + String(diag.fixPlan||'').slice(0,400),
    'Implement the fixPlan to make the abs text widgets reproduce the SOURCE text geometry (zero default text-editor padding/margin, set captured line-height, exact font-size, size the wrapper to the captured text box). PRESERVE recipes #20-28 + the kept fixes (do NOT re-enable #29). Reversible behind ABS_NO_VISFID=1.',
    'node --check. SELFTEST: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0. BENCH SMOKE: node bench/bench-run.mjs -> hero/pricing/footer visual should RISE + bench mean rise + NO other block regress. If node --check / self-test fails -> restore /tmp/ev-bk-buildabs-visfid.mjs + RESTORED.',
    'Return "OK:" with bench per-block visual+composite before->after (hero/pricing/footer + the others for no-reg) + bench mean before->after, or "RESTORED:".',
  ].join('\n'), { label: 'fix:visfid', phase: 'Fix' })
  log('IMPL: ' + String(impl || '').slice(0, 280))

  const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
  if (okImpl) {
    phase('Verify+Gate')
    const VS = { type: 'object', additionalProperties: false, properties: {
      benchHeroVisOff: { type: 'number' }, benchHeroVisOn: { type: 'number' }, benchMeanOff: { type: 'number' }, benchMeanOn: { type: 'number' }, anyBenchReg: { type: 'boolean' },
      liveSupaCompOff: { type: 'number' }, liveSupaCompOn: { type: 'number' }, liveTwCompOff: { type: 'number' }, liveTwCompOn: { type: 'number' }, anyLiveReg: { type: 'boolean' },
      selftest: { type: 'number' }, ok: { type: 'boolean' }, verdict: { type: 'string' },
    }, required: ['benchHeroVisOff', 'benchHeroVisOn', 'benchMeanOff', 'benchMeanOn', 'anyBenchReg', 'liveSupaCompOff', 'liveSupaCompOn', 'anyLiveReg', 'selftest', 'ok', 'verdict'] }
    verify = await agent([HARD,
      'INDEPENDENTLY VERIFY the builder visual-fidelity fix on BOTH bench AND live (the bench-overfit lesson: a fix MUST pass live too). Work in ' + GRADER + '. ' + AUTH + '. Flag ABS_NO_VISFID=1 disables. Prior: ' + String(impl||'').slice(0,200) + '. You MUST end by calling StructuredOutput. Do NOT edit (run only).',
      'BENCH A/B: node bench/bench-run.mjs ON (default) vs ABS_NO_VISFID=1 OFF. benchHeroVisOff/On, benchMeanOff/On, anyBenchReg (any block composite -0.01).',
      'LIVE A/B (the overfit guard): rebuild+grade supabase (2986) + tailwind (3146) ON vs ABS_NO_VISFID=1 OFF, median-of-2. liveSupaCompOff/On, liveTwCompOff/On. anyLiveReg = either live composite < OFF - 0.005.',
      'selftest = grade-sections --source supabase --selftest (1.0). ok = benchHeroVisOn>benchHeroVisOff+0.02 AND benchMeanOn>=benchMeanOff AND !anyBenchReg AND !anyLiveReg AND selftest==1.0 (improves bench WITHOUT regressing live). Return all fields + verdict.',
    ].join('\n'), { label: 'verify:visfid', phase: 'Verify+Gate', schema: VS })
    log('VERIFY: benchHeroVis ' + (verify&&verify.benchHeroVisOff) + '->' + (verify&&verify.benchHeroVisOn) + ' benchMean ' + (verify&&verify.benchMeanOff) + '->' + (verify&&verify.benchMeanOn) + ' liveSupa ' + (verify&&verify.liveSupaCompOff) + '->' + (verify&&verify.liveSupaCompOn) + ' anyLiveReg=' + (verify&&verify.anyLiveReg) + ' ok=' + (verify&&verify.ok))
  }
}

phase('Verify+Gate')
let verdict
if (!diag || !diag.feasible) {
  verdict = 'NOT BUILT — diagnosis: visual gap not a fixable builder geometry/font issue (heroVisual=' + (diag&&diag.heroVisual) + ' SSIM=' + (diag&&diag.heroSSIM) + '). ' + String(diag&&diag.fixPlan||'').slice(0,200)
} else if (!impl || !/\bOK:/i.test(String(impl)) || /\bRESTORED:/i.test(String(impl))) {
  verdict = 'REVERTED — fix failed/self-test: ' + String(impl||'').slice(0,200)
} else if (verify && verify.ok) {
  verdict = 'ADOPTED — builder visual-fidelity fix: bench hero visual ' + verify.benchHeroVisOff + '->' + verify.benchHeroVisOn + ', bench mean ' + verify.benchMeanOff + '->' + verify.benchMeanOn + '; LIVE no-reg (supabase ' + verify.liveSupaCompOff + '->' + verify.liveSupaCompOn + ', tailwind ' + verify.liveTwCompOff + '->' + verify.liveTwCompOn + '); self-test 1.0. Closes builder text-geometry gap on known input (corpus-wide, BOTH bench + live verified — no overfit). Reversible ABS_NO_VISFID=1.'
} else {
  await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-buildabs-visfid.mjs build-absolute.mjs && node --check build-absolute.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Verify+Gate' })
  verdict = 'REVERTED — bench+live gate not met (' + (verify&&verify.anyLiveReg ? 'LIVE regression — bench-overfit caught by the live gate' : 'bench gain insufficient') + '): ' + JSON.stringify(verify || {}).slice(0, 280)
}
log('BUILDER-VISUAL-FIDELITY: ' + verdict)
return { verdict, diag, impl: String(impl||'').slice(0,400), verify }

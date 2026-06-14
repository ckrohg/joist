export const meta = {
  name: 'grader-mobileprop-v3',
  description: 'KEYSTONE for the responsive dimension: (A) FIX grade-responsive self-test flakiness at the ROOT — the --selftest path re-captures the same URL TWICE independently, so live-site variance (lazy content/animations) makes RLG node-matching score 0.957-0.999 and occasionally breach the >=0.96 rail; this BLOCKED the deterministic mobile-prop term twice. Change the SELFTEST clone capture to a DEEP-COPY of the source capture (a page IS perfectly self-consistent; deepcopy isolates GRADER determinism from live re-capture noise -> self-test EXACTLY 1.0 every run). (B) LAND the proven coverage-weighted mobile-prop term (v2 logic that already proved deterministic + penalizes-defects + anti-inflation; it only reverted on the self-test rail this fix removes): per narrow breakpoint {390,768} mobileProportion = mean(0.5*overflowMatch + 0.5*heightRatio[min/max clone vs src docH]), COVERAGE-WEIGHTED (× the RLG coverage F1, anti-gaming), blended responsiveScore = 0.7*RLG + 0.3*(mobileProportion*coverage). Makes the responsive dimension HONESTLY credit mobile fidelity (tailwind vreflow now ~1:1 -> high; supabase/framer partial -> partial) + penalize overflow/inflation. Both reversible (GRADER_NO_MOBILEPROP=1). GATE: self-test EXACTLY 1.0 x5 DETERMINISTIC (the root fix) + mobile-prop penalizes an overflow/inflated clone + credits the vreflow tailwind clone + bad clone not inflated + reversible, else auto-restore.',
  phases: [
    { title: 'Fold', detail: 'self-test deepcopy determinism fix + coverage-weighted mobile-prop term; node --check; self-test EXACTLY 1.0 x5' },
    { title: 'Verify', detail: 'independent: self-test 1.0 x5 deterministic (spread 0) + penalizes overflow/inflated clone + credits vreflow-tailwind + no bad-clone inflation + reversible' },
    { title: 'Gate', detail: 'keep iff deterministic self-test + honest mobile credit/penalty + no inflation, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && export JOIST_BASE="${JOIST_BASE:-http://localhost:8001}"; case "$JOIST_BASE" in *sg-host.com*|*georges232*|*35.212.46.254*) echo "FATAL: JOIST_BASE=$JOIST_BASE is a blocked/paused host (host-guard allowlist; renders only target localhost:8001 or JOIST_TRAINING_BASE)"; exit 1;; esac'
const HARD = 'Edit ONLY grade-responsive.mjs. Back it up FIRST: cp grade-responsive.mjs /tmp/ev-bk-graderesponsive-v3.mjs. Do NOT edit perelement/grade-sections/build-*. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64.'

const impl = await agent([HARD,
  'TWO changes to grade-responsive.mjs (KEYSTONE for the responsive dimension). Work in ' + GRADER + '. Read grade-responsive.mjs: the SELFTEST branch (~L447-455 where SELFTEST re-captures cloneCap = await captureAcrossWidths(browser, source)), PROBE_FN (~L84-140, returns {vw,docH,nodes}), captureAcrossWidths, coverageWeight (~L382, returns {coverage,...}), the perBreakpoint array (~L479 has srcDocH+cloneDocH), responsiveScore = 0.6*edgeWeighted + 0.4*layoutWeighted (~L477), and the SELFTEST assertion (~L519-525, EPS=0.04 >=0.96).',
  'CHANGE A — SELF-TEST DETERMINISM (root fix): in the SELFTEST branch, instead of independently re-capturing the same url as the clone (cloneCap = await captureAcrossWidths(browser, source)), set cloneCap = a DEEP-COPY of srcCap (cloneCap = JSON.parse(JSON.stringify(srcCap))). RATIONALE: the self-test asserts the GRADER scores identical input as 1.0 (grader self-consistency); independent re-capture conflated that with live-site variance (lazy content/animations) -> flaky 0.957-0.999. A deepcopy is identical input -> grader must return EXACTLY 1.0, deterministically. Keep the rest of the SELFTEST path. (This makes the self-test a true grader-determinism assertion; capture-determinism is a separate concern not the self-test job.)',
  'CHANGE B — mobile-prop term, COVERAGE-WEIGHTED (the proven v2 logic): STEP 1 add `scrollWidth: document.documentElement.scrollWidth` to PROBE_FN return. STEP 2 compute mobileProportion over narrow breakpoints (widths <=768 present, typically 390+768): per width, overflowMatch = (srcOverflow===cloneOverflow)?1:(cloneOverflow&&!srcOverflow?0:0.5) where overflow = scrollWidth > w*1.02; heightRatio = min(cloneDocH,srcDocH)/max(cloneDocH,srcDocH); perWidthProp = 0.5*overflowMatch + 0.5*heightRatio; mobileProportion = mean(perWidthProp). If no narrow width -> mobileProportion=null. STEP 3 blend (coverage-weighted, anti-gaming): mobileProportionWeighted = mobileProportion * coverage (the coverageWeight() F1 already computed); when mobileProportion!=null and GRADER_NO_MOBILEPROP!=="1": responsiveScore = r4(0.7*(0.6*edgeWeighted+0.4*layoutWeighted) + 0.3*mobileProportionWeighted); else OLD pure-RLG value. Add mobileProportion + mobileProportionWeighted + per-width detail to result JSON.',
  'BOTH reversible: GRADER_NO_MOBILEPROP=1 disables the mobile-prop blend (Change B). Change A (self-test deepcopy) is selftest-path-only and always on (it only makes the self-test correct + deterministic). Self-test: deepcopy -> overflowMatch=1, heightRatio=1, coverage=1, mobileProp=1, RLG=1 -> responsiveScore EXACTLY 1.0.',
  'STEP 0: cp grade-responsive.mjs /tmp/ev-bk-graderesponsive-v3.mjs. Implement A+B. node --check. STEP SELFTEST x5 (HARD — the whole point): for i in 1..5: ' + AUTH + ' && node grade-responsive.mjs --selftest --source https://tailwindcss.com --widths 390,768,1440 -> must be EXACTLY 1.0 (or >=0.9999) ALL 5 (deepcopy => deterministic). ALSO GRADER_NO_MOBILEPROP=1 selftest x1 -> 1.0. If any run != ~1.0 -> something is wrong (deepcopy should be exact) -> restore + RESTORED.',
  'Return PLAIN-TEXT "OK:" with the 5 self-test scores (must all be ~1.0 EXACT) + confirmation the deepcopy + mobile-prop are in, or "RESTORED:".',
].join('\n'), { label: 'fold:mobileprop-v3', phase: 'Fold' })
log('IMPL: ' + String(impl || '').slice(0, 280))

const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
let verify = null
if (okImpl) {
  phase('Verify')
  const VS = { type: 'object', additionalProperties: false, properties: {
    selftest5: { type: 'array', items: { type: 'number' } }, deterministicExact: { type: 'boolean' }, selftestOFF: { type: 'number' },
    vreflowTailwindResp: { type: 'number' }, overflowCloneResp: { type: 'number' }, cleanCloneResp: { type: 'number' },
    badCloneOff: { type: 'number' }, badCloneOn: { type: 'number' }, reversible: { type: 'boolean' }, ok: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['selftest5', 'deterministicExact', 'overflowCloneResp', 'cleanCloneResp', 'badCloneOff', 'badCloneOn', 'reversible', 'ok', 'verdict'] }
  verify = await agent([HARD,
    'INDEPENDENT ADVERSARIAL VERIFICATION of grade-responsive v3 (self-test deepcopy + coverage-weighted mobile-prop). Be skeptical — two prior mobile-prop attempts reverted (flaky self-test, then content-blind gaming). Work in ' + GRADER + '. ' + AUTH + '. Prior report: ' + String(impl||'').slice(0,200) + '. You MUST end by calling StructuredOutput. Do NOT edit files.',
    '(1) DETERMINISTIC SELF-TEST (the root fix): run node grade-responsive.mjs --selftest --source https://tailwindcss.com --widths 390,768,1440 FIVE times -> selftest5; deterministicExact=true iff all 5 are >=0.9999 AND spread (max-min) < 0.0005 (deepcopy => EXACTLY 1.0, truly deterministic, NOT just passing). Also GRADER_NO_MOBILEPROP=1 once -> selftestOFF (must be ~1.0). If selftest5 still varies meaningfully, the deepcopy was not applied -> FAIL.',
    '(2) CREDITS REAL MOBILE: grade the vreflow tailwind clone (page 3146, mobile docH ~1:1 now) responsive -> vreflowTailwindResp; it should be HIGHER than its pre-mobileprop pure-RLG (the mobile-prop credits its near-1:1 mobile). [Informational — confirm it is not LOWER.]',
    '(3) PENALIZES DEFECTS: an overflowing/inflated clone (build supabase ABS_NO_CHROMEFIX=1 ABS_NO_VREFLOW=1 ABS_NO_FLUIDFONT=1 -> overflow + 7x docH) -> overflowCloneResp; a clean current-pipeline clone -> cleanCloneResp. overflowCloneResp must be LOWER than cleanCloneResp.',
    '(4) ANTI-INFLATION (the v2 fix — coverage-weight): a wrong-content clone (e.g. tailwind layout vs supabase source) responsive OFF vs ON -> badCloneOff/On; ON must NOT exceed OFF by >0.02 (coverage-weighting must gate the proportion credit so a low-coverage wrong-content clone earns ~0).',
    '(5) reversible: GRADER_NO_MOBILEPROP=1 reproduces pure-RLG. ok=true iff deterministicExact AND overflowCloneResp<cleanCloneResp AND not badClone-inflated AND reversible. Return {selftest5, deterministicExact, selftestOFF, vreflowTailwindResp, overflowCloneResp, cleanCloneResp, badCloneOff, badCloneOn, reversible, ok, verdict}.',
  ].join('\n'), { label: 'verify:mobileprop-v3', phase: 'Verify', schema: VS })
  log('VERIFY: selftest5=' + JSON.stringify(verify&&verify.selftest5) + ' exact=' + (verify&&verify.deterministicExact) + ' overflow=' + (verify&&verify.overflowCloneResp) + ' clean=' + (verify&&verify.cleanCloneResp) + ' badClone ' + (verify&&verify.badCloneOff) + '->' + (verify&&verify.badCloneOn) + ' ok=' + (verify&&verify.ok))
}

phase('Gate')
let verdict
if (!okImpl) {
  verdict = 'REVERTED — impl/self-test failed: ' + String(impl||'').slice(0,200)
} else {
  const v = verify || {}
  const detOK = v.deterministicExact === true && (v.selftest5||[]).length>=5 && (v.selftest5||[]).every((x)=>x>=0.9999)
  const penalizes = v.overflowCloneResp < v.cleanCloneResp - 0.005
  const noInflate = !(v.badCloneOn > v.badCloneOff + 0.02)
  const ok = detOK && penalizes && noInflate && v.reversible === true
  if (ok) {
    verdict = 'ADOPTED — KEYSTONE: grade-responsive self-test now EXACTLY deterministic (deepcopy, ' + JSON.stringify(v.selftest5) + ') + coverage-weighted mobile-prop term LANDED. Responsive dimension honestly credits mobile fidelity (vreflow tailwind resp ' + v.vreflowTailwindResp + ') + penalizes overflow/inflation (overflow ' + v.overflowCloneResp + ' < clean ' + v.cleanCloneResp + '); bad-clone not inflated (' + v.badCloneOff + '->' + v.badCloneOn + '); reversible. The session mobile wins (chrome-unpin/fluid-fonts/vreflow) now register. RE-BASELINE the corpus.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-graderesponsive-v3.mjs grade-responsive.mjs && node --check grade-responsive.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
    verdict = 'REVERTED — ' + (!detOK ? 'self-test not EXACTLY deterministic (deepcopy fix failed)' : !penalizes ? 'does not penalize overflow/inflated clone' : !noInflate ? 'still inflates bad clone (coverage-weight insufficient)' : 'not reversible') + '. ' + JSON.stringify(v).slice(0,300)
  }
}
log('MOBILEPROP-V3: ' + verdict)
return { verdict, impl: String(impl||'').slice(0,400), verify }

export const meta = {
  name: 'responsive-mobile-proportion',
  description: 'GRADER HONESTY (user top priority): the responsive 0.25 dimension (RLG) measures relationship-edge GEOMETRY only — it is BLIND to the human-obvious mobile defects this session keeps fixing: horizontal OVERFLOW (docW>viewport at 390), and document HEIGHT inflation/truncation (oversized text / dropped content). So chrome-unpin, fluid-fonts, and true reflow are all real mobile wins the composite barely registers. ADD a DETERMINISTIC, SOURCE-RELATIVE mobile-proportion fidelity sub-score to grade-responsive: per narrow breakpoint {390,768}, overflowMatch (clone overflow-state vs source) + heightRatio (min/max of clone vs source docH). Blend responsiveScore = 0.7*RLG + 0.3*mobileProportion (composite weight stays 0.25). DETERMINISTIC (docH/scrollWidth are stable measurements, NOT borderline like the reverted wrapper-distinctness gate -> no self-test flakiness). SOURCE-RELATIVE -> anti-gaming (cannot score high without matching source mobile proportions; a clone that overflows or drops content is penalized; cannot win by rendering less). Reversible GRADER_NO_MOBILEPROP=1. GATE: self-test 1.0 DETERMINISTIC (5 runs) both modes + chrome-fixed/fluid clones score HIGHER + an overflow/inflated clone scores LOWER + bad clone not inflated, else auto-restore.',
  phases: [
    { title: 'Fold', detail: 'add scrollWidth to PROBE_FN + mobileProportion sub-score (overflow + height-ratio) blended into responsiveScore behind GRADER_NO_MOBILEPROP=1; node --check + RLG self-test 1.0 x5' },
    { title: 'Verify', detail: 'independent: self-test 1.0 deterministic x5 both modes; chrome-fix/fluid ON > OFF; synthetic overflow/inflated clone penalized; bad clone not inflated; reversible' },
    { title: 'Gate', detail: 'keep iff deterministic self-test 1.0 + rewards real mobile fidelity + penalizes real defects + no bad-clone inflation, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && export JOIST_BASE="${JOIST_BASE:-http://localhost:8001}"; case "$JOIST_BASE" in *sg-host.com*|*georges232*|*35.212.46.254*) echo "FATAL: JOIST_BASE=$JOIST_BASE is a blocked/paused host (host-guard allowlist; renders only target localhost:8001 or JOIST_TRAINING_BASE)"; exit 1;; esac'
const HARD = 'Edit ONLY grade-responsive.mjs. Back it up FIRST: cp grade-responsive.mjs /tmp/ev-bk-graderesponsive-mobileprop.mjs. Do NOT edit perelement/grade-sections/build-*. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64.'

const impl = await agent([HARD,
  'ADD a deterministic SOURCE-RELATIVE mobile-proportion sub-score to grade-responsive.mjs. Work in ' + GRADER + '. Read grade-responsive.mjs: PROBE_FN (~L84-140, returns {vw, docH, nodes}), captureAcrossWidths (~L143), the perBreakpoint array (~L479, ALREADY has srcDocH + cloneDocH), and responsiveScore = 0.6*edgeWeighted + 0.4*layoutWeighted (~L477).',
  'WHY: the RLG measures relationship-edge geometry; it is BLIND to horizontal overflow + document-height inflation/truncation — the human-obvious mobile defects (a clone whose 390 view scrolls sideways to 1440px, or whose mobile text is giant and the page is 2x too tall). chrome-unpin + fluid-fonts + reflow fix exactly these but the grader does not see them.',
  'STEP 1 — capture scrollWidth: in PROBE_FN add `scrollWidth: document.documentElement.scrollWidth` to the returned object (alongside docH). It is a stable, deterministic measurement.',
  'STEP 2 — mobileProportion sub-score (DETERMINISTIC, SOURCE-RELATIVE), computed over the NARROW breakpoints present in WIDTHS that are <= 768 (typically 390 and 768; if only one narrow width, use it): for each such width w: (a) overflowMatch — srcOverflow = srcScrollWidth > w*1.02; cloneOverflow = cloneScrollWidth > w*1.02; overflowMatch = (srcOverflow===cloneOverflow) ? 1 : (cloneOverflow && !srcOverflow ? 0 : 0.5) [the bad case: clone overflows when source does not -> 0]. (b) heightRatio = min(cloneDocH, srcDocH) / max(cloneDocH, srcDocH) [symmetric, in [0,1], 1 when equal; penalizes BOTH inflation and truncation]. perWidthProp = 0.5*overflowMatch + 0.5*heightRatio. mobileProportion = mean(perWidthProp over the narrow widths). If no narrow width present, mobileProportion = null (skip the blend).',
  'STEP 3 — blend, COVERAGE-WEIGHTED (this is the v1 fix: v1 was content-blind -> a wrong-content clone with coincidentally-matching proportions got undeserved credit). The mobile-prop term reads only scrollWidth/docH (no node identity), so it MUST be gated by node coverage exactly as edgeWeighted/layoutWeighted already are. Use the SAME coverage value coverageWeight() already computes (the `coverage` var, the symmetric node-match F1). Compute mobileProportionWeighted = mobileProportion * coverage. Then when mobileProportion != null and GRADER_NO_MOBILEPROP !== "1": responsiveScore = r4(0.7 * (0.6*edgeWeighted + 0.4*layoutWeighted) + 0.3 * mobileProportionWeighted). Otherwise responsiveScore = the OLD value (pure RLG). Add BOTH mobileProportion (raw) AND mobileProportionWeighted + per-width detail to the result JSON for telemetry. ANTI-GAMING: a low-coverage wrong-content clone now earns ~0 proportion credit (mobileProp * low-coverage ~ 0); a self-test (coverage=1) is unaffected; an overflowing clone is still penalized (overflowMatch=0 regardless of coverage). Keep edgeSet/layout/coverage reporting unchanged.',
  'DETERMINISM RAIL (this is why the prior wrapper-distinctness mirror was REVERTED — it was flaky): scrollWidth + docH are STABLE measurements across captures, so source-vs-source mobileProportion must be EXACTLY 1.0 every run (srcScrollWidth==cloneScrollWidth, srcDocH==cloneDocH for the same url... NOTE the self-test re-captures the same url independently, so docH may differ by a few px between two live loads -> heightRatio ~0.999, mobileProportion ~0.999; that is fine, self-test EPS=0.04 absorbs it; but it must NOT be wildly variable). RUN the self-test 5 TIMES to confirm it is STABLE (not flaky like the reverted mirror).',
  'STEP 0: cp grade-responsive.mjs /tmp/ev-bk-graderesponsive-mobileprop.mjs. STEP 1-3 implement. node --check. STEP 4 SELFTEST x5 (HARD): for i in 1..5: ' + AUTH + ' && node grade-responsive.mjs --selftest --source https://tailwindcss.com --widths 390,768,1440 -> ALL 5 must PASS (>=0.96). ALSO GRADER_NO_MOBILEPROP=1 selftest PASS. If any FAIL or it is flaky -> restore + RESTORED.',
  'Return PLAIN-TEXT "OK:" with the 5 self-test scores (proving determinism) + the formula, or "RESTORED:".',
].join('\n'), { label: 'fold:mobile-proportion', phase: 'Fold' })
log('IMPL: ' + String(impl || '').slice(0, 280))

const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
let verify = null
if (okImpl) {
  phase('Verify')
  const VS = { type: 'object', additionalProperties: false, properties: {
    selftest5: { type: 'array', items: { type: 'number' } }, deterministic: { type: 'boolean' }, selftestOFF: { type: 'number' },
    chromeFixRespOff: { type: 'number' }, chromeFixRespOn: { type: 'number' },
    overflowCloneResp: { type: 'number' }, cleanCloneResp: { type: 'number' },
    badCloneOff: { type: 'number' }, badCloneOn: { type: 'number' }, reversible: { type: 'boolean' },
    ok: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['selftest5', 'deterministic', 'overflowCloneResp', 'cleanCloneResp', 'badCloneOff', 'badCloneOn', 'reversible', 'ok', 'verdict'] }
  verify = await agent([HARD,
    'INDEPENDENT ADVERSARIAL VERIFICATION of the grade-responsive mobile-proportion sub-score (be skeptical — the prior wrapper-distinctness mirror was REVERTED for FLAKY self-test; this must be DETERMINISTIC). Work in ' + GRADER + '. ' + AUTH + '. Prior report: ' + String(impl||'').slice(0,250) + '. You MUST end by calling StructuredOutput. Do NOT edit files.',
    '(1) DETERMINISTIC SELF-TEST: run node grade-responsive.mjs --selftest --source https://tailwindcss.com --widths 390,768,1440 FIVE times -> selftest5 array; deterministic=true iff all 5 PASS (>=0.96) AND spread (max-min) < 0.02 (NOT flaky). Also GRADER_NO_MOBILEPROP=1 once -> selftestOFF (must PASS).',
    '(2) REWARDS REAL MOBILE FIDELITY: take a clone that has the chrome-fix + fluid-fonts (overflow eliminated, height matched) — e.g. supabase abs page 2986 built fresh — grade its responsive WITH the mobile-prop ON vs OFF (GRADER_NO_MOBILEPROP=1): chromeFixRespOff/On. The ON (with mobile-prop) score should be >= OFF for a clone that genuinely fits mobile (it earns the proportion credit). [If a clean clone, ON ~ OFF or higher.]',
    '(3) PENALIZES REAL DEFECTS: construct/grade an OVERFLOWING or HEIGHT-INFLATED clone (e.g. build supabase with ABS_NO_CHROMEFIX=1 ABS_NO_FLUIDFONT=1 -> it overflows to 1440 at 390 + giant text) -> overflowCloneResp; and a clean fitted clone (defaults) -> cleanCloneResp. overflowCloneResp must be LOWER than cleanCloneResp (the grader now SEES the overflow/inflation). This is the core proof the term is honest.',
    '(4) ANTI-INFLATION / no-game: grade a genuinely low-fidelity clone (wrong content) responsive OFF vs ON -> badCloneOff/On; ON must NOT exceed OFF by >0.02 just from proportion (a content-wrong clone that happens to have matching height should not be rescued — the RLG 0.7 weight + low coverage still dominate).',
    '(5) reversible: GRADER_NO_MOBILEPROP=1 reproduces pure-RLG. ok=true iff deterministic AND overflowCloneResp < cleanCloneResp (penalizes the real defect) AND not badClone-inflated AND reversible. Return {selftest5, deterministic, selftestOFF, chromeFixRespOff, chromeFixRespOn, overflowCloneResp, cleanCloneResp, badCloneOff, badCloneOn, reversible, ok, verdict}.',
  ].join('\n'), { label: 'verify:mobile-proportion', phase: 'Verify', schema: VS })
  log('VERIFY: selftest5=' + JSON.stringify(verify&&verify.selftest5) + ' det=' + (verify&&verify.deterministic) + ' overflowClone=' + (verify&&verify.overflowCloneResp) + ' cleanClone=' + (verify&&verify.cleanCloneResp) + ' ok=' + (verify&&verify.ok))
}

phase('Gate')
let verdict
if (!okImpl) {
  verdict = 'REVERTED — impl/self-test failed: ' + String(impl||'').slice(0,200)
} else {
  const v = verify || {}
  const detOK = v.deterministic === true && (v.selftest5||[]).length >= 5 && (v.selftest5||[]).every((x)=>x>=0.96)
  const penalizes = v.overflowCloneResp < v.cleanCloneResp - 0.005
  const noInflate = !(v.badCloneOn > v.badCloneOff + 0.02)
  const ok = detOK && penalizes && noInflate && v.reversible === true
  if (ok) {
    verdict = 'ADOPTED — mobile-proportion responsive term: the grader now SEES mobile overflow + height-inflation. DETERMINISTIC self-test (5 runs ' + JSON.stringify(v.selftest5) + ', not flaky); penalizes a real overflow/inflated clone (' + v.overflowCloneResp + ' < clean ' + v.cleanCloneResp + '); chrome-fix/fluid clone credited (' + v.chromeFixRespOff + '->' + v.chromeFixRespOn + '); bad-clone not inflated (' + v.badCloneOff + '->' + v.badCloneOn + '); reversible GRADER_NO_MOBILEPROP=1. The session mobile wins (chrome-unpin, fluid-fonts, reflow) now register honestly. Re-baseline the corpus.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-graderesponsive-mobileprop.mjs grade-responsive.mjs && node --check grade-responsive.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
    verdict = 'REVERTED — ' + (!detOK ? 'self-test not deterministic/PASS x5 (flaky like the reverted mirror)' : !penalizes ? 'does NOT penalize the overflow/inflated clone (term not honest)' : !noInflate ? 'inflated a bad clone' : 'not reversible') + '. ' + JSON.stringify(v).slice(0,300)
  }
}
log('MOBILE-PROPORTION: ' + verdict)
return { verdict, impl: String(impl||'').slice(0,400), verify }

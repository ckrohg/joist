export const meta = {
  name: 'grader-coverage-attribution',
  description: 'GRADER KEYSTONE #6 (CONFIRMED false-deflation, user top priority): the per-element score MULTIPLIES every sub-score (color/typo/pos/text/effects) by areaCoverage, so on INCOMPLETE clones accurate sub-scores are crushed -> reactdev raw color 0.8276 reported as 0.16 (x coverage 0.1931); ALL its sub-scores are excellent raw (0.66-0.99) but crushed to ~0.17. The grader CONFLATES ACCURACY (high) with COMPLETENESS (low: 82/205 matched). FIX: report per-element sub-scores on RAW per-pair means (un-crush ACCURACY) AND surface COVERAGE as its OWN completeness dimension that still penalizes the composite (ANTI-GAMING: a clone matching 1 node perfectly must NOT score high). Self-test source-vs-source MUST stay 1.0 (coverage=1, raw=1). Reversible GRADER_NO_COVSEP=1. GATE: self-test 1.0 both modes + reactdev per-element rises toward raw (~0.85) + completeness dimension reflects coverage (incompleteness still penalized) + a deliberately-INCOMPLETE clone is NOT inflated (anti-gaming) + reversible + no NaN + independent-verified, else auto-restore. Re-baseline simultaneously.',
  phases: [
    { title: 'Fold', detail: 'perelement raw sub-scores (un-multiply coverage) + coverage as a separate penalized completeness dim in grade-sections; self-test 1.0 both modes' },
    { title: 'Verify', detail: 'independent adversarial: self-test 1.0; reactdev per-element un-crushed; anti-gaming (incomplete clone NOT inflated); reversible; no NaN; re-attribution sensible' },
    { title: 'Gate', detail: 'keep iff honest re-attribution + anti-gaming + self-test 1.0 + reversible, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && export JOIST_BASE="${JOIST_BASE:-http://localhost:8001}"; case "$JOIST_BASE" in *sg-host.com*|*georges232*|*35.212.46.254*) echo "FATAL: JOIST_BASE=$JOIST_BASE is a blocked/paused host (host-guard allowlist; renders only target localhost:8001 or JOIST_TRAINING_BASE)"; exit 1;; esac'
const HARD = 'Edit ONLY perelement-score.mjs + grade-sections.mjs. Back up each FIRST (/tmp/ev-bk-perelem-covsep.mjs, /tmp/ev-bk-grade-covsep.mjs). Do NOT edit capture/build-*. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64.'

const impl = await agent([HARD,
  'IMPLEMENT grader keystone #6 — separate ACCURACY from COMPLETENESS. Work in ' + GRADER + '. Read perelement-score.mjs (the per-element composite = mean(color,typo,pos,text,effects) MULTIPLIED by areaCoverage; the raw{} sub-scores are already stored) + grade-sections.mjs (how perElement feeds visual + the composite weights ~0.35*visual[0.5 SSIM + 0.5 perElement] + 0.20*edit + 0.20*structural + 0.25*responsive).',
  'CONFIRMED BUG: every sub-score is x areaCoverage -> accurate-but-incomplete clones (reactdev raw color 0.8276, coverage 0.1931) report ~0.17. Accuracy and completeness must be SEPARATE.',
  'THE CHANGE: (1) perelement-score.mjs: expose rawPerElement = mean of the RAW sub-scores (color/typo/pos/text/effects) WITHOUT the areaCoverage multiply, AND expose coverage (areaCoverage) separately in the report. Keep the old coverage-multiplied value too (telemetry). (2) grade-sections.mjs: visual now uses rawPerElement (accuracy): visual = 0.5*SSIM + 0.5*rawPerElement. ADD coverage as a penalized COMPLETENESS contribution so the composite still punishes incomplete clones (ANTI-GAMING). Pick the CLEANEST anti-gaming fold + DOCUMENT the new composite formula: EITHER (a) fold coverage into the STRUCTURAL dimension (structural_new = structural * coverage, or a blend) since structural is the completeness axis, OR (b) add a top-level completeness dimension (weight ~0.15) re-normalizing the others. The composite weights must still sum to 1 and self-test to 1.0.',
  'ANTI-GAMING RAIL (critical): a clone that matches only a FEW nodes perfectly must NOT score high — coverage/completeness must gate the composite so low coverage -> low composite, EVEN THOUGH raw sub-scores are high. Test this explicitly. (The whole point: un-crush accuracy WITHOUT letting a 1-node clone win.)',
  'SELF-TEST RAIL: source-vs-source -> coverage=1, rawPerElement=1 -> composite EXACTLY 1.0. Reversible: GRADER_NO_COVSEP=1 -> exact old behavior (coverage-multiplied perElement, old composite).',
  'STEP 0: cp perelement-score.mjs /tmp/ev-bk-perelem-covsep.mjs ; cp grade-sections.mjs /tmp/ev-bk-grade-covsep.mjs. node --check both. STEP SELFTEST (HARD, both modes): ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest AND --source https://tailwindcss.com --selftest -> 1.0 with the fix ON; AND GRADER_NO_COVSEP=1 -> 1.0. STEP RE-ATTRIBUTE: grade reactdev (page 4771) -> the per-element/visual should RISE (raw accuracy ~0.85 no longer crushed) AND a completeness/coverage term should reflect the 0.19 (so the composite is honest, not inflated). STEP ANTI-GAME: grade a deliberately-incomplete clone (or simulate: a clone matching few nodes) -> composite must NOT rise vs its true incompleteness.',
  'Return PLAIN-TEXT "OK:" with the NEW composite formula + reactdev per-element/visual/composite before->after + self-test (both modes) + the anti-gaming check result, or "RESTORED:" if any rail fails.',
].join('\n'), { label: 'fold:cov-attribution', phase: 'Fold' })
log('IMPL: ' + String(impl || '').slice(0, 300))

const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
let verify = null
if (okImpl) {
  phase('Verify')
  const VS = { type: 'object', additionalProperties: false, properties: {
    selftestSupabase: { type: 'number' }, selftestTailwind: { type: 'number' }, selftestOFFmode: { type: 'number' },
    reactdevPerElemOld: { type: 'number' }, reactdevPerElemNew: { type: 'number' }, reactdevCompositeOld: { type: 'number' }, reactdevCompositeNew: { type: 'number' }, reactdevCoverageDim: { type: 'number' },
    incompleteCloneOld: { type: 'number' }, incompleteCloneNew: { type: 'number' }, antiGamingHolds: { type: 'boolean' },
    reversible: { type: 'boolean' }, anyNaN: { type: 'boolean' }, ok: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['selftestSupabase', 'selftestTailwind', 'reactdevPerElemOld', 'reactdevPerElemNew', 'antiGamingHolds', 'reversible', 'anyNaN', 'ok', 'verdict'] }
  verify = await agent([HARD,
    'INDEPENDENT ADVERSARIAL VERIFICATION of grader coverage-attribution (the BIGGEST grader change — a flaw corrupts EVERY verdict; be maximally skeptical). Work in ' + GRADER + '. ' + AUTH + '. Prior report: ' + String(impl||'').slice(0,300) + '. You MUST end by calling StructuredOutput.',
    '(1) SELF-TEST 1.0: grade-sections --selftest on supabase + tailwind with fix ON -> selftestSupabase/selftestTailwind (must be 1.0); GRADER_NO_COVSEP=1 selftest once -> selftestOFFmode (must be 1.0). Any <1.0 = FLAW.',
    '(2) UN-CRUSH ACCURACY: grade reactdev (4771) -> reactdevPerElemOld (GRADER_NO_COVSEP=1, the crushed ~0.17) vs reactdevPerElemNew (fix ON, should rise toward the ~0.85 raw); reactdevCompositeOld vs reactdevCompositeNew; reactdevCoverageDim (the separate coverage/completeness value, should reflect ~0.19). The per-element must RISE (accuracy un-crushed).',
    '(3) ANTI-GAMING (the decisive rail): grade a DELIBERATELY-INCOMPLETE clone — take a real clone + delete ~half its matched content (or grade a known-sparse clone). incompleteCloneOld (OFF) vs incompleteCloneNew (ON). antiGamingHolds=true iff the incomplete clone is NOT inflated by the change (incompleteCloneNew must NOT exceed incompleteCloneOld by more than ~0.03 — coverage-as-a-dimension must still penalize incompleteness; the raw sub-scores must NOT rescue a 1-node-perfect clone). If antiGamingHolds is false, the fix is gameable -> FLAW.',
    '(4) reversible: GRADER_NO_COVSEP=1 reproduces the exact old composite. (5) anyNaN. ok=true iff selftests 1.0 AND reactdevPerElemNew>reactdevPerElemOld (un-crushed) AND antiGamingHolds AND reversible AND !anyNaN. Return {selftestSupabase, selftestTailwind, selftestOFFmode, reactdevPerElemOld, reactdevPerElemNew, reactdevCompositeOld, reactdevCompositeNew, reactdevCoverageDim, incompleteCloneOld, incompleteCloneNew, antiGamingHolds, reversible, anyNaN, ok, verdict}.',
  ].join('\n'), { label: 'verify:cov-attribution', phase: 'Verify', schema: VS })
  log('VERIFY: selftest sb=' + (verify&&verify.selftestSupabase) + ' tw=' + (verify&&verify.selftestTailwind) + ' reactdev perElem ' + (verify&&verify.reactdevPerElemOld) + '->' + (verify&&verify.reactdevPerElemNew) + ' antiGaming=' + (verify&&verify.antiGamingHolds) + ' ok=' + (verify&&verify.ok))
}

phase('Gate')
let verdict
if (!okImpl) {
  verdict = 'REVERTED — impl/self-test failed: ' + String(impl||'').slice(0,200)
} else {
  const v = verify || {}
  const selftestOK = v.selftestSupabase === 1 && v.selftestTailwind === 1 && (v.selftestOFFmode == null || v.selftestOFFmode === 1)
  const unCrushed = v.reactdevPerElemNew > v.reactdevPerElemOld + 0.05
  const ok = selftestOK && unCrushed && v.antiGamingHolds === true && v.reversible === true && v.anyNaN === false
  if (ok) {
    verdict = 'ADOPTED — grader now separates ACCURACY from COMPLETENESS: reactdev per-element un-crushed ' + v.reactdevPerElemOld + '->' + v.reactdevPerElemNew + ' (raw accuracy ~0.85 no longer x coverage); coverage is its own completeness dim (' + v.reactdevCoverageDim + ', still penalizes); self-test 1.0 both modes; ANTI-GAMING held (incomplete clone ' + v.incompleteCloneOld + '->' + v.incompleteCloneNew + ' not inflated); reversible GRADER_NO_COVSEP=1; no NaN. The grader stops false-deflating accuracy + names completeness as the real gap. RE-BASELINE the corpus.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-perelem-covsep.mjs perelement-score.mjs && cp /tmp/ev-bk-grade-covsep.mjs grade-sections.mjs && node --check perelement-score.mjs && node --check grade-sections.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
    verdict = 'REVERTED — ' + (!selftestOK ? 'self-test != 1.0' : !unCrushed ? 'per-element not un-crushed' : !v.antiGamingHolds ? 'GAMEABLE: incomplete clone inflated (coverage no longer penalizes)' : v.anyNaN ? 'NaN' : 'not reversible') + '. ' + JSON.stringify(v).slice(0,300)
  }
}
log('GRADER-COVERAGE-ATTRIBUTION: ' + verdict)
return { verdict, impl: String(impl||'').slice(0,500), verify }

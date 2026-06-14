export const meta = {
  name: 'perelement-ydrift-fix',
  description: 'SUPERVISED grader-honesty fix (confirmed + anti-game-controlled). The perElement matcher double-penalizes a uniform vertical stretch: refH=max(srcH,cloneH) + the areaCoverage multiplier collapse crush color/typo/text on a content-CORRECT-but-stretched clone (supabase ssim 0.897/raw text 1.0 but reported color 0.048). FIX (two-pass): PASS1 match+areaCoverage+color/typo/text on a SINGLE global uniform y-scale (1/hRatio, robustly fit, capped 0.5-2.0); PASS2 position sub-score on RAW boxes so drift is STILL penalized; hRatio+responsive untouched. Reversible GRADER_NO_YSCALE=1 + self-test=1.0 (scale=1 no-op) + independent adversarial verify that INCLUDES the shuffled-y anti-game control (must stay crushed) + my-own-backup restore.',
  phases: [
    { title: 'Fold', detail: 'two-pass uniform-y-scale match in perelement-score; self-test=1.0; supabase honest rise; shuffled-y control stays crushed' },
    { title: 'Verify', detail: 'independent reviewer: self-test both modes, supabase rises, SHUFFLED-Y CONTROL not rescued, linear ~unchanged, abs control no-op, reversible' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const impl = await agent([
  'Implement a SUPERVISED grader-honesty fix to perelement-score.mjs that corrects a CONFIRMED + anti-game-controlled false-deflation. Work in ' + GRADER + '. source /tmp/joist-auth.env. Never print JOIST_AUTH_B64.',
  'CONTEXT (perelement-ydrift-diagnostic wi79vrqi1): the Hungarian matcher cost = 0.5*(1-textDice)+0.2*(1-typoMatch)+0.3*centerDist, centerDist normalized by refH=max(srcPageH,clonePageH); every sub-score x areaCoverage = matchedArea/(matchedArea+unmatchedSrcArea+unmatchedCloneArea). A uniform clone y-stretch (hRatio>1) inflates refH + pushes big page-spanning textless containers out of the geomOk match gate -> they dump into unmatchedSrcArea -> areaCoverage collapses (supabase 0.087) -> multiplicatively crushes color/typo/text DESPITE raw text=1.0/color 0.56/typo 0.91/ssim 0.897. Proven artifact: y-normalizing recovers areaCoverage 0.087->0.437, color 0.048->0.233; a SHUFFLED-y control stays crushed at 0.040 (NOT rescued).',
  'THE FIX (two-pass, in perelement-score.mjs):',
  '1. Reversible flag: const USE_YSCALE = !process.env.GRADER_NO_YSCALE (default ON; =1 reverts to exact prior).',
  '2. Estimate ONE global uniform y-scale s: prefer a robust fit = median(cloneCy/srcCy) over high-text-Dice anchor pairs (dice>=0.6); fall back to srcPageH/clonePageH (=1/hRatio). Require anchor inliers to agree within ~8% before trusting the robust fit, else use the pageH ratio. CAP s to [0.5, 2.0]. If |1-1/s| < ~0.06 (no real stretch), s=1 (no-op).',
  '3. PASS 1 (match + areaCoverage + color/typo/text): apply s to the CLONE node cy/y/h BEFORE building the cost matrix; recompute refH on the scaled clone height. Match, compute areaCoverage, and color/typo/text on the matched pairs (these are y-independent content props — crediting them on the uniform-scale-aligned match is the correction).',
  '4. PASS 2 (position sub-score ONLY): compute the position/centerDist sub-score on the RAW (un-scaled) boxes over that same matched set, so the vertical drift is STILL penalized in the position channel. Do NOT touch hRatio or the responsive dimension (they keep penalizing the stretch at the composite level).',
  '5. GUARD: only ever a SINGLE global scalar y-scale (NEVER per-node y-shifts). This must NOT rescue a genuinely mis-positioned (shuffled-y) clone.',
  'STEP 0: cp perelement-score.mjs /tmp/ev-bk-perelem-yd.mjs (back up). STEP 1: implement. node --check.',
  'STEP 2 SELF-TEST (HARD): node grade-sections.mjs --source https://supabase.com --selftest -> composite 1.0 (scale=1 no-op on source-vs-source). ALSO GRADER_NO_YSCALE=1 selftest -> 1.0. If either fails, restore + report FAILED.',
  'STEP 3 HONESTY: re-grade supabase 6006 (node grade-sections.mjs --source https://supabase.com --clone "' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/?page_id=6006" --out /tmp/yd-supa) ON (default) vs OFF (GRADER_NO_YSCALE=1): report areaCoverage + color + composite both modes (expect ON: areaCoverage ~0.4, color ~0.23, composite ~+0.048).',
  'STEP 4 ANTI-GAME (CRITICAL): build a SHUFFLED-Y control — take the supabase clone capture and randomly permute the clone node y-positions (or reuse the diagnostic control), grade it ON vs OFF. The y-scale fix MUST NOT rescue it (stays ~0.04, NOT ~0.4). If the shuffled control is rescued, the fix is unsafe -> restore + report FAILED.',
  'Return PLAIN-TEXT starting "OK:" if implemented + self-test 1.0 (both modes) + supabase rises honestly + SHUFFLED-Y CONTROL stays crushed, else "FAILED:". Leave in place for the reviewer.',
].join('\n'), { label: 'fold:perelement-ydrift', phase: 'Fold' })
log('PERELEMENT-YDRIFT impl: ' + String(impl || '').slice(0, 250))

const verify = await agent([
  'INDEPENDENT ADVERSARIAL VERIFICATION (be maximally skeptical — this is a SUPERVISED grader change that RAISES scores; a wrong move credits broken clones). Work in ' + GRADER + '. A prior agent added a two-pass uniform-y-scale to perelement-score.mjs.',
  'Prior report: ' + String(impl || '(none)').slice(0, 500),
  'VERIFY yourself (do not trust the report): (1) self-test source-vs-source composite=1.0 in BOTH modes (default + GRADER_NO_YSCALE=1); (2) supabase 6006 areaCoverage rises (~0.087->~0.4) + color (~0.048->~0.23) + composite ~+0.048 — counting REAL content (raw text was 1.0); (3) THE ANTI-GAME GATE: construct a shuffled-y / mis-positioned clone (permute clone node y) and confirm the fix does NOT rescue it (stays ~0.04, NOT ~0.4) — if it rescues a shuffled clone, FLAW-FOUND; (4) linear 5404 is ~unchanged (its deflation is honest completeness, not y-drift — fix should add ~0); (5) ABS control tailwind 3146 (hRatio~1.0) unchanged (s~1 no-op); (6) position sub-score still LOW on the stretched supabase (drift still penalized on raw boxes, not inflated); (7) reversibility: GRADER_NO_YSCALE=1 reproduces the exact prior supabase areaCoverage (~0.087). Return "VERIFIED:" or "FLAW-FOUND:" with specifics.',
].join('\n'), { label: 'independent-verify', phase: 'Verify' }).catch((e) => 'verify-failed: ' + (e && e.message))
log('VERIFY: ' + String(verify || '').slice(0, 250))

const implOK = /\bOK:/i.test(String(impl || '')) && !/\bFAILED:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
const verifyOK = /\bVERIFIED:/i.test(String(verify || '')) && !/\bFLAW-FOUND:/i.test(String(verify || ''))
const ok = implOK && verifyOK
let verdict
if (ok) verdict = 'ADOPTED — perElement two-pass uniform-y-scale corrects the confirmed y-drift false-deflation (supabase color 0.048->~0.23, composite +~0.048; SHUFFLED-Y control NOT rescued; position+hRatio+responsive still penalize the drift; linear/abs unchanged; reversible GRADER_NO_YSCALE=1; self-test 1.0 both modes; independent-verified). Re-baselines uniformly-stretched-but-complete clones HONESTLY upward.'
else { await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-perelem-yd.mjs perelement-score.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Verify' }); verdict = 'REVERTED — ' + (implOK ? 'reviewer flagged: ' + String(verify || '').slice(0, 200) : 'impl failed: ' + String(impl || '').slice(0, 200)) }
log('PERELEMENT-YDRIFT: ' + verdict)
return { verdict, impl: String(impl || '').slice(0, 700), verify: String(verify || '').slice(0, 700) }

export const meta = {
  name: 'block-merge-coverage',
  description: 'RESEARCH BACKLOG #4 (MED-HIGH, wall D=coverage honesty): a symmetric block-MERGE pre-pass in perelement-score.mjs BEFORE the Hungarian assignment. Merge vertically-adjacent text leaves that share typography (same family+size+weight+color) AND gap < 0.5*lineHeight into one block (union box, concatenated text) — on BOTH source and clone. This removes a REAL areaCoverage deflation: a paragraph rendered as N wrapped line-fragments on one side but 1 block on the other never matches 1:1, so the source area registers as unmatched and crushes coverage (direct evidence: research #1 resend recovered content scored as unmatchedCloneArea partly via fragmentation). Symmetric -> self-test source-vs-source stays 1.0. Reversible GRADER_NO_MERGE=1. ANTI-GAMING GUARD (the deep-flatten failure mode): must RAISE fragmented-but-COMPLETE clones AND must NOT inflate a deliberately-INCOMPLETE clone. GATE: self-test 1.0 both modes + raises >=1 real complete clone + does NOT inflate the incomplete control + no NaN, else auto-restore.',
  phases: [
    { title: 'Fold', detail: 'symmetric block-merge pre-pass in perelement-score behind GRADER_NO_MERGE=1; self-test 1.0 both modes' },
    { title: 'Verify', detail: 'independent: self-test 1.0; raises fragmented-complete clones; anti-gaming = does NOT inflate an incomplete control; reversibility; no NaN' },
    { title: 'Gate', detail: 'keep iff honest-raise + anti-gaming holds, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Edit ONLY perelement-score.mjs. Back it up FIRST: cp perelement-score.mjs /tmp/ev-bk-perelem-blockmerge.mjs. Do NOT edit grade-sections/capture/build-*. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64.'

const impl = await agent([HARD,
  'IMPLEMENT research backlog #4 — a SYMMETRIC block-MERGE pre-pass in perelement-score.mjs. Work in ' + GRADER + '. First READ perelement-score.mjs: find where the SOURCE and CLONE leaf lists are built, the text-similarity<0.5 unmatched filter, the Hungarian/assignment cost matrix, and the areaCoverage = matchedArea/(matchedArea+unmatchedSrcArea+unmatchedCloneArea) computation (see the header doc lines ~17-23). The merge runs on BOTH leaf lists BEFORE the cost matrix is built.',
  'WHY: a paragraph/list rendered as N wrapped line-fragments on one side (e.g. capture splits a <p> into 3 line boxes) but as 1 block on the other never matches 1:1 -> the unmatched fragments inflate unmatchedSrc/CloneArea -> areaCoverage (a multiplier on color/typo/text) collapses DESPITE the text being present. Merging fragments into blocks on BOTH sides normalizes the granularity so present-but-fragmented content earns its coverage credit.',
  'THE MERGE (apply identically to the source leaf array and the clone leaf array): group TEXT leaves that are (a) same typography — same font-family, same font-size (within 1px), same font-weight bucket, same color (CIEDE2000 dE<=2), (b) vertically adjacent — horizontally overlapping in x-range AND the vertical gap between one box bottom and the next box top is < 0.5 * lineHeight, (c) in document/reading order. Merge a run of such leaves into ONE leaf: box = union of boxes, text = concatenation (space-joined), typography = the shared typography. Non-text leaves (images/media/buttons) are NEVER merged. A single leaf with no mergeable neighbor passes through unchanged.',
  'CRITICAL SYMMETRY (this is what makes self-test hold + avoids the deep-flatten asymmetric-over-harvest failure): the EXACT SAME merge function runs on source and clone with the SAME thresholds. Source-vs-source: identical input -> identical merge -> identical leaf sets -> perfect match -> composite stays 1.0. Do NOT merge only one side. Do NOT merge across different typography (that was deep-flattens over-harvest bug).',
  'REVERSIBILITY: gate the whole pre-pass behind if (process.env.GRADER_NO_MERGE !== "1") (default ON; =1 disables -> exact prior behavior). ',
  'STEP 0: cp perelement-score.mjs /tmp/ev-bk-perelem-blockmerge.mjs. STEP 1 implement. node --check perelement-score.mjs. STEP 2 SELF-TEST (HARD, both modes): ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest AND --source https://tailwindcss.com --selftest -> BOTH composite 1.0 with merge ON (default). ALSO GRADER_NO_MERGE=1 selftest 1.0 on both. If any selftest != 1.0 the merge is asymmetric/over-eager -> fix (tighten typography/gap gates) or report which.',
  'Return PLAIN-TEXT "OK:" with: the merge gates used, how many leaves merged on supabase source vs clone (a real clone grade), and confirmation self-test==1.0 on BOTH sources in BOTH modes; or "RESTORED:" if node --check fails.',
].join('\n'), { label: 'fold:block-merge', phase: 'Fold' })
log('IMPL: ' + String(impl || '').slice(0, 300))

const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
let verify = null
if (okImpl) {
  phase('Verify')
  const VS = { type: 'object', additionalProperties: false, properties: {
    selftestSupabaseOn: { type: 'number' }, selftestTailwindOn: { type: 'number' }, selftestOffMode: { type: 'number' },
    completeClones: { type: 'array', items: { type: 'object', additionalProperties: true } },
    incompleteControlOff: { type: 'number' }, incompleteControlOn: { type: 'number' },
    anyNaN: { type: 'boolean' }, reversible: { type: 'boolean' },
    honestRaise: { type: 'boolean' }, gamingDetected: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['selftestSupabaseOn', 'selftestTailwindOn', 'anyNaN', 'reversible', 'honestRaise', 'gamingDetected', 'verdict'] }
  verify = await agent([HARD,
    'INDEPENDENT ADVERSARIAL VERIFICATION of a block-MERGE pre-pass added to perelement-score.mjs (a prior agent added it; gate GRADER_NO_MERGE=1, default ON). Be skeptical — a wrong grader change corrupts every verdict. Work in ' + GRADER + '. Prior report: ' + String(impl || '').slice(0, 300) + '. You MUST end by calling StructuredOutput.',
    '(1) SELF-TEST source-vs-source MUST be 1.0: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest AND --source https://tailwindcss.com --selftest with merge ON (default) -> selftestSupabaseOn, selftestTailwindOn (both must be 1.0; <1.0 = asymmetric merge FLAW). Also one selftest with GRADER_NO_MERGE=1 -> selftestOffMode (must be 1.0).',
    '(2) HONEST-RAISE on REAL COMPLETE clones: grade 2-3 existing text-heavy clones that are COMPLETE (e.g. supabase page 2986, tailwind 3146) with merge OFF (GRADER_NO_MERGE=1) vs ON. ' + AUTH + ' && node grade-sections.mjs --source <url> --clone "$JOIST_BASE/?page_id=<page>" --out /tmp/bm-<site>-{on|off}. Record per clone {site, compositeOff, compositeOn, areaCoverageOff, areaCoverageOn}. honestRaise=true iff merge ON raises composite (or areaCoverage) on >=1 complete clone WITHOUT lowering any (un-deflates fragmented text).',
    '(3) ANTI-GAMING (the deep-flatten failure mode): build a deliberately INCOMPLETE clone — take a complete clone capture and DELETE ~half its sections (or grade an old known-incomplete build), then grade merge OFF vs ON. incompleteControlOff/On. gamingDetected=true iff merge ON raises the INCOMPLETE clones composite by >0.01 (merging must NOT conjure coverage for genuinely MISSING content — unmatchedSrcArea must still penalize it).',
    '(4) reversible=true iff GRADER_NO_MERGE=1 reproduces the exact OFF behavior. anyNaN=true iff any score is NaN/undefined.',
    'Return {selftestSupabaseOn, selftestTailwindOn, selftestOffMode, completeClones:[{site,compositeOff,compositeOn,areaCoverageOff,areaCoverageOn}], incompleteControlOff, incompleteControlOn, anyNaN, reversible, honestRaise, gamingDetected, verdict}.',
  ].join('\n'), { label: 'verify:block-merge', phase: 'Verify', schema: VS })
  log('VERIFY: selftest sb=' + (verify&&verify.selftestSupabaseOn) + ' tw=' + (verify&&verify.selftestTailwindOn) + ' honestRaise=' + (verify&&verify.honestRaise) + ' gaming=' + (verify&&verify.gamingDetected) + ' NaN=' + (verify&&verify.anyNaN))
}

phase('Gate')
let verdict
if (!okImpl) {
  verdict = 'REVERTED — impl failed/self-test not 1.0: ' + String(impl || '').slice(0, 200)
} else {
  const v = verify || {}
  const selftestOK = v.selftestSupabaseOn === 1 && v.selftestTailwindOn === 1 && (v.selftestOffMode == null || v.selftestOffMode === 1)
  const ok = selftestOK && v.honestRaise === true && v.gamingDetected === false && v.anyNaN === false && v.reversible === true
  if (ok) {
    verdict = 'ADOPTED — symmetric block-merge un-deflates fragmented-but-present text coverage (' + JSON.stringify((v.completeClones||[]).map((c)=>({s:c.site,off:c.compositeOff,on:c.compositeOn}))) + '); self-test 1.0 both modes; anti-gaming HELD (incomplete control ' + v.incompleteControlOff + '->' + v.incompleteControlOn + ' not inflated); reversible GRADER_NO_MERGE=1; no NaN. The grader now credits present-but-fragmented content -> unblocks anim-finish content-recovery scoring.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-perelem-blockmerge.mjs perelement-score.mjs && node --check perelement-score.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
    verdict = 'REVERTED — ' + (!selftestOK ? 'self-test != 1.0 (asymmetric merge)' : v.gamingDetected ? 'GAMING: merge inflated the incomplete control (deep-flatten failure mode repeats)' : v.anyNaN ? 'NaN produced' : !v.honestRaise ? 'no honest raise on complete clones (net-zero like deep-flatten)' : 'not reversible') + '. ' + JSON.stringify({ st:[v.selftestSupabaseOn,v.selftestTailwindOn], honestRaise:v.honestRaise, gaming:v.gamingDetected, incomplete:[v.incompleteControlOff,v.incompleteControlOn] })
  }
}
log('BLOCK-MERGE: ' + verdict)
return { verdict, impl: String(impl || '').slice(0, 500), verify }

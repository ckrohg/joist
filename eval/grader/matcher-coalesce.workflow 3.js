export const meta = {
  name: 'matcher-coalesce',
  description: 'THE HONEST COMPOSITE UNLOCK (4x-confirmed throttle): per-element ACCURACY is excellent (raw ~0.94) but areaCoverage (~0.49) MULTIPLIES every sub-score down — and the diag PROVED that coverage is ~100% GRADER 1:1-MATCHER STARVATION, NOT missing content (96.9% of unmatched-source AREA has the content reproduced+rendered at the same box; 0% dropped). The strict Hungarian assignment starves co-located STACKED nodes: each region has multiple stacked nodes on both sides (wrapper+inner+svg+image+text); only min(N,M) pair, the rest dump into unmatched though pixels are identical. FIX (diag-specified, SAFEST): a SYMMETRIC container-COALESCE pre-pass in perelement-score.mjs BEFORE the cost matrix — recursively fold a TEXTLESS wrapper CONTAINER whose box ~equals (high IoU / contains) its single dominant child INTO that child, on BOTH source and clone (keep ALL content leaves: image/text/button/svg; only drop redundant same-box wrapper containers). This is struct-invariance extended; symmetric -> self-test 1.0 by construction. Reversible GRADER_NO_COALESCE=1. GATE (MAX DISCIPLINE — matcher is the most dangerous file): self-test source-vs-source EXACTLY 1.0 both modes + supabase/reactdev coverage+composite RISE (crediting reproduced content) + ANTI-GAMING: a deliberately-INCOMPLETE clone does NOT gain coverage (its missing content has no clone counterpart) + render-identical-different-nesting pair scores ~equal + independent adversarial verify + no NaN, else auto-restore. Re-baseline.',
  phases: [
    { title: 'Fold', detail: 'symmetric container-coalesce pre-pass in perelement-score (drop redundant same-box textless wrapper containers, keep all content leaves); self-test 1.0 both modes' },
    { title: 'Verify', detail: 'independent adversarial: self-test 1.0; coverage/composite rise on supabase+reactdev; ANTI-GAMING incomplete-clone NOT inflated; render-identical-nesting ~equal; no NaN; reversible' },
    { title: 'Gate+Rebaseline', detail: 'keep iff honest coverage rise + anti-gaming holds + self-test 1.0; then re-baseline the corpus on the truer grader' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Edit ONLY perelement-score.mjs. The base is ALREADY clean (coalesce=0). STEP 0: VERIFY clean base (grep -c -i coalesce perelement-score.mjs MUST be 0; if >0 STOP — restore /tmp/ev-TRUSTED-perelem-clean.mjs first), then cp perelement-score.mjs /tmp/ev-bk-perelem-coalesce2.mjs. The CANONICAL clean restore is /tmp/ev-TRUSTED-perelem-clean.mjs (content-verified coalesce=0). Do NOT edit capture/build/grade-sections. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64.'

const impl = await agent([HARD,
  'IMPLEMENT a SYMMETRIC container-COALESCE pre-pass in perelement-score.mjs. Work in ' + GRADER + '. Read flatten() (~L382-420, builds the flat node list from the box-tree) + the cost-matrix/Hungarian assignment + areaCoverage = matchedArea/(matchedArea+unmatchedSrcArea+unmatchedCloneArea) + the existing struct-invariant gate (containerHasVisualSignal) + blockMerge.',
  'CONFIRMED BUG: areaCoverage ~0.49 is 1:1-matcher STARVATION of co-located STACKED nodes — each region has stacked wrapper-containers + content on both sides; only min(N,M) pair; reproduced content dumps into unmatched. The source side keeps redundant wrapper containers (wrapper+inner) that have no clone-side container counterpart (clone has an image/video widget at that box), so they can NEVER pair.',
  'THE FIX — a symmetric coalesce that runs IDENTICALLY on the source flat-list and the clone flat-list, BEFORE the cost matrix: recursively, if a node is a CONTAINER (kind container/div/section, TEXTLESS, no distinct content of its own) whose box is ~the same as (IoU>=0.9 OR it CONTAINS and is <=1.15x the area of) a SINGLE dominant child node, FOLD the wrapper away and keep the child (carry the child up). Repeat until no wrapper folds. RESULT: a [wrapper -> inner -> image] stack collapses to [image]; a [wrapper -> {image, text}] stays as {image, text} (two distinct children -> do NOT fold, keep both). NEVER merge two content leaves together; NEVER drop a text/image/button/svg content node; ONLY remove redundant same-box textless wrapper CONTAINERS. This makes the stacked-but-reproduced regions pair 1:1 instead of starving.',
  'SYMMETRY RAIL (guarantees self-test 1.0): the SAME function, SAME thresholds, run on both source and clone lists. source-vs-source -> identical lists -> identical coalesce -> identical node sets -> areaCoverage 1.0 -> composite 1.0. Do NOT branch per-side.',
  'ANTI-GAMING (must hold): coalesce only removes WRAPPER CONTAINERS (no own content); it cannot conjure coverage for genuinely-MISSING content — if the clone lacks a content leaf, the source content leaf (after coalesce) still has no clone counterpart and stays unmatched. Do NOT coalesce a wrapper into a child if that would let a region with N distinct source contents pair against a clone with fewer.',
  'V2 DENOMINATOR FIX (this is why v1 reverted — be precise): v1 tripped the anti-gaming gate by +0.0246 NOT via a false match (matched pairs DECREASED) but via a SOURCE-side DENOMINATOR artifact — a region MISSING on the clone was triple-counted as unmatched (wrapper+inner+content area) and coalesce de-double-counted it to the content area alone, SHRINKING unmatchedSrcArea and thus raising coverage WITHOUT a new match. FIX: a FOLDED WRAPPER must contribute ZERO area to the coverage computation — neither matched-eligible nor unmatched-denominator. Concretely: after coalesce, areaCoverage = matchedArea / (matchedArea + unmatchedSrcArea + unmatchedCloneArea) must be computed over ONLY the surviving CONTENT leaves (the folded wrapper boxes are removed from ALL three terms). This way: a MATCHED content leaf contributes its area to matched (good); a MISSING content leaf contributes its area to unmatchedSrc at FULL weight (penalized — no discount); and a folded wrapper contributes NOTHING (it is structural, not content). Net: a complete clone still gains from real pairing; an INCOMPLETE clone gets NO denominator discount -> the +0.0246 artifact -> <=0.02. Verify the incomplete-clone delta is <=0.02 in your smoke test before returning OK.',
  'REVERSIBLE: gate behind if (process.env.GRADER_NO_COALESCE !== "1") (default ON; =1 = exact prior behavior). STEP 0: VERIFY grep coalesce==0 then cp perelement-score.mjs /tmp/ev-bk-perelem-coalesce2.mjs. node --check. STEP SELFTEST (HARD both modes): ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest AND --source https://tailwindcss.com --selftest -> 1.0 with coalesce ON (default); AND GRADER_NO_COALESCE=1 -> 1.0. If any selftest != 1.0 the coalesce is asymmetric/over-eager -> fix or RESTORE. STEP CHECK: grade supabase (live 2986) -> areaCoverage should RISE from ~0.49 toward the true reproduced level + composite rise.',
  'Return "OK:" with supabase areaCoverage + composite before(GRADER_NO_COALESCE=1)->after(default) + self-test results (both modes, both sites), or "RESTORED:".',
].join('\n'), { label: 'fold:coalesce', phase: 'Fold' })
log('IMPL: ' + String(impl || '').slice(0, 300))

const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
let verify = null
if (okImpl) {
  phase('Verify')
  const VS = { type: 'object', additionalProperties: false, properties: {
    selftestSupabase: { type: 'number' }, selftestTailwind: { type: 'number' }, selftestOFF: { type: 'number' },
    supaCovOff: { type: 'number' }, supaCovOn: { type: 'number' }, supaCompOff: { type: 'number' }, supaCompOn: { type: 'number' },
    reactCovOff: { type: 'number' }, reactCovOn: { type: 'number' }, reactCompOff: { type: 'number' }, reactCompOn: { type: 'number' },
    incompleteCloneOff: { type: 'number' }, incompleteCloneOn: { type: 'number' }, antiGamingHolds: { type: 'boolean' },
    renderIdenticalNestingEqual: { type: 'boolean' }, reversible: { type: 'boolean' }, anyNaN: { type: 'boolean' }, ok: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['selftestSupabase', 'selftestTailwind', 'supaCovOff', 'supaCovOn', 'supaCompOff', 'supaCompOn', 'antiGamingHolds', 'reversible', 'anyNaN', 'ok', 'verdict'] }
  verify = await agent([HARD,
    'INDEPENDENT ADVERSARIAL VERIFICATION of a container-COALESCE matcher pre-pass in perelement-score.mjs (THE MOST DANGEROUS file — a wrong matcher corrupts EVERY verdict; be maximally skeptical). Work in ' + GRADER + '. ' + AUTH + '. Prior report: ' + String(impl||'').slice(0,300) + '. You MUST end by calling StructuredOutput. Do NOT edit files (verify-only).',
    '(1) SELF-TEST 1.0: grade-sections --selftest on supabase + tailwind with coalesce ON (default) -> selftestSupabase/selftestTailwind (MUST be 1.0; <1.0 = asymmetric coalesce FLAW); GRADER_NO_COALESCE=1 selftest once -> selftestOFF (1.0).',
    '(2) HONEST COVERAGE RISE: grade supabase (2986) + reactdev (4771) OFF (GRADER_NO_COALESCE=1) vs ON. supaCovOff/On, supaCompOff/On, reactCovOff/On, reactCompOff/On. Coverage should RISE (crediting reproduced stacked content). Confirm the rise corresponds to GENUINELY-reproduced regions (spot-check 2-3 newly-credited pairs: the clone really renders that content at that box).',
    '(3) ANTI-GAMING (DECISIVE): build/grade a DELIBERATELY-INCOMPLETE clone (delete ~half its content leaves, or grade a known-sparse clone) OFF vs ON coalesce -> incompleteCloneOff/On. antiGamingHolds=true iff coalesce does NOT inflate the incomplete clone by >0.02 (missing content has no clone counterpart -> still unmatched -> coalesce cannot rescue it). If coalesce inflates an incomplete clone, it is GAMEABLE -> FLAW.',
    '(4) RENDER-IDENTICAL-NESTING: two builds that render the same at desktop but with different DOM nesting depth should now score ~EQUAL coverage (renderIdenticalNestingEqual). (5) reversible: GRADER_NO_COALESCE=1 reproduces prior. (6) anyNaN.',
    'ok = selftests 1.0 AND supaCovOn>supaCovOff AND antiGamingHolds AND reversible AND !anyNaN. Return all fields + verdict.',
  ].join('\n'), { label: 'verify:coalesce', phase: 'Verify', schema: VS })
  log('VERIFY: selftest sb=' + (verify&&verify.selftestSupabase) + ' supaCov ' + (verify&&verify.supaCovOff) + '->' + (verify&&verify.supaCovOn) + ' supaComp ' + (verify&&verify.supaCompOff) + '->' + (verify&&verify.supaCompOn) + ' antiGaming=' + (verify&&verify.antiGamingHolds) + ' ok=' + (verify&&verify.ok))
}

phase('Gate+Rebaseline')
let verdict
if (!okImpl) {
  verdict = 'REVERTED — impl/self-test failed: ' + String(impl||'').slice(0,200)
} else {
  const v = verify || {}
  const selftestOK = v.selftestSupabase === 1 && v.selftestTailwind === 1 && (v.selftestOFF == null || v.selftestOFF === 1)
  const covUp = v.supaCovOn > v.supaCovOff + 0.02
  const ok = selftestOK && covUp && v.antiGamingHolds === true && v.reversible === true && v.anyNaN === false
  if (ok) {
    verdict = 'ADOPTED — symmetric container-coalesce credits genuinely-reproduced stacked content the 1:1 matcher was starving: supabase coverage ' + v.supaCovOff + '->' + v.supaCovOn + ' composite ' + v.supaCompOff + '->' + v.supaCompOn + ' | reactdev coverage ' + v.reactCovOff + '->' + v.reactCovOn + ' composite ' + v.reactCompOff + '->' + v.reactCompOn + '; self-test 1.0 both modes; ANTI-GAMING held (incomplete clone ' + v.incompleteCloneOff + '->' + v.incompleteCloneOn + '); render-identical-nesting equal=' + v.renderIdenticalNestingEqual + '; reversible; no NaN. The grader now HONESTLY credits reproduced content -> composite reflects true fidelity. RE-BASELINE the corpus.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-TRUSTED-perelem-clean.mjs perelement-score.mjs && node --check perelement-score.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate+Rebaseline' })
    verdict = 'REVERTED — ' + (!selftestOK ? 'self-test != 1.0 (asymmetric coalesce)' : !covUp ? 'coverage did not rise' : !v.antiGamingHolds ? 'GAMEABLE: inflated incomplete clone (coalesce over-credits missing content)' : v.anyNaN ? 'NaN' : 'not reversible') + '. ' + JSON.stringify(v).slice(0,300)
  }
}
log('MATCHER-COALESCE: ' + verdict)
return { verdict, impl: String(impl||'').slice(0,500), verify }

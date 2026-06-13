export const meta = {
  name: 'gradespec-coalescing-fix',
  description: 'Fix grade-spec --anchored under-measuring clones that COALESCE leaves (one-to-many matching) without breaking anti-gaming; self-test + fresh-Claude verify',
  phases: [
    { title: 'Build', detail: 'coalescing-aware one-to-many matching in anchored mode' },
    { title: 'Verify', detail: 'fresh reviewer: anti-gaming + identity + tailwind credit restored' },
  ],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SRC_SUPA = '/tmp/glob-supa.json'
const INCOMPLETE = '/tmp/pe-layout-gsec-supabasecom-mq2hv9sv-clone.json'  // 57-leaf incomplete (anti-gaming control)
const CLONE_GRIDFIX = '/tmp/gridfix-clone.json'                          // supabase GRIDFIX clone (anchored was 0.348)
const SRC_TW = '/tmp/cap-tailwind-off.json'                              // tailwind source (142 leaves)
const CLONE_TW = '/tmp/tw-clone.json'                                    // tailwind clone (71 leaves, coalesced; anchored was 0.054 despite heightRatio 1.12)

const SCHEMA = {
  type: 'object', additionalProperties: true,
  properties: {
    changed: { type: 'boolean', description: 'grade-spec.mjs anchored matcher updated (only that file)' },
    v1SelftestStillPasses: { type: 'boolean' },
    identityAnchored: { type: 'number', description: 'must stay ~1.0' },
    incompleteAnchored: { type: 'number', description: 'must stay LOW (anti-gaming under one-to-many)' },
    supaAnchoredBefore: { type: 'number', description: 'supabase GRIDFIX clone anchored, pre-fix (~0.348)' },
    supaAnchoredAfter: { type: 'number' },
    twAnchoredBefore: { type: 'number', description: 'tailwind clone anchored, pre-fix (~0.054)' },
    twAnchoredAfter: { type: 'number', description: 'should RISE materially (the 1.12-quality coalesced clone was under-measured)' },
    selftestPass: { type: 'boolean', description: 'identityAnchored>=0.95 AND incompleteAnchored<identity-0.25 AND v1 selftest passes AND twAnchoredAfter>twAnchoredBefore' },
    summary: { type: 'string' },
  },
  required: ['changed', 'selftestPass', 'summary'],
}

phase('Build')
const build = await agent(
  [
    'Improve the --anchored mode of grade-spec.mjs (in ' + GRADER + ') to stop UNDER-measuring clones that COALESCE leaves. ADDITIVE/in-place to grade-spec.mjs ONLY — do not edit any other .mjs file. Preserve the default (v1) path + the existing --selftest assertions (identity & incomplete).',
    '',
    'THE BUG (just measured): the tailwind clone has 71 leaves vs 142 source leaves — build-structured MERGES multi-line/multi-leaf text into single text widgets. The anchored matcher matches each src leaf to its OWN clone leaf, so when 3 src text leaves were merged into 1 clone widget, only ~1 of the 3 matches -> anchored coverage = 0.054 on a structurally-SOUND clone (segment-based heightRatio is 1.12). The per-section content metric is untrustworthy under coalescing.',
    '',
    'THE FIX — coalescing-aware ONE-TO-MANY matching in the anchored matcher: a single clone leaf may satisfy MULTIPLE src leaves, but ONLY when it genuinely SUBSUMES them:',
    '  - the clone leaf spatially COVERS the src leaf\'s predicted (anchored) position (the src leaf\'s scaled box is within / very near the clone leaf\'s box), AND',
    '  - for text: the clone leaf\'s normalized text CONTAINS the src leaf\'s significant tokens (the merged widget literally includes that line\'s words), OR for media: same kind-class + size sanity.',
    '  - Implementation: relax the "each clone leaf consumed once" rule to "a clone TEXT leaf may be claimed by multiple src leaves whose tokens it contains and whose scaled boxes it covers"; keep media 1:1 (a clone image still maps to one src image). Credit each subsumed src leaf\'s area.',
    'This credits a coalesced clone paragraph for all the src lines it absorbs, while a clone that is MISSING content still cannot claim it (no clone leaf contains those tokens).',
    '',
    'GATES (run + report truthfully):',
    '- v1SelftestStillPasses: original node grade-spec.mjs --selftest assertions (v1 + the existing anchored identity/incomplete) still pass.',
    '- identityAnchored: ' + SRC_SUPA + ' vs itself -> still ~1.0 (one-to-many must NOT change identity; with no coalescing it is 1:1).',
    '- incompleteAnchored: ' + SRC_SUPA + ' vs ' + INCOMPLETE + ' -> must stay LOW (< identity-0.25). CRITICAL ANTI-GAMING: one-to-many must NOT let the 57-leaf incomplete clone claim content it does not contain. If incompleteAnchored jumps up, the containment gate is too loose — tighten it.',
    '- supaAnchoredBefore/After: ' + SRC_SUPA + ' vs ' + CLONE_GRIDFIX + ' (was ~0.348; should be ~stable — supabase was not heavily coalesced).',
    '- twAnchoredBefore/After: ' + SRC_TW + ' vs ' + CLONE_TW + ' (was ~0.054; should RISE materially toward a value reflecting the 1.12 structural quality — proving the coalescing fix credits present-but-merged content).',
    'selftestPass = identityAnchored>=0.95 AND incompleteAnchored<identity-0.25 AND v1SelftestStillPasses AND twAnchoredAfter>twAnchoredBefore. Report all via schema. If anti-gaming breaks (incomplete jumps), report selftestPass=false + explain.',
  ].join('\n'),
  { schema: SCHEMA, label: 'build:coalescing-fix', phase: 'Build' }
)

if (!build || !build.changed || !build.selftestPass) {
  log('coalescing-fix did not pass self-test (changed=' + (build && build.changed) + ' selftestPass=' + (build && build.selftestPass) + ') — recorded not-kept; RESTORE grade-spec.mjs if needed')
  return { kept: false, reason: 'self-test failed (likely anti-gaming) or not changed', build }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer, no stake in the implementer. Try to FALSIFY. Work in ' + GRADER + '. Do NOT edit files.',
    '',
    'grade-spec.mjs --anchored was changed to allow ONE-TO-MANY matching (a coalesced clone leaf can satisfy multiple src leaves it subsumes), to fix under-measuring coalesced clones. Reported: identityAnchored=' + build.identityAnchored + ', incompleteAnchored=' + build.incompleteAnchored + ', twAnchored ' + build.twAnchoredBefore + '->' + build.twAnchoredAfter + ', supaAnchored ' + build.supaAnchoredBefore + '->' + build.supaAnchoredAfter + '.',
    '',
    'VERIFY:',
    '1. node grade-spec.mjs --selftest STILL PASSES (v1 + anchored identity ~1.0 + incomplete low). Reproduce the numbers.',
    '2. ANTI-GAMING IS THE CRITICAL CHECK: one-to-many matching is the dangerous kind of change — it could let a clone claim content it does not have. Run anchored on the 57-leaf incomplete clone (' + INCOMPLETE + ') and confirm it stays LOW. THEN construct a falsification: does the containment gate truly require the clone leaf to CONTAIN the src tokens + COVER the box? Read the matcher. Try to find an input where a clone leaf spuriously claims many src leaves it does not actually contain (e.g., a long clone paragraph claiming unrelated src lines just by spatial coverage). If you can inflate coverage for a clone that is missing content -> FLAW-FOUND.',
    '3. The tailwind rise (' + build.twAnchoredBefore + '->' + build.twAnchoredAfter + ') should be from GENUINE subsumption (the coalesced clone widgets really contain the src text), not from loosened gating. Spot-check 2-3 tailwind sections: do the clone leaves credited actually contain the src tokens? Run node grade-spec.mjs --src ' + SRC_TW + ' --clone ' + CLONE_TW + ' --anchored --summary and sanity-check.',
    '4. Only grade-spec.mjs changed (mtime/git).',
    '',
    'OUTPUT: "VERIFIED:" if 1+2+4 hold (selftest passes, anti-gaming holds, only grade-spec.mjs touched), else "FLAW-FOUND:". One line per check with PASS/FAIL + the numbers you observed. Note check 3 as INFO.',
  ].join('\n'),
  { label: 'verify:fresh-claude', phase: 'Verify' }
)

const verified = /\bVERIFIED:/i.test(String(verify || '')) && !/\bFLAW-FOUND:/i.test(String(verify || ''))
return {
  kept: verified,
  verdict: verified
    ? 'ADOPTED — grade-spec coalescing-aware matching: fixes under-measure of coalesced clones, anti-gaming holds, independently verified'
    : 'NOT KEPT — verifier flagged a flaw (likely anti-gaming) or self-test not reproduced; restore grade-spec.mjs',
  build,
  review: String(verify || '').slice(0, 1200),
}

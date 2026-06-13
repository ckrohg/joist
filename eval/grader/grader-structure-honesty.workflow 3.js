export const meta = {
  name: 'grader-structure-honesty',
  description: 'GRADER FALSE-DEFLATION DIAGNOSTIC (user top priority = grader honesty). Evidence: the card-row reflow renders PIXEL-IDENTICAL to the crude-1col build (supabase 99.954%, content-identical 149 leaves same coords) yet scores per-element pos 0.889->0.716 + RLG dip. Two suspected bugs: (B2) per-element + RLG node-matching is sensitive to DOM NESTING (grid-nested vs flat-abs) not rendered geometry -> render-identical clones score differently; (B1) RLG rewards crude everything->1col OVER true 3->2->1 reflow. CONTROLLED experiments isolate each before ANY fix. EXP1: author page A (3-card row as flat abs widgets) + page B (same 3 cards, identical final coords, inside a grid container as grid children) -> render @1440 confirm pixel-identical -> grade A-vs-B with perelement + grade-responsive: MUST be ~1.0; if <~0.95 the grader penalizes structure (B2 proven). EXP2: author S (3 cards reflow 3->2->1 via grid breakpoints) + C (identical 3->2->1) + D (crude everything->1col at <=1024) -> RLG(S,C) MUST be >= RLG(S,D); if D>=C, RLG is backwards (B1 proven). CONDITIONAL FIX only if a bug is PROVEN: make the matcher/coverage key on rendered geometry not nesting (B2) and/or fix the RLG reflow-direction (B1), with self-test 1.0 + the controlled pairs scoring correctly + no inflation of genuinely-bad clones. Reversible flags. Read-only on builders.',
  phases: [
    { title: 'Diagnose', detail: 'author controlled pixel-identical pairs; grade; PIN whether/why render-identical-or-better scores lower (B1/B2)' },
    { title: 'Fix', detail: 'IF a bug is proven: targeted grader fix (reversible) so controlled pairs score correctly + self-test 1.0 + no bad-clone inflation' },
    { title: 'Gate', detail: 'keep iff bug proven AND fix makes controlled pairs correct AND self-test 1.0 AND no inflation, else revert/record-only' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'

const DSCHEMA = { type: 'object', additionalProperties: false, properties: {
  exp1_pixelIdentical: { type: 'boolean' }, exp1_perElemAB: { type: 'number' }, exp1_responsiveAB: { type: 'number' },
  exp1_leafCountA: { type: 'number' }, exp1_leafCountB: { type: 'number' },
  B2_structurePenalty: { type: 'boolean' }, B2_mechanism: { type: 'string' },
  exp2_rlgSC: { type: 'number' }, exp2_rlgSD: { type: 'number' }, B1_rlgBackwards: { type: 'boolean' }, B1_mechanism: { type: 'string' },
  anyBugProven: { type: 'boolean' }, fixProposal: { type: 'string' }, fixFile: { type: 'string' }, notes: { type: 'string' },
}, required: ['exp1_pixelIdentical', 'exp1_perElemAB', 'exp1_responsiveAB', 'B2_structurePenalty', 'exp2_rlgSC', 'exp2_rlgSD', 'B1_rlgBackwards', 'anyBugProven', 'notes'] }

const diag = await agent([
  'GRADER FALSE-DEFLATION DIAGNOSTIC — controlled experiments, do NOT edit any grader/builder file in THIS phase (read-only; you author throwaway WP pages only). Work in ' + GRADER + '. ' + AUTH + ' before every WP command. Never print JOIST_AUTH_B64. You MUST end by calling StructuredOutput. Pages 2990/6724/6731 are disposable scratch slots (reuse/overwrite freely); allocate more scratch ids if needed.',
  'Read grade-responsive.mjs (matchNodes ~L181, top-MAX_NODES-by-area selection ~L136, coverageWeight ~L382, the responsiveScore=0.6*edge*cov+0.4*layout*cov ~L477) and perelement-score.mjs (leaf build, the symmetric areaCoverage, the Hungarian/greedy match) so you can attribute any score gap to a SPECIFIC mechanism.',
  'Author throwaway pages via a small node script using the joist/v1 PUT path (GET-hash -> expected_hash -> 409-retry, edit_mode=builder, elementor_canvas — mimic build-absolute.mjs auth/hash flow).',
  '=== EXP1 (B2: does the grader penalize DOM nesting that renders identically?) ===',
  'Page A: a hero band + ONE row of 3 cards as FLAT absolutely-positioned widgets (each card a container with a heading+text), pinned at coords X1/X2/X3, y, equal width W. Page B: the SAME hero + the SAME 3 cards with the SAME final rendered coords (X1/X2/X3,y,W) but laid out as a GRID container (grid_columns_grid repeat(3,1fr), the container pinned to span the 3-card band) with the 3 cards as GRID CHILDREN (no _position). Tune so A and B render PIXEL-IDENTICAL at 1440 (verify: screenshot both, >=99.5% match -> exp1_pixelIdentical).',
  'Then GRADE A-vs-B (A as --source, B as --clone): node perelement-score.mjs (or via grade-sections) -> exp1_perElemAB (the per-element composite/scalar); node grade-responsive.mjs --source <A-url> --clone <B-url> --widths 390,768,1440 -> exp1_responsiveAB. Record leaf counts capture-layout sees for A vs B (exp1_leafCountA/B). B2_structurePenalty=true iff (exp1_perElemAB < 0.95 OR exp1_responsiveAB < 0.95) DESPITE pixel-identical render. B2_mechanism = the PINNED cause (e.g. "grid container captured as an extra unmatched clone leaf -> areaCoverage drop", or "top-80-by-area picks the grid container over a real node -> matchNodes pairs shift", or "perelement boxes differ because grid cell box != abs widget box").',
  '=== EXP2 (B1: does RLG reward crude 1col over true 3->2->1?) ===',
  'Page S: 3 cards that reflow 3->2->1 (grid_columns_grid repeat(3) + _tablet repeat(2) + _mobile repeat(1)). Page C: identical 3->2->1 reflow (a faithful clone of S). Page D: 3 cards that at <=1024 collapse everything to 1 col (crude un-pin: all stacked/above-below at 768 AND 390, i.e. NO 2-col tablet step). Grade RLG(S,C) -> exp2_rlgSC and RLG(S,D) -> exp2_rlgSD (node grade-responsive.mjs --source <S> --clone <C|D> --widths 390,768,1024,1440). B1_rlgBackwards=true iff exp2_rlgSD >= exp2_rlgSC - 0.01 (the crude 1col scores as good as / better than the true reflow that actually matches S). B1_mechanism = pinned cause (e.g. "edgeSetAgreement does not credit the 2-col tablet relationship", or "coverage dominates and both have equal coverage so reflow correctness is washed out").',
  'anyBugProven = B2_structurePenalty OR B1_rlgBackwards. fixProposal = a SPECIFIC, MINIMAL, reversible code change for the proven bug(s) (which file, which function, what to change, what flag gates it). fixFile = the file to edit. Be precise + honest: if NEITHER bug reproduces in the controlled setup, say so (anyBugProven=false) — then the reflow drop was a real difference, not a grader bug.',
  'Return {exp1_pixelIdentical, exp1_perElemAB, exp1_responsiveAB, exp1_leafCountA, exp1_leafCountB, B2_structurePenalty, B2_mechanism, exp2_rlgSC, exp2_rlgSD, B1_rlgBackwards, B1_mechanism, anyBugProven, fixProposal, fixFile, notes}.',
].join('\n'), { label: 'diagnose:grader-structure', phase: 'Diagnose', schema: DSCHEMA })
log('DIAG: B2(structurePenalty)=' + (diag&&diag.B2_structurePenalty) + ' perElemAB=' + (diag&&diag.exp1_perElemAB) + ' respAB=' + (diag&&diag.exp1_responsiveAB) + ' | B1(rlgBackwards)=' + (diag&&diag.B1_rlgBackwards) + ' rlgSC=' + (diag&&diag.exp2_rlgSC) + ' rlgSD=' + (diag&&diag.exp2_rlgSD) + ' | anyBug=' + (diag&&diag.anyBugProven))

let fixRes = null, verify = null
if (diag && diag.anyBugProven && diag.fixFile) {
  phase('Fix')
  const FIXFILE = diag.fixFile.includes('responsive') ? 'grade-responsive.mjs' : diag.fixFile.includes('perelement') ? 'perelement-score.mjs' : diag.fixFile.includes('grade-sections') ? 'grade-sections.mjs' : diag.fixFile
  fixRes = await agent([
    'Implement the PROVEN grader-honesty fix. Work in ' + GRADER + '. ' + AUTH + ' before every WP command. Never print JOIST_AUTH_B64.',
    'PROVEN BUG(S): B2_structurePenalty=' + diag.B2_structurePenalty + ' (' + String(diag.B2_mechanism||'').slice(0,300) + '); B1_rlgBackwards=' + diag.B1_rlgBackwards + ' (' + String(diag.B1_mechanism||'').slice(0,300) + ').',
    'FIX PROPOSAL from diagnosis: ' + String(diag.fixProposal||'').slice(0,500) + '. Target file: ' + FIXFILE + '.',
    'STEP 0: cp ' + FIXFILE + ' /tmp/ev-bk-graderhonesty-' + FIXFILE + '. Implement the MINIMAL change. Gate behind a reversible env flag (e.g. GRADER_STRUCT_INVARIANT=0 disables / GRADER_RLG_FIX=0 disables; default = fix ON). The change must key matching/coverage on RENDERED GEOMETRY not DOM nesting (B2) and/or correctly credit the matched-reflow relationship over the crude collapse (B1).',
    'HARD RAILS: (1) SELFTEST must stay 1.0: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest AND --source https://tailwindcss.com --selftest -> 1.0 (both with fix ON and with the disable flag). node grade-responsive.mjs --selftest -> PASS. (2) The controlled pairs from the diagnosis must now score CORRECTLY: re-grade A-vs-B (must be >=0.97) and RLG(S,C) >= RLG(S,D). (3) NO INFLATION of genuinely-bad clones: grade a deliberately-incomplete/low-fidelity clone OFF vs ON the fix -> the fix must NOT raise its score by >0.01 (it only stops penalizing render-identical structure / fixes reflow credit; it must not make bad clones look good). node --check.',
    'STEP: re-author (or reuse) the A/B and S/C/D pages to re-verify. Return PLAIN-TEXT "OK:" with: the change, selftest results (both modes), A-vs-B before->after, RLG(S,C) vs RLG(S,D) before->after, and the bad-clone control before->after; or "RESTORED:" if any rail fails (restore the backup).',
  ].join('\n'), { label: 'fix:grader-honesty', phase: 'Fix' })
  log('FIX: ' + String(fixRes||'').slice(0,300))

  if (fixRes && /\bOK:/i.test(String(fixRes)) && !/\bRESTORED:/i.test(String(fixRes))) {
    phase('Gate')
    const VSCHEMA = { type: 'object', additionalProperties: false, properties: {
      selftestSupabase: { type: 'number' }, selftestTailwind: { type: 'number' }, selftestRLG: { type: 'boolean' },
      abAfter: { type: 'number' }, rlgSC_after: { type: 'number' }, rlgSD_after: { type: 'number' },
      badCloneOff: { type: 'number' }, badCloneOn: { type: 'number' }, reversible: { type: 'boolean' },
      ok: { type: 'boolean' }, verdict: { type: 'string' },
    }, required: ['selftestSupabase', 'selftestTailwind', 'abAfter', 'rlgSC_after', 'rlgSD_after', 'badCloneOff', 'badCloneOn', 'reversible', 'ok', 'verdict'] }
    verify = await agent([
      'INDEPENDENT ADVERSARIAL VERIFICATION of a grader-honesty fix (a wrong grader change corrupts EVERY verdict — be skeptical). Work in ' + GRADER + '. ' + AUTH + '. Fix report: ' + String(fixRes||'').slice(0,300) + '. You MUST end by calling StructuredOutput.',
      '(1) SELFTEST 1.0: re-run grade-sections --selftest on supabase + tailwind (fix ON) -> selftestSupabase/selftestTailwind (must be 1.0); grade-responsive --selftest -> selftestRLG (must PASS). (2) Re-grade the controlled A-vs-B pixel-identical pair -> abAfter (must be >=0.97). (3) RLG(S,C) true-reflow vs RLG(S,D) crude-1col -> rlgSC_after, rlgSD_after (rlgSC_after must be >= rlgSD_after). (4) ANTI-INFLATION: grade a genuinely low-fidelity / incomplete clone with the fix flag OFF vs ON -> badCloneOff/badCloneOn (ON must NOT exceed OFF by >0.01). (5) reversible: the disable flag reproduces prior behavior. ok=true iff ALL hold. Return {selftestSupabase, selftestTailwind, selftestRLG, abAfter, rlgSC_after, rlgSD_after, badCloneOff, badCloneOn, reversible, ok, verdict}.',
    ].join('\n'), { label: 'verify:grader-honesty', phase: 'Gate', schema: VSCHEMA })
    log('VERIFY: ok=' + (verify&&verify.ok) + ' ab=' + (verify&&verify.abAfter) + ' SC/SD=' + (verify&&verify.rlgSC_after) + '/' + (verify&&verify.rlgSD_after) + ' badClone ' + (verify&&verify.badCloneOff) + '->' + (verify&&verify.badCloneOn))
  }
}

phase('Gate')
let verdict
if (!diag) {
  verdict = 'INCONCLUSIVE — diagnostic produced no result.'
} else if (!diag.anyBugProven) {
  verdict = 'NO GRADER BUG PROVEN in the controlled setup (exp1 perElemAB=' + diag.exp1_perElemAB + ' respAB=' + diag.exp1_responsiveAB + ' pixelIdentical=' + diag.exp1_pixelIdentical + '; exp2 rlgSC=' + diag.exp2_rlgSC + ' rlgSD=' + diag.exp2_rlgSD + '). The reflow score drop was a REAL difference, not a grader false-deflation. ' + String(diag.notes||'').slice(0,300) + ' -> grader unchanged; reconsider the reflow as a genuine fidelity tradeoff.'
} else if (!fixRes || !/\bOK:/i.test(String(fixRes)) || /\bRESTORED:/i.test(String(fixRes))) {
  verdict = 'BUG PROVEN but fix not applied/failed rails (auto-restored): B2=' + diag.B2_structurePenalty + ' B1=' + diag.B1_rlgBackwards + '. fix: ' + String(fixRes||'').slice(0,200) + '. Bug recorded for a follow-up round.'
} else if (verify && verify.ok) {
  verdict = 'ADOPTED — grader-honesty fix PROVEN+VERIFIED: render-identical pair A-vs-B now ' + verify.abAfter + ' (was ' + diag.exp1_perElemAB + '/' + diag.exp1_responsiveAB + '); true-reflow RLG ' + verify.rlgSC_after + ' >= crude-1col ' + verify.rlgSD_after + '; self-test 1.0 (sb ' + verify.selftestSupabase + ' tw ' + verify.selftestTailwind + '); bad-clone NOT inflated (' + verify.badCloneOff + '->' + verify.badCloneOn + '); reversible. The grader no longer false-deflates true responsive reflow -> UNBLOCKS wall B. Re-run the card-row reflow next to confirm it now scores as a win.'
} else {
  await agent('Restore the grader fix backup: cd ' + GRADER + ' && for f in grade-responsive.mjs perelement-score.mjs grade-sections.mjs; do [ -f /tmp/ev-bk-graderhonesty-$f ] && cp /tmp/ev-bk-graderhonesty-$f $f; done && node --check grade-responsive.mjs && node --check perelement-score.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
  verdict = 'REVERTED — fix failed independent verification: ' + JSON.stringify(verify || {}).slice(0, 300)
}
log('GRADER-STRUCTURE-HONESTY: ' + verdict)
return { verdict, diag, fix: String(fixRes || '').slice(0, 500), verify }

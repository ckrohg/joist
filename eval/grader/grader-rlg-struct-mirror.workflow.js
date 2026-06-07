export const meta = {
  name: 'grader-rlg-struct-mirror',
  description: 'COMPLETE the grader struct-invariant honesty fix: the per-element channel (perelement-score.mjs) was made structure-invariant (drop visually-invisible layout wrappers so a grid-nested clone that renders pixel-identically is not coverage-penalized), but the RESPONSIVE channel (grade-responsive.mjs PROBE_FN, the area>=2000 textless-box keep ~L113) was NOT mirrored -> the 0.25 RLG term still false-deflates grid-nested clones (diag proved responsiveAB=0.849 at 1440 where render is identical). MIRROR the SAME distinctness gate into PROBE_FN, behind the SAME flag (GRADER_STRUCT_INVARIANT), so both channels toggle together. In-page test (getComputedStyle): skip a textless sized box kept ONLY via area>=2000 if it has NO visual signal — bg ~matches its offsetParent bg (small RGB tolerance) AND no visible border AND no border-radius AND no box-shadow. Symmetric -> self-test 1.0. GATE: RLG self-test PASS (both flag modes) + controlled A-vs-B responsive ~1.0 (was 0.849) + RLG(S,true-reflow) >= RLG(S,crude-1col) preserved + no bad-clone inflation + reversible, else auto-restore.',
  phases: [
    { title: 'Mirror', detail: 'add the distinctness gate to grade-responsive PROBE_FN behind GRADER_STRUCT_INVARIANT; node --check + RLG self-test 1.0 both modes' },
    { title: 'Verify', detail: 'independent: RLG self-test PASS; A-vs-B responsive ~1.0; RLG(S,C)>=RLG(S,D); bad-clone not inflated; reversible' },
    { title: 'Gate', detail: 'keep iff all rails hold, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Edit ONLY grade-responsive.mjs. Back it up FIRST: cp grade-responsive.mjs /tmp/ev-bk-graderesponsive-mirror.mjs. Do NOT edit perelement/grade-sections/build-*. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64.'

const impl = await agent([HARD,
  'MIRROR the struct-invariant distinctness gate into grade-responsive.mjs. Work in ' + GRADER + '. CONTEXT: perelement-score.mjs already drops structurally-invisible layout wrappers (a container is kept as a fidelity node ONLY if visually distinct: border/radius/box-shadow OR bg CIEDE2000 dE>3 vs parent AND page; flag GRADER_STRUCT_INVARIANT, default ON). The RESPONSIVE grader (grade-responsive.mjs) does NOT mirror this, so grid/flex wrappers still inflate its node count -> coverageWeight() symmetric-F1 precision drops -> responsiveScore is false-deflated for grid-nested-but-pixel-identical clones (proven: A-vs-B responsiveAB=0.849 at 1440 where render is identical).',
  'Read grade-responsive.mjs PROBE_FN (~L84-140): the keep gate is `if (dt || media || area >= 2000) { ...push node... }` (~L113). A node kept via `dt` (direct text) or `media` (img/video/canvas/button/a/svg) is a real content node — NEVER prune those. The problem is ONLY the textless, non-media boxes kept SOLELY by `area >= 2000` — those are the layout wrappers.',
  'THE MIRROR (in PROBE_FN, runs in-page so getComputedStyle is available): when a node would be kept ONLY by the area>=2000 branch (NOT dt, NOT media), additionally require it to carry a DISTINCT VISUAL SIGNAL, else skip it. Distinct = ANY of: a visible border (border-width>=1 AND a non-transparent border-color), border-radius>=0.5px, a non-none box-shadow, a backdrop-filter, OR its backgroundColor differs from its offsetParent (nearest positioned ancestor; fall back to parentElement) backgroundColor by more than a small tolerance. For the bg compare in-page, parse the two rgb()/rgba() strings to [r,g,b] and use a simple max-channel-abs-diff > 12 (a light perceptual proxy for dE>3; transparent/zero-alpha bg = no signal). Implement a tiny inline helper inside PROBE_FN (no imports). Gate the WHOLE extra requirement behind the SAME flag passed in from the runner: read process.env.GRADER_STRUCT_INVARIANT in the node scope and pass a boolean into page.evaluate(PROBE_FN, MAX_NODES, useStructInvariant) — when the flag is "0", behave EXACTLY as before (keep all area>=2000 boxes).',
  'CRITICAL SYMMETRY (self-test rail): the SAME prune runs on source and clone. source-vs-source -> identical DOM -> identical prune -> identical node sets -> coverage 1.0 -> responsiveScore 1.0. Do NOT prune content (text/media) nodes. Keep the relationship/edge/coverage math otherwise UNTOUCHED.',
  'STEP 0: cp grade-responsive.mjs /tmp/ev-bk-graderesponsive-mirror.mjs. STEP 1 implement (PROBE_FN + thread the flag through the two page.evaluate(PROBE_FN, MAX_NODES) call sites in captureAcrossWidths). node --check grade-responsive.mjs. STEP 2 SELF-TEST (HARD, both modes): ' + AUTH + ' && node grade-responsive.mjs --selftest --source https://tailwindcss.com -> PASS (responsiveScore>=0.96); AND GRADER_STRUCT_INVARIANT=0 node grade-responsive.mjs --selftest --source https://tailwindcss.com -> PASS. If self-test fails ON -> the prune is asymmetric/over-eager -> fix or restore.',
  'Return PLAIN-TEXT "OK:" with the gate added + both self-test results, or "RESTORED:" if node --check / self-test fails.',
].join('\n'), { label: 'mirror:rlg-struct', phase: 'Mirror' })
log('IMPL: ' + String(impl || '').slice(0, 280))

const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
let verify = null
if (okImpl) {
  phase('Verify')
  const VS = { type: 'object', additionalProperties: false, properties: {
    selftestON: { type: 'number' }, selftestOFF: { type: 'number' },
    abResponsiveBefore: { type: 'number' }, abResponsiveAfter: { type: 'number' },
    rlgSC: { type: 'number' }, rlgSD: { type: 'number' },
    badCloneRespOff: { type: 'number' }, badCloneRespOn: { type: 'number' },
    reversible: { type: 'boolean' }, ok: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['selftestON', 'abResponsiveAfter', 'rlgSC', 'rlgSD', 'badCloneRespOff', 'badCloneRespOn', 'reversible', 'ok', 'verdict'] }
  verify = await agent([HARD,
    'INDEPENDENT ADVERSARIAL VERIFICATION of the grade-responsive struct-invariant MIRROR (be skeptical — corrupting the responsive grader corrupts the 0.25 dimension). Work in ' + GRADER + '. ' + AUTH + '. Prior report: ' + String(impl||'').slice(0,250) + '. You MUST end by calling StructuredOutput. Do NOT edit files.',
    'Re-author (or reuse if still present) the controlled pages from the prior diagnostic: A=flat-abs 3-card row (page 2990) and B=grid-nested identical render (page 6724) [pixel-identical at 1440]; S=3->2->1 reflow (6731), C=faithful reflow (7594), D=crude-1col (7595). If a page is gone, re-author via the joist/v1 PUT path (GET-hash->expected_hash->409-retry, X-Joist-Session-Id, edit_mode=builder, elementor_canvas).',
    '(1) RLG SELF-TEST both modes: ' + AUTH + ' && node grade-responsive.mjs --selftest --source https://tailwindcss.com -> selftestON (must PASS >=0.96); GRADER_STRUCT_INVARIANT=0 ... -> selftestOFF (must PASS). (2) A-vs-B RESPONSIVE (THE fix target): node grade-responsive.mjs --source <A-url@1440-only via --widths 1440> --clone <B-url> -> abResponsiveAfter (must be >=0.97; was ~0.849). Also run with GRADER_STRUCT_INVARIANT=0 -> abResponsiveBefore (should reproduce ~0.849). (3) ORDERING PRESERVED: RLG(S,C) -> rlgSC and RLG(S,D) -> rlgSD (rlgSC must still be >= rlgSD; D crude-1col still penalized ~0.82). (4) ANTI-INFLATION: grade a real low-fidelity clone responsive OFF vs ON the flag -> badCloneRespOff/On (ON must NOT exceed OFF by >0.01). (5) reversible: flag=0 reproduces prior. ok=true iff ALL hold. Return {selftestON, selftestOFF, abResponsiveBefore, abResponsiveAfter, rlgSC, rlgSD, badCloneRespOff, badCloneRespOn, reversible, ok, verdict}.',
  ].join('\n'), { label: 'verify:rlg-struct-mirror', phase: 'Verify', schema: VS })
  log('VERIFY: selftestON=' + (verify&&verify.selftestON) + ' abResp ' + (verify&&verify.abResponsiveBefore) + '->' + (verify&&verify.abResponsiveAfter) + ' SC/SD=' + (verify&&verify.rlgSC) + '/' + (verify&&verify.rlgSD) + ' badClone ' + (verify&&verify.badCloneRespOff) + '->' + (verify&&verify.badCloneRespOn) + ' ok=' + (verify&&verify.ok))
}

phase('Gate')
let verdict
if (!okImpl) {
  verdict = 'REVERTED — impl/self-test failed: ' + String(impl||'').slice(0,200)
} else {
  const v = verify || {}
  const selftestOK = v.selftestON >= 0.96 && (v.selftestOFF == null || v.selftestOFF >= 0.96)
  const abFixed = v.abResponsiveAfter >= 0.97
  const orderOK = v.rlgSC >= v.rlgSD - 0.01
  const noInflate = !(v.badCloneRespOn > v.badCloneRespOff + 0.01)
  const ok = selftestOK && abFixed && orderOK && noInflate && v.reversible === true
  if (ok) {
    verdict = 'ADOPTED — RLG struct-invariant mirror COMPLETES the grader-honesty fix: A-vs-B responsive ' + v.abResponsiveBefore + '->' + v.abResponsiveAfter + ' (render-identical now ~1.0); RLG(S,C)=' + v.rlgSC + ' >= RLG(S,D)=' + v.rlgSD + ' (ordering preserved); self-test PASS both modes; bad-clone not inflated (' + v.badCloneRespOff + '->' + v.badCloneRespOn + '); reversible GRADER_STRUCT_INVARIANT=0. BOTH grader channels now structure-invariant -> the card-row reflow can be re-tested honestly.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-graderesponsive-mirror.mjs grade-responsive.mjs && node --check grade-responsive.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
    verdict = 'REVERTED — ' + (!selftestOK ? 'RLG self-test not PASS (asymmetric prune)' : !abFixed ? 'A-vs-B responsive not recovered to >=0.97' : !orderOK ? 'broke RLG ordering (S,C<S,D)' : !noInflate ? 'inflated a bad clone' : 'not reversible') + '. ' + JSON.stringify(v).slice(0,300)
  }
}
log('RLG-STRUCT-MIRROR: ' + verdict)
return { verdict, impl: String(impl||'').slice(0,400), verify }

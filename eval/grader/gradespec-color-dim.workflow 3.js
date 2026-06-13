export const meta = {
  name: 'gradespec-color-fidelity-dimension',
  description: 'Add a per-section BACKGROUND/COLOR-fidelity dimension to grade-spec.mjs (it is currently color-blind — a white clone of a dark site scores == a correct dark clone). Credits the validated dark fixes + catches color mismatch. TEXT-return; gate identity + anti-gaming (white-clone-of-dark scores LOW) + dark-clone-HIGH + supabase-unchanged + v1/anchored selftest intact; auto-restore; verify.',
  phases: [{ title: 'Build+Gate' }, { title: 'Verify' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const VDARK_SRC = '/tmp/vercel-dark-src.json'    // vercel captured DARK (7/7 dark bands)
const VDARK_CLONE = '/tmp/vc-dark-clone.json'    // vercel clone DARK (7/7 dark)
const VWHITE_CLONE = '/tmp/vc-clone.json'        // prior vercel clone WHITE (0 dark) — the wrong-color control
const SUPA = '/tmp/glob-supa.json'               // light source
const SUPA_CLONE = '/tmp/gridfix-clone.json'     // supabase clone (light)

phase('Build+Gate')
const build = await agent(
  [
    'Add a per-section BACKGROUND/COLOR-fidelity dimension to grade-spec.mjs (in ' + GRADER + '). It is currently COLOR-BLIND (scores only structural/text band coverage) so a clone that renders a DARK site entirely WHITE scores identically to a correct dark clone. ADDITIVE/in-place to grade-spec.mjs ONLY; preserve the default (v1) path + the existing v1/anchored --selftest assertions. FIRST: cp grade-spec.mjs /tmp/grade-spec.color.bak (RESTORE on any gate fail). Return PLAIN TEXT (no StructuredOutput tool).',
    '',
    'THE GAP (just measured): the validated dark fixes made vercel capture+clone DARK (src 7/7 dark bands -> clone 7/7 dark) but grade-spec anchoredMean stayed flat 0.345 — because grade-spec has zero background/color dimension. A white clone of a dark site must score LOWER than a correct dark clone.',
    '',
    'THE FIX: add a per-section BACKGROUND-COLOR match. For each spec section, compare the SRC band bg color (segment bg.value / the band node bg) to the CLONE band bg color (segment the clone, match section by order/anchor). colorMatch_section = 1 - normalizedColorDistance (use a simple perceptual-ish distance: deltaE-lite on rgb, OR a dark/light + hue agreement). Aggregate to a page colorMatch (area- or count-weighted). EXPOSE it: add colorMatch to the --summary output AND to the anchored result object; you MAY fold a modest weight into the headline (e.g. blend 15-20% colorMatch into the per-section/anchored score) OR keep it a separate reported dimension — your call, but it MUST be reported + must satisfy the gates. Do NOT break the existing structural/text scoring.',
    '',
    'GATE (run + report; RESTORE on any fail):',
    '1. v1/anchored selftest INTACT: node grade-spec.mjs --selftest still passes (the existing identity=1.0 / incomplete-low assertions).',
    '2. COLOR IDENTITY: grading ' + SUPA + ' vs itself -> colorMatch ~1.0 (a page vs itself has identical bands).',
    '3. CREDIT + ANTI-GAMING (the decisive A/B): grade ' + VDARK_SRC + ' (dark) vs ' + VDARK_CLONE + ' (dark clone) -> colorMatch HIGH; grade ' + VDARK_SRC + ' (dark) vs ' + VWHITE_CLONE + ' (the WHITE baseline clone) -> colorMatch LOW. The dark clone MUST score clearly higher than the white clone (proves the dimension credits the dark fix + penalizes a white clone of a dark site). Report both numbers + the gap (need dark - white >= ~0.3).',
    '4. LIGHT-SITE sanity: grade ' + SUPA + ' (light) vs ' + SUPA_CLONE + ' (light clone) -> colorMatch reasonably HIGH (both light; the dimension should not falsely penalize a correct light clone).',
    'kept = gate1 (selftest intact) AND gate2 (color identity ~1) AND gate3 (dark-clone colorMatch >= white-clone + 0.3) AND gate4 (light-vs-light high).',
    '',
    'END with one line exactly: "VERDICT: KEPT" or "VERDICT: NOT-KEPT". Before it: selftest (pass/fail), color-identity, dark-clone colorMatch, white-clone colorMatch (the gap), supabase colorMatch.',
  ].join('\n'),
  { label: 'build:color-dim', phase: 'Build+Gate' }
)

const buildKept = /VERDICT:\s*KEPT/i.test(String(build || ''))
if (!buildKept) {
  log('color-dim build VERDICT not KEPT — recorded not-kept (agent should restore grade-spec)')
  return { kept: false, reason: 'build gate failed', build: String(build || '').slice(0, 1500) }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer, no stake. FALSIFY. Work in ' + GRADER + '. Do NOT edit files. Return PLAIN TEXT.',
    'grade-spec.mjs gained a per-section background/color-fidelity dimension (it was color-blind). Implementer reported KEPT: dark clone colorMatch clearly > white-clone colorMatch, supabase light-vs-light high, v1 selftest intact.',
    'VERIFY: (1) node grade-spec.mjs --selftest STILL passes (existing structural/text identity+incomplete assertions unbroken). (2) the DECISIVE A/B: run grade-spec on ' + VDARK_SRC + ' vs ' + VDARK_CLONE + ' (dark) and vs ' + VWHITE_CLONE + ' (white) yourself — confirm the dark clone colorMatch is clearly higher (>=~0.3 gap). If a white clone of a dark site does NOT score lower, the dimension is broken -> FLAW. (3) NO FALSE PENALTY: ' + SUPA + ' vs ' + SUPA_CLONE + ' (both light) colorMatch should be reasonably high. (4) only grade-spec.mjs changed + node --check passes.',
    'END with one line exactly: "VERDICT: VERIFIED" or "VERDICT: FLAW" (with reason). Report the colorMatch numbers you observed.',
  ].join('\n'),
  { label: 'verify:color-dim', phase: 'Verify' }
)

const verified = /VERDICT:\s*VERIFIED/i.test(String(verify || '')) && !/VERDICT:\s*FLAW/i.test(String(verify || ''))
return {
  kept: verified,
  verdict: verified
    ? 'ADOPTED — grade-spec color-fidelity dimension: credits dark fixes + penalizes wrong-color clones, v1 intact, independently verified'
    : 'NOT KEPT — gate or verify failed; grade-spec should be restored',
  build: String(build || '').slice(0, 1200),
  review: String(verify || '').slice(0, 1000),
}

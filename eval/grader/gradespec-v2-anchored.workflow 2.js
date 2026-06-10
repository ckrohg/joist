export const meta = {
  name: 'gradespec-v2-per-band-anchored',
  description: 'Extend grade-spec.mjs with a per-band y-ANCHOR mode that fairly credits reflowed-but-present content (v1 single-y-scale undercredits) + outputs per-section height ratios; self-test honesty+anti-gaming, then fresh-Claude independent verify',
  phases: [
    { title: 'Build', detail: 'add --anchored mode + self-test (identity 1.0, incomplete low, anchored>v1 on the fixed clone)' },
    { title: 'Verify', detail: 'fresh independent reviewer: honesty + anti-gaming + anchor-logic' },
  ],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SRC = '/tmp/glob-supa.json'                       // supabase source (206 leaves, pageH 7578)
const INCOMPLETE = '/tmp/pe-layout-gsec-supabasecom-mq2hv9sv-clone.json' // 57-leaf incomplete clone (anti-gaming control)
const CLONE_BEFORE = '/tmp/gradespec-goodclone.json'    // collapsed clone (pre-GRIDFIX, heightRatio 2.05) — v1 scored 0.093
const CLONE_AFTER = '/tmp/gridfix-clone.json'           // GRIDFIX clone (heightRatio 1.52) — v1 scored 0.145

const SCHEMA = {
  type: 'object', additionalProperties: true,
  properties: {
    extended: { type: 'boolean', description: 'grade-spec.mjs gained an --anchored mode (v1 default preserved)' },
    v1SelftestStillPasses: { type: 'boolean', description: 'the ORIGINAL node grade-spec.mjs --selftest still passes unchanged' },
    identityAnchored: { type: 'number', description: 'anchored mean grading source vs itself (must be ~1.0)' },
    incompleteAnchored: { type: 'number', description: 'anchored mean on the 57-leaf incomplete clone (must stay LOW — anti-gaming under anchoring)' },
    anchoredBefore: { type: 'number', description: 'anchored mean on the COLLAPSED pre-GRIDFIX clone (v1 gave 0.093)' },
    anchoredAfter: { type: 'number', description: 'anchored mean on the GRIDFIX clone (v1 gave 0.145)' },
    selftestPass: { type: 'boolean', description: 'true iff identityAnchored>=0.95 AND incompleteAnchored<identityAnchored-0.25 AND v1SelftestStillPasses' },
    creditsReflow: { type: 'boolean', description: 'true iff anchoredAfter > 0.145 (anchored credits the real reflow gain v1 missed)' },
    perSectionHeightRatio: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { idx: { type: 'number' }, role: { type: 'string' }, heightRatio: { type: 'number' }, anchoredCov: { type: 'number' } } }, description: 'per-section clone/src height ratio on the GRIDFIX clone — diagnoses which sections still over-stretch' },
    worstStretchSections: { type: 'array', items: { type: 'number' } },
    summary: { type: 'string' },
  },
  required: ['extended', 'selftestPass', 'summary'],
}

phase('Build')
const build = await agent(
  [
    'Extend the existing per-section grader grade-spec.mjs (in ' + GRADER + ') with a per-band y-ANCHOR mode. ADDITIVE only — do NOT edit any other .mjs file, and PRESERVE the existing default behavior + the existing --selftest (the v1 global-y-scale path must remain the default and keep passing).',
    '',
    'WHY: grade-spec v1 maps src-y -> clone-y with a SINGLE global y-scale (clonePageH/srcPageH). When a clone REFLOWS non-uniformly (some sections stretch more than others), that single scale mis-maps bands, so present-but-reflowed content scores ~0. Evidence: the GRIDFIX rebuild is structurally much better (heightRatio 2.05->1.52, dense grids restored) yet v1 only moved 0.093->0.145 — it UNDER-credits. We need a grader that credits reflowed-but-PRESENT content while STILL refusing to credit MISSING content (anti-gaming).',
    '',
    'ADD an --anchored mode (e.g. node grade-spec.mjs --src S --clone C --anchored --summary, and fold it into --selftest as a second assertion set). PER-BAND Y-ANCHOR algorithm, for each spec section band:',
    '  1. Pick 1-2 ANCHOR leaves in the src band: the most DISTINCTIVE text leaves (longest text / the heading). Find the best-matching clone leaf by shared significant tokens (same matcher class as v1). The anchor gives the band an absolute clone-Y.',
    '  2. If two anchors (near top + near bottom of the band) both match, localScale = (cloneY_bottom - cloneY_top)/(srcY_bottom - srcY_top) and localOffset anchors the top; if only one matches, localScale = global S and offset = anchorCloneY - anchorSrcY*S; if NONE match, the band is absent -> coverage 0 (do NOT fall back to crediting it).',
    '  3. For each src leaf in the band predict cloneY = anchorCloneY + (srcLeaf.y - anchorSrcY)*localScale, and match to an UNUSED clone leaf near (scaledX, predictedY) with the SAME kind-class + (text) shared-token / (media) size sanity. Each clone leaf consumed once.',
    '  4. section anchoredCoverage = matched src-area / total src-area in band. Also compute the band heightRatio = (clone band span from the anchors) / (src band height).',
    'This credits a band that is present but shifted/stretched WITHIN ITSELF (reflow), while a band whose anchors do not match (missing content) still scores ~0.',
    '',
    'RUN + REPORT (be truthful):',
    '- v1SelftestStillPasses: the ORIGINAL --selftest assertions still pass.',
    '- identityAnchored: anchored mode, ' + SRC + ' vs ITSELF -> must be ~1.0 (>=0.95) every section.',
    '- incompleteAnchored: anchored, ' + SRC + ' vs ' + INCOMPLETE + ' -> must stay LOW (< identity-0.25). THIS IS THE KEY ANTI-GAMING CHECK: anchoring must NOT let a clone missing ~77% of content score high. If incompleteAnchored is high, your anchor logic is gameable — fix it (require the anchor token-match to be strong, and only credit leaves that actually match).',
    '- anchoredBefore: anchored on ' + CLONE_BEFORE + ' (the collapsed pre-GRIDFIX clone).',
    '- anchoredAfter: anchored on ' + CLONE_AFTER + ' (the GRIDFIX clone).',
    '- creditsReflow = anchoredAfter > 0.145 (v1 under-credited; anchored should credit the present content).',
    '- perSectionHeightRatio: for the GRIDFIX clone (' + CLONE_AFTER + '), per-section {idx, role, heightRatio, anchoredCov} + the worst-stretch section indices (heightRatio farthest from 1.0). This diagnoses where the residual page-height (1.52x) comes from.',
    'selftestPass = identityAnchored>=0.95 AND incompleteAnchored<identityAnchored-0.25 AND v1SelftestStillPasses. Report all via the schema. If the anti-gaming check fails, report selftestPass=false and explain.',
  ].join('\n'),
  { schema: SCHEMA, label: 'build:gradespec-v2', phase: 'Build' }
)

if (!build || !build.extended || !build.selftestPass) {
  log('v2 build did not pass self-test (extended=' + (build && build.extended) + ' selftestPass=' + (build && build.selftestPass) + ') — recorded not-kept')
  return { kept: false, reason: 'self-test failed or not extended', build }
}

phase('Verify')
const verify = await agent(
  [
    'You are a FRESH, INDEPENDENT, SKEPTICAL reviewer with NO stake in the implementer being right. Try to FALSIFY. Work in ' + GRADER + '. Do NOT edit files.',
    '',
    'grade-spec.mjs gained an --anchored mode (per-band y-anchor) that claims to fairly credit reflowed-but-present clone content WITHOUT crediting missing content. Reported: identityAnchored=' + build.identityAnchored + ', incompleteAnchored=' + build.incompleteAnchored + ', anchoredAfter(GRIDFIX clone)=' + build.anchoredAfter + ' (v1 gave 0.145), anchoredBefore(collapsed)=' + build.anchoredBefore + '.',
    '',
    'VERIFY (run the commands; report what you observe):',
    '1. node grade-spec.mjs --selftest  STILL PASSES (the original v1 assertions are intact + the new anchored assertions pass). Reproduce identityAnchored~1.0 and incompleteAnchored<identity-0.25.',
    '2. ANTI-GAMING IS THE CRITICAL CHECK: run the anchored mode on the 57-leaf incomplete clone (' + INCOMPLETE + '). Confirm it scores LOW. Then reason about the anchor logic: could a clone that is MISSING most content but happens to match a few section headings get spuriously high anchored coverage (because anchoring + within-band scaling is lenient)? Read the code. If anchoring credits a band whose body is absent just because its heading matched -> FLAW.',
    '3. anchoredAfter > anchoredBefore AND anchoredAfter > 0.145 (the anchored grader credits the GRIDFIX structural gain that v1 missed) — confirm by running anchored on both ' + CLONE_AFTER + ' and ' + CLONE_BEFORE + '. If anchoredAfter is NOT meaningfully higher, the v2 grader does not actually solve the under-crediting -> note it.',
    '4. Was anything other than grade-spec.mjs modified? Check mtimes / git. The default (v1) behavior + the original --selftest must be unchanged.',
    '',
    'OUTPUT (plain text): "VERIFIED:" if 1+2+4 hold (selftest passes, anti-gaming holds, only grade-spec.mjs touched), else "FLAW-FOUND:". One line per check with PASS/FAIL + the actual numbers you observed. Note claim 3 (does it credit reflow) as INFO even if it passes.',
  ].join('\n'),
  { label: 'verify:fresh-claude', phase: 'Verify' }
)

const verified = /\bVERIFIED:/i.test(String(verify || '')) && !/\bFLAW-FOUND:/i.test(String(verify || ''))
return {
  kept: verified,
  verdict: verified
    ? 'ADOPTED — grade-spec v2 anchored mode: fair per-section grading (credits reflow, anti-gaming holds), independently verified'
    : 'NOT KEPT — verifier flagged a flaw (likely anti-gaming) or self-test not reproduced',
  build,
  review: String(verify || '').slice(0, 1200),
}

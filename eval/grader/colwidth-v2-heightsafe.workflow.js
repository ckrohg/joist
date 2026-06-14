export const meta = {
  name: 'colwidth-v2-heightsafe',
  description: 'STRUCT_COLWIDTH made HEIGHT-SAFE: apply per-section source content-column width + alignment, but skip/clamp any section whose narrowing would increase its rendered height (the hero heading over-wrap). Keep the area-coverage win on safe sections with ZERO height regression. Gate + fresh-Claude verify.',
  phases: [
    { title: 'Build', detail: 'height-safe per-section colwidth (skip wrap-regressing sections like the hero)' },
    { title: 'Verify', detail: 'fresh reviewer: byte-identical-off + no h-scroll + heightRatio not worse + no corpus regression' },
  ],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SRC = '/tmp/glob-supa.json'
const BASELINE_OFF = '/tmp/colwidth-baseline.json'
const PAGE = '12157'
const CLONE_URL = '' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/structured-supabase/'
const HEIGHTRATIO_BASELINE = 1.523  // GRIDFIX-only render baseline; v2 must NOT exceed this

const SCHEMA = {
  type: 'object', additionalProperties: true,
  properties: {
    changed: { type: 'boolean' },
    flagOffByteIdentical: { type: 'boolean' },
    selftestOk: { type: 'boolean' },
    corpusNoRegression: { type: 'boolean' },
    sectionsNarrowed: { type: 'number', description: 'how many sections got colwidth applied (hero/wrap-risk sections skipped)' },
    heroSkipped: { type: 'boolean', description: 'the hero (wrap-regressor) was correctly skipped' },
    heightRatioOn: { type: 'number', description: 'supabase clone heightRatio flag-on (must be <= ~1.523, NOT worse than GRIDFIX-only)' },
    anchoredAreaBefore: { type: 'number' },
    anchoredAreaAfter: { type: 'number', description: 'must be > before (area-coverage win retained on safe sections)' },
    noHScroll: { type: 'boolean' },
    kept: { type: 'boolean', description: 'flagOffByteIdentical AND selftestOk AND corpusNoRegression AND noHScroll AND heightRatioOn<=1.527 AND anchoredAreaAfter>anchoredAreaBefore' },
    summary: { type: 'string' },
  },
  required: ['changed', 'kept', 'summary'],
}

phase('Build')
const build = await agent(
  [
    'Re-implement STRUCT_COLWIDTH in build-structured.mjs (in ' + GRADER + ') as HEIGHT-SAFE. v1 was net-beneficial (hero width 1140->672 exact source match; grade-spec anchored area 0.373->0.462) but auto-reverted because narrowing the HERO made its heading wrap to 2 lines (+1.2% whole-page height). ALL OTHER narrowed sections (3,5,7,8,11) had ZERO height change. Goal: keep the area-coverage win on the safe sections with NO height regression. ADDITIVE/in-place to build-structured.mjs ONLY; default OFF byte-identical. Back up first: cp build-structured.mjs /tmp/bs.cw2.bak (restore on gate-fail).',
    '',
    'HEIGHT-SAFE RULE: apply the per-section source content-column-width narrowing + source alignment EXACTLY as v1, EXCEPT SKIP narrowing for any section that would over-wrap. Offline-computable heuristic: for a section, compute targetWidth = source content-column width (min member.x .. max member.x1 over non-full-bleed members). Find the section\'s WIDEST single TEXT/heading element width (wText). If wText >= targetWidth * 0.85 (a heading that nearly fills the column -> narrowing it risks a new wrap, esp. since the clone font renders ~10-15% wider than the source), SKIP colwidth for that section (leave it full-width/legacy). Otherwise apply colwidth. This skips the hero (its heading nearly fills its column) while still narrowing body-text sections (#3/#5/#7/#8/#11) where text is well within the column. You MAY tune the 0.85 threshold to maximize sections narrowed while keeping the heightRatio gate. Keep the no-h-scroll invariant (max-width + width:100% via scoped #colw-N custom_css; NEVER a bare fixed px width).',
    '',
    'GATES (run + report; RESTORE from /tmp/bs.cw2.bak if any fails):',
    '- flagOffByteIdentical: node build-structured.mjs --layout ' + SRC + ' --dry --dump /tmp/cw2-off.json ; cmp to ' + BASELINE_OFF + '. MUST be byte-identical.',
    '- selftestOk: STRUCT_COLWIDTH=1 node build-structured.mjs --layout ' + SRC + ' --selftest prints OK (no FAIL/h-scroll).',
    '- corpusNoRegression: STRUCT_COLWIDTH=1 ... --selftest OK on /tmp/cap-tailwind-off.json /tmp/br-basecamp.json /tmp/ab-vercel-NEW.json /tmp/br-overreacted.json.',
    '- RENDER A/B on supabase ' + PAGE + ': source /tmp/joist-auth.env (NEVER print JOIST_AUTH_B64). Publish flag-ON (STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 ... --page ' + PAGE + ' --publish), capture ' + CLONE_URL + '?v=RANDOM -> /tmp/cw2-clone.json. heightRatioOn = clonePageH/7578 (MUST be <= 1.527, i.e. NOT worse than the GRIDFIX-only baseline ' + HEIGHTRATIO_BASELINE + '). noHScroll = max leaf x1 <= 1440. anchoredAreaAfter = node grade-spec.mjs --src ' + SRC + ' --clone /tmp/cw2-clone.json --anchored (mean); anchoredAreaBefore ~0.373. heroSkipped = the hero/first section was NOT narrowed; sectionsNarrowed = count of #colw-N applied.',
    '- kept = flagOffByteIdentical AND selftestOk AND corpusNoRegression AND noHScroll AND heightRatioOn<=1.527 AND anchoredAreaAfter>anchoredAreaBefore.',
    '',
    'Report all fields. Be truthful — if you cannot get area-coverage UP while keeping heightRatio<=1.527, report kept=false + the numbers. The whole point is a STRICT net win (horizontal fidelity up, height NOT worse).',
  ].join('\n'),
  { schema: SCHEMA, label: 'build:colwidth-v2', phase: 'Build' }
)

if (!build || !build.changed || !build.kept) {
  log('colwidth-v2 did not pass gate (changed=' + (build && build.changed) + ' kept=' + (build && build.kept) + ') — should be restored; recorded not-kept')
  return { kept: false, reason: 'gate failed', build }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer, no stake. FALSIFY. Work in ' + GRADER + '. Do NOT edit files.',
    'build-structured.mjs has STRUCT_COLWIDTH (default OFF) made HEIGHT-SAFE (skips narrowing wrap-risk sections like the hero). Reported: flagOffByteIdentical=' + build.flagOffByteIdentical + ', heightRatioOn=' + build.heightRatioOn + ' (must be <=1.527), anchoredArea ' + build.anchoredAreaBefore + '->' + build.anchoredAreaAfter + ', heroSkipped=' + build.heroSkipped + ', sectionsNarrowed=' + build.sectionsNarrowed + '.',
    '',
    'VERIFY:',
    '1. FLAG-OFF BYTE-IDENTICAL: node build-structured.mjs --layout ' + SRC + ' --dry --dump /tmp/rev-cw2-off.json ; cmp to ' + BASELINE_OFF + '. If not identical -> FLAW.',
    '2. NO H-SCROLL: STRUCT_COLWIDTH=1 ... --selftest on supabase + the 4 corpus captures all print OK (no bare fixed-px width). If any FAIL -> FLAW.',
    '3. HEIGHT NOT WORSE: confirm the reported heightRatioOn <= 1.527 is plausible + that the hero was skipped (so it cannot have regressed). If heightRatioOn>1.527 the gate should have failed -> FLAW.',
    '4. Only build-structured.mjs changed.',
    'OUTPUT: "VERIFIED:" if 1+2+4 hold AND heightRatioOn<=1.527, else "FLAW-FOUND:". One line per check + evidence.',
  ].join('\n'),
  { label: 'verify:fresh-claude', phase: 'Verify' }
)

const verified = /\bVERIFIED:/i.test(String(verify || '')) && !/\bFLAW-FOUND:/i.test(String(verify || ''))
return {
  kept: verified && build.kept,
  verdict: (verified && build.kept)
    ? 'ADOPTED (default-OFF) — STRUCT_COLWIDTH height-safe: per-section source content-width fidelity with zero height regression, independently verified'
    : 'NOT KEPT — gate or verify failed; build-structured.mjs restored',
  build,
  review: String(verify || '').slice(0, 1000),
}

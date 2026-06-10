export const meta = {
  name: 'section-content-width-alignment-fidelity',
  description: 'Make build-structured honor each section\'s SOURCE content-column width + horizontal alignment (instead of always centered-full-width), behind STRUCT_COLWIDTH (default OFF). Fixes the "full-width-left-heavy / doesn\'t feel close" mismatch. Self-test byte-identical-off + grade-spec area-coverage up + no-regression, then fresh-Claude verify.',
  phases: [
    { title: 'Build', detail: 'STRUCT_COLWIDTH: per-section inner max-width = source content-column width + source alignment' },
    { title: 'Verify', detail: 'fresh reviewer: byte-identical-off + no h-scroll + no corpus regression' },
  ],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SRC = '/tmp/glob-supa.json'
const BASELINE_OFF = '/tmp/colwidth-baseline.json'   // current default-off dump (for byte-identical-off check)
const PAGE = '12157'
const CLONE_URL = 'https://georges232.sg-host.com/structured-supabase/'

const SCHEMA = {
  type: 'object', additionalProperties: true,
  properties: {
    changed: { type: 'boolean', description: 'build-structured.mjs gained STRUCT_COLWIDTH (only that file)' },
    flagOffByteIdentical: { type: 'boolean', description: 'flag-off dump == /tmp/colwidth-baseline.json (default unchanged)' },
    selftestOk: { type: 'boolean', description: 'build-structured --selftest passes flag-on' },
    corpusNoRegression: { type: 'boolean', description: 'tailwind/basecamp/vercel/overreacted --selftest pass flag-on (no h-scroll / valid tree)' },
    heroWidthOff: { type: 'number', description: 'rendered hero content-column width with flag off (full-width ~1140)' },
    heroWidthOn: { type: 'number', description: 'rendered hero content-column width with flag on (should approach the source ~604px)' },
    heightRatioOn: { type: 'number', description: 'supabase clone heightRatio with flag on (should stay ~1.52 or better, not worse — matching source width matches source wrapping)' },
    anchoredAreaBefore: { type: 'number', description: 'grade-spec anchored mean before (~0.372)' },
    anchoredAreaAfter: { type: 'number', description: 'grade-spec anchored mean after (should rise — content lands at source positions)' },
    kept: { type: 'boolean', description: 'true iff flagOffByteIdentical AND selftestOk AND corpusNoRegression AND no h-scroll AND (heroWidthOn closer to source than heroWidthOff) AND heightRatioOn not worse' },
    summary: { type: 'string' },
  },
  required: ['changed', 'kept', 'summary'],
}

phase('Build')
const build = await agent(
  [
    'Add STRUCT_COLWIDTH (default OFF) to build-structured.mjs (in ' + GRADER + ') so each SECTION\'s inner content container honors the SOURCE content-column width + horizontal alignment, instead of the current always-centered, near-full-width (content_width:boxed + flex_align_items:center + CONTENT_MAXW ~min(1280,92%vw)). ADDITIVE/in-place to build-structured.mjs ONLY; default OFF must be byte-identical. Back up first: cp build-structured.mjs /tmp/bs.colwidth.bak (restore on gate-fail).',
    '',
    'WHY: measured defect — the supabase hero renders full-width (content cluster x=150, w~1140) while the SOURCE hero is a tight ~604px column; #7 footer reflows right-aligned->centered. This makes clones feel "left-heavy / full-width / not close" (the user\'s complaint) and depresses grade-spec per-section area-coverage even when content is present (high textCoverage, low area-coverage).',
    '',
    'THE FIX (STRUCT_COLWIDTH on): for each section, compute the SOURCE content-column geometry from its members (the x-extent of the non-full-bleed content cluster: min member x0 .. max member x1, excluding any full-bleed background element). Set the section\'s inner content container max-width to that captured content-column WIDTH (clamped to <= VW, never a fixed px that causes h-scroll — use max-width in px with width:100% so it still shrinks on narrow viewports), and set its horizontal placement (flex_align_items / margin) to match the source: left if the content cluster hugs the left, center if centered, right if right. Keep the no-h-scroll invariant: max-width + width:100% + the existing guards; NEVER emit a bare fixed px width without max-width:100%. Per-section, driven by the captured member geometry (you may also read the section-spec via buildSpec for the archetype/alignment hint, but the captured content-cluster x-extent is the primary signal).',
    '',
    'GATES (run + report):',
    '- flagOffByteIdentical: node build-structured.mjs --layout ' + SRC + ' --dry --dump /tmp/cw-off.json ; cmp to ' + BASELINE_OFF + '. MUST be byte-identical (default unchanged).',
    '- selftestOk: node build-structured.mjs --layout ' + SRC + ' --selftest with STRUCT_COLWIDTH=1 prints OK: (no FAIL, no h-scroll violation).',
    '- corpusNoRegression: STRUCT_COLWIDTH=1 node build-structured.mjs --layout <f> --selftest for f in /tmp/cap-tailwind-off.json /tmp/br-basecamp.json /tmp/ab-vercel-NEW.json /tmp/br-overreacted.json — all print OK:.',
    '- RENDER A/B on supabase (page ' + PAGE + '): source /tmp/joist-auth.env (NEVER print JOIST_AUTH_B64). Publish flag-ON (STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 ... --page ' + PAGE + ' --publish), capture ' + CLONE_URL + '?v=RANDOM -> /tmp/cw-clone.json. Report heroWidthOn (the hero heading/content cluster width in the rendered clone — should approach the source ~604, not ~1140), heightRatioOn (clonePageH/7578), and grade-spec anchored mean (node grade-spec.mjs --src ' + SRC + ' --clone /tmp/cw-clone.json --anchored). For heroWidthOff use the prior full-width value (~1140) or rebuild flag-off-of-colwidth (keep GRIDFIX on) to measure.',
    '- kept = flagOffByteIdentical AND selftestOk AND corpusNoRegression AND no-h-scroll AND heroWidthOn meaningfully closer to ~604 than heroWidthOff AND heightRatioOn NOT worse than ~1.52 AND anchoredAreaAfter >= anchoredAreaBefore(~0.372). If any gate fails, RESTORE build-structured.mjs from /tmp/bs.colwidth.bak and report kept=false with which gate failed.',
    '',
    'Report all fields via schema. Be truthful — if narrowing the column makes sections TALLER (more wrapping) and worsens heightRatio, report it (kept=false). The goal is matching the SOURCE column width (which wraps the same way the source does), not arbitrary narrowing.',
  ].join('\n'),
  { schema: SCHEMA, label: 'build:colwidth', phase: 'Build' }
)

if (!build || !build.changed || !build.kept) {
  log('colwidth build did not pass gate (changed=' + (build && build.changed) + ' kept=' + (build && build.kept) + ') — should be restored; recorded not-kept')
  return { kept: false, reason: 'gate failed or not changed', build }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer, no stake. FALSIFY. Work in ' + GRADER + '. Do NOT edit files.',
    '',
    'build-structured.mjs gained STRUCT_COLWIDTH (default OFF): per-section inner content max-width = source content-column width + source alignment, to fix the full-width/left-heavy mismatch. Reported: flagOffByteIdentical=' + build.flagOffByteIdentical + ', selftestOk=' + build.selftestOk + ', corpusNoRegression=' + build.corpusNoRegression + ', heroWidth ' + build.heroWidthOff + '->' + build.heroWidthOn + ', heightRatioOn=' + build.heightRatioOn + ', anchoredArea ' + build.anchoredAreaBefore + '->' + build.anchoredAreaAfter + '.',
    '',
    'VERIFY:',
    '1. FLAG-OFF BYTE-IDENTICAL: node build-structured.mjs --layout ' + SRC + ' --dry --dump /tmp/rev-cw-off.json ; cmp to ' + BASELINE_OFF + '. Read the diff: is the new code fully gated behind STRUCT_COLWIDTH? If flag-off is NOT byte-identical -> FLAW.',
    '2. NO HORIZONTAL SCROLL (the hard invariant + the user\'s explicit complaint): the new max-width must use width:100%+max-width (never a bare fixed px). Run STRUCT_COLWIDTH=1 ... --selftest on supabase + the 4 corpus captures; all must print OK: (the selftest validates no bare fixed-px width / no h-scroll). If any FAILs -> FLAW.',
    '3. Did it actually narrow the hero toward the source (~604) without making the page TALLER (heightRatio not worse)? Sanity-check the reported numbers are self-consistent. Note as INFO.',
    '4. Only build-structured.mjs changed (mtime/git).',
    '',
    'OUTPUT: "VERIFIED:" if 1+2+4 hold, else "FLAW-FOUND:". One line per check with PASS/FAIL + evidence (cmp result, the selftest OK/FAIL lines).',
  ].join('\n'),
  { label: 'verify:fresh-claude', phase: 'Verify' }
)

const verified = /\bVERIFIED:/i.test(String(verify || '')) && !/\bFLAW-FOUND:/i.test(String(verify || ''))
return {
  kept: verified && build.kept,
  verdict: (verified && build.kept)
    ? 'ADOPTED (default-OFF) — STRUCT_COLWIDTH: per-section source content-width + alignment fidelity, byte-identical-off, no h-scroll, independently verified'
    : 'NOT KEPT — gate or verify failed; build-structured.mjs restored',
  build,
  review: String(verify || '').slice(0, 1000),
}

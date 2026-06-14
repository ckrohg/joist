export const meta = {
  name: 'darkbg-v3-text-adopt',
  description: 'Adopt the proven CAPTURE_BANDBG dark-bg feature via a TEXT-return agent (no schema, to dodge the StructuredOutput plumbing failure). Re-apply + gate on framer (dark>=3) + supabase no-regression + no h-scroll + flag-off byte-identical; keep if all pass else restore; fresh-Claude verify.',
  phases: [{ title: 'Build+Gate' }, { title: 'Verify' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const FRAMER = 'https://www.framer.com/'
const SUPA = 'https://supabase.com/'

phase('Build+Gate')
const build = await agent(
  [
    'Adopt the CAPTURE_BANDBG dark-background rendered-sampling feature into capture-layout.mjs (in ' + GRADER + '). It was BUILT + PROVEN already (framer surfaced 3 dark sections rgb(8,8,8), supabase stayed light, no h-scroll) but lost twice (wrong test site, then a tooling crash). Re-apply it cleanly + gate on framer. Return PLAIN TEXT (do NOT use any StructuredOutput tool).',
    '',
    'capture-layout.mjs is FOUNDATIONAL: additive + flag-gated + default-OFF (byte-identical when off). FIRST: cp capture-layout.mjs /tmp/cl.darkbg3.bak (RESTORE on any gate fail).',
    '',
    'FEATURE (CAPTURE_BANDBG=1, default OFF): while the Playwright page is open, for each TOP-LEVEL band/section node (mirror segment contentRoot + boxKids), collect descendant child boxes, sample the full-page screenshot ONLY at gutter points not covered by any child, take the dominant quantized color (>=24 samples, >=0.5 dominant fraction), adopt ONLY when isDarkOrColored (avg<110 OR avg<=230 with chroma>=60); set BOTH node.bgSampled AND node.background.color. Insert right after the existing modalBg/sampleBg call, ENTIRELY inside `if (process.env.CAPTURE_BANDBG === \'1\')`.',
    '',
    'GATE (restore on any fail):',
    '1. flag-OFF byte-identical: with CAPTURE_BANDBG unset, new code does not run (read the diff — all under the flag).',
    '2. FRAMER: capture ' + FRAMER + ' WITH CAPTURE_BANDBG=1, segment it, count dark bands (bg avg<110). Need >=3.',
    '3. SUPABASE no-regression: capture ' + SUPA + ' WITH CAPTURE_BANDBG=1, segment, dark-band count must stay ~0 (<=1).',
    '4. no-h-scroll: STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 STRUCT_LINKCOLS=1 node build-structured.mjs --layout <a flag-on framer capture> --dry --selftest prints OK.',
    'If framer no longer renders dark in headless, that is a headless-render-fidelity issue (not a feature flaw) — report it + restore.',
    '',
    'END YOUR REPLY with a single line exactly: "VERDICT: KEPT" (if gates 1-4 all pass and you LEFT the feature in place) or "VERDICT: NOT-KEPT" (if any gate failed and you RESTORED capture-layout.mjs). Before that line, give the framer dark-band count, supabase dark-band count, flag-off-byte-identical (yes/no), and no-h-scroll (yes/no).',
  ].join('\n'),
  { label: 'build:darkbg-v3', phase: 'Build+Gate' }
)

const buildKept = /VERDICT:\s*KEPT/i.test(String(build || ''))
if (!buildKept) {
  log('darkbg-v3 build VERDICT not KEPT — recorded not-kept (agent should have restored)')
  return { kept: false, reason: 'build gate failed', build: String(build || '').slice(0, 1500) }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer. FALSIFY. Work in ' + GRADER + '. Do NOT edit files. FOUNDATIONAL capture file — be extra skeptical. Return PLAIN TEXT (no StructuredOutput tool).',
    'capture-layout.mjs gained CAPTURE_BANDBG (default OFF): dark-band rendered sampling. The implementer reported KEPT with framer dark bands >=3 + supabase staying light.',
    'VERIFY: (1) read the diff — ALL new code gated behind CAPTURE_BANDBG (flag-off unchanged)? (2) capture ' + SUPA + ' with CAPTURE_BANDBG=1 yourself, segment — supabase bands must NOT darken (<=1 dark). (3) capture ' + FRAMER + ' with CAPTURE_BANDBG=1 — confirm >=3 dark bands. (4) only capture-layout.mjs changed.',
    'END with a single line exactly: "VERDICT: VERIFIED" (if 1+2+4 hold and framer>=3) or "VERDICT: FLAW" (with the reason). Give the dark-band counts you observed before that line.',
  ].join('\n'),
  { label: 'verify:darkbg-v3', phase: 'Verify' }
)

const verified = /VERDICT:\s*VERIFIED/i.test(String(verify || '')) && !/VERDICT:\s*FLAW/i.test(String(verify || ''))
return {
  kept: verified,
  verdict: verified
    ? 'ADOPTED (default-OFF) — CAPTURE_BANDBG dark-bg fidelity, framer-gated + supabase-no-regression, independently verified'
    : 'NOT KEPT — verify FLAW (capture-layout should be restored by the build agent; driver will re-check)',
  build: String(build || '').slice(0, 1200),
  review: String(verify || '').slice(0, 1000),
}

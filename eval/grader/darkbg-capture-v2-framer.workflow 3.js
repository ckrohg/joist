export const meta = {
  name: 'darkbg-capture-v2-framer-gated',
  description: 'Re-apply the (already-proven) CAPTURE_BANDBG dark-bg rendered-sampling feature and gate it on FRAMER (genuinely dark in headless) instead of the now-light vercel — adopt default-OFF if framer dark bands captured + supabase no-regression + no h-scroll. Auto-restore on fail; fresh-Claude verify.',
  phases: [
    { title: 'Build', detail: 're-apply CAPTURE_BANDBG gutter-sampling; gate on framer + supabase' },
    { title: 'Verify', detail: 'fresh reviewer: framer dark fixed + supabase no-regression + default-off untouched' },
  ],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const FRAMER = 'https://www.framer.com/'
const SUPA = 'https://supabase.com/'

const SCHEMA = {
  type: 'object', additionalProperties: true,
  properties: {
    changed: { type: 'boolean' },
    flagOffUnchanged: { type: 'boolean', description: 'flag-off byte-identical (new sampling fully gated behind CAPTURE_BANDBG)' },
    framerDarkBandsBefore: { type: 'number', description: 'dark bands on framer WITHOUT flag (~0 — read as light wrapper)' },
    framerDarkBandsAfter: { type: 'number', description: 'dark bands on framer WITH CAPTURE_BANDBG=1 (should be >=3, the agent measured 3 at rgb(8,8,8))' },
    supaDarkBandsAfter: { type: 'number', description: 'supabase dark bands WITH flag — must stay ~0 (light page, no false-darkening)' },
    supaLightRegression: { type: 'boolean', description: 'TRUE if flag wrongly darkened supabase (must be FALSE)' },
    noHScroll: { type: 'boolean', description: 'building framer from the flag-on capture has no h-scroll' },
    kept: { type: 'boolean', description: 'changed AND flagOffUnchanged AND framerDarkBandsAfter>=3 AND supaLightRegression==false AND noHScroll' },
    summary: { type: 'string' },
  },
  required: ['changed', 'kept', 'summary'],
}

phase('Build')
const build = await agent(
  [
    'Re-apply the CAPTURE_BANDBG dark-background rendered-sampling feature to capture-layout.mjs (in ' + GRADER + ') and gate it on FRAMER (a genuinely-dark site in headless), NOT vercel (which now renders light in headless so its gate could not pass honestly). The feature was already built + PROVEN last round (framer surfaced 3 dark sections at rgb(8,8,8), supabase stayed light, no h-scroll) then reverted only due to the wrong test site. capture-layout.mjs is FOUNDATIONAL: additive + flag-gated + default-OFF (byte-identical when off). Back up first: cp capture-layout.mjs /tmp/cl.darkbg2.bak (RESTORE on any gate fail).',
    '',
    'THE FEATURE (CAPTURE_BANDBG=1, default OFF): while the Playwright page is open during capture, for each TOP-LEVEL band/section node (mirror segment\'s contentRoot + boxKids so the bg lands on the nodes whose bandBg() flows to seg.sections[].bg), collect descendant child boxes, sample the full-page screenshot ONLY at gutter points not covered by any child, take the dominant quantized color (require >=24 samples + >=0.5 dominant fraction), and adopt it ONLY when isDarkOrColored (avg<110, OR avg<=230 with chroma>=60). When adopted, set BOTH node.bgSampled AND node.background.color (segment bandBg prefers opaque background.color, so both must be set to surface the dark truth over the light wrapper CSS). Insert right after the existing modalBg/sampleBg call, ENTIRELY inside `if (process.env.CAPTURE_BANDBG === \'1\')`. (This is the exact insertion from last round; the prior diff was 944a945,1016.)',
    '',
    'GATES (run + report; RESTORE from /tmp/cl.darkbg2.bak if any fails):',
    '- changed + flagOffUnchanged: with CAPTURE_BANDBG unset the new code does NOT run (legacy path). Confirm via the diff (all new code under the flag).',
    '- FRAMER fix: capture ' + FRAMER + ' WITHOUT flag -> framerDarkBandsBefore (~0). Capture WITH CAPTURE_BANDBG=1 -> segment it -> framerDarkBandsAfter (sections whose bg avg<110). MUST be >=3.',
    '- SUPABASE no-regression (CRITICAL): capture ' + SUPA + ' WITH CAPTURE_BANDBG=1 -> supaDarkBandsAfter MUST stay ~0; supaLightRegression = (supaDarkBandsAfter>1) MUST be false.',
    '- noHScroll: build framer from the flag-on capture (STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 STRUCT_LINKCOLS=1 ... --dry --selftest) prints OK (dark bg is a kses-safe container background_color).',
    'kept = changed AND flagOffUnchanged AND framerDarkBandsAfter>=3 AND supaLightRegression==false AND noHScroll.',
    'Report all fields truthfully. If framer no longer renders dark in headless either, report kept=false + RESTORE + say so (then it is a headless-render-fidelity issue, not a feature flaw).',
  ].join('\n'),
  { schema: SCHEMA, label: 'build:darkbg-framer', phase: 'Build' }
)

if (!build || !build.changed || !build.kept) {
  log('darkbg-v2 did not pass framer gate (changed=' + (build && build.changed) + ' kept=' + (build && build.kept) + ') — should be restored; recorded not-kept')
  return { kept: false, reason: 'framer gate failed', build }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer, no stake. FALSIFY. Work in ' + GRADER + '. Do NOT edit files. FOUNDATIONAL capture file — be extra skeptical.',
    'capture-layout.mjs gained CAPTURE_BANDBG (default OFF): samples dark band backgrounds from the rendered page. Reported: framerDarkBands ' + build.framerDarkBandsBefore + '->' + build.framerDarkBandsAfter + ', supaDarkBandsAfter=' + build.supaDarkBandsAfter + ', supaLightRegression=' + build.supaLightRegression + ', noHScroll=' + build.noHScroll + '.',
    '',
    'VERIFY:',
    '1. DEFAULT-OFF UNTOUCHED: read the diff — ALL new sampling gated behind CAPTURE_BANDBG? If any new code runs unconditionally -> FLAW.',
    '2. LIGHT-SITE NO-REGRESSION (CRITICAL): capture ' + SUPA + ' with CAPTURE_BANDBG=1 yourself; segment it; confirm bands NOT wrongly darkened (~0 dark). If supabase darkens -> FLAW.',
    '3. FRAMER FIXED: capture ' + FRAMER + ' with CAPTURE_BANDBG=1; confirm >=3 bands read dark. If not -> FLAW.',
    '4. Only capture-layout.mjs changed.',
    'OUTPUT: "VERIFIED:" if 1+2+4 hold AND framer dark>=3, else "FLAW-FOUND:". One line per check + dark-band counts observed.',
  ].join('\n'),
  { label: 'verify:fresh-claude', phase: 'Verify' }
)

const verified = /\bVERIFIED:/i.test(String(verify || '')) && !/\bFLAW-FOUND:/i.test(String(verify || ''))
return {
  kept: verified && build.kept,
  verdict: (verified && build.kept)
    ? 'ADOPTED (default-OFF) — CAPTURE_BANDBG dark-bg fidelity (framer dark bands captured, light sites untouched), independently verified'
    : 'NOT KEPT — gate or verify failed; capture-layout.mjs restored',
  build,
  review: String(verify || '').slice(0, 1000),
}

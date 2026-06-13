export const meta = {
  name: 'darkbg-capture-rendered-sampling',
  description: 'CAPTURE_BANDBG (default OFF): sample each band\'s TRUE rendered background from the live page so dark/canvas/gradient sections stop rendering flat white. Default-off keeps the proven capture untouched; strict gate = light-site (supabase) no-regression + vercel dark bands fixed; auto-restore on fail; fresh-Claude verify.',
  phases: [
    { title: 'Build', detail: 'capture-layout rendered band-bg sampling pass (flag-gated)' },
    { title: 'Verify', detail: 'fresh reviewer: light-site no-regression + vercel dark fixed + default-off untouched' },
  ],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const VERCEL = 'https://vercel.com/'
const SUPA = 'https://supabase.com/'

const SCHEMA = {
  type: 'object', additionalProperties: true,
  properties: {
    changed: { type: 'boolean', description: 'capture-layout.mjs gained CAPTURE_BANDBG (only that file)' },
    flagOffUnchanged: { type: 'boolean', description: 'with the flag OFF the band-bg logic is the legacy path (no new sampling runs) — code-gated' },
    vercelDarkBandsBefore: { type: 'number', description: 'dark bands captured on vercel WITHOUT the flag (≈0)' },
    vercelDarkBandsAfter: { type: 'number', description: 'dark bands captured on vercel WITH the flag (should be >=4: prism hero, dark CTA, footer)' },
    supaLightRegression: { type: 'boolean', description: 'TRUE if the flag WRONGLY turned supabase light bands dark (a regression — must be FALSE)' },
    supaDarkBandsAfter: { type: 'number', description: 'dark bands on supabase WITH the flag — must stay ~0 (supabase is a light page)' },
    noHScroll: { type: 'boolean', description: 'building vercel from the flag-on capture still has no h-scroll' },
    kept: { type: 'boolean', description: 'changed AND flagOffUnchanged AND vercelDarkBandsAfter>=4 AND supaLightRegression==false AND noHScroll' },
    summary: { type: 'string' },
  },
  required: ['changed', 'kept', 'summary'],
}

phase('Build')
const build = await agent(
  [
    'Add CAPTURE_BANDBG (env, default OFF) to capture-layout.mjs (in ' + GRADER + ') — a rendered-background SAMPLING pass so DARK/canvas/gradient sections stop being captured as flat white. capture-layout.mjs is the FOUNDATIONAL capture file: this MUST be additive + flag-gated + default-OFF (the legacy band-bg path is byte-identical when the flag is off). Back up first: cp capture-layout.mjs /tmp/cl.darkbg.bak (RESTORE on any gate fail).',
    '',
    'THE BUG (measured on vercel.com): vercel has 5 dark bands (gradient-prism hero panel, dark CTA strips, footer) but the captured tree has ZERO dark or gradient full-bleed nodes — the band-bg reads the light wrapper CSS rgb(250) and misses canvas/WebGL/complex-gradient fills. So the clone renders all dark sections flat white. There is no dark CSS node to find in the DOM; the TRUE dark color only exists in the RENDERED pixels.',
    '',
    'THE FIX (CAPTURE_BANDBG on): while the Playwright page is still open during capture, for each TOP-LEVEL band/section node, sample its TRUE rendered background color and store it as node.bgSampled (the field segment.mjs already reads). Sample ROBUSTLY: pick several points inside the band that are NOT covered by any child element box (the background gutters — e.g. left/right margins, gaps between children, the band\'s top/bottom strips), read the rendered pixel color at those points (page.evaluate with elementFromPoint + getComputedStyle backgroundColor walking up, OR crop the band region from a screenshot and take the modal/edge color), and set bgSampled to the DOMINANT such color. Guard: only set bgSampled if it is opaque AND clearly distinct from white/near-white (so a light page is unaffected); if the sampled bg is light/near-white, leave bgSampled unset (legacy). This keeps light pages identical and only adds dark/colored bgs where they truly exist.',
    '',
    'GATES (run + report; RESTORE from /tmp/cl.darkbg.bak if any fails):',
    '- changed + flagOffUnchanged: with CAPTURE_BANDBG unset, the new sampling code does NOT run (the band-bg path is the legacy one). Confirm by reading the diff (new code under `if (CAPTURE_BANDBG)` / equivalent).',
    '- VERCEL fix: capture ' + VERCEL + ' WITHOUT the flag -> count dark full-bleed bands (avg(rgb)<110) = vercelDarkBandsBefore (~0). Capture WITH CAPTURE_BANDBG=1 -> vercelDarkBandsAfter (segment it; count sections whose bg is now dark). MUST be >=4.',
    '- SUPABASE no-regression (CRITICAL): capture ' + SUPA + ' WITH CAPTURE_BANDBG=1 -> supaDarkBandsAfter MUST stay ~0 (supabase is a LIGHT page; the flag must NOT wrongly darken its bands). supaLightRegression = (supaDarkBandsAfter > 1). MUST be false.',
    '- noHScroll: build vercel from the flag-on capture (STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 STRUCT_LINKCOLS=1 ... --dry --selftest, or publish+capture) prints OK (no h-scroll). The dark bg is a background_color on the container (kses-safe), cannot cause h-scroll.',
    'SECURITY: source /tmp/joist-auth.env for any publish (NEVER print JOIST_AUTH_B64). Capture needs no auth.',
    'kept = changed AND flagOffUnchanged AND vercelDarkBandsAfter>=4 AND supaLightRegression==false AND noHScroll.',
    '',
    'Report all fields. Be truthful — if the sampling wrongly darkens supabase (light-site regression) or cannot reliably read vercel\'s dark bands, report kept=false + RESTORE. The default-off proven capture must remain pristine.',
  ].join('\n'),
  { schema: SCHEMA, label: 'build:darkbg-capture', phase: 'Build' }
)

if (!build || !build.changed || !build.kept) {
  log('darkbg-capture did not pass gate (changed=' + (build && build.changed) + ' kept=' + (build && build.kept) + ') — should be restored; recorded not-kept')
  return { kept: false, reason: 'gate failed (light-site regression or vercel not fixed)', build }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer, no stake. FALSIFY. Work in ' + GRADER + '. Do NOT edit files. This is the FOUNDATIONAL capture file — be extra skeptical.',
    'capture-layout.mjs gained CAPTURE_BANDBG (default OFF): samples dark/canvas/gradient band backgrounds from the rendered page. Reported: vercelDarkBands ' + build.vercelDarkBandsBefore + '->' + build.vercelDarkBandsAfter + ', supaDarkBandsAfter=' + build.supaDarkBandsAfter + ' (must stay ~0), supaLightRegression=' + build.supaLightRegression + ', noHScroll=' + build.noHScroll + '.',
    '',
    'VERIFY:',
    '1. DEFAULT-OFF UNTOUCHED: read the diff. Is ALL new sampling gated behind CAPTURE_BANDBG (so the flag-off capture path is unchanged)? If any new code runs unconditionally -> FLAW (it would alter the proven default capture).',
    '2. LIGHT-SITE NO-REGRESSION (CRITICAL): capture ' + SUPA + ' with CAPTURE_BANDBG=1 yourself; segment it; confirm its bands are NOT wrongly darkened (dark-band count ~0). If supabase bands turn dark -> FLAW (the proven light clone would regress).',
    '3. VERCEL ACTUALLY FIXED: capture ' + VERCEL + ' with CAPTURE_BANDBG=1; confirm >=4 bands now read dark (avg rgb<110). If not, the fix does not work -> FLAW.',
    '4. Only capture-layout.mjs changed.',
    'OUTPUT: "VERIFIED:" if 1+2+4 hold AND vercel dark bands >=4, else "FLAW-FOUND:". One line per check + the dark-band counts you observed.',
  ].join('\n'),
  { label: 'verify:fresh-claude', phase: 'Verify' }
)

const verified = /\bVERIFIED:/i.test(String(verify || '')) && !/\bFLAW-FOUND:/i.test(String(verify || ''))
return {
  kept: verified && build.kept,
  verdict: (verified && build.kept)
    ? 'ADOPTED (default-OFF) — CAPTURE_BANDBG: dark/gradient band background fidelity (vercel dark bands captured, light sites untouched), independently verified'
    : 'NOT KEPT — gate or verify failed; capture-layout.mjs restored',
  build,
  review: String(verify || '').slice(0, 1000),
}

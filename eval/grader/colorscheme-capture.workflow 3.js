export const meta = {
  name: 'persite-colorscheme-capture',
  description: 'CAPTURE_COLORSCHEME (default OFF): detect each site\'s DECLARED preferred color-scheme + emulate it before capture, so dark-default sites (vercel) capture their TRUE dark design without regressing light sites (supabase). TEXT-return; gate vercel-dark + supabase-light + framer-dark + flag-off byte-identical; auto-restore; verify.',
  phases: [{ title: 'Build+Gate' }, { title: 'Verify' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const VERCEL = 'https://vercel.com/'
const SUPA = 'https://supabase.com/'
const FRAMER = 'https://www.framer.com/'

phase('Build+Gate')
const build = await agent(
  [
    'Add CAPTURE_COLORSCHEME (env, default OFF) to capture-layout.mjs (in ' + GRADER + ') — emulate each site\'s DECLARED preferred color-scheme before capture so dark-default sites capture their TRUE dark design. capture-layout is FOUNDATIONAL: additive + flag-gated + default-OFF (byte-identical when off). FIRST: cp capture-layout.mjs /tmp/cl.cs.bak (RESTORE on any gate fail). Return PLAIN TEXT (no StructuredOutput tool).',
    '',
    'PROVEN by diagnosis: vercel declares meta[name=color-scheme]="dark light" (dark PREFERRED) but headless defaults to light media -> renders LIGHT (wrong). Emulating colorScheme:dark flips it to its true dark design (pageBg rgb(0,0,0), dark bands). But a GLOBAL colorScheme:dark wrongly darkens supabase (a light page). So the fix MUST be PER-SITE: emulate the scheme the SITE DECLARES.',
    '',
    'THE FIX (CAPTURE_COLORSCHEME=1): after the page loads (before the box-tree + screenshot capture), DETECT the page\'s preferred scheme: read document.querySelector(\'meta[name=color-scheme]\')?.content (first token) OR getComputedStyle(document.documentElement).colorScheme. If the FIRST/preferred token is "dark" -> page.emulateMedia({ colorScheme: "dark" }), wait for reflow/settle (the CSS media queries re-evaluate live; give it a short settle + fonts.ready), THEN proceed to capture. If the preferred token is "light"/absent/"normal" -> leave default (light) — do NOT emulate dark. (framer renders dark via intrinsic CSS regardless, so it is unaffected.) Insert entirely inside `if (process.env.CAPTURE_COLORSCHEME === \'1\') { ... }`.',
    '',
    'GATE (run flag-on captures; RESTORE on any fail):',
    '1. flag-OFF byte-identical: with CAPTURE_COLORSCHEME unset, no new code runs (read the diff — all under the flag).',
    '2. VERCEL: capture ' + VERCEL + ' WITH CAPTURE_COLORSCHEME=1, segment -> pageBg should be DARK + dark-band count >=2 (vercel now renders its true dark design). Report pageBg + dark bands.',
    '3. SUPABASE no-regression (CRITICAL): capture ' + SUPA + ' WITH CAPTURE_COLORSCHEME=1 -> must STAY LIGHT (pageBg ~rgb(248-252), dark bands ~0). supabase must NOT be darkened (it does not declare dark-preferred). If supabase darkens -> FAIL.',
    '4. FRAMER unaffected: capture ' + FRAMER + ' WITH CAPTURE_COLORSCHEME=1 -> still >=3 dark bands (intrinsic dark, unaffected).',
    '5. no-h-scroll: build a flag-on vercel capture (STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 STRUCT_LINKCOLS=1 node build-structured.mjs --layout <vercel flag-on capture> --dry --selftest) prints OK.',
    'kept = gate1 AND vercel-dark(>=2) AND supabase-light(<=1 dark) AND framer-dark(>=3) AND no-h-scroll.',
    '',
    'END with one line exactly: "VERDICT: KEPT" or "VERDICT: NOT-KEPT". Before it: flag-off-byte-identical (yes/no), vercel pageBg + dark bands, supabase dark bands, framer dark bands, no-h-scroll (yes/no).',
  ].join('\n'),
  { label: 'build:colorscheme', phase: 'Build+Gate' }
)

const buildKept = /VERDICT:\s*KEPT/i.test(String(build || ''))
if (!buildKept) {
  log('colorscheme build VERDICT not KEPT — recorded not-kept (agent should restore; driver re-checks capture-layout)')
  return { kept: false, reason: 'build gate failed', build: String(build || '').slice(0, 1500) }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer. FALSIFY. Work in ' + GRADER + '. Do NOT edit files. FOUNDATIONAL capture file — extra skeptical. Return PLAIN TEXT.',
    'capture-layout.mjs gained CAPTURE_COLORSCHEME (default OFF): emulate each site\'s declared preferred color-scheme. Implementer reported KEPT (vercel renders dark, supabase stays light, framer dark).',
    'VERIFY: (1) diff — ALL new code gated behind CAPTURE_COLORSCHEME (flag-off unchanged)? (2) LIGHT-SITE NO-REGRESSION (critical): capture ' + SUPA + ' with CAPTURE_COLORSCHEME=1 yourself — supabase must STAY LIGHT (dark bands ~0). If it darkens -> FLAW. (3) capture ' + VERCEL + ' with CAPTURE_COLORSCHEME=1 — confirm it now renders DARK (pageBg dark + >=2 dark bands), proving the per-site detection works. (4) only capture-layout.mjs changed + node --check passes.',
    'END with one line exactly: "VERDICT: VERIFIED" or "VERDICT: FLAW" (with reason). Report pageBg/dark-band counts observed.',
  ].join('\n'),
  { label: 'verify:colorscheme', phase: 'Verify' }
)

const verified = /VERDICT:\s*VERIFIED/i.test(String(verify || '')) && !/VERDICT:\s*FLAW/i.test(String(verify || ''))
return {
  kept: verified,
  verdict: verified
    ? 'ADOPTED (default-OFF) — CAPTURE_COLORSCHEME per-site color-scheme emulation: dark-default sites capture true dark design, light sites unaffected, independently verified'
    : 'NOT KEPT — gate or verify failed; capture-layout should be restored (driver re-checks)',
  build: String(build || '').slice(0, 1200),
  review: String(verify || '').slice(0, 1000),
}

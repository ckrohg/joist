export const meta = {
  name: 'headed-capture-dynamic-sites',
  description: 'CAPTURE_HEADED (default OFF): a capture mode for JS/canvas-walled dynamic sites that render BLANK/wrong in headless (Stripe blank). Try a real HEADED browser; if the sandbox has no display, fall back to ENHANCED-HEADLESS (anti-bot UA + full JS/network settle + GPU). Gate: a known blank-in-headless site (Stripe) renders NON-BLANK + light sites unaffected. Default-off, additive, auto-restore, verify. TEXT-return.',
  phases: [{ title: 'Build+Gate' }, { title: 'Verify' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const STRIPE = 'https://stripe.com/'
const SUPA = 'https://supabase.com/'

phase('Build+Gate')
const build = await agent(
  [
    'Add CAPTURE_HEADED (env, default OFF) to capture-layout.mjs (in ' + GRADER + ') — a capture mode for JS/canvas/anti-bot dynamic sites that render BLANK or wrong in plain headless (the known outlier: stripe.com renders ~blank headless; vercel light is ALREADY fixed by CAPTURE_COLORSCHEME). capture-layout is FOUNDATIONAL: additive + flag-gated + default-OFF (the normal headless path unchanged when off). FIRST: cp capture-layout.mjs /tmp/cl.headed.bak (RESTORE on gate fail). Return PLAIN TEXT (no StructuredOutput tool).',
    '',
    'FIRST, READ how capture-layout launches Playwright (browser launch/context/page opts, headless flag, waits, UA). Then implement CAPTURE_HEADED=1 to maximize real-browser fidelity:',
    '  (a) Try a REAL HEADED browser: launch({ headless: false }) (+ existing args). If the environment HAS a display, this renders like a real browser (JS, canvas, anti-bot heuristics pass).',
    '  (b) If headed launch FAILS (no display / "Missing X server" / cannot connect) — catch it and FALL BACK to ENHANCED-HEADLESS in the SAME run: a realistic desktop User-Agent (not HeadlessChrome), navigator.webdriver masked, locale/timezone set, --use-angle=swiftshader (GPU), waitForLoadState("networkidle") + an extra settle + document.fonts.ready + a scroll-to-bottom-and-back to trigger lazy content, before capture. (Many anti-bot/JS-gated sites render under enhanced-headless even without true headed.)',
    '  Detect+report WHICH path ran (true-headed vs enhanced-headless-fallback).',
    '',
    'GATE (RESTORE on any fail):',
    '1. flag-OFF byte-identical behavior: with CAPTURE_HEADED unset, the launch path + capture are UNCHANGED (read the diff — all new launch/settle code under `if (CAPTURE_HEADED)`/equivalent; the default headless path is intact). node --check passes.',
    '2. STRIPE renders NON-BLANK: capture ' + STRIPE + ' WITHOUT the flag -> record leaf count (baseline; expected ~blank/tiny). Capture WITH CAPTURE_HEADED=1 -> leaf count + pageH. PASS iff the flag-on Stripe capture is substantially NON-BLANK (e.g. >=80 leaves + a real pageH, vs the blank baseline). Report both counts + which path (headed/enhanced-headless) achieved it.',
    '3. LIGHT-SITE no-regression: capture ' + SUPA + ' WITH CAPTURE_HEADED=1 -> still a sane tree (leaf count comparable to its normal headless capture; not degraded). The flag must not BREAK normal sites.',
    'kept = gate1 (flag-off unchanged + node --check) AND gate2 (Stripe non-blank with the flag) AND gate3 (light site unaffected). IF the sandbox supports NEITHER true-headed (no display) NOR gets Stripe rendering via enhanced-headless, report kept=false + the precise infra finding (e.g. "true headed needs a display/xvfb; enhanced-headless got Stripe to N leaves / still blank") + RESTORE — that is a valid honest outcome (a capture-ENVIRONMENT requirement, not a code bug).',
    '',
    'END with one line exactly: "VERDICT: KEPT" or "VERDICT: NOT-KEPT". Before it: which path ran (headed/enhanced-headless), Stripe leaves OFF vs ON, supabase leaves with-flag, flag-off-unchanged (y/n), node --check (y/n). If NOT-KEPT, the infra finding.',
  ].join('\n'),
  { label: 'build:headed-capture', phase: 'Build+Gate' }
)

const buildKept = /VERDICT:\s*KEPT/i.test(String(build || ''))
if (!buildKept) {
  log('headed-capture build NOT-KEPT (likely no-display / Stripe-unrenderable) — recorded as a capture-env finding; agent should restore')
  return { kept: false, reason: 'headed needs display / Stripe unrenderable in sandbox (capture-env finding)', build: String(build || '').slice(0, 1800) }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer. FALSIFY. Work in ' + GRADER + '. Do NOT edit files. FOUNDATIONAL capture file — extra skeptical. Return PLAIN TEXT.',
    'capture-layout.mjs gained CAPTURE_HEADED (default OFF): a real-headed / enhanced-headless mode for dynamic sites. Implementer reported KEPT (Stripe renders non-blank with the flag; light sites unaffected).',
    'VERIFY: (1) flag-OFF UNCHANGED: read the diff — all new launch/settle code gated behind CAPTURE_HEADED; the default headless path is untouched. node --check. If the default path changed -> FLAW. (2) STRIPE: capture ' + STRIPE + ' with CAPTURE_HEADED=1 yourself — confirm it renders substantially non-blank (>=80 leaves) vs a near-blank flag-off baseline. If Stripe is still blank/tiny with the flag -> the claim is false -> FLAW. (3) LIGHT-SITE: capture ' + SUPA + ' with CAPTURE_HEADED=1 — sane tree, not degraded. (4) only capture-layout.mjs changed.',
    'END with one line: "VERDICT: VERIFIED" or "VERDICT: FLAW" (reason). Report Stripe leaves off/on + supabase leaves + which path ran.',
  ].join('\n'),
  { label: 'verify:headed-capture', phase: 'Verify' }
)

const verified = /VERDICT:\s*VERIFIED/i.test(String(verify || '')) && !/VERDICT:\s*FLAW/i.test(String(verify || ''))
return {
  kept: verified,
  verdict: verified
    ? 'ADOPTED (default-OFF) — CAPTURE_HEADED: dynamic-site capture (Stripe renders non-blank), flag-off unchanged, light sites unaffected, independently verified'
    : 'NOT KEPT — gate/verify failed OR sandbox cannot render Stripe (capture-env finding); capture-layout restored',
  build: String(build || '').slice(0, 1400),
  review: String(verify || '').slice(0, 1000),
}

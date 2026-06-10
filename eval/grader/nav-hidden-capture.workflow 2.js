export const meta = {
  name: 'capture-skip-hidden-subtrees',
  description: 'CAPTURE_VISIBLE (default OFF): skip effectively-hidden subtrees (hover-revealed mega-menu dropdowns, opacity:0/clipped/off-screen content) during capture so they stop flattening into tall visible blocks (vercel 804px nav). TEXT-return (dodge schema plumbing). Strict gate: proven sites lose NO visible content + vercel nav shrinks; auto-restore; verify.',
  phases: [{ title: 'Build+Gate' }, { title: 'Verify' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const VERCEL = 'https://vercel.com/'
const SUPA = 'https://supabase.com/'
const TW = 'https://tailwindcss.com/'

phase('Build+Gate')
const build = await agent(
  [
    'Add CAPTURE_VISIBLE (env, default OFF) to capture-layout.mjs (in ' + GRADER + ') — skip EFFECTIVELY-HIDDEN subtrees during capture so hover-revealed mega-menu dropdowns / opacity:0 / clipped / off-screen content stop being captured as visible blocks. capture-layout is FOUNDATIONAL: additive + flag-gated + default-OFF (byte-identical when off). FIRST: cp capture-layout.mjs /tmp/cl.navfix2.bak (RESTORE on any gate fail). Return PLAIN TEXT (no StructuredOutput tool).',
    '',
    'THE BUG (vercel): the captured tree includes a mega-menu\'s hover-hidden dropdown links (AI Gateway/Sandbox/v0/CI-CD...) as a tall ~804px visible block (segment idx0 ratio 12.6x vs a 64px real nav). On a real browser these are hidden until hover; in headless they are in the DOM with boxes. The capture should DROP content that is effectively non-visible in the default (non-hover) state.',
    '',
    'THE FIX (CAPTURE_VISIBLE=1): during the live capture walk, treat a node as EFFECTIVELY HIDDEN (skip it + its subtree) when, via getComputedStyle on the live element (self OR an ancestor): visibility:hidden/collapse, OR opacity===0, OR display:none (likely already skipped), OR it is CLIPPED fully outside a clipping ancestor (overflow hidden/clip AND the node\'s rect is entirely outside that ancestor\'s rect), OR positioned fully OFF-SCREEN (rect entirely left of 0, above 0, or beyond the doc width with a clipping/overflow context). BE CONSERVATIVE — only skip when CONFIDENT it is non-visible (a normal in-flow visible element must NEVER be dropped). Do NOT skip merely-below-the-fold content (that IS visible on scroll).',
    '',
    'GATE (run flag-on captures; RESTORE on any fail):',
    '1. flag-OFF byte-identical: with CAPTURE_VISIBLE unset, the walk is unchanged (read the diff — all new skip-logic under the flag).',
    '2. PROVEN-SITES NO CONTENT LOSS (CRITICAL — over-filtering guard): capture ' + SUPA + ' and ' + TW + ' BOTH with and without CAPTURE_VISIBLE=1; the flag-on leaf count must be ~equal to flag-off (within a few %) AND all key headings/text still present (these sites have no big hidden mega-menus, so the filter should drop ~nothing). If either loses real visible content -> FAIL.',
    '3. VERCEL nav shrinks: capture ' + VERCEL + ' with CAPTURE_VISIBLE=1, segment -> the top nav band should shrink dramatically (the ~804px hover-hidden dropdown block dropped, toward a ~64px real nav). Report the nav band height off vs on. NOTE: if vercel\'s dropdowns render VISIBLY (opacity 1) in headless rather than hidden, the filter correctly will NOT drop them -> report that (then it is a headless-render issue, not fixable by visibility-filtering; still gate on #1+#2 and report kept=false honestly).',
    '4. no-h-scroll + valid: build a flag-on capture (e.g. supabase) --dry --selftest prints OK.',
    'kept = gate1 AND gate2 (no proven-site content loss) AND gate3 (vercel nav meaningfully shrinks) AND gate4. If gate3 cannot pass because vercel renders dropdowns visibly in headless, kept=false + RESTORE + explain (headless-render issue).',
    '',
    'END YOUR REPLY with one line exactly: "VERDICT: KEPT" or "VERDICT: NOT-KEPT". Before it, report: flag-off-byte-identical (yes/no), supabase leaf off/on, tailwind leaf off/on, vercel nav-band height off/on, no-h-scroll (yes/no).',
  ].join('\n'),
  { label: 'build:nav-hidden', phase: 'Build+Gate' }
)

const buildKept = /VERDICT:\s*KEPT/i.test(String(build || ''))
if (!buildKept) {
  log('nav-hidden build VERDICT not KEPT — recorded not-kept (agent should have restored; driver re-checks capture-layout)')
  return { kept: false, reason: 'build gate failed (over-filter risk or vercel renders dropdowns visibly in headless)', build: String(build || '').slice(0, 1500) }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer. FALSIFY. Work in ' + GRADER + '. Do NOT edit files. FOUNDATIONAL capture file — be extra skeptical; a node-dropping filter risks losing real content. Return PLAIN TEXT.',
    'capture-layout.mjs gained CAPTURE_VISIBLE (default OFF): skips effectively-hidden subtrees. Implementer reported KEPT (proven sites no content loss, vercel nav shrank).',
    'VERIFY: (1) diff — ALL new skip-logic gated behind CAPTURE_VISIBLE (flag-off unchanged)? (2) OVER-FILTER CHECK (critical): capture ' + SUPA + ' with CAPTURE_VISIBLE=1 yourself; compare leaf count + key headings to flag-off — NO real visible content may be lost. (3) capture ' + VERCEL + ' with CAPTURE_VISIBLE=1 — did the hidden nav block actually drop (nav band shrank) WITHOUT dropping the real visible nav links? (4) only capture-layout.mjs changed + node --check passes.',
    'END with one line exactly: "VERDICT: VERIFIED" or "VERDICT: FLAW" (with reason). Report the leaf counts you observed.',
  ].join('\n'),
  { label: 'verify:nav-hidden', phase: 'Verify' }
)

const verified = /VERDICT:\s*VERIFIED/i.test(String(verify || '')) && !/VERDICT:\s*FLAW/i.test(String(verify || ''))
return {
  kept: verified,
  verdict: verified
    ? 'ADOPTED (default-OFF) — CAPTURE_VISIBLE: skip hidden mega-menu/clipped subtrees, proven-sites no content loss, vercel nav un-flattened, independently verified'
    : 'NOT KEPT — gate or verify failed (over-filter or headless renders dropdowns visibly); capture-layout should be restored',
  build: String(build || '').slice(0, 1200),
  review: String(verify || '').slice(0, 1000),
}

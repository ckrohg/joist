export const meta = {
  name: 'headless-render-fidelity-diagnose',
  description: 'DIAGNOSE (read-mostly) whether capture-environment tweaks — prefers-color-scheme emulation, JS-settle/networkidle, interaction-state reset (no-hover/scroll-top) — make the HEADLESS capture match the real-browser design on dynamic sites (vercel dark? mega-menu closed? framer still dark?). Determine if the headless-render frontier is a tractable env-tweak (gated fix) or needs headed capture (finding). TEXT-return; no permanent capture-layout change unless a CLEAR gated win.',
  phases: [{ title: 'Diagnose' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const VERCEL = 'https://vercel.com/'
const FRAMER = 'https://www.framer.com/'
const SUPA = 'https://supabase.com/'

phase('Diagnose')
const r = await agent(
  [
    'DIAGNOSE the HEADLESS-RENDER-FIDELITY frontier (read-mostly experiment). Work in ' + GRADER + '. The capture (capture-layout.mjs, Playwright headless) does NOT match real-browser renders for dynamic sites: vercel.com renders LIGHT in headless (real design is dark), mega-menu dropdowns are captured OPEN (804px nav; real = closed-until-hover), canvas/gradient bgs missed. Build/filter fixes fight the symptom + mismatch the (wrong) headless grader. QUESTION: is this fixable with capture-ENVIRONMENT tweaks, or does it need a headed/real-browser capture path?',
    '',
    'Read capture-layout.mjs to see how it launches Playwright (browser/context/page options, waits, viewport). Then EXPERIMENT (use a TEMP copy /tmp/cl-exp.mjs or env-driven probes — do NOT permanently modify capture-layout.mjs unless a clear gated win emerges at the end). Test these capture-environment variations and MEASURE the effect on the captured tree (segment it; check band bg darkness + the top nav band height):',
    '  (A) prefers-color-scheme emulation: page.emulateMedia({ colorScheme: "dark" }) vs "light" vs default. Does colorScheme:"dark" make vercel render its DARK design (dark bands appear)? Does it harm supabase (a light page)?',
    '  (B) JS-settle: longer waitForLoadState("networkidle") + an extra settle delay + waiting for fonts/animations. Does more settle change what renders (canvas/gradient appear)?',
    '  (C) interaction-state reset before measuring: move mouse to (0,0)/away, blur active element, scroll to top, wait — does the mega-menu CLOSE (vercel top nav band height drops from ~804 toward ~64)? Is the mega-menu open because of a default hover/focus state the capture can reset?',
    '  (D) viewport / device-scale / reduced-motion: any effect.',
    '',
    'For each variation report: vercel dark-band count + top-nav-band height; supabase dark-band count (must STAY ~0 — a light page must not be wrongly darkened by colorScheme:dark) + leaf count; framer dark-band count (should stay >=3). ',
    '',
    'CONCLUDE (the deliverable): is the headless-render frontier (1) TRACTABLE via a capture-env tweak — name which setting(s) help, whether they are SAFE (no light-site regression), and whether they would be a gated default-off win; OR (2) NEEDS A HEADED/real-browser capture path (the env tweaks are insufficient) — an architectural finding for the user. Be concrete + truthful. If you find a CLEAR, SAFE, gated win (e.g., interaction-reset reliably closes the mega-menu with zero light-site regression), you MAY implement it in capture-layout.mjs behind a default-OFF flag + back up /tmp/cl.hf.bak first + report it; otherwise leave capture-layout.mjs UNCHANGED.',
    '',
    'END with one line: "VERDICT: ENV-TWEAK-WIN <flag>" (if you implemented a clear gated win) or "VERDICT: NEEDS-HEADED" or "VERDICT: INCONCLUSIVE", preceded by the per-variation measurements + your recommendation.',
  ].join('\n'),
  { label: 'diagnose:headless-fidelity', phase: 'Diagnose' }
)

log('headless-fidelity diagnose done: ' + String(r || '').slice(-200))
return { kept: /VERDICT:\s*ENV-TWEAK-WIN/i.test(String(r || '')), report: String(r || '').slice(0, 2500) }

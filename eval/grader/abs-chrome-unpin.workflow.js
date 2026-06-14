export const meta = {
  name: 'abs-chrome-unpin',
  description: 'DOMINANT ABS MOBILE BUG (surfaced by the abs-responsive port): build-absolute pins the editable full-width nav + footer (and unclassed page-absolute bg/chrome twins) at the SOURCE css width:1440px and never un-pins them -> docW=1440 at the 390 viewport -> horizontal scroll + left-edge clipping on EVERY abs clone at mobile. FIX: un-pin the full-bleed chrome to width:100% responsively at <=1024 (same scoped @media custom_css channel recipe #20 uses for the body), broaden the un-pin to catch the unclassed page-absolute twins, and guarantee no element keeps a fixed px width wider than the viewport at mobile. Reversible ABS_NO_CHROMEFIX=1. GATE: docW==viewport at 390 (no horizontal scroll) on supabase+vercel+tailwind abs builds AND desktop pixel-identical AND responsive term up / composite no-reg, else auto-restore.',
  phases: [
    { title: 'Diagnose+Fix', detail: 'find the 1440px source on nav/footer/bg twins; un-pin to 100% responsively at <=1024; behind ABS_NO_CHROMEFIX=1; node --check + selftest 1.0' },
    { title: 'Verify', detail: 'render 390/768/1440 on supabase+vercel+tailwind abs builds: docW==viewport@390, nav/footer full-width, desktop identical, responsive up / no-reg' },
    { title: 'Gate', detail: 'keep iff no mobile overflow + desktop identical + no-reg, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && export JOIST_BASE="${JOIST_BASE:-http://localhost:8001}"; case "$JOIST_BASE" in *sg-host.com*|*georges232*|*35.212.46.254*) echo "FATAL: JOIST_BASE=$JOIST_BASE is a blocked/paused host (host-guard allowlist; renders only target localhost:8001 or JOIST_TRAINING_BASE)"; exit 1;; esac'
const HARD = 'Edit ONLY build-absolute.mjs. Back it up FIRST: cp build-absolute.mjs /tmp/ev-bk-buildabs-chromefix.mjs. Do NOT edit capture/grade/perelement/build-flow. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Pro IS licensed on this configured 4.0.9 stack.'

const impl = await agent([HARD,
  'FIX the dominant abs mobile-overflow bug in build-absolute.mjs. Work in ' + GRADER + '. CONTEXT: a prior round proved that on EVERY abs clone the document is 1440px wide at the 390 viewport (horizontal scroll, content clipped off the left). Root cause: the editable full-width header <nav> + <footer> chrome (and some unclassed page-absolute bg/twin elements) are emitted at the SOURCE width (css width:1440px) and the existing <=1024 un-pin custom_css (scoped to .e-con>.elementor-absolute, ~lines 595-630) does NOT un-pin them (either they have an explicit fixed px width that overrides width:100%, or they are not matched by that selector).',
  'STEP A DIAGNOSE: read build-absolute.mjs around the header/nav emission (the prepended sticky header container), the footer emission, the abs-pin emit (_position/_element_width/_element_custom_width ~line 72), and the recipe #20 abs-responsive-unpin custom_css (~595-630). Identify EXACTLY where a fixed 1440px (or source-band px) width lands on the nav/footer/bg chrome, and which elements escape the un-pin selector. CONFIRM by building supabase (page 2986) + rendering at 390 (measure document.documentElement.scrollWidth — expect ~1440 now) and finding which element(s) are 1440px wide.',
  'STEP B FIX (minimal, robust): (1) emit the full-width chrome (nav header container, footer, full-bleed background bands) with width:100% / max-width:100% rather than a fixed source px width — OR add their _element_ids to the responsive un-pin so at <=1024 they get width:100%/max-width:100vw + left:0. (2) BROADEN the <=1024 un-pin custom_css so it also catches the unclassed page-absolute twins (e.g. add a rule like @media(max-width:1024px){ .elementor-element[data-... ]{...} } or target the specific chrome _element_ids; if needed add a defensive max-width:100vw on the page root container). (3) Ensure NO emitted element keeps an inline/px width greater than the viewport at mobile. Do NOT mask with body{overflow-x:hidden} as the ONLY fix — fix the actual widths (a single defensive overflow-x guard is acceptable as a belt-and-suspenders AFTER the real width fix).',
  'PRESERVE DESKTOP EXACTLY: desktop (>1024) rendering must be pixel-identical — only the <=1024 behavior of the chrome changes. The nav/footer must still be full-bleed at desktop.',
  'REVERSIBILITY: gate behind if (process.env.ABS_NO_CHROMEFIX === "1") -> old behavior. Default = fix ON.',
  'STEP 0: cp build-absolute.mjs /tmp/ev-bk-buildabs-chromefix.mjs. STEP 1 implement. node --check. STEP 2 SELFTEST: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0 (no grader change). STEP 3 SMOKE: build supabase (2986) fix ON, render at 390, confirm document.documentElement.scrollWidth <= ~400 (was ~1440). If node --check fails -> restore + RESTORED.',
  'Return PLAIN-TEXT "OK:" with the 1440px source you found + the fix + the supabase @390 scrollWidth BEFORE (ABS_NO_CHROMEFIX=1) and AFTER, or "RESTORED:".',
].join('\n'), { label: 'fix:abs-chrome-unpin', phase: 'Diagnose+Fix' })
log('IMPL: ' + String(impl || '').slice(0, 300))

const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
let verify = null
if (okImpl) {
  phase('Verify')
  const VS = { type: 'object', additionalProperties: false, properties: {
    site: { type: 'string' },
    scrollWidth390Off: { type: 'number' }, scrollWidth390On: { type: 'number' },
    navFooterResponsive: { type: 'boolean' }, desktopIdentical: { type: 'boolean' },
    respOff: { type: 'number' }, respOn: { type: 'number' }, compositeOff: { type: 'number' }, compositeOn: { type: 'number' },
    overflowFixed: { type: 'boolean' }, regressed: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['site', 'scrollWidth390Off', 'scrollWidth390On', 'desktopIdentical', 'overflowFixed', 'respOff', 'respOn', 'compositeOff', 'compositeOn', 'regressed', 'verdict'] }
  const SITES = [
    { name: 'supabase', url: 'https://supabase.com', page: 2986 },
    { name: 'vercel', url: 'https://vercel.com', page: 4296 },
    { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146 },
  ]
  verify = await parallel(SITES.map((s) => () => agent([HARD,
    'VERIFY the abs chrome-unpin fix on ONE site, ABS builder. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + '. Run ' + AUTH + ' before every WP command. You MUST end by calling StructuredOutput. Do NOT edit files.',
    'A/B BUILD (build-absolute.mjs --publish; reuse ONE shared capture): fix ON (default) and OFF (ABS_NO_CHROMEFIX=1).',
    'MOBILE OVERFLOW (isolated Playwright @390): measure document.documentElement.scrollWidth for OFF (scrollWidth390Off, expect ~1440) and ON (scrollWidth390On, expect <=~400). overflowFixed=true iff scrollWidth390On <= 400 (no horizontal scroll) while OFF was >400. Confirm nav + footer render full-width at 390 (navFooterResponsive).',
    'DESKTOP INVARIANT (@1440): ON vs OFF full-page render must be ~pixel-identical (desktopIdentical=true iff >=99% match AND same docH; the chrome must stay full-bleed at desktop).',
    'GRADE A/B: ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/acu-' + s.name + '-{on|off}. Report respOff/respOn (0.25 RLG term) + compositeOff/compositeOn. regressed=true iff compositeOn<compositeOff-0.01 OR desktopIdentical false.',
    'Judge like a human at 390: is the page now a clean full-width-fit column with no horizontal scroll, nav/footer spanning the viewport? Return {site, scrollWidth390Off, scrollWidth390On, navFooterResponsive, desktopIdentical, respOff, respOn, compositeOff, compositeOn, overflowFixed, regressed, verdict}.',
  ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify', schema: VS }))).then((rs) => rs.filter(Boolean))
  for (const r of verify) log('VERIFY ' + r.site + ': scrollW@390 ' + r.scrollWidth390Off + '->' + r.scrollWidth390On + ' overflowFixed=' + r.overflowFixed + ' dSame=' + r.desktopIdentical + ' resp ' + r.respOff + '->' + r.respOn + ' comp ' + r.compositeOff + '->' + r.compositeOn + ' reg=' + r.regressed)
}

phase('Gate')
let verdict
if (!okImpl) {
  verdict = 'REVERTED — impl failed: ' + String(impl || '').slice(0, 200)
} else {
  const v = verify || []
  const fixedAll = v.length && v.every((r) => r.overflowFixed && r.desktopIdentical)
  const anyReg = v.some((r) => r.regressed)
  const respHeld = v.every((r) => r.respOn >= r.respOff - 0.005)
  if (fixedAll && !anyReg && respHeld) {
    verdict = 'ADOPTED — abs chrome no longer overflows at mobile (' + v.map((r)=>r.site+' scrollW@390 '+r.scrollWidth390Off+'->'+r.scrollWidth390On+' resp '+r.respOff+'->'+r.respOn+' comp '+r.compositeOff+'->'+r.compositeOn).join(' | ') + '); desktop identical; no-reg. Broad mobile-fidelity win on the router PRIMARY. Reversible ABS_NO_CHROMEFIX=1. Unblocks the grid card-row reflow re-test.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-buildabs-chromefix.mjs build-absolute.mjs && node --check build-absolute.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
    verdict = 'REVERTED — ' + (!fixedAll ? 'overflow not fixed on all sites OR desktop changed' : anyReg ? 'a site regressed' : 'responsive term dropped') + '. ' + JSON.stringify(v.map((r)=>({s:r.site,sw:[r.scrollWidth390Off,r.scrollWidth390On],dSame:r.desktopIdentical,resp:[r.respOff,r.respOn],comp:[r.compositeOff,r.compositeOn],reg:r.regressed})))
  }
}
log('ABS-CHROME-UNPIN: ' + verdict)
return { verdict, impl: String(impl || '').slice(0, 500), verify }

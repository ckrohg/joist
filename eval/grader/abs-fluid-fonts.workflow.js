export const meta = {
  name: 'abs-fluid-fonts',
  description: 'RESEARCH WAVE-3 #2 (HIGH, wall B=responsive-TYPE, router PRIMARY): port flow proven clamp() fluid-font path into build-absolute. Today the abs builder pins FIXED px font-sizes -> at 390 the text renders at desktop size -> overflow + document-height inflation (the REAL narrow-width difference B1-disproof exposed). FIX: emit large text (headings/display, font-size >= ~20px where fixed-px hurts most) with a FLUID size clamp(minPx, maxPx/1440*100vw, maxPx) + unitless line-height, via the per-element scoped custom_css channel (same kses-safe channel recipe #20/#21 use). DESKTOP BYTE-IDENTICAL: at viewport 1440, max/1440*100vw == maxPx, so clamp == the captured desktop size. Small body text (<20px, already readable) stays fixed to bound custom_css size. Reversible ABS_NO_FLUIDFONT=1. GATE: desktop(1440) pixel-identical + 390 height-inflation/overflow DOWN (or responsive term up) + composite no-reg on supabase+tailwind+vercel, else auto-restore.',
  phases: [
    { title: 'Build', detail: 'clamp() fluid fonts for large text via per-element custom_css in build-absolute; behind ABS_NO_FLUIDFONT=1; node --check + selftest 1.0' },
    { title: 'Verify', detail: 'render 1440/768/390 on supabase+tailwind+vercel abs builds: desktop identical + 390 text scales (less overflow/height-inflation) + composite no-reg' },
    { title: 'Gate', detail: 'keep iff desktop-identical + 390 improves + no-reg, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Edit ONLY build-absolute.mjs. Back it up FIRST: cp build-absolute.mjs /tmp/ev-bk-buildabs-fluidfont.mjs. Do NOT edit capture/grade/perelement/build-flow. PRESERVE recipe #20 (abs-responsive-unpin) + #21 (abs-chrome-unpin) — build ON TOP. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Pro IS licensed on sg-host 4.0.9.'

const impl = await agent([HARD,
  'IMPLEMENT clamp() FLUID FONTS in build-absolute.mjs (wall B responsive-type, router primary). Work in ' + GRADER + '. Read build-absolute.mjs: nativeTypo() / wherever it emits typography_font_size (the fixed {unit:"px",size:N}), the per-element scoped custom_css emission (recipe #20/#21 channel — find how a per-element rule keyed to an _element_id is appended to page custom_css), and the text-widget emit path.',
  'WHY: fixed-px fonts mean a 48px desktop heading is STILL 48px at the 390 viewport -> it overflows / wraps to many lines / inflates document height (a real narrow-width fidelity loss). Flow already solved this with fluid clamp() (proved 390 height inflation 4.18->3.81). Port it to abs.',
  'THE CHANGE: for each TEXT widget whose captured font-size >= ~20px (headings/display/large text — where fixed-px hurts; SMALL body text <20px stays fixed to keep the custom_css bounded + it is already mobile-readable), instead of (or in addition to) the fixed typography_font_size, emit a per-element scoped custom_css rule: `selector { font-size: clamp(MINpx, MAXpx/1440*100vw, MAXpx) !important; line-height: LH; }` where MAX = the captured desktop px size, MIN = a readable floor (e.g. round(MAX*0.62) but not below 16px for body-ish / keep headings proportionally larger), LH = the captured line-height as a UNITLESS ratio (so it scales with font-size). The selector is the same per-element selector the abs custom_css already uses (keyed to the widget _element_id).',
  'DESKTOP-IDENTICAL MATH (critical): at viewport width 1440, 100vw = 1440px so MAXpx/1440*100vw = MAXpx -> clamp == MAX == the captured desktop size -> desktop renders byte-identical. VERIFY this holds (the grader renders desktop at 1440).',
  'Use clamp() in the px-vw-px form so it is pure CSS (kses-safe in custom_css). Do NOT touch the typography_font_size SETTING if that risks a double-apply — prefer emitting the clamp ONLY in custom_css with !important so it wins; OR set the setting to MAX and let custom_css override at narrow widths. Pick whichever renders desktop-identical + scales at narrow (verify by render).',
  'REVERSIBILITY: gate behind if (process.env.ABS_NO_FLUIDFONT === "1") -> fixed px (old). Default = fluid ON.',
  'STEP 0: cp build-absolute.mjs /tmp/ev-bk-buildabs-fluidfont.mjs. STEP 1 implement. node --check. STEP 2 SELFTEST: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0. STEP 3 SMOKE: build supabase (2986) fluid ON, render @1440 vs ABS_NO_FLUIDFONT=1 @1440 -> CONFIRM >=99.5% pixel-identical (desktop invariant); render @390 -> confirm large headings are SMALLER than the OFF build (text scaled) + document scrollHeight is LOWER (less inflation). If node --check fails OR desktop not identical -> restore + RESTORED.',
  'Return PLAIN-TEXT "OK:" with: how many text widgets got fluid fonts on supabase, the desktop @1440 ON-vs-OFF pixel match %, and the @390 docHeight ON vs OFF; or "RESTORED:".',
].join('\n'), { label: 'build:abs-fluid-fonts', phase: 'Build' })
log('IMPL: ' + String(impl || '').slice(0, 280))

const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
let verify = null
if (okImpl) {
  phase('Verify')
  const VS = { type: 'object', additionalProperties: false, properties: {
    site: { type: 'string' }, desktopMatchPct: { type: 'number' }, desktopIdentical: { type: 'boolean' },
    docH390Off: { type: 'number' }, docH390On: { type: 'number' }, scrollWidth390: { type: 'number' },
    respOff: { type: 'number' }, respOn: { type: 'number' }, compositeOff: { type: 'number' }, compositeOn: { type: 'number' },
    textScales: { type: 'boolean' }, regressed: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['site', 'desktopMatchPct', 'desktopIdentical', 'docH390Off', 'docH390On', 'respOff', 'respOn', 'compositeOff', 'compositeOn', 'textScales', 'regressed', 'verdict'] }
  const SITES = [
    { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146, why: 'big display headings' },
    { name: 'supabase', url: 'https://supabase.com', page: 2986, why: 'hero + section headings' },
    { name: 'vercel', url: 'https://vercel.com', page: 4296, why: 'large hero type' },
  ]
  verify = await parallel(SITES.map((s) => () => agent([HARD,
    'VERIFY abs fluid fonts on ONE site, ABS builder. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + ' (' + s.why + '). Run ' + AUTH + ' before every WP command. You MUST end by calling StructuredOutput. Do NOT edit files.',
    'A/B BUILD (build-absolute.mjs --publish; reuse ONE shared capture): fluid ON (default) and OFF (ABS_NO_FLUIDFONT=1).',
    'DESKTOP INVARIANT (@1440): ON vs OFF full-page render -> desktopMatchPct. desktopIdentical=true iff >=99.5% AND same docH (clamp==max@1440 must be byte-identical).',
    'MOBILE (@390 on the ON build): document.documentElement.scrollHeight = docH390On; also build a quick OFF render @390 for docH390Off. textScales=true iff large headings render visibly SMALLER ON vs OFF at 390 AND docH390On <= docH390Off (less inflation). scrollWidth390 (chrome-fix should keep ~390).',
    'GRADE A/B: ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/aff-' + s.name + '-{on|off}. respOff/respOn (0.25 RLG) + compositeOff/compositeOn. regressed=true iff compositeOn<compositeOff-0.01 OR desktopIdentical false.',
    'Judge like a human at 390: do the headings now fit/read well instead of being giant-desktop-size and wrapping/overflowing? Return {site, desktopMatchPct, desktopIdentical, docH390Off, docH390On, scrollWidth390, respOff, respOn, compositeOff, compositeOn, textScales, regressed, verdict}.',
  ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify', schema: VS }))).then((rs) => rs.filter(Boolean))
  for (const r of verify) log('VERIFY ' + r.site + ': desk ' + r.desktopMatchPct + '% docH@390 ' + r.docH390Off + '->' + r.docH390On + ' textScales=' + r.textScales + ' resp ' + r.respOff + '->' + r.respOn + ' comp ' + r.compositeOff + '->' + r.compositeOn + ' reg=' + r.regressed)
}

phase('Gate')
let verdict
if (!okImpl) {
  verdict = 'REVERTED — impl failed/desktop not identical: ' + String(impl || '').slice(0, 200)
} else {
  const v = verify || []
  const deskOK = v.length && v.every((r) => r.desktopIdentical)
  const mobileBetter = v.some((r) => r.textScales && r.docH390On <= r.docH390Off + 5)
  const anyReg = v.some((r) => r.regressed)
  if (deskOK && mobileBetter && !anyReg) {
    verdict = 'ADOPTED — abs fluid fonts: large text scales at narrow widths (desktop byte-identical, clamp==max@1440), 390 height-inflation/overflow DOWN, composite no-reg on the ROUTER PRIMARY (' + v.map((r)=>r.site+' desk '+r.desktopMatchPct+'% docH@390 '+r.docH390Off+'->'+r.docH390On+' resp '+r.respOff+'->'+r.respOn+' comp '+r.compositeOff+'->'+r.compositeOn).join(' | ') + '). Closes the abs<->flow responsive-type gap. Reversible ABS_NO_FLUIDFONT=1.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-buildabs-fluidfont.mjs build-absolute.mjs && node --check build-absolute.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
    verdict = 'REVERTED — ' + (!deskOK ? 'desktop NOT identical (clamp changed desktop render)' : !mobileBetter ? 'mobile did not improve (text did not scale / height not reduced)' : 'a site regressed') + '. ' + JSON.stringify(v.map((r)=>({s:r.site,desk:r.desktopMatchPct,dH:[r.docH390Off,r.docH390On],ts:r.textScales,resp:[r.respOff,r.respOn],comp:[r.compositeOff,r.compositeOn],reg:r.regressed})))
  }
}
log('ABS-FLUID-FONTS: ' + verdict)
return { verdict, impl: String(impl || '').slice(0, 500), verify }

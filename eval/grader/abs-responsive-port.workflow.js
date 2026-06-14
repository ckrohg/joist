export const meta = {
  name: 'abs-responsive-port',
  description: 'RESEARCH WAVE-2 #1 (HIGH, wall B=responsive, router PRIMARY): port true 3->2->1 card-row reflow into the ABS builder. Today build-absolute only does a crude everything->1col custom_css un-pin (recipe #20). Detect comparable-width card/logo ROWS (>=3 siblings) in the abs tree and emit ONLY those rows as a GRID container with flow-proven per-breakpoint grid_columns_grid + grid_columns_grid_tablet/mobile overrides (repeat(N)->repeat(2)->repeat(1)); keep all NON-row regions abs-pinned (desktop unchanged). PROBE-FIRST: a banked truth says flex children may NOT honor _element_custom_width on this stack while flow reflows via grid track overrides — so Phase-0 renders a minimal abs page with one card-row converted, at 1440/768/390, to confirm WHICH mechanism (grid-track overrides vs flex width%) actually reflows AND that desktop abs-pinning still works AND the elementor #19528 desktop-custom precondition. Only implement the mechanism that renders. Reversible ABS_NO_CARDREFLOW=1. GATE: card rows reflow 3->2->1 + desktop pinned-identical + responsive term UP + corpus no-reg, else auto-restore.',
  phases: [
    { title: 'Probe', detail: 'minimal abs page, 1 card-row -> grid-track-overrides vs flex-width%; render 1440/768/390; pick what reflows + keeps desktop pinned' },
    { title: 'Build', detail: 'detect card-rows in abs tree -> emit as grid w/ per-breakpoint overrides; non-rows stay pinned; behind ABS_NO_CARDREFLOW=1; node --check + selftest 1.0' },
    { title: 'Verify', detail: 'render 1440/768/390 on supabase+vercel abs builds: reflow 3->2->1 + desktop identical + responsive term up + composite no-reg' },
    { title: 'Gate', detail: 'keep iff reflow + desktop-identical + responsive-up + no-reg, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && export JOIST_BASE="${JOIST_BASE:-http://localhost:8001}"; case "$JOIST_BASE" in *sg-host.com*|*georges232*|*35.212.46.254*) echo "FATAL: JOIST_BASE=$JOIST_BASE is a blocked/paused host (host-guard allowlist; renders only target localhost:8001 or JOIST_TRAINING_BASE)"; exit 1;; esac'
const HARD = 'Edit ONLY build-absolute.mjs (Build phase). Back it up FIRST: cp build-absolute.mjs /tmp/ev-bk-buildabs-respport.mjs. Do NOT edit capture/grade/perelement/build-flow. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Pro IS licensed on this configured 4.0.9 stack.'

// ---- Phase 0: PROBE viability on a throwaway page (no builder edit yet) ----
const PROBE_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  gridOverrideReflows: { type: 'boolean' }, flexWidthReflows: { type: 'boolean' },
  desktopPinHolds: { type: 'boolean' }, desktopCustomPreconditionNeeded: { type: 'boolean' },
  gridColsAt: { type: 'string' }, flexColsAt: { type: 'string' },
  chosenMechanism: { type: 'string' }, viable: { type: 'boolean' }, notes: { type: 'string' },
}, required: ['gridOverrideReflows', 'flexWidthReflows', 'desktopPinHolds', 'chosenMechanism', 'viable', 'notes'] }
const probe = await agent([HARD.replace('Edit ONLY build-absolute.mjs (Build phase). ', 'PROBE PHASE — do NOT edit any builder file yet. '),
  'PROBE the abs-responsive mechanism on a THROWAWAY page (page 2990 framer slot is free to overwrite, or any scratch page id you confirm is disposable). Work in ' + GRADER + '. You MUST end by calling StructuredOutput. Goal: determine WHICH responsive mechanism actually reflows a card-row that lives inside an otherwise ABSOLUTE-positioned Elementor page on this configured 4.0.9 + Pro stack.',
  'Hand-author (via a small node script using fetch + the joist/v1 PUT path; mimic build-absolute.mjs auth + hash flow) a MINIMAL page: an abs-pinned hero band + ONE row of 3 comparable-width cards (each a container with a heading+text). Build TWO variants on two scratch pages:',
  'VARIANT G (grid-track overrides, flow-proven): the card-row = a GRID container with settings grid_columns_grid={unit:custom,size:"repeat(3,1fr)"} + grid_columns_grid_tablet={unit:custom,size:"repeat(2,1fr)"} + grid_columns_grid_mobile={unit:custom,size:"repeat(1,1fr)"}; cards are normal (non-abs) grid children. The rest of the page stays abs-pinned.',
  'VARIANT F (flex width%, the literal research recipe): the card-row = a FLEX container (flex-wrap) holding 3 cards each with _element_width=custom + _element_custom_width={unit:%,size:30} (desktop) + _element_custom_width_tablet={%,45} + _element_custom_width_mobile={%,100}. IMPORTANT elementor #19528 check: also test whether the tablet/mobile width overrides only apply when DESKTOP _element_width is explicitly "custom" (set it; if omitted does it no-op?).',
  'RENDER each variant in isolated Playwright at 1440 / 768 / 390 and COUNT the columns the card-row actually lays out at each width. Also confirm the abs-pinned hero is still correctly positioned at 1440 in BOTH (desktopPinHolds).',
  'Decide: gridOverrideReflows (G shows 3/2/1), flexWidthReflows (F shows 3/2/1), desktopPinHolds, desktopCustomPreconditionNeeded (#19528), chosenMechanism (grid|flex|none) = whichever reflows 3->2->1 AND keeps desktop pinned (PREFER grid per the banked truth that flex children may not honor _element_custom_width), viable=true iff a mechanism works. Report gridColsAt / flexColsAt as "1440/768/390" strings.',
  'Return {gridOverrideReflows, flexWidthReflows, desktopPinHolds, desktopCustomPreconditionNeeded, gridColsAt, flexColsAt, chosenMechanism, viable, notes}.',
].join('\n'), { label: 'probe:abs-responsive', phase: 'Probe', schema: PROBE_SCHEMA })
log('PROBE: gridReflows=' + (probe&&probe.gridOverrideReflows) + ' flexReflows=' + (probe&&probe.flexWidthReflows) + ' desktopPin=' + (probe&&probe.desktopPinHolds) + ' chosen=' + (probe&&probe.chosenMechanism) + ' viable=' + (probe&&probe.viable))

let verify = null, impl = null
if (probe && probe.viable && probe.chosenMechanism && probe.chosenMechanism !== 'none') {
  phase('Build')
  impl = await agent([HARD,
    'IMPLEMENT the abs-responsive card-row port in build-absolute.mjs using the PROBE-VALIDATED mechanism: chosenMechanism=' + probe.chosenMechanism + ' (gridColsAt=' + probe.gridColsAt + ' flexColsAt=' + probe.flexColsAt + ' desktopCustomPreconditionNeeded=' + probe.desktopCustomPreconditionNeeded + '). Probe notes: ' + String(probe.notes||'').slice(0,300),
    'Work in ' + GRADER + '. Read build-absolute.mjs: find the abs-pinning emit + the recipe #20 abs-responsive-unpin (the crude everything->1col custom_css media query). Find where rows/siblings are available (or add a detector).',
    'DETECT CARD-ROWS: a set of >=3 SIBLING leaves/containers that are (a) comparable width (within ~15% of the median), (b) horizontally laid out in one band (similar y, tiled x), (c) each non-trivial (has children/content). These are card/logo/feature rows. Everything else stays abs-pinned exactly as today.',
    'EMIT card-rows via the chosen mechanism: if grid -> wrap the row cells in a GRID container with grid_columns_grid repeat(N,1fr) desktop + grid_columns_grid_tablet repeat(2,1fr) + grid_columns_grid_mobile repeat(1,1fr) (set the desktop track FIRST per #19528 if desktopCustomPreconditionNeeded); cells become grid children (drop their abs _position). if flex -> per-breakpoint _element_custom_width 30/45/100 with desktop _element_width=custom set first. Keep the row container itself placed where the abs band was (so desktop is identical). DO NOT touch non-row regions — they stay pinned.',
    'KEEP recipe #20 for non-row content (it still un-pins the rest to 1col at mobile). The new code ONLY changes how detected card-rows reflow (proper N->2->1 instead of blanket 1col).',
    'REVERSIBILITY: gate behind if (process.env.ABS_NO_CARDREFLOW === "1") -> old behavior (all abs-pinned + recipe #20 blanket). Default = card-row reflow ON.',
    'STEP 0: cp build-absolute.mjs /tmp/ev-bk-buildabs-respport.mjs. STEP 1 implement. node --check build-absolute.mjs. STEP 2 SELFTEST (grader unchanged): ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0. STEP 3 SMOKE: build supabase (page 2986) with reflow ON, grep the emitted data to confirm >=1 detected card-row carries the per-breakpoint overrides. If node --check fails -> restore + say RESTORED.',
    'Return PLAIN-TEXT "OK:" with how many card-rows got the reflow on supabase + the mechanism used, or "RESTORED:".',
  ].join('\n'), { label: 'build:abs-responsive', phase: 'Build' })
  log('IMPL: ' + String(impl || '').slice(0, 280))

  const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
  if (okImpl) {
    phase('Verify')
    const VS = { type: 'object', additionalProperties: false, properties: {
      site: { type: 'string' }, desktopCols: { type: 'number' }, tabletCols: { type: 'number' }, mobileCols: { type: 'number' },
      desktopIdentical: { type: 'boolean' }, reflows: { type: 'boolean' },
      respOff: { type: 'number' }, respOn: { type: 'number' }, compositeOff: { type: 'number' }, compositeOn: { type: 'number' },
      regressed: { type: 'boolean' }, verdict: { type: 'string' },
    }, required: ['site', 'desktopIdentical', 'reflows', 'respOff', 'respOn', 'compositeOff', 'compositeOn', 'regressed', 'verdict'] }
    const SITES = [
      { name: 'supabase', url: 'https://supabase.com', page: 2986 },
      { name: 'vercel', url: 'https://vercel.com', page: 4296 },
    ]
    verify = await parallel(SITES.map((s) => () => agent([HARD,
      'VERIFY the abs-responsive card-row port on ONE site, ABS builder. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + '. Run ' + AUTH + ' before every WP command. You MUST end by calling StructuredOutput. Do NOT edit files.',
      'A/B BUILD (build-absolute.mjs --publish; reuse ONE shared capture so only the row-reflow differs): reflow ON (default) and OFF (ABS_NO_CARDREFLOW=1).',
      'RENDER (isolated Playwright at 3 widths on the ON build): count columns of a representative card-row at 1440 (desktopCols), 768 (tabletCols), 390 (mobileCols). reflows=true iff desktopCols>tabletCols>=mobileCols and mobile is 1-2 with no horizontal overflow (docW==viewport). Render the OFF build at 1440 and confirm desktopIdentical=true (reflow change invisible at desktop).',
      'GRADE A/B: ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/arp-' + s.name + '-{on|off}. Report respOff/respOn (the 0.25 RLG term) + compositeOff/compositeOn. regressed=true iff compositeOn<compositeOff-0.01 OR desktopIdentical false.',
      'Judge like a human at 390: is the card-row a clean 1-2 column stack of readable cards, not squished or overflowing? Return {site, desktopCols, tabletCols, mobileCols, desktopIdentical, reflows, respOff, respOn, compositeOff, compositeOn, regressed, verdict}.',
    ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify', schema: VS }))).then((rs) => rs.filter(Boolean))
    for (const r of verify) log('VERIFY ' + r.site + ': cols ' + r.desktopCols + '/' + r.tabletCols + '/' + r.mobileCols + ' reflows=' + r.reflows + ' dSame=' + r.desktopIdentical + ' resp ' + r.respOff + '->' + r.respOn + ' comp ' + r.compositeOff + '->' + r.compositeOn + ' reg=' + r.regressed)
  }
}

phase('Gate')
let verdict
if (!probe || !probe.viable || probe.chosenMechanism === 'none') {
  verdict = 'BLOCKED — probe found NO mechanism reflows a card-row inside an abs page on 4.0.9 (gridReflows=' + (probe&&probe.gridOverrideReflows) + ' flexReflows=' + (probe&&probe.flexWidthReflows) + ' desktopPin=' + (probe&&probe.desktopPinHolds) + '). ' + String(probe&&probe.notes||'').slice(0,300) + ' -> abs-responsive needs a different approach (e.g. scoped @media custom_css grid rules on the row wrapper). No builder edit made.'
} else if (!impl || !/\bOK:/i.test(String(impl)) || /\bRESTORED:/i.test(String(impl))) {
  verdict = 'REVERTED — probe OK (' + probe.chosenMechanism + ') but impl failed: ' + String(impl||'').slice(0,200)
} else {
  const v = verify || []
  const anyReflow = v.some((r) => r.reflows && r.desktopIdentical)
  const respUp = v.some((r) => r.respOn > r.respOff + 0.005)
  const anyReg = v.some((r) => r.regressed)
  if (anyReflow && respUp && !anyReg) {
    verdict = 'ADOPTED — abs builder now reflows card-rows 3->2->1 (' + probe.chosenMechanism + '), desktop pinned-identical, responsive term UP on the ROUTER PRIMARY (' + v.map((r)=>r.site+' '+r.desktopCols+'/'+r.tabletCols+'/'+r.mobileCols+' resp '+r.respOff+'->'+r.respOn+' comp '+r.compositeOff+'->'+r.compositeOn).join(' | ') + '). Reversible ABS_NO_CARDREFLOW=1. Cracks wall B on abs.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-buildabs-respport.mjs build-absolute.mjs && node --check build-absolute.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
    verdict = 'REVERTED — ' + (!anyReflow ? 'no clean reflow / desktop changed' : !respUp ? 'responsive term did not rise' : 'a site regressed') + '. ' + JSON.stringify(v.map((r)=>({s:r.site,cols:[r.desktopCols,r.tabletCols,r.mobileCols],dSame:r.desktopIdentical,resp:[r.respOff,r.respOn],comp:[r.compositeOff,r.compositeOn],reg:r.regressed})))
  }
}
log('ABS-RESPONSIVE-PORT: ' + verdict)
return { verdict, probe, impl: String(impl || '').slice(0, 500), verify }

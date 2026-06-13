export const meta = {
  name: 'ram-grid-responsive',
  description: 'RESEARCH BACKLOG #3 (HIGH, wall B=multi-breakpoint responsive): Responsive-Aware-Minmax (RAM) grid. For any flow grid of >=3 comparable-width card/logo cells, set grid_columns_grid={unit:custom, size:repeat(auto-fit, minmax(min(<median-cell>px,100%),1fr))} via the native grid custom channel — TRUE 3->2->1 reflow with ZERO media query, kses-safe. Desktop (the container width fits N columns) renders IDENTICALLY to the current fixed-track grid; only narrow widths reflow. Lifts the 0.25 responsive(RLG) term + makes recovered/multi-card content actually responsive (the gap exposed by research #1). Reversible via FLOW_NO_RAMGRID=1. GATE: KEEP iff responsive term UP at 768/390 AND desktop(1440) render byte-comparable AND corpus composite no-regression on the canonical sg-host stack. Else auto-restore.',
  phases: [
    { title: 'Build', detail: 'RAM grid in build-flow for >=3-comparable-cell rows, behind FLOW_NO_RAMGRID=1; node --check + selftest 1.0' },
    { title: 'Verify', detail: 'render at 1440/768/390 (reflow 3->2->1 + desktop identical) + responsive-term A/B + corpus no-reg on sg-host' },
    { title: 'Gate', detail: 'keep iff responsive up + desktop holds + no-reg, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
// AUTH GUARD (fixes the round-1 contamination: every agent MUST grade the SAME real stack)
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL: wrong JOIST_BASE=$JOIST_BASE (must be sg-host; do NOT use /tmp/joist-auth-1.env)"; exit 1; }'
const HARD = 'Edit ONLY build-flow.mjs. Back it up FIRST: cp build-flow.mjs /tmp/ev-bk-buildflow-ramgrid.mjs. Do NOT edit capture/grade/perelement/build-absolute. AUTH (run before every node command that talks to WP): ' + AUTH + '. Never print JOIST_AUTH_B64.'

const impl = await agent([HARD,
  'IMPLEMENT research backlog #3 — the RAM (Responsive-Aware-Minmax) grid in build-flow.mjs. Work in ' + GRADER + '. First READ build-flow.mjs: find where it emits a GRID container for a detected row/grid of cards/logos — the grid-detection + minmax-track recipes (search grid_columns_grid, repeat(, minmax(, grid-detection, the recipe #15/#17 code). Understand how it currently sets the column track template (likely a FIXED repeat(N, minmax(...)) or N 1fr tracks).',
  'WHY: a fixed N-column track never reflows — at 390px it stays N columns and overflows or shrinks each card to unreadable. Elementor responsive for containers normally needs per-breakpoint overrides, but a CSS-native auto-fit minmax track reflows with ZERO media query and is fully kses-safe (it rides the proven grid_columns_grid custom-unit channel that already round-trips).',
  'THE CHANGE: for a grid where the cells are >=3 and comparable-width (the existing detector already qualifies these rows — REUSE its gate; do NOT widen it to 1-2 cell rows or mixed-width rows), set the column track to: grid_columns_grid = { unit: "custom", size: "repeat(auto-fit, minmax(min(" + medianCellPx + "px, 100%), 1fr))" } where medianCellPx = the median captured cell width for that row. Keep grid_rows_grid / gap / alignment exactly as today. The min(<cell>px,100%) inner guard prevents overflow at very narrow widths; auto-fit collapses empty tracks so it reflows N->...->1 by available width. DESKTOP INVARIANT: at the container desktop width, auto-fit must still lay out the SAME N columns as today (medianCellPx chosen so floor(containerW/medianCellPx)==N) — verify this assumption and, if auto-fit would change desktop column count, clamp with a desktop max via the existing fixed track at >=1024 (but PREFER pure auto-fit if desktop count holds).',
  'REVERSIBILITY: gate behind if (process.env.FLOW_NO_RAMGRID === "1") -> emit the OLD fixed-track grid (default = RAM grid ON). This lets verify A/B cleanly and is the revert path.',
  'STEP 0: cp build-flow.mjs /tmp/ev-bk-buildflow-ramgrid.mjs. STEP 1 implement. node --check build-flow.mjs. STEP 2 SELF-TEST (grader unchanged so must hold): ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> composite 1.0. STEP 3 SMOKE: build supabase (page 2986) with RAM ON and grep the emitted _elementor_data (or the build log) to CONFIRM at least one grid_columns_grid carries repeat(auto-fit, minmax(min(...px,100%),1fr)). If node --check fails -> restore backup + say RESTORED.',
  'Return PLAIN-TEXT "OK:" with: how many qualifying grids got the RAM track on supabase, the medianCellPx + N for one example, and confirmation desktop column count is preserved; or "RESTORED:" if reverted.',
].join('\n'), { label: 'build:ram-grid', phase: 'Build' })
log('IMPL: ' + String(impl || '').slice(0, 300))

const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
let verify = null
if (okImpl) {
  phase('Verify')
  const VS = { type: 'object', additionalProperties: false, properties: {
    site: { type: 'string' },
    desktopCols: { type: 'number' }, tabletCols: { type: 'number' }, mobileCols: { type: 'number' },
    desktopIdentical: { type: 'boolean' }, reflows: { type: 'boolean' },
    respOff: { type: 'number' }, respOn: { type: 'number' },
    compositeOff: { type: 'number' }, compositeOn: { type: 'number' },
    regressed: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['site', 'desktopIdentical', 'reflows', 'respOff', 'respOn', 'compositeOff', 'compositeOn', 'regressed', 'verdict'] }
  const SITES = [
    { name: 'supabase', url: 'https://supabase.com', page: 2986, why: 'feature-card + logo-wall grids (flow home turf)' },
    { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146, why: 'card grids + comparison rows' },
    { name: 'vercel', url: 'https://vercel.com', page: 4296, why: 'multi-card product grid' },
  ]
  verify = await parallel(SITES.map((s) => () => agent([HARD,
    'VERIFY the RAM grid on ONE site. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' clonePage=' + s.page + ' (' + s.why + '). You MUST end by calling StructuredOutput. Do NOT edit any file. Run ' + AUTH + ' before every WP command.',
    'A/B BUILD: build the clone to page ' + s.page + ' with RAM ON (default) and OFF (FLOW_NO_RAMGRID=1) using build-flow.mjs --publish (one at a time; capture is shared — reuse one capture json for both builds so ONLY the grid track differs).',
    'RENDER REFLOW (isolated Playwright at 3 widths on the RAM-ON clone): count the columns in a representative card/logo grid at 1440 (desktopCols), 768 (tabletCols), 390 (mobileCols). reflows=true iff desktopCols > tabletCols >= mobileCols and mobileCols is small (1-2) — i.e. it genuinely reflows 3->2->1, not stuck N-wide (overflow) nor everything->1col collapse. ALSO render the RAM-OFF clone at 1440 and confirm desktopIdentical=true (RAM ON and OFF look the same at desktop — the change must be invisible on desktop).',
    'RESPONSIVE TERM + COMPOSITE A/B: ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/ramg-' + s.name + '-{on|off}. Report the RESPONSIVE sub-score (respOff/respOn — the 0.25 RLG term) and composite (compositeOff/compositeOn). regressed=true iff compositeOn < compositeOff - 0.01 OR desktopIdentical is false.',
    'Judge like a human: at 390px does the card grid become a clean single/double column of readable cards, or does it overflow / squish? Return {site, desktopCols, tabletCols, mobileCols, desktopIdentical, reflows, respOff, respOn, compositeOff, compositeOn, regressed, verdict}.',
  ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify', schema: VS }))).then((rs) => rs.filter(Boolean))
  for (const r of verify) log('VERIFY ' + r.site + ': cols ' + r.desktopCols + '/' + r.tabletCols + '/' + r.mobileCols + ' reflows=' + r.reflows + ' desktopSame=' + r.desktopIdentical + ' resp ' + r.respOff + '->' + r.respOn + ' composite ' + r.compositeOff + '->' + r.compositeOn + ' reg=' + r.regressed)
}

phase('Gate')
let verdict
if (!okImpl) {
  verdict = 'REVERTED — impl failed: ' + String(impl || '').slice(0, 200)
} else {
  const v = verify || []
  const anyReflow = v.some((r) => r.reflows && r.desktopIdentical)
  const respUp = v.some((r) => r.respOn > r.respOff + 0.005)
  const anyReg = v.some((r) => r.regressed)
  if (anyReflow && respUp && !anyReg) {
    verdict = 'ADOPTED — RAM grid gives true 3->2->1 reflow with zero media query, desktop identical (' + v.map((r)=>r.site+' '+r.desktopCols+'/'+r.tabletCols+'/'+r.mobileCols+' resp '+r.respOff+'->'+r.respOn+' comp '+r.compositeOff+'->'+r.compositeOn).join(' | ') + '). Lifts wall B (responsive). Reversible FLOW_NO_RAMGRID=1.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-buildflow-ramgrid.mjs build-flow.mjs && node --check build-flow.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
    verdict = 'REVERTED — ' + (!anyReflow ? 'no clean reflow OR desktop changed (auto-fit altered desktop column count)' : !respUp ? 'responsive term did not rise' : 'a site regressed') + '. ' + JSON.stringify(v.map((r)=>({s:r.site,cols:[r.desktopCols,r.tabletCols,r.mobileCols],dSame:r.desktopIdentical,resp:[r.respOff,r.respOn],comp:[r.compositeOff,r.compositeOn],reg:r.regressed})))
  }
}
log('RAM-GRID: ' + verdict)
return { verdict, impl: String(impl || '').slice(0, 600), verify }

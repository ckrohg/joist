export const meta = {
  name: 'abs-cardrow-reflow',
  description: 'WALL B re-attempt (UNBLOCKED by abs-chrome-unpin): give the ABS builder true 3->2->1 card-row reflow. The grid mechanism is PROVEN (grid_columns_grid + _tablet/_mobile breakpoint overrides compile + reflow on abs pages); flex _element_custom_width does NOT size flex container children. Prior attempt reverted on (a) mobile overflow [now FIXED] + (b) vercel desktop-flow shift. SHARPENED APPROACH that kills (b): abs-PIN the card-row CONTAINER at the bands EXACT (x,y,w,h) at desktop (so desktop is byte-identical — the container occupies exactly the source band, zero flow change), lay its children out as a GRID (repeat(N,1fr)), then at <=1024 un-pin the container (position:relative,height:auto,width:100%) + reflow grid (repeat(2)->repeat(1)) + release cell min_height (height:auto) + un-pin cell-relative leaf left-offsets. DETECTOR is STRICT: only CLEAN regular rows (>=3 siblings, comparable width +-15%, same y-band, ~equal x-gaps) where grid repeat(N,1fr) reproduces the desktop layout. Reversible ABS_NO_CARDREFLOW=1. GATE: desktop pixel-identical (>=99.5%) + mobile reflow 3->2->1 with no overflow + responsive UP + composite no-reg, else auto-restore.',
  phases: [
    { title: 'Build', detail: 'strict card-row detector -> abs-pinned grid container @desktop + un-pin/reflow @<=1024; behind ABS_NO_CARDREFLOW=1; node --check + selftest 1.0' },
    { title: 'Verify', detail: 'render 1440/768/390 on supabase+vercel: desktop >=99.5% identical + reflow 3->2->1 + no overflow + responsive up + no-reg' },
    { title: 'Gate', detail: 'keep iff desktop-identical + clean reflow + responsive-up + no-reg, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && export JOIST_BASE="${JOIST_BASE:-http://localhost:8001}"; case "$JOIST_BASE" in *sg-host.com*|*georges232*|*35.212.46.254*) echo "FATAL: JOIST_BASE=$JOIST_BASE is a blocked/paused host (host-guard allowlist; renders only target localhost:8001 or JOIST_TRAINING_BASE)"; exit 1;; esac'
const HARD = 'Edit ONLY build-absolute.mjs. Back it up FIRST: cp build-absolute.mjs /tmp/ev-bk-buildabs-cardreflow.mjs. Do NOT edit capture/grade/perelement/build-flow. The abs-chrome-unpin fix (recipe #21, ABS_NO_CHROMEFIX default ON) is ALREADY in build-absolute — keep it ON; build ON TOP of it. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Pro IS licensed on this configured 4.0.9 stack.'

const impl = await agent([HARD,
  'IMPLEMENT true 3->2->1 card-row reflow in build-absolute.mjs (wall B, router primary). Work in ' + GRADER + '. The grid MECHANISM is already PROVEN on this stack: grid_columns_grid {unit:custom,size:"repeat(N,1fr)"} + grid_columns_grid_tablet repeat(2,1fr) + grid_columns_grid_mobile repeat(1,1fr) compiles to real grid-template-columns and reflows. flex _element_custom_width does NOT work on flex container children — DO NOT use flex-width%.',
  'Read build-absolute.mjs: the abs-pin emit (_position/_offset/_element_width ~line 72), the prepended header, the recipe #20 abs-responsive-unpin custom_css (~595-630), and the recipe #21 chrome-unpin you must preserve.',
  'STRICT CARD-ROW DETECTOR (only fire where grid repeat(N,1fr) reproduces the desktop layout): a set of >=3 SIBLING leaves/containers that are (a) comparable width (each within +-15% of the median), (b) same y-band (tops within ~half a row height), (c) tiled horizontally with ~EQUAL x-gaps (gap variance small), (d) together span most of their parent band width. ONLY these qualify; anything irregular stays abs-pinned exactly as today.',
  'EMIT a qualifying card-row as a GRID CONTAINER, sharpened to keep DESKTOP BYTE-IDENTICAL: (1) the container is ABS-PINNED at the bands EXACT geometry — _position absolute, the bands x/y offset, _element_width custom = band width px, min_height = band height px (so at desktop it occupies precisely the source band -> zero document-flow change, fixing the prior vercel shift). (2) its children become GRID children (DROP their _position:absolute; let the grid place them) with grid_columns_grid repeat(N,1fr) (N = desktop column count) + the captured column/row gap. At the pinned band width, repeat(N,1fr) reproduces the N-column desktop layout. (3) per-breakpoint reflow: grid_columns_grid_tablet repeat(2,1fr), grid_columns_grid_mobile repeat(1,1fr).',
  'AT <=1024 (scoped @media custom_css keyed to the containers _element_id, same channel as recipe #20/#21): un-pin the container -> position:relative; height:auto; min-height:0; width:100%; left/top:auto (so it grows to its reflowed content) AND release the children -> height:auto; min-height:0; position:relative; left:auto;top:auto (kill desktop min_height + any cell-relative left-offset so cards size to content + do not bleed). EXCLUDE the card-row containers _element_id from any blanket rule that would force its grid to a single column; the grid_columns_grid_tablet/mobile overrides must drive the column count.',
  'PRESERVE the chrome-unpin (recipe #21) + everything else. REVERSIBILITY: gate behind if (process.env.ABS_NO_CARDREFLOW === "1") -> old behavior (all abs-pinned + recipe #20/#21 only). Default = card-row reflow ON.',
  'STEP 0: cp build-absolute.mjs /tmp/ev-bk-buildabs-cardreflow.mjs. STEP 1 implement. node --check. STEP 2 SELFTEST: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0. STEP 3 SMOKE: build supabase (2986) reflow ON, render @1440 vs an ABS_NO_CARDREFLOW=1 build @1440 and CONFIRM they are >=99.5% pixel-identical (the desktop-identical invariant — if not, the grid is NOT reproducing desktop -> tighten the detector or restore); render @390 and confirm the card-row is 1 column with no overflow (scrollWidth<=400). If node --check fails or desktop is not identical -> restore + RESTORED.',
  'Return PLAIN-TEXT "OK:" with: card-rows detected on supabase, the desktop @1440 ON-vs-OFF pixel-match %, and the @390 column count + scrollWidth; or "RESTORED:" with why.',
].join('\n'), { label: 'build:abs-cardrow-reflow', phase: 'Build' })
log('IMPL: ' + String(impl || '').slice(0, 300))

const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
let verify = null
if (okImpl) {
  phase('Verify')
  const VS = { type: 'object', additionalProperties: false, properties: {
    site: { type: 'string' }, desktopMatchPct: { type: 'number' },
    desktopCols: { type: 'number' }, tabletCols: { type: 'number' }, mobileCols: { type: 'number' }, scrollWidth390: { type: 'number' },
    desktopIdentical: { type: 'boolean' }, reflows: { type: 'boolean' },
    respOff: { type: 'number' }, respOn: { type: 'number' }, compositeOff: { type: 'number' }, compositeOn: { type: 'number' },
    regressed: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['site', 'desktopMatchPct', 'desktopIdentical', 'reflows', 'scrollWidth390', 'respOff', 'respOn', 'compositeOff', 'compositeOn', 'regressed', 'verdict'] }
  const SITES = [
    { name: 'vercel', url: 'https://vercel.com', page: 4296, why: 'the prior desktop-flow-shift stress test' },
    { name: 'supabase', url: 'https://supabase.com', page: 2986, why: 'multi-card + logo rows' },
  ]
  verify = await parallel(SITES.map((s) => () => agent([HARD,
    'VERIFY abs card-row reflow on ONE site, ABS builder. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + ' (' + s.why + '). Run ' + AUTH + ' before every WP command. You MUST end by calling StructuredOutput. Do NOT edit files.',
    'A/B BUILD (build-absolute.mjs --publish; reuse ONE shared capture so only the reflow differs): reflow ON (default) and OFF (ABS_NO_CARDREFLOW=1).',
    'DESKTOP INVARIANT (@1440, THE critical gate): full-page render ON vs OFF -> desktopMatchPct (% identical pixels). desktopIdentical=true iff desktopMatchPct>=99.5 AND same docH. (The container is abs-pinned at the band at desktop -> must be byte-identical; if not, the grid is not reproducing desktop.)',
    'MOBILE REFLOW: render the ON build at 1440/768/390 -> count a representative card-row columns (desktopCols/tabletCols/mobileCols) + document.documentElement.scrollWidth at 390 (scrollWidth390). reflows=true iff desktopCols>tabletCols>=mobileCols, mobileCols is 1-2, AND scrollWidth390<=400 (no overflow — the chrome-fix should hold this).',
    'GRADE A/B: ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/acr-' + s.name + '-{on|off}. respOff/respOn (0.25 RLG) + compositeOff/compositeOn. regressed=true iff compositeOn<compositeOff-0.01 OR desktopIdentical false.',
    'Judge like a human at 390: is the card-row a clean readable 1-2 column stack (no desktop-min_height whitespace, no left-edge bleed, no overflow)? Return {site, desktopMatchPct, desktopCols, tabletCols, mobileCols, scrollWidth390, desktopIdentical, reflows, respOff, respOn, compositeOff, compositeOn, regressed, verdict}.',
  ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify', schema: VS }))).then((rs) => rs.filter(Boolean))
  for (const r of verify) log('VERIFY ' + r.site + ': desktop ' + r.desktopMatchPct + '% cols ' + r.desktopCols + '/' + r.tabletCols + '/' + r.mobileCols + ' sw@390=' + r.scrollWidth390 + ' reflows=' + r.reflows + ' resp ' + r.respOff + '->' + r.respOn + ' comp ' + r.compositeOff + '->' + r.compositeOn + ' reg=' + r.regressed)
}

phase('Gate')
let verdict
if (!okImpl) {
  verdict = 'REVERTED — impl failed/desktop not identical at smoke: ' + String(impl || '').slice(0, 220)
} else {
  const v = verify || []
  const deskOK = v.length && v.every((r) => r.desktopIdentical)
  const anyReflow = v.some((r) => r.reflows)
  const respUp = v.some((r) => r.respOn > r.respOff + 0.005)
  const anyReg = v.some((r) => r.regressed)
  if (deskOK && anyReflow && respUp && !anyReg) {
    verdict = 'ADOPTED — abs builder reflows card-rows 3->2->1 (grid, container abs-pinned@desktop -> byte-identical), no mobile overflow, responsive UP on the ROUTER PRIMARY (' + v.map((r)=>r.site+' desk '+r.desktopMatchPct+'% '+r.desktopCols+'/'+r.tabletCols+'/'+r.mobileCols+' resp '+r.respOff+'->'+r.respOn+' comp '+r.compositeOff+'->'+r.compositeOn).join(' | ') + '). Cracks wall B on abs. Reversible ABS_NO_CARDREFLOW=1.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-buildabs-cardreflow.mjs build-absolute.mjs && node --check build-absolute.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
    verdict = 'REVERTED — ' + (!deskOK ? 'desktop NOT identical (grid not reproducing desktop layout -> abs builder cannot cleanly per-row reflow; the crude 1col un-pin recipe #20 stays the abs responsive answer)' : !anyReflow ? 'no clean reflow' : !respUp ? 'responsive term did not rise (grader may under-reward true reflow vs clean 1col -> investigate RLG)' : 'a site regressed') + '. ' + JSON.stringify(v.map((r)=>({s:r.site,desk:r.desktopMatchPct,cols:[r.desktopCols,r.tabletCols,r.mobileCols],sw:r.scrollWidth390,resp:[r.respOff,r.respOn],comp:[r.compositeOff,r.compositeOn],reg:r.regressed})))
  }
}
log('ABS-CARDROW-REFLOW: ' + verdict)
return { verdict, impl: String(impl || '').slice(0, 500), verify }

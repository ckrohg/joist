export const meta = {
  name: 'linkcols-css-columns-recipe',
  description: 'STRUCT_LINKCOLS (default OFF): emit long bare-anchor link lists (footer sitemaps / index lists) as a CSS multi-column block instead of a 1-per-row stack — fixes the basecamp footer 2.51x collapse. Gate byte-identical-off + heightRatio down + no h-scroll + corpus no-reg, then fresh-Claude verify.',
  phases: [
    { title: 'Build', detail: 'detect link-list clusters + emit CSS columns (column-width)' },
    { title: 'Verify', detail: 'fresh reviewer: byte-identical-off + no h-scroll + footer height down + no corpus regression' },
  ],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SUPA = '/tmp/glob-supa.json'
const BASELINE_OFF = '/tmp/colwidth-baseline.json'   // all-flags-off default (sha 11e8aba2)
const BC = '/tmp/br-basecamp.json'                   // basecamp source (footer link-list collapse, pageH 4909)
const BC_PAGEH = 4909
const PAGE = '12446'                                 // scratch page
const BC_CLONE_URL = '' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/incomplete-clone-scratch-was-12999/'
const BC_HEIGHTRATIO_BEFORE = 1.351                  // basecamp full-stack heightRatio WITHOUT linkcols

const SCHEMA = {
  type: 'object', additionalProperties: true,
  properties: {
    changed: { type: 'boolean' },
    flagOffByteIdentical: { type: 'boolean', description: 'all-flags-off dump == /tmp/colwidth-baseline.json' },
    selftestOk: { type: 'boolean' },
    corpusNoRegression: { type: 'boolean' },
    linkListsDetected: { type: 'number', description: 'how many link-list clusters were emitted as CSS columns (basecamp footer should be >=1)' },
    noHScroll: { type: 'boolean' },
    bcFooterRatioBefore: { type: 'number', description: 'basecamp footer/trailing section height ratio before (~2.51)' },
    bcFooterRatioAfter: { type: 'number', description: 'after — should drop toward ~1.x' },
    bcHeightRatioBefore: { type: 'number', description: '~1.351' },
    bcHeightRatioAfter: { type: 'number', description: 'whole-page — should DROP (footer was +743px)' },
    kept: { type: 'boolean', description: 'flagOffByteIdentical AND selftestOk AND corpusNoRegression AND noHScroll AND bcHeightRatioAfter < bcHeightRatioBefore AND bcFooterRatioAfter < bcFooterRatioBefore' },
    summary: { type: 'string' },
  },
  required: ['changed', 'kept', 'summary'],
}

phase('Build')
const build = await agent(
  [
    'Add STRUCT_LINKCOLS (default OFF) to build-structured.mjs (in ' + GRADER + ') — a CSS multi-column recipe for LONG BARE-ANCHOR LINK LISTS (footer sitemaps, index lists, "And there’s more" link grids). ADDITIVE/in-place to build-structured.mjs ONLY; default OFF byte-identical. Back up first: cp build-structured.mjs /tmp/bs.linkcols2.bak (restore on gate-fail).',
    '',
    'THE BUG (measured on basecamp, the dominant height inflator): the source footer "And there’s more" index is one compact CSS-columns <ul> (~220px, 34 anchors in N short columns); the builder STACKS all 34 anchors 1-per-row into ONE tall full-width column (live DOM: all 34 links at x=190) -> footer 492->1235px (ratio 2.51, +743px). RAM-grid (#35) only fires on comparable-width card/grid cells, NEVER on bare-anchor link lists, so there is NO multi-column-list recipe.',
    '',
    'THE FIX: detect a LINK-LIST cluster and emit it as a CSS multi-column block instead of a vertical stack.',
    '  - DETECT (conservative, to avoid mis-firing on real stacked content): a cluster of >=8 members where >=80% are bare anchors/links (kind==="button" with an href, OR tag==="a"), each SHORT (height < 56px), with little/no large non-anchor text interleaved, and they currently stack into a single x-column (a tall narrow run). A nav row (few links, one y-row) must NOT trigger (require >=8 + multi-row stack).',
    '  - EMIT: a container whose children are the anchors, with a scoped #linkcols-N{columns:<colW>px;column-gap:32px} custom_css rule (CSS multi-column auto-flows the anchors into as many columns as fit). colW = derive from the source: if the source anchors sit in K distinct x-clusters, set colW so ~K columns fit (colW ~= containerWidth/K - gap); else default colW ~= 200px (a typical sitemap column). Each anchor is display:block; break-inside:avoid. NEVER a bare fixed px width that causes h-scroll — columns + column-gap inside a width:100% container is kses-safe and cannot overflow horizontally (it adds columns, not width). Reuse the RAMCSS/COLWCSS custom_css injection channel.',
    '',
    'GATES (run + report; RESTORE from /tmp/bs.linkcols2.bak if any fails):',
    '- flagOffByteIdentical: node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/lc-off.json ; cmp to ' + BASELINE_OFF + ' (all flags off). MUST be byte-identical.',
    '- selftestOk: STRUCT_LINKCOLS=1 node build-structured.mjs --layout ' + BC + ' --selftest prints OK (no FAIL/h-scroll).',
    '- corpusNoRegression: STRUCT_LINKCOLS=1 ... --selftest OK on /tmp/glob-supa.json /tmp/cap-tailwind-off.json /tmp/ab-vercel-NEW.json /tmp/br-overreacted.json.',
    '- RENDER A/B on basecamp ' + PAGE + ': source /tmp/joist-auth.env (NEVER print JOIST_AUTH_B64). Publish FULL stack + linkcols (STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 STRUCT_LINKCOLS=1 ... --page ' + PAGE + ' --publish), capture ' + BC_CLONE_URL + '?v=RANDOM -> /tmp/lc-bc-clone.json. Segment it + the source ' + BC + '; bcHeightRatioAfter = clonePageH/' + BC_PAGEH + ' (was ' + BC_HEIGHTRATIO_BEFORE + '); bcFooterRatioAfter = the footer/trailing-section cloneH/srcH (was ~2.51). noHScroll = max leaf x1 <= 1440. linkListsDetected = #linkcols-N count.',
    '- kept = flagOffByteIdentical AND selftestOk AND corpusNoRegression AND noHScroll AND bcHeightRatioAfter < ' + BC_HEIGHTRATIO_BEFORE + ' AND bcFooterRatioAfter < 2.51.',
    '',
    'Report all fields. Be truthful — if CSS columns do not reduce the footer height (e.g. anchors do not flow), or it mis-fires on non-link content, report kept=false + restore.',
  ].join('\n'),
  { schema: SCHEMA, label: 'build:linkcols', phase: 'Build' }
)

if (!build || !build.changed || !build.kept) {
  log('linkcols build did not pass gate (changed=' + (build && build.changed) + ' kept=' + (build && build.kept) + ') — should be restored; recorded not-kept')
  return { kept: false, reason: 'gate failed', build }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer, no stake. FALSIFY. Work in ' + GRADER + '. Do NOT edit files.',
    'build-structured.mjs gained STRUCT_LINKCOLS (default OFF): long bare-anchor link lists -> CSS multi-column block (fixes the basecamp footer 2.51x collapse). Reported: flagOffByteIdentical=' + build.flagOffByteIdentical + ', noHScroll=' + build.noHScroll + ', linkListsDetected=' + build.linkListsDetected + ', bcFooterRatio ' + build.bcFooterRatioBefore + '->' + build.bcFooterRatioAfter + ', bcHeightRatio ' + build.bcHeightRatioBefore + '->' + build.bcHeightRatioAfter + '.',
    '',
    'VERIFY:',
    '1. FLAG-OFF BYTE-IDENTICAL: node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/rev-lc-off.json ; cmp to ' + BASELINE_OFF + '. If not identical -> FLAW.',
    '2. NO H-SCROLL: STRUCT_LINKCOLS=1 ... --selftest on basecamp + the 4 corpus captures all print OK. CSS columns must not introduce a bare fixed-px width. If any FAIL -> FLAW.',
    '3. NOT OVER-AGGRESSIVE: does the detector mis-fire on NON-link content (a real stacked list of cards/paragraphs becoming a cramped column flow)? Read the detector. Confirm a normal nav row (few links, 1 y-row) and a paragraph stack do NOT trigger. If it mis-fires on non-link content -> FLAW.',
    '4. Only build-structured.mjs changed. And the basecamp footer height actually dropped (bcFooterRatioAfter < 2.51).',
    'OUTPUT: "VERIFIED:" if 1+2+3+4 hold, else "FLAW-FOUND:". One line per check + evidence.',
  ].join('\n'),
  { label: 'verify:fresh-claude', phase: 'Verify' }
)

const verified = /\bVERIFIED:/i.test(String(verify || '')) && !/\bFLAW-FOUND:/i.test(String(verify || ''))
return {
  kept: verified && build.kept,
  verdict: (verified && build.kept)
    ? 'ADOPTED (default-OFF) — STRUCT_LINKCOLS: link-list CSS-columns recipe, basecamp footer un-collapsed, byte-identical-off, no h-scroll, independently verified'
    : 'NOT KEPT — gate or verify failed; build-structured.mjs restored',
  build,
  review: String(verify || '').slice(0, 1000),
}

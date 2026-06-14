export const meta = {
  name: 'flow-height-diagnostic',
  description: 'DIAGNOSTIC (NO file edits). After 3 flow rounds failed to fix the ~1.4-1.9x height drift via floor-pinning/capping, instrument the LIVE published flow clone (NOT the build-log predictor — proven decoupled from reality, 0.826 predicted vs 1.901 live) to measure per-top-level-section RENDERED height vs captured source box.h, and decompose WHY the worst sections inflate. Output ranked inflation causes -> a targeted fix directive for the next round. Read/run only; edits nothing.',
  phases: [
    { title: 'Measure', detail: 'build flow + publish + page.evaluate per-section inflation decomposition on tailwind + linear' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'READ/RUN ONLY — this is a DIAGNOSTIC: edit/move/delete NO files (not build-flow.mjs, not capture-layout.mjs, nothing). source /tmp/joist-auth.env for WP auth. Never use a corpus page id (2986/2988/2990/3146/4296/4297/4771). Never print JOIST_AUTH_B64.'
const SITES = [
  { name: 'supabase', url: 'https://supabase.com', page: 6006 },
  { name: 'vercel', url: 'https://vercel.com', page: 6009 },
]
const SCHEMA = { type: 'object', additionalProperties: false, properties: {
  site: { type: 'string' },
  liveHRatio: { type: 'number' },
  cloneDocH: { type: 'number' },
  srcDocH: { type: 'number' },
  worstSections: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    idx: { type: 'number' }, label: { type: 'string' }, srcBandH: { type: 'number' }, liveSectionH: { type: 'number' }, ratio: { type: 'number' },
    cause: { type: 'string' }, evidence: { type: 'string' },
  }, required: ['ratio', 'cause', 'evidence'] } },
  causeRanking: { type: 'array', items: { type: 'string' } },
  targetedFixDirective: { type: 'string' },
}, required: ['site', 'liveHRatio', 'worstSections', 'causeRanking', 'targetedFixDirective'] }

phase('Measure')
const out = await parallel(SITES.map((s) => () => agent([HARD_RULE,
  'DIAGNOSE flow height inflation on ONE site by instrumenting the LIVE render. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + '. You MUST end by calling StructuredOutput.',
  'SETUP (source /tmp/joist-auth.env first):',
  '  1. REUSE the capture from the generalization round: /tmp/fg-' + s.name + '.json (gives source box.h + sibling positions). If missing, node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/fg-' + s.name + '.json --passes 2.',
  '  2. node build-flow.mjs --layout /tmp/fg-' + s.name + '.json --page ' + s.page + '  (current build-flow with grid #15 + overlay #16; page ' + s.page + ' is the flow scratch page from the generalization round).',
  '  3. PUBLISH (POST wp/v2/pages/' + s.page + ' status=publish) + re-assert meta._elementor_edit_mode=builder. This must be a REAL tree render, not the post_content fallback.',
  'MEASURE (LIVE, via isolated Playwright page.evaluate at 1440 — do NOT trust any build-log predicted height; it is decoupled from reality):',
  '  A. Read srcDocH (source pageH) + per-top-level-section source box.h from /tmp/fg-' + s.name + '.json. Read cloneDocH = document.body scrollHeight of the published clone. liveHRatio = cloneDocH/srcDocH. (CONTEXT: supabase rendered hRatio 3.298 despite ssim 0.896/struct 1.0 + grid#15 & overlay#16 BOTH fired — so a THIRD inflation pattern is un-caught; vercel 1.46 is suspected hover mega-menu DOM captured as visible+stacked.)',
  '  B. For EACH top-level Elementor section/container (direct children of the elementor root), measure its LIVE offsetHeight. Match each to its source band (by order/content) and compute ratio = liveSectionH / srcBandH. Rank the 3 WORST-inflating (highest ratio, biggest absolute excess).',
  '  C. For each of those 3 worst sections, DECOMPOSE the inflation by inspecting the live DOM under it. Quantify which dominates:',
  '     (a) PADDING/GAP ACCUMULATION: sum the section\'s own padding + the gaps + paddings of its nested container chain; how many px of the excess is non-content (padding/gap/margin) vs actual leaf content?',
  '     (b) TEXT-WRAP: for the text leaves, count rendered line-count (offsetHeight / lineHeight) vs the source\'s line-count for the same text; is text wrapping to MORE lines than source (font-size too large or container too narrow)? Report a couple of concrete examples (text, clone lines vs source lines, clone font-size vs source font-size).',
  '     (c) VERTICAL-STACKING OF OVERLAPS: in the SOURCE capture, find sibling pairs whose boxes OVERLAP (IoU>0 or one contains the other); in the CLONE, are those same siblings stacked VERTICALLY (non-overlapping, each adding full height)? Count how many source-overlapping groups got linearized to a vertical stack, and estimate the px that adds.',
  '     (d) PHANTOM/HIDDEN DOM RENDERED VISIBLE: did the capture record content the SOURCE hides (hover mega-menus, dropdowns, modals, off-screen carousel slides, tabs-not-active) and the clone renders it visible+stacked, adding height the source never shows? (vercel\'s hover mega-menu is the prime suspect.) Count the px.',
  '     (e) GRID-ROW HEIGHT INFLATION: a grid FIRED (recipe #15) but its ROWS render taller than source — cards taller than their source counterparts, or per-row height = max(tall card) stacked across many rows. Compare clone grid total height vs source grid box.h. (supabase is bento-grid-heavy; gridFired=true yet hRatio 3.298, so a grid that tiles horizontally but inflates vertically is a prime suspect.)',
  'CONCLUDE: rank the causes (a)/(b)/(c) by px-contribution to the excess height on THIS site, with concrete numbers. Then write a SINGLE targetedFixDirective: the most precise build-flow.mjs change that would BOUND (not floor) the dominant cause — e.g. "scale section font-size/padding by measured ratio", "pin source-overlapping sibling subtrees absolutely so they layer instead of stacking", "collapse the accumulated nested-container padding/gap chain". Be specific about which cause dominates and the mechanism.',
  'Return {site, liveHRatio, cloneDocH, srcDocH, worstSections[{idx,label,srcBandH,liveSectionH,ratio,cause,evidence}], causeRanking[], targetedFixDirective}.',
].join('\n'), { label: 'diag:' + s.name, phase: 'Measure', schema: SCHEMA }))).then((rs) => rs.filter(Boolean))

for (const r of out) log('DIAG ' + r.site + ': liveHRatio ' + r.liveHRatio + ' | causes ' + (r.causeRanking || []).join(' > '))
return { diagnostics: out }

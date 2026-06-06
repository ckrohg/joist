export const meta = {
  name: 'build-responsive-grader',
  description: 'Build a NEW shadow grader module grade-responsive.mjs implementing RLG-based responsive fidelity (research w8zxa9aec / ReDeCheck ISSTA 2017): capture source+clone at 5 widths, build a Responsive Layout Graph per page (visible element nodes + pairwise relationship edges with viewport-width RANGES), grade by source-vs-clone edge-set agreement + an Applitools-Layout-style per-width relative-position score. Self-test source-vs-source=1.0. SMOKE-validate it DISCRIMINATES: the desktop-frozen absolute builder should score LOW responsive, the reflowing flow builder HIGHER. NEW file only — never edits capture-layout/build-absolute/grade-sections (only RUNS capture-layout, which is safe even with a directed-fix round active since that round edits build-absolute only).',
  phases: [
    { title: 'Build', detail: 'implement grade-responsive.mjs (RLG, 5 widths) + self-test=1.0' },
    { title: 'Smoke', detail: 'prove it discriminates: absolute(tailwind, frozen) LOW vs flow(linear, reflows) HIGH' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const KN = '/Users/ckrohg/Documents/Claude/tenet-elementor/knowledge'
const SCHEMA = { type: 'object', additionalProperties: false, properties: {
  built: { type: 'boolean' }, file: { type: 'string' }, nodeCheckPass: { type: 'boolean' }, selfTestResponsive: { type: 'number' },
  discriminates: { type: 'boolean' },
  smoke: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    label: { type: 'string' }, page: { type: 'number' }, responsiveScore: { type: 'number' }, perBreakpoint: { type: 'string' }, note: { type: 'string' },
  }, required: ['label', 'responsiveScore'] } },
  algorithmSummary: { type: 'string' }, openIssues: { type: 'array', items: { type: 'string' } },
}, required: ['built', 'nodeCheckPass'] }

const r = await agent([
  'Build a NEW responsive-fidelity grader. Work in ' + GRADER + '. Read ' + KN + '/RESPONSIVE_AND_MOTION_GRADING.md FIRST (the RLG design + extraction recipe). This is a NEW file grade-responsive.mjs — do NOT edit capture-layout.mjs / build-absolute.mjs / grade-sections.mjs (you may READ + RUN capture-layout.mjs).',
  'CONTRACT: node grade-responsive.mjs --source <url> --clone <url> [--out dir]  -> prints + writes a responsiveScore in [0,1] + per-breakpoint detail.',
  'ALGORITHM (RLG, per the doc): for BOTH source and clone, at widths [390,768,1024,1440,1920] (a reasonable subset is fine; you MAY add binary-search between adjacent differing samples if cheap): render in Playwright, collect VISIBLE element nodes with their bounding boxes; build pairwise RELATIONSHIP edges among sibling/parent-child element pairs — relationship type in {left-of, right-of, above, below, overlap, contains} — and record, per pair, the set of widths at which each relationship holds (collapse to width RANGES = the (amin,amax,t,P) tuple). Then GRADE = edge-set agreement: the fraction of SOURCE element-pairs whose relationship + alignment + breakpoint-range the CLONE reproduces (match source pairs to clone pairs by text/position the same way perelement-score does; reuse that matching if helpful). ALSO compute an Applitools-"Layout"-style per-width score = relative-position agreement of matched elements at each width (ignore color/content). responsiveScore = blend (e.g. 0.6*edge-set-agreement + 0.4*mean per-width layout score). Keep it ROBUST + bounded in runtime (cap node count per page, e.g. top N by area; 5 widths). Reuse capture-layout or a lighter inline DOM-rect probe — your call, but keep it self-contained in grade-responsive.mjs.',
  'SELF-TEST (HARD): grade-responsive --source X --clone X (same URL both sides) MUST return responsiveScore = 1.0 (a page is perfectly responsive-consistent with itself). Build a --selftest flag that asserts this on https://tailwindcss.com and prints PASS/FAIL.',
  'SMOKE / DISCRIMINATION (the proof this metric is meaningful): grade the EXISTING corpus clones (source /tmp/joist-auth.env; do NOT rebuild): (1) tailwind ABSOLUTE clone https://georges232.sg-host.com/?page_id=3146 — the absolute builder is DESKTOP-PIXEL-FROZEN, so it should score LOW responsive; (2) linear FLOW clone https://georges232.sg-host.com/?page_id=5404 — the flow builder reflows (collapses grids at 768/390), so it should score HIGHER responsive. Report both responsiveScores. discriminates=true iff flow(linear 5404) > absolute(tailwind 3146) responsive by a clear margin (this validates the metric captures real responsiveness). If they do NOT separate, the metric is mis-built — say so in openIssues.',
  'node --check grade-responsive.mjs. Return {built, file, nodeCheckPass, selfTestResponsive, discriminates, smoke:[{label,page,responsiveScore,perBreakpoint,note}], algorithmSummary, openIssues}.',
].join('\n'), { label: 'build:grade-responsive', phase: 'Build', schema: SCHEMA }).catch((e) => ({ built: false, nodeCheckPass: false, openIssues: ['failed: ' + (e && e.message)] }))

log('RESPONSIVE GRADER: built=' + r.built + ' selfTest=' + r.selfTestResponsive + ' discriminates=' + r.discriminates)
if (r.smoke) for (const s of r.smoke) log('  ' + s.label + ' (p' + s.page + '): responsive ' + s.responsiveScore)
return { r }

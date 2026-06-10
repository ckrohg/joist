export const meta = {
  name: 'grader-coverage-undercount-diagnostic',
  description: 'DIAGNOSTIC (NO edits). The framer flow clone recovered 316 widgets / 420 elementor-elements yet areaCoverage read only 0.0556 and composite moved just +0.087; tailwind capture has 146 leaves vs 514 DOM-visible texts. STRONG hint the GRADER CLONE-SIDE capture under-counts the actually-rendered widgets, deflating areaCoverage -> capping every flow composite + understating the cloner (a false-deflation, the user-flagged grader-lies-both-ways class). Instrument: count what the clone ACTUALLY renders vs what the grader RESOLVES, quantify the deflation, find the cause + the targeted (supervised) fix. Read/run only; edits nothing.',
  phases: [
    { title: 'Measure', detail: 'clone rendered-elements vs grader-resolved-nodes; quantify undercount + cause' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'READ/RUN ONLY — this is a DIAGNOSTIC: edit/move/delete NO files. source /tmp/joist-auth.env for WP auth. Never use the ABSOLUTE corpus page ids (2986/2988/2990/3146/4296/4297/4771). Never print JOIST_AUTH_B64.'
// framer = the loudest signal (420 elements, coverage 0.0556). tailwind = the height-solved control (1.053, yet coverage caps visual at 0.567).
const SITES = [
  { name: 'framer', url: 'https://www.framer.com', page: 6005 },
  { name: 'tailwind', url: 'https://tailwindcss.com', page: 5405 },
]
const SCHEMA = { type: 'object', additionalProperties: false, properties: {
  site: { type: 'string' },
  cloneRenderedElements: { type: 'number' },
  cloneRenderedLeaves: { type: 'number' },
  graderResolvedCloneNodes: { type: 'number' },
  areaCoverageReported: { type: 'number' },
  areaCoverageIfFullyCounted: { type: 'number' },
  isUndercount: { type: 'boolean' },
  undercountCause: { type: 'string' },
  affectsSourceSideToo: { type: 'string' },
  targetedFixDirective: { type: 'string' },
  honestVerdict: { type: 'string' },
}, required: ['site', 'cloneRenderedElements', 'graderResolvedCloneNodes', 'isUndercount', 'undercountCause', 'targetedFixDirective', 'honestVerdict'] }

phase('Measure')
const out = await parallel(SITES.map((s) => () => agent([HARD_RULE,
  'INVESTIGATE whether the grader UNDER-COUNTS the clone widgets (deflating areaCoverage). Work in ' + GRADER + '. site=' + s.name + ' published flow clone = sg-host page ' + s.page + '. You MUST end by calling StructuredOutput. BE SKEPTICAL BOTH WAYS — confirm OR refute the undercount with real numbers; do not assume.',
  'STEP 1 — READ how the grader captures the CLONE: read grade-sections.mjs + perelement-score.mjs to find the CLONE-side capture path (does it walk the clone DOM directly? reuse capture-layout? a separate node list?) and where areaCoverage / perElement coverage is computed (the source-region-vs-clone-widget matching). Note any flatten-cap, MAXD depth limit, leaf cap, or visibility filter applied to the CLONE capture.',
  'STEP 2 — COUNT what the clone ACTUALLY renders: isolated Playwright on https://georges232.sg-host.com/?page_id=' + s.page + ' at 1440 — page.evaluate count of .elementor-element (total), .elementor-widget (leaf widgets), visible text nodes, and <img>. This is the GROUND TRUTH of what the clone shows.',
  'STEP 3 — COUNT what the GRADER resolves: run node grade-sections.mjs --source ' + s.url + ' --clone "https://georges232.sg-host.com/?page_id=' + s.page + '" --out /tmp/gcov-' + s.name + ' and read the report — how many CLONE nodes/widgets did the grader resolve + match? what areaCoverage did it report? Compare graderResolvedCloneNodes to cloneRenderedElements/Leaves from STEP 2.',
  'STEP 4 — VERDICT: is there an undercount (graderResolvedCloneNodes << cloneRenderedLeaves)? If yes, what CAUSES it (the cap/limit/filter from STEP 1)? Estimate areaCoverageIfFullyCounted (what coverage WOULD be if the grader counted all rendered widgets). CRITICAL: does the same capture path also under-count the SOURCE (if so, the metric is symmetric and the undercount may NOT deflate the ratio — say so honestly)? A symmetric undercount on both source+clone may be self-cancelling; an asymmetric one (clone under-counted but source fully counted) is a real false-deflation.',
  'STEP 5 — targetedFixDirective: the precise (SUPERVISED) change to the grader CLONE-capture to count all rendered widgets, IF the undercount is real + asymmetric. If it is symmetric/self-cancelling or the clone is genuinely sparse, say NO-FIX and explain (the composite is honest; pursue cloner coverage instead).',
  'Return {site, cloneRenderedElements, cloneRenderedLeaves, graderResolvedCloneNodes, areaCoverageReported, areaCoverageIfFullyCounted, isUndercount, undercountCause, affectsSourceSideToo, targetedFixDirective, honestVerdict}.',
].join('\n'), { label: 'gcov:' + s.name, phase: 'Measure', schema: SCHEMA }))).then((rs) => rs.filter(Boolean))

for (const r of out) log('GCOV ' + r.site + ': clone renders ' + r.cloneRenderedElements + ' / grader resolves ' + r.graderResolvedCloneNodes + ' | undercount=' + r.isUndercount + ' | ' + r.honestVerdict)
return { diagnostics: out }

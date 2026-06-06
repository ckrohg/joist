export const meta = {
  name: 'flow-coverage-diagnostic',
  description: 'DIAGNOSTIC (NO cloner edits). Height is largely solved on flow (tailwind hRatio 1.053, linear 1.14) yet visual stays ~0.55 because areaCoverage ~0.19 starves every perElement sub-score. Before building the meaty region-capture pipeline, instrument WHAT the unmatched source area actually is — categorize it (genuine imagery to region-capture / real text the build dropped / empty-bg) and determine whether the CAPTURE json already has nodes for it (build drops them) or MISSES it (capture-side gap). Output a ranked coverage-gap breakdown + a targeted fix directive. Read/run only; edits nothing.',
  phases: [
    { title: 'Measure', detail: 'instrument source-vs-clone area coverage on tailwind (+framer); categorize the unmatched area; capture-has-nodes vs capture-misses' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'READ/RUN ONLY — this is a DIAGNOSTIC: edit/move/delete NO files. source /tmp/joist-auth.env for WP auth. Never use the ABSOLUTE corpus page ids (2986/2988/2990/3146/4296/4297/4771). Never print JOIST_AUTH_B64.'
// tailwind = clean pure-coverage signal (height SOLVED hRatio 1.053). framer = the imagery/video extreme (coverage 0.35, 20 videos->1).
const SITES = [
  { name: 'tailwind', url: 'https://tailwindcss.com', page: 5405, capture: '/tmp/cf3-tailwind.json' },
  { name: 'framer', url: 'https://www.framer.com', page: 6005, capture: '/tmp/fg-framer.json' },
]
const SCHEMA = { type: 'object', additionalProperties: false, properties: {
  site: { type: 'string' },
  areaCoverage: { type: 'number' },
  unmatchedAreaPct: { type: 'number' },
  breakdown: { type: 'object', additionalProperties: false, properties: {
    imageryPct: { type: 'number' }, textPct: { type: 'number' }, emptyBgPct: { type: 'number' },
  }, required: ['imageryPct', 'textPct', 'emptyBgPct'] },
  captureHasNodesForGap: { type: 'string' },
  worstRegions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    label: { type: 'string' }, areaPx: { type: 'number' }, kind: { type: 'string' }, inCaptureJson: { type: 'boolean' }, why: { type: 'string' },
  }, required: ['label', 'kind', 'why'] } },
  dominantGap: { type: 'string' },
  targetedFixDirective: { type: 'string' },
}, required: ['site', 'areaCoverage', 'breakdown', 'dominantGap', 'targetedFixDirective'] }

phase('Measure')
const out = await parallel(SITES.map((s) => () => agent([HARD_RULE,
  'DIAGNOSE the flow areaCoverage gap on ONE site by instrumenting source vs clone. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' flow page=' + s.page + '. You MUST end by calling StructuredOutput.',
  'SETUP (source /tmp/joist-auth.env first): the flow clone is already built+published on page ' + s.page + ' (from prior rounds); if its render looks stale, rebuild: node build-flow.mjs --layout ' + s.capture + ' --page ' + s.page + ' (capture exists; else capture-ensemble ' + s.url + ' to ' + s.capture + '), then publish + edit_mode=builder. Read the capture json ' + s.capture + ' to know what nodes the capture HAS.',
  'MEASURE areaCoverage + WHAT IS MISSING (isolated Playwright, 1440):',
  '  A. Render the SOURCE (' + s.url + ') and the CLONE (sg-host page ' + s.page + ') at 1440. Read the grader areaCoverage if available (grade-sections --out), else compute: fraction of source viewport-area (the visible page) that is covered by a matched clone widget box.',
  '  B. PARTITION the SOURCE page into its leaf/region boxes (from the rendered source DOM via page.evaluate, OR from the capture json). For each source region NOT covered by a clone widget (UNMATCHED), categorize it:',
  '     (a) IMAGERY — the source region is visually rich: contains <img>/<svg>/<canvas>/<video>, or a CSS background-image/gradient, or is a graphic/illustration/screenshot/chart with LITTLE real text. (region-capturing THESE as images is allowed — images may be copied.)',
  '     (b) TEXT — the region is real prose/headings/links the clone FAILED to place (must be rebuilt, never rasterized).',
  '     (c) EMPTY/BG — whitespace or a solid background band (no real content).',
  '  Quantify the px-area split: of the unmatched area, what % is (a) imagery vs (b) text vs (c) empty/bg? Give the 3-5 worst unmatched regions with their area + kind.',
  '  C. For the IMAGERY + TEXT unmatched regions: is there a corresponding NODE in the capture json ' + s.capture + ' (so build-flow DROPPED it) or is it ABSENT from the capture (a capture-side MISS)? This decides whether the fix is build-side (emit dropped nodes) or capture-side (region-screenshot / better capture).',
  'CONCLUDE: dominantGap (one line: e.g. "imagery not captured — N% of unmatched area is CSS-drawn graphics/screenshots absent from the capture json -> needs region-screenshot capture" or "text dropped by build -> emit them"). Then a SINGLE targetedFixDirective: the most precise change to lift coverage, honoring the rule (images may be region-captured; WORDS must be rebuilt, never rasterized). Be specific about capture-side vs build-side + the mechanism.',
  'Return {site, areaCoverage, unmatchedAreaPct, breakdown:{imageryPct,textPct,emptyBgPct}, captureHasNodesForGap, worstRegions[{label,areaPx,kind,inCaptureJson,why}], dominantGap, targetedFixDirective}.',
].join('\n'), { label: 'cov:' + s.name, phase: 'Measure', schema: SCHEMA }))).then((rs) => rs.filter(Boolean))

for (const r of out) log('COV ' + r.site + ': areaCoverage ' + r.areaCoverage + ' | imagery ' + (r.breakdown && r.breakdown.imageryPct) + '% text ' + (r.breakdown && r.breakdown.textPct) + '% | ' + r.dominantGap)
return { diagnostics: out }

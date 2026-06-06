export const meta = {
  name: 'build-flow-ab',
  description: 'A/B-only run for the flow builder: build-flow.mjs ALREADY has the v2 edits (node --check OK, tablet/mobile grid cols present) — the prior iterate run crashed only on the StructuredOutput return, after the edits landed. So skip Fix, just A/B tailwind+linear (PUBLISHED) vs absolute baselines + responsiveness. Read/run-only on capture-ensemble/grade-sections; writes only to non-corpus pages 5404/5405.',
  phases: [{ title: 'AB', detail: 'capture-ensemble + build-flow(v2) + PUBLISH + grade tailwind & linear; responsive 768/390' }],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'HARD SAFETY (a directed-fix round runs concurrently): do NOT edit build-flow.mjs or any cloner/grader file — READ/RUN only. Use ONLY pages 5404 (linear) / 5405 (tailwind) for output (non-corpus). Never print JOIST_AUTH_B64. source /tmp/joist-auth.env first. You MUST end by calling StructuredOutput with the result object — this is mandatory.'
const AB_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  site: { type: 'string' }, page: { type: 'number' }, flowComposite: { type: 'number' }, prevFlow: { type: 'number' }, absBaseline: { type: 'number' },
  hRatio: { type: 'number' }, ssim: { type: 'number' }, visual: { type: 'number' }, struct: { type: 'number' }, edit: { type: 'number' }, color: { type: 'number' }, coverage: { type: 'number' },
  responsive: { type: 'string' }, verdict: { type: 'string' }, nextFixes: { type: 'array', items: { type: 'string' } },
}, required: ['site', 'flowComposite', 'verdict'] }
const SITES = [
  { name: 'tailwind', url: 'https://tailwindcss.com', page: 5405, absBaseline: 0.85, prevFlow: 0.712 },
  { name: 'linear', url: 'https://linear.app', page: 5404, absBaseline: 0.776, prevFlow: 0.692 },
]
phase('AB')
const ab = await parallel(SITES.map((s) => () => agent([HARD_RULE,
  'A/B the v2 flow builder on ONE site. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + '. abs baseline=' + s.absBaseline + ', prev flow v1=' + s.prevFlow + ' (numbers to beat). build-flow.mjs is ALREADY v2-edited (bounded hRatio + responsive grid/overlay collapse) — do NOT edit it, just run it.',
  'STEPS (sequential):',
  '  1. node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/cf2-' + s.name + '.json --passes 2',
  '  2. node build-flow.mjs --layout /tmp/cf2-' + s.name + '.json --page ' + s.page,
  '  3. CRITICAL: PUBLISH the page (POST wp/v2/pages/' + s.page + ' status=publish) BEFORE grading — drafts render BLANK to anonymous and give a false 0. Re-assert meta._elementor_edit_mode=builder.',
  '  4. node grade-sections.mjs --source ' + s.url + ' --clone "https://georges232.sg-host.com/?page_id=' + s.page + '" --out /tmp/cfg2-' + s.name + ' ; read report.composite, structuralFidelity, visualMean, editabilityMean, ssimRaw, hRatio (or heightRatio), perElement.color, perElement.coverage.',
  '  5. RESPONSIVE: screenshot the published clone at 768 and 390 (isolated Playwright: node a small script or use a fresh chromium.launch); assert docW <= viewport (no h-overflow) and grids collapse. Describe what you see.',
  'Report REAL numbers (do NOT inflate). Did v2 beat v1 (' + s.prevFlow + ')? Did hRatio drop toward 1.0? top 2 nextFixes.',
  'Return {site, page, flowComposite, prevFlow, absBaseline, hRatio, ssim, visual, struct, edit, color, coverage, responsive, verdict, nextFixes[]}. END by calling StructuredOutput.',
].join('\n'), { label: 'ab:' + s.name, phase: 'AB', schema: AB_SCHEMA }))).then(rs => rs.filter(Boolean))
for (const r of ab) log('AB ' + r.site + ': flow-v2 ' + r.flowComposite + ' (v1 ' + r.prevFlow + ', abs ' + r.absBaseline + ') hRatio ' + r.hRatio + ' -> ' + r.verdict)
return { ab }

export const meta = {
  name: 'flow-rebaseline',
  description: 'RE-BASELINE after the grader-deep-flatten adoption (mandatory post-grader-change step). Re-grade the 7 existing PUBLISHED flow clone pages + 1 absolute control on the honest grader, in BOTH modes (deep-flatten ON = honest, vs GRADER_NO_DEEP_FLATTEN=1 = old) to quantify the per-site deflation that was corrected + produce the honest flow-corpus-mean (the absolute->flow transition input). NO rebuild (pages already built+published), NO cloner edits — pure re-measurement. Confirms the absolute corpus is ~unchanged (absolute clones are shallow).',
  phases: [
    { title: 'Regrade', detail: 'grade 7 flow pages + 1 absolute control in both grader modes; honest composite + deep-flatten delta' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'READ/GRADE ONLY — edit NO files. Do NOT rebuild (the clones are already built+published); just grade. source /tmp/joist-auth.env for WP auth. Never print JOIST_AUTH_B64.'
const SITES = [
  { name: 'tailwind', url: 'https://tailwindcss.com', page: 5405, builder: 'flow' },
  { name: 'linear', url: 'https://linear.app', page: 5404, builder: 'flow' },
  { name: 'supabase', url: 'https://supabase.com', page: 6006, builder: 'flow' },
  { name: 'framer', url: 'https://www.framer.com', page: 6005, builder: 'flow' },
  { name: 'reactdev', url: 'https://react.dev', page: 6007, builder: 'flow' },
  { name: 'resend', url: 'https://resend.com', page: 6008, builder: 'flow' },
  { name: 'vercel', url: 'https://vercel.com', page: 6009, builder: 'flow' },
  { name: 'tailwind-ABS-control', url: 'https://tailwindcss.com', page: 3146, builder: 'absolute' },
]
const SCHEMA = { type: 'object', additionalProperties: false, properties: {
  site: { type: 'string' }, page: { type: 'number' }, builder: { type: 'string' },
  compositeHonest: { type: 'number' }, compositeOld: { type: 'number' }, deltaFromDeepFlatten: { type: 'number' },
  areaCoverageHonest: { type: 'number' }, areaCoverageOld: { type: 'number' }, note: { type: 'string' },
}, required: ['site', 'compositeHonest', 'compositeOld', 'deltaFromDeepFlatten'] }

phase('Regrade')
const out = await parallel(SITES.map((s) => () => agent([HARD_RULE,
  'RE-GRADE one already-published clone in BOTH grader modes. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' clone=sg-host page ' + s.page + ' (builder=' + s.builder + '). You MUST end by calling StructuredOutput. Do NOT rebuild — grade the live published page as-is.',
  'STEP 1 (HONEST = deep-flatten ON, default): node grade-sections.mjs --source ' + s.url + ' --clone "https://georges232.sg-host.com/?page_id=' + s.page + '" --out /tmp/rb-' + s.name + '-on ; read composite + areaCoverage (perElement coverage).',
  'STEP 2 (OLD = deflating): GRADER_NO_DEEP_FLATTEN=1 node grade-sections.mjs --source ' + s.url + ' --clone "https://georges232.sg-host.com/?page_id=' + s.page + '" --out /tmp/rb-' + s.name + '-off ; read composite + areaCoverage.',
  'Report compositeHonest (ON), compositeOld (OFF), deltaFromDeepFlatten = honest-old, areaCoverageHonest, areaCoverageOld. For the ABS control: confirm the delta is ~0 (absolute clones are shallow -> deep-flatten should barely change them; if the abs delta is large, FLAG it — the fix may be over-counting).',
  'Return {site, page, builder, compositeHonest, compositeOld, deltaFromDeepFlatten, areaCoverageHonest, areaCoverageOld, note}.',
].join('\n'), { label: 'rb:' + s.name, phase: 'Regrade', schema: SCHEMA }))).then((rs) => rs.filter(Boolean))

for (const r of out) log('REBASE ' + r.site + ': ' + r.compositeOld + ' -> ' + r.compositeHonest + ' (deepFlatten +' + (r.deltaFromDeepFlatten || 0).toFixed(3) + ')')
const flow = out.filter((r) => r.builder === 'flow')
const mean = flow.length ? +(flow.reduce((a, r) => a + (r.compositeHonest || 0), 0) / flow.length).toFixed(3) : 0
const oldMean = flow.length ? +(flow.reduce((a, r) => a + (r.compositeOld || 0), 0) / flow.length).toFixed(3) : 0
log('HONEST FLOW-CORPUS-MEAN: ' + mean + ' (was ' + oldMean + ' on the old deflating grader)')
return { perSite: out, flowCorpusMeanHonest: mean, flowCorpusMeanOld: oldMean }

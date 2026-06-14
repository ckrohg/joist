export const meta = {
  name: 'abs-corpus-honest-regrade',
  description: 'Grade the 7 ABSOLUTE-builder corpus clones on the now-honest (ydrift-only) grader to get the honest ABSOLUTE-corpus-mean — the other half of the absolute->flow transition comparison (flow honest = 0.616). The abs numbers I have been citing (~0.72-0.85) were on the OLD SSIM-heavy grader; the abs control just measured tailwind-abs 3146 = 0.714 on the full honest composite, so the abs corpus is likely lower than assumed and the flow-vs-abs gap smaller. Grade-only (clones already built+published), NO edits.',
  phases: [
    { title: 'Regrade', detail: 'grade the 7 absolute corpus pages on the honest grader; honest absolute-corpus-mean' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'READ/GRADE ONLY — edit NO files, do NOT rebuild (the absolute clones are already built+published). source /tmp/joist-auth.env for WP auth. Never print JOIST_AUTH_B64.'
const SITES = [
  { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146 },
  { name: 'supabase', url: 'https://supabase.com', page: 2986 },
  { name: 'resend', url: 'https://resend.com', page: 2988 },
  { name: 'framer', url: 'https://www.framer.com', page: 2990 },
  { name: 'vercel', url: 'https://vercel.com', page: 4296 },
  { name: 'linear', url: 'https://linear.app', page: 4297 },
  { name: 'reactdev', url: 'https://react.dev', page: 4771 },
]
const SCHEMA = { type: 'object', additionalProperties: false, properties: {
  site: { type: 'string' }, page: { type: 'number' }, composite: { type: 'number' },
  visual: { type: 'number' }, ssim: { type: 'number' }, struct: { type: 'number' }, edit: { type: 'number' }, responsive: { type: 'number' }, hRatio: { type: 'number' },
  flowHonest: { type: 'number' }, note: { type: 'string' },
}, required: ['site', 'composite'] }
const FLOW = { tailwind: 0.646, supabase: 0.671, resend: 0.492, framer: 0.550, vercel: 0.674, linear: 0.679, reactdev: 0.599 }

phase('Regrade')
const out = await parallel(SITES.map((s) => () => agent([HARD_RULE,
  'Grade ONE already-published ABSOLUTE clone on the honest grader. Work in ' + GRADER + '. site=' + s.name + ' clone=configured-host page ' + s.page + ' (absolute builder). flow-honest for this site = ' + (FLOW[s.name] || 0) + '. You MUST end by calling StructuredOutput. Do NOT rebuild — grade the live published page as-is.',
  'node grade-sections.mjs --source ' + s.url + ' --clone "' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/?page_id=' + s.page + '" --out /tmp/absrg-' + s.name + ' ; read composite, visualMean, ssimRaw, structuralFidelity, editabilityMean, responsive, hRatio.',
  'Report the honest ABSOLUTE composite + sub-scores. Compare to flowHonest=' + (FLOW[s.name] || 0) + ' (which builder wins this site on the honest grader?).',
  'Return {site, page, composite, visual, ssim, struct, edit, responsive, hRatio, flowHonest, note}.',
].join('\n'), { label: 'absrg:' + s.name, phase: 'Regrade', schema: SCHEMA }))).then((rs) => rs.filter(Boolean))

for (const r of out) log('ABSRG ' + r.site + ': abs ' + r.composite + ' vs flow ' + (r.flowHonest || FLOW[r.site]) + ' -> ' + ((r.composite > (r.flowHonest || FLOW[r.site] || 0)) ? 'ABS wins' : 'FLOW wins'))
const mean = out.length ? +(out.reduce((a, r) => a + (r.composite || 0), 0) / out.length).toFixed(3) : 0
const flowMean = 0.616
log('HONEST ABSOLUTE-CORPUS-MEAN: ' + mean + ' vs FLOW-honest-mean ' + flowMean + ' -> transition gap ' + (mean - flowMean).toFixed(3))
return { perSite: out, absCorpusMeanHonest: mean, flowCorpusMeanHonest: flowMean, transitionGap: +(mean - flowMean).toFixed(3) }

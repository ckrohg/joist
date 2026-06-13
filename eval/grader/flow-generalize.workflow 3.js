export const meta = {
  name: 'flow-generalize',
  description: 'GENERALIZATION probe after the 2 flow wins (grid-detection #15 + overlay-abs #16). Build the CURRENT flow builder across the 5 corpus sites not yet tested on flow (supabase/resend/framer/vercel/reactdev) on dedicated flow scratch pages, grade each, and report per-site composite + hRatio + the dominant remaining cause. Confirms the grid/overlay/abs fixes generalize + produces the honest FLOW-CORPUS-MEAN (informs the absolute->flow transition decision) + surfaces the cross-site dominant lever (expected: visual/coverage -> region-capture). Read/build/grade only; edits NO cloner files.',
  phases: [
    { title: 'Generalize', detail: 'build-flow + grade 5 fresh sites on flow scratch pages; report composite/hRatio/dominant-cause' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'READ/BUILD/GRADE ONLY — edit/move/delete NO cloner files (build-flow.mjs, build-absolute.mjs, capture-layout.mjs, capture-ensemble.mjs, grade-sections.mjs, perelement-score.mjs ALL read/run only). source /tmp/joist-auth.env for WP auth. Do NOT use the ABSOLUTE corpus page ids (2986/2988/2990/4296/4297/4771/3146) as build targets — they hold the absolute baselines; CREATE OR REUSE a dedicated FLOW page per site instead. Never print JOIST_AUTH_B64.'
// 5 sites not yet flow-tested. Each gets its OWN flow scratch page (create-or-reuse by stable title so re-runs are idempotent).
const SITES = [
  { name: 'supabase', url: 'https://supabase.com', absBaseline: 0.823 },
  { name: 'resend', url: 'https://resend.com', absBaseline: 0.7005 },
  { name: 'framer', url: 'https://www.framer.com', absBaseline: 0.7215 },
  { name: 'vercel', url: 'https://vercel.com', absBaseline: 0.756 },
  { name: 'reactdev', url: 'https://react.dev', absBaseline: 0.737 },
]
const SCHEMA = { type: 'object', additionalProperties: false, properties: {
  site: { type: 'string' }, page: { type: 'number' }, composite: { type: 'number' }, absBaseline: { type: 'number' },
  hRatio: { type: 'number' }, ssim: { type: 'number' }, visual: { type: 'number' }, struct: { type: 'number' }, edit: { type: 'number' }, responsive: { type: 'number' },
  gridFired: { type: 'boolean' }, overlayFired: { type: 'boolean' }, absCount: { type: 'number' },
  dominantCause: { type: 'string' }, verdict: { type: 'string' },
}, required: ['site', 'composite', 'hRatio', 'dominantCause', 'verdict'] }

phase('Generalize')
const out = await parallel(SITES.map((s) => () => agent([HARD_RULE,
  'GENERALIZATION test the CURRENT flow builder on ONE fresh site. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' abs baseline=' + s.absBaseline + '. You MUST end by calling StructuredOutput.',
  'STEPS (sequential, source /tmp/joist-auth.env first):',
  '  1. CREATE-OR-REUSE a flow page: GET wp/v2/pages?search=flowgen-' + s.name + ' ; if none, POST wp/v2/pages {title:"flowgen-' + s.name + '", status:"draft"} and capture its id. (do NOT touch the absolute corpus pages.)',
  '  2. node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/fg-' + s.name + '.json --passes 2',
  '  3. node build-flow.mjs --layout /tmp/fg-' + s.name + '.json --page <id>',
  '  4. PUBLISH (POST wp/v2/pages/<id> status=publish) + re-assert meta._elementor_edit_mode=builder.',
  '  5. node grade-sections.mjs --source ' + s.url + ' --clone "https://georges232.sg-host.com/?page_id=<id>" --out /tmp/fgg-' + s.name + ' ; read composite, structuralFidelity, visualMean, editabilityMean, ssimRaw, hRatio (heightRatio), responsive score, and the perElement breakdown.',
  '  6. CHECK the new recipes fired: gridFired = did any container classify mode:grid (recipe #15)? overlayFired = did buildOverlay abs-layer any overlay (recipe #16)? absCount = page.evaluate count of position:absolute on the published clone (should be >0 if overlays present).',
  'Report the REAL numbers (do NOT inflate) + the SINGLE dominant remaining cause for this site (one line: e.g. "visual/coverage — capture coverage 0.2, rastered-text-cheat heroes" or "hRatio still high — <why>"). Compare composite to the flow expectation (~0.66 on the 2 cracked sites) + the abs baseline ' + s.absBaseline + '.',
  'Return {site, page, composite, absBaseline, hRatio, ssim, visual, struct, edit, responsive, gridFired, overlayFired, absCount, dominantCause, verdict}.',
].join('\n'), { label: 'flowgen:' + s.name, phase: 'Generalize', schema: SCHEMA }))).then((rs) => rs.filter(Boolean))

for (const r of out) log('FLOWGEN ' + r.site + ': composite ' + r.composite + ' (abs ' + r.absBaseline + ') hRatio ' + r.hRatio + ' | ' + r.dominantCause)
const known = [{ site: 'tailwind', composite: 0.672 }, { site: 'linear', composite: 0.66 }]
const all = out.concat(known.filter((k) => !out.some((o) => o.site === k.site)))
const mean = all.length ? +(all.reduce((a, r) => a + (r.composite || 0), 0) / all.length).toFixed(3) : 0
log('FLOW-CORPUS-MEAN (incl. tailwind 0.672 + linear 0.66): ' + mean + ' across ' + all.length + ' sites')
return { perSite: out, flowCorpusMean: mean, knownIncluded: known }

export const meta = {
  name: 'corpus-rebaseline',
  description: 'RE-GROUND the flywheel: the manifest means (abs 0.648 / flow 0.616 / router 0.671) are STALE-grader (pre-detectors / block-merge / per-element struct-invariant / chrome-unpin / fluid-fonts). Re-baseline all 7 corpus sites on the CURRENT honest grader (grade-sections, all keeps live) + canonical sg-host auth, building with build-absolute (router PRIMARY). Returns per-site composite + sub-scores (visual/editability/structural/responsive) + the top defect per site, then a synth ranks the corpus-wide defect classes so the NEXT rounds target the biggest REAL gap objectively (the Driver Protocol auto-target-top-miss, grounded in measured truth not guesses). Read-only on builders/grader (build+grade only).',
  phases: [
    { title: 'Rebaseline', detail: 'build-absolute + grade-sections on all 7 corpus sites (canonical auth), per-site composite + sub-scores + top defect' },
    { title: 'Rank', detail: 'corpus mean + ranked defect classes + the single biggest gap -> next-round target' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const SITES = [
  { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146 },
  { name: 'supabase', url: 'https://supabase.com', page: 2986 },
  { name: 'resend', url: 'https://resend.com', page: 2988 },
  { name: 'framer', url: 'https://www.framer.com', page: 2990 },
  { name: 'linear', url: 'https://linear.app', page: 4297 },
  { name: 'vercel', url: 'https://vercel.com', page: 4296 },
  { name: 'reactdev', url: 'https://react.dev', page: 4771 },
]
const RSCHEMA = { type: 'object', additionalProperties: false, properties: {
  site: { type: 'string' }, built: { type: 'boolean' },
  composite: { type: 'number' }, visual: { type: 'number' }, editability: { type: 'number' }, structural: { type: 'number' }, responsive: { type: 'number' },
  scrollWidth390: { type: 'number' }, topDefect: { type: 'string' }, notes: { type: 'string' },
}, required: ['site', 'built', 'composite', 'visual', 'editability', 'structural', 'responsive', 'topDefect'] }

phase('Rebaseline')
const results = await parallel(SITES.map((s) => () => agent([
  'RE-BASELINE one corpus site on the CURRENT pipeline. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + '. ' + AUTH + ' before every WP command. Never print JOIST_AUTH_B64. You MUST end by calling StructuredOutput. Do NOT edit any builder/grader file (build + grade only).',
  'STEP 1 BUILD: node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/rb-' + s.name + '.json --passes 2 (or capture-layout.mjs if ensemble missing); then node build-absolute.mjs --layout /tmp/rb-' + s.name + '.json --page ' + s.page + ' --publish. ALL current recipes are live (chrome-unpin, fluid-fonts, responsive-unpin). If build fails, set built=false + report the error in notes.',
  'STEP 2 GRADE (current honest grader, all keeps live): ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/rbg-' + s.name + '. Parse the report: composite, and the sub-scores visual, editability, structural, responsive (read the JSON in /tmp/rbg-' + s.name + '/sections.json or stdout). Also capture document.documentElement.scrollWidth at 390 on the clone (scrollWidth390 — confirm chrome-fix holds <=~400).',
  'STEP 3 TOP DEFECT: from the grade report + a quick human look at the render, name the SINGLE biggest defect class for this site (topDefect), e.g. "dynamic-content-not-captured", "responsive-reflow", "color/typography drift", "missing sections/coverage", "image/asset fidelity", "overflow", "text-collision", "nav/footer", "canvas/webgl blank". Be specific + grounded in the actual sub-score that is lowest + what you SEE.',
  'Return {site, built, composite, visual, editability, structural, responsive, scrollWidth390, topDefect, notes}.',
].join('\n'), { label: 'rebaseline:' + s.name, phase: 'Rebaseline', schema: RSCHEMA })))
const ok = (results || []).filter(Boolean).filter((r) => r.built)
for (const r of (results||[]).filter(Boolean)) log('REBASELINE ' + r.site + ': comp=' + r.composite + ' (vis ' + r.visual + ' edit ' + r.editability + ' struct ' + r.structural + ' resp ' + r.responsive + ') sw@390=' + r.scrollWidth390 + ' topDefect=' + r.topDefect)

phase('Rank')
const mean = (f) => ok.length ? Math.round(ok.reduce((a, r) => a + (f(r) || 0), 0) / ok.length * 10000) / 10000 : 0
const corpusMean = { composite: mean((r) => r.composite), visual: mean((r) => r.visual), editability: mean((r) => r.editability), structural: mean((r) => r.structural), responsive: mean((r) => r.responsive) }
log('CORPUS MEAN (current honest grader, abs builder): composite ' + corpusMean.composite + ' | visual ' + corpusMean.visual + ' edit ' + corpusMean.editability + ' struct ' + corpusMean.structural + ' resp ' + corpusMean.responsive)

const RANKSCHEMA = { type: 'object', additionalProperties: false, properties: {
  rankedDefectClasses: { type: 'array', items: { type: 'object', additionalProperties: true } },
  weakestDimension: { type: 'string' }, weakestSites: { type: 'array', items: { type: 'string' } },
  biggestGapTarget: { type: 'string' }, recommendation: { type: 'string' },
}, required: ['rankedDefectClasses', 'weakestDimension', 'biggestGapTarget', 'recommendation'] }
const ranked = await agent([
  'Synthesize a corpus re-baseline into a RANKED defect attribution to target the next flywheel rounds. CORPUS MEAN (current honest grader, build-absolute): ' + JSON.stringify(corpusMean) + '. PER-SITE: ' + JSON.stringify((results||[]).filter(Boolean).map((r) => ({ site: r.site, composite: r.composite, visual: r.visual, editability: r.editability, structural: r.structural, responsive: r.responsive, topDefect: r.topDefect, built: r.built }))),
  'Produce: rankedDefectClasses (array of {defectClass, frequency, avgGapContribution, sites[]} sorted by total gap contribution across the corpus), weakestDimension (which sub-score is lowest corpus-wide: visual/editability/structural/responsive), weakestSites (the 2-3 lowest-composite sites), biggestGapTarget (the SINGLE highest-leverage next lever — the defect class whose fix would raise the corpus mean most, grounded in the data), and a one-paragraph recommendation for the next 2-3 rounds. Be concrete + honest (if a dimension is structurally capped, say so).',
].join('\n'), { label: 'rank:defects', phase: 'Rank', schema: RANKSCHEMA })
log('RANKED: weakestDim=' + (ranked&&ranked.weakestDimension) + ' biggestGap=' + (ranked&&ranked.biggestGapTarget))

return { corpusMean, perSite: (results||[]).filter(Boolean), ranked, built: ok.length + '/' + SITES.length }

export const meta = {
  name: 'clean-rebaseline-multipass',
  description: 'MEASUREMENT-INTEGRITY KEYSTONE: reset the corpus to a KNOWN consistent state + trustworthy numbers. The corpus pages are inconsistent (flow-router overwrote all 7 with FLOW builds; only some rebuilt abs since) -> cross-round grades are not comparable + recent diagnoses partly graded stale FLOW page-state (the #6 coverage-0.19 phantom). FIX: per site, REBUILD with build-absolute (all recipes live) THEN GRADE 3x in the SAME agent (atomic — nothing overwrites between build + the 3 grades), reporting median composite + sub-scores + the grade VARIANCE (quantify the known RLG re-capture nondeterminism) + the top defect. Then a synth gives the TRUE consistent corpus mean + per-dimension + ranked top-defect for the next phase. Read-only on builders/grader (build+grade only). This is the trustworthy baseline all future A/B compares against.',
  phases: [
    { title: 'Rebuild+grade3x', detail: 'per site: build-absolute --publish THEN grade 3x atomically; median + variance + top defect' },
    { title: 'Synthesize', detail: 'true consistent corpus mean + per-dimension + grade-variance + ranked top-defect' },
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
  composites3: { type: 'array', items: { type: 'number' } }, compositeMedian: { type: 'number' }, compositeSpread: { type: 'number' },
  visual: { type: 'number' }, editability: { type: 'number' }, structural: { type: 'number' }, responsive: { type: 'number' }, coverage: { type: 'number' },
  topDefect: { type: 'string' }, notes: { type: 'string' },
}, required: ['site', 'built', 'composites3', 'compositeMedian', 'compositeSpread', 'visual', 'editability', 'structural', 'responsive', 'topDefect'] }

phase('Rebuild+grade3x')
const results = await parallel(SITES.map((s) => () => agent([
  'CLEAN RE-BASELINE one corpus site, ATOMICALLY (rebuild THEN grade 3x in THIS agent so no other process overwrites the page between). Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + '. ' + AUTH + ' before every WP command. Never print JOIST_AUTH_B64. You MUST end by calling StructuredOutput. Do NOT edit any builder/grader file (build + grade only).',
  'STEP 1 BUILD: node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/cb-' + s.name + '.json --passes 2 (fallback capture-layout.mjs); then node build-absolute.mjs --layout /tmp/cb-' + s.name + '.json --page ' + s.page + ' --publish. ALL current recipes live (chrome-unpin, fluid-fonts, vertical-reflow, surface-raster+wordsafe, text-collision-dedupe, fragment-merge). If a PUT 422 atomic_save_silent_failure occurs but joist_get_page_tree confirms the tree persisted (nodes>0), treat built=true (known silent-save warning). If build truly fails, built=false + error in notes.',
  'STEP 2 GRADE 3x (the SAME published page, immediately, no rebuild between): run node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/cbg-' + s.name + '-{1,2,3} THREE times. composites3 = the 3 composite values. compositeMedian = the median. compositeSpread = max-min (quantifies RLG re-capture variance). Take visual/editability/structural/responsive/coverage from the MEDIAN run (or the run closest to median).',
  'STEP 3 TOP DEFECT: the single biggest defect class grounded in the lowest sub-score + a human look (responsive-reflow / dynamic-content / color / missing-sections / overflow / etc).',
  'Return {site, built, composites3, compositeMedian, compositeSpread, visual, editability, structural, responsive, coverage, topDefect, notes}.',
].join('\n'), { label: 'rebaseline:' + s.name, phase: 'Rebuild+grade3x', schema: RSCHEMA })))
const ok = (results || []).filter(Boolean).filter((r) => r.built)
for (const r of (results||[]).filter(Boolean)) log('CLEAN ' + r.site + ': median=' + r.compositeMedian + ' spread=' + r.compositeSpread + ' [' + (r.composites3||[]).join(',') + '] (vis ' + r.visual + ' edit ' + r.editability + ' struct ' + r.structural + ' resp ' + r.responsive + ' cov ' + r.coverage + ') topDefect=' + String(r.topDefect||'').slice(0,80))

phase('Synthesize')
const mean = (f) => ok.length ? Math.round(ok.reduce((a, r) => a + (f(r) || 0), 0) / ok.length * 10000) / 10000 : 0
const corpusMean = { compositeMedian: mean((r) => r.compositeMedian), visual: mean((r) => r.visual), editability: mean((r) => r.editability), structural: mean((r) => r.structural), responsive: mean((r) => r.responsive), coverage: mean((r) => r.coverage), avgGradeSpread: mean((r) => r.compositeSpread) }
log('CLEAN CORPUS MEAN (consistent abs state, median-of-3): composite ' + corpusMean.compositeMedian + ' | vis ' + corpusMean.visual + ' edit ' + corpusMean.editability + ' struct ' + corpusMean.structural + ' resp ' + corpusMean.responsive + ' cov ' + corpusMean.coverage + ' | avg grade-spread ' + corpusMean.avgGradeSpread)

const RANKSCHEMA = { type: 'object', additionalProperties: false, properties: {
  cleanCorpusMean: { type: 'number' }, weakestDimension: { type: 'string' }, gradeVarianceConcern: { type: 'boolean' },
  rankedDefectClasses: { type: 'array', items: { type: 'object', additionalProperties: true } }, biggestGapTarget: { type: 'string' }, recommendation: { type: 'string' },
}, required: ['cleanCorpusMean', 'weakestDimension', 'gradeVarianceConcern', 'biggestGapTarget', 'recommendation'] }
const ranked = await agent([
  'Synthesize a CLEAN consistent-state corpus re-baseline (median-of-3 grades, all 7 freshly abs-built). CORPUS MEAN: ' + JSON.stringify(corpusMean) + '. PER-SITE: ' + JSON.stringify((results||[]).filter(Boolean).map((r) => ({ site: r.site, median: r.compositeMedian, spread: r.compositeSpread, visual: r.visual, editability: r.editability, structural: r.structural, responsive: r.responsive, coverage: r.coverage, topDefect: r.topDefect, built: r.built }))),
  'Produce: cleanCorpusMean (the median composite mean), weakestDimension (lowest of visual/editability/structural/responsive), gradeVarianceConcern (true iff avg grade-spread > ~0.02 — i.e. RLG nondeterminism is large enough to threaten A/B reliability + needs the deterministic-self-test/median-of-3 protocol going forward), rankedDefectClasses ([{defectClass, sites, avgGapContribution}] by total gap), biggestGapTarget (the single highest-leverage ADDRESSABLE next lever grounded in this CLEAN data — exclude the capped/dead ones: abs-responsive-tweaks capped, flow-routing net-zero, coverage-crush phantom), and a recommendation for the next 2-3 rounds. Be honest about what is capped vs addressable.',
].join('\n'), { label: 'synth:clean-rebaseline', phase: 'Synthesize', schema: RANKSCHEMA })
log('RANKED: cleanMean=' + (ranked&&ranked.cleanCorpusMean) + ' weakest=' + (ranked&&ranked.weakestDimension) + ' varianceConcern=' + (ranked&&ranked.gradeVarianceConcern) + ' biggestGap=' + (ranked&&ranked.biggestGapTarget))

return { corpusMean, perSite: (results||[]).filter(Boolean), ranked, built: ok.length + '/' + SITES.length }

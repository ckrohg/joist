export const meta = {
  name: 'corpus-breadth',
  description: 'GENERALIZATION TEST toward clone-ANY-site (roadmap #3 breadth): the 7-site corpus is all dev-tool marketing (tailwind/supabase/resend/framer/linear/vercel/reactdev) -> recipes may OVERFIT that archetype (evidence: recipe #30 was a live no-op because none of the 7 have the pattern it fixes). Clone + grade 4 DIVERSE archetypes the corpus never exercises — editorial BLOG (overreacted.io), dense FORUM/LIST (news.ycombinator.com), non-dev PRODUCT (basecamp.com), ecommerce/PRODUCT (apple.com/airpods-pro) — on the CURRENT pipeline (build-absolute + grade-sections, all kept recipes), and report per-site composite + sub-scores + top defect + a GENERALIZATION read (how does the cloner do on UNSEEN archetypes vs the ~0.56 dev-marketing baseline?) + ranked NEW defect classes (layout patterns the dev-marketing corpus does not surface). Read-only on pipeline (build+grade only); allocate fresh scratch WP pages. This tells us if the cloner is good at ANY site or just overfit, + surfaces the highest-value REAL next levers.',
  phases: [
    { title: 'Clone-diverse', detail: 'clone+grade 4 diverse archetypes on the current pipeline; per-site composite + sub-scores + top defect + does-it-render' },
    { title: 'Generalize', detail: 'generalization read (vs 0.56 dev-marketing) + ranked NEW defect classes the broad corpus surfaces' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && export JOIST_BASE="${JOIST_BASE:-http://localhost:8001}"; case "$JOIST_BASE" in *sg-host.com*|*georges232*|*35.212.46.254*) echo "FATAL: JOIST_BASE=$JOIST_BASE is a blocked/paused host (host-guard allowlist; renders only target localhost:8001 or JOIST_TRAINING_BASE)"; exit 1;; esac'
const SITES = [
  { name: 'overreacted', url: 'https://overreacted.io/', archetype: 'editorial BLOG (text-heavy, minimal — should clone WELL if simple content works)', page: 9001 },
  { name: 'hackernews', url: 'https://news.ycombinator.com/', archetype: 'dense FORUM/LIST (table-based, tiny text, totally different layout)', page: 9002 },
  { name: 'basecamp', url: 'https://basecamp.com/', archetype: 'non-dev PRODUCT marketing (opinionated editorial layout)', page: 9003 },
  { name: 'apple-airpods', url: 'https://www.apple.com/airpods-pro/', archetype: 'ecommerce/PRODUCT (premium, image+scroll heavy)', page: 9004 },
]
const RSCHEMA = { type: 'object', additionalProperties: false, properties: {
  site: { type: 'string' }, archetype: { type: 'string' }, rendered: { type: 'boolean' }, built: { type: 'boolean' },
  composite: { type: 'number' }, visual: { type: 'number' }, editability: { type: 'number' }, structural: { type: 'number' }, responsive: { type: 'number' }, coverage: { type: 'number' },
  topDefect: { type: 'string' }, newDefectVsDevMarketing: { type: 'string' }, notes: { type: 'string' },
}, required: ['site', 'archetype', 'rendered', 'built', 'composite', 'topDefect', 'newDefectVsDevMarketing'] }
phase('Clone-diverse')
const results = await parallel(SITES.map((s) => () => agent([
  'CLONE + GRADE one DIVERSE-archetype site to test generalization. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' archetype=' + s.archetype + ' scratchPage=' + s.page + '. ' + AUTH + ' before every WP command. Never print JOIST_AUTH_B64. You MUST end by calling StructuredOutput. Do NOT edit any builder/grader file (build + grade only).',
  'STEP 0: ensure scratch WP page ' + s.page + ' exists — GET ' + '$JOIST_BASE' + '/wp-json/wp/v2/pages/' + s.page + '; if 404, POST ' + '$JOIST_BASE' + '/wp-json/wp/v2/pages {title:"breadth-' + s.name + '", status:"publish"} and use the returned id (report it in notes if different from ' + s.page + ').',
  'STEP 1 RENDER CHECK: load ' + s.url + ' in Playwright @1440 — does it render real content headless (rendered=true) or is it blocked/blank/bot-walled (rendered=false, note why)?',
  'STEP 2 BUILD: node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/br-' + s.name + '.json --passes 2 (fallback capture-layout.mjs); then node build-absolute.mjs --layout /tmp/br-' + s.name + '.json --page <scratchId> --publish. All current recipes live. If build fails, built=false + error in notes.',
  'STEP 3 GRADE: ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=<scratchId>" --out /tmp/brg-' + s.name + '. composite + visual/editability/structural/responsive/coverage.',
  'STEP 4: topDefect (the biggest defect class for this site) + newDefectVsDevMarketing = a defect class / layout pattern that the dev-marketing corpus (tailwind/supabase/etc) does NOT surface but THIS archetype does (e.g. "dense table layout", "long-form article typography", "product-gallery", "tiny-text list", "editorial whitespace"). Be specific — this is the point of the round.',
  'Return {site, archetype, rendered, built, composite, visual, editability, structural, responsive, coverage, topDefect, newDefectVsDevMarketing, notes}.',
].join('\n'), { label: 'breadth:' + s.name, phase: 'Clone-diverse', schema: RSCHEMA })))
const ok = (results || []).filter(Boolean).filter((r) => r.built)
for (const r of (results||[]).filter(Boolean)) log('BREADTH ' + r.site + ' [' + r.archetype.slice(0,30) + ']: rendered=' + r.rendered + ' built=' + r.built + ' comp=' + r.composite + ' (vis ' + r.visual + ' struct ' + r.structural + ' resp ' + r.responsive + ' cov ' + r.coverage + ') new=' + String(r.newDefectVsDevMarketing||'').slice(0,60))

phase('Generalize')
const mean = (f) => ok.length ? Math.round(ok.reduce((a, r) => a + (f(r) || 0), 0) / ok.length * 10000) / 10000 : 0
const breadthMean = { composite: mean((r) => r.composite), visual: mean((r) => r.visual), structural: mean((r) => r.structural), responsive: mean((r) => r.responsive), coverage: mean((r) => r.coverage) }
log('BREADTH MEAN: composite ' + breadthMean.composite + ' (dev-marketing baseline ~0.56) | vis ' + breadthMean.visual + ' struct ' + breadthMean.structural + ' resp ' + breadthMean.responsive)

const RANKSCHEMA = { type: 'object', additionalProperties: false, properties: {
  breadthMean: { type: 'number' }, generalizes: { type: 'boolean' }, overfitEvidence: { type: 'string' },
  newDefectClasses: { type: 'array', items: { type: 'object', additionalProperties: true } }, biggestNewLever: { type: 'string' }, recommendation: { type: 'string' },
}, required: ['breadthMean', 'generalizes', 'newDefectClasses', 'biggestNewLever', 'recommendation'] }
const ranked = await agent([
  'Synthesize a generalization test. The 7-site DEV-MARKETING corpus mean is ~0.56 (composite). DIVERSE-archetype results (just measured): ' + JSON.stringify((results||[]).filter(Boolean).map((r) => ({ site: r.site, archetype: r.archetype, rendered: r.rendered, built: r.built, composite: r.composite, visual: r.visual, structural: r.structural, responsive: r.responsive, coverage: r.coverage, topDefect: r.topDefect, newDefect: r.newDefectVsDevMarketing }))) + '. Breadth mean: ' + JSON.stringify(breadthMean) + '.',
  'Produce: breadthMean (composite), generalizes (true iff the cloner does ~comparably on unseen archetypes — breadthMean within ~0.1 of 0.56 — vs OVERFIT if much lower), overfitEvidence (specific archetypes/patterns where it does much worse + why), newDefectClasses ([{defectClass, sites, severity}] the dev-marketing corpus does NOT surface — e.g. dense-table, long-form-typography, product-gallery, tiny-text-list, editorial-whitespace), biggestNewLever (the single highest-value NEW defect to fix that would generalize the cloner most), and a recommendation for whether to (a) add these to the standing corpus + fix the biggest new lever, or (b) the cloner generalizes fine + responsive/known-levers remain the priority. Be honest about generalization.',
].join('\n'), { label: 'synth:breadth', phase: 'Generalize', schema: RANKSCHEMA })
log('RANKED: breadthMean=' + (ranked&&ranked.breadthMean) + ' generalizes=' + (ranked&&ranked.generalizes) + ' biggestNewLever=' + String(ranked&&ranked.biggestNewLever||'').slice(0,80))

return { breadthMean, perSite: (results||[]).filter(Boolean), ranked, built: ok.length + '/' + SITES.length }

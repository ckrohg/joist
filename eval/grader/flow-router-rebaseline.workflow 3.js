export const meta = {
  name: 'flow-router-rebaseline',
  description: 'Test/realize the biggest UNCAPPED lever (rebaseline-2: responsive 0.2296 is the floor + CAPPED on the abs builder; the FLOW builder reflows 3->2->1 so it is the uncapped path; linear flow 0.607 vs abs 0.378 on responsive). Re-baseline build-FLOW on all 7 corpus sites on the CURRENT honest grader (mobile-prop + struct-invariant + block-merge live, canonical sg-host auth) -> per-site flow composite + sub-scores. Then compute the BEST-PER-SITE ROUTER (max of the known abs composite vs flow composite) + the router corpus mean vs the abs-only 0.5589, and which sites should route to flow. With the honester grader now rewarding flows reflow, routing responsive-heavy sites to flow may lift the corpus substantially. Read-only on builders/grader (build+grade only); the router POLICY adoption is the deliverable.',
  phases: [
    { title: 'Flow-rebaseline', detail: 'build-flow + grade on all 7 corpus sites (current honest grader)' },
    { title: 'Router', detail: 'best-per-site max(abs,flow) + router corpus mean vs abs-only 0.5589 + route recommendation' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
// abs composites from rebaseline-2 (build-absolute, current honest grader)
const ABS = { tailwind: 0.592, supabase: 0.553, resend: 0.519, framer: 0.516, vercel: 0.501, reactdev: 0.53, linear: 0.46 }
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
  flowComposite: { type: 'number' }, flowVisual: { type: 'number' }, flowEditability: { type: 'number' }, flowStructural: { type: 'number' }, flowResponsive: { type: 'number' },
  notes: { type: 'string' },
}, required: ['site', 'built', 'flowComposite', 'flowVisual', 'flowEditability', 'flowStructural', 'flowResponsive'] }

phase('Flow-rebaseline')
const results = await parallel(SITES.map((s) => () => agent([
  'RE-BASELINE one corpus site on the FLOW builder. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + '. ' + AUTH + ' before every WP command. Never print JOIST_AUTH_B64. You MUST end by calling StructuredOutput. Do NOT edit any builder/grader file (build + grade only).',
  'STEP 1 BUILD with FLOW: node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/fr-' + s.name + '.json --passes 2 (or capture-layout.mjs); then node build-flow.mjs --layout /tmp/fr-' + s.name + '.json --page ' + s.page + ' --publish. All flow recipes live (grid-detection, per-breakpoint reflow, etc). If build fails, set built=false + the error in notes.',
  'STEP 2 GRADE (current honest grader): ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/frg-' + s.name + '. Parse flowComposite + sub-scores flowVisual/flowEditability/flowStructural/flowResponsive (read /tmp/frg-' + s.name + '/sections.json or stdout).',
  'NOTE: this site is currently published as the ABS build; your flow build OVERWRITES page ' + s.page + ' for grading — that is fine (it is a re-baseline; the router decision will determine the final builder per site). Return {site, built, flowComposite, flowVisual, flowEditability, flowStructural, flowResponsive, notes}.',
].join('\n'), { label: 'flow:' + s.name, phase: 'Flow-rebaseline', schema: RSCHEMA })))
const ok = (results || []).filter(Boolean).filter((r) => r.built)
for (const r of (results||[]).filter(Boolean)) log('FLOW ' + r.site + ': comp=' + r.flowComposite + ' (vis ' + r.flowVisual + ' edit ' + r.flowEditability + ' struct ' + r.flowStructural + ' resp ' + r.flowResponsive + ') | abs=' + (ABS[r.site]||'?'))

phase('Router')
const mean = (arr, f) => arr.length ? Math.round(arr.reduce((a, r) => a + (f(r) || 0), 0) / arr.length * 10000) / 10000 : 0
const flowMean = mean(ok, (r) => r.flowComposite)
const flowRespMean = mean(ok, (r) => r.flowResponsive)
// router = per-site max(abs, flow)
const routed = ok.map((r) => ({ site: r.site, abs: ABS[r.site] || 0, flow: r.flowComposite, winner: (r.flowComposite > (ABS[r.site] || 0)) ? 'flow' : 'abs', best: Math.max(r.flowComposite, ABS[r.site] || 0) }))
const routerMean = Math.round(routed.reduce((a, x) => a + x.best, 0) / (routed.length || 1) * 10000) / 10000
const flowWins = routed.filter((x) => x.winner === 'flow')
log('FLOW corpus mean ' + flowMean + ' (resp ' + flowRespMean + ') vs ABS 0.5589 | ROUTER (best-per-site) mean ' + routerMean + ' | flow wins on: ' + flowWins.map((x)=>x.site+'('+x.flow+'>'+x.abs+')').join(', '))

const RANKSCHEMA = { type: 'object', additionalProperties: false, properties: {
  flowCorpusMean: { type: 'number' }, flowResponsiveMean: { type: 'number' }, routerCorpusMean: { type: 'number' },
  flowWinSites: { type: 'array', items: { type: 'string' } }, routerGainVsAbs: { type: 'number' },
  adoptRouter: { type: 'boolean' }, recommendation: { type: 'string' },
}, required: ['flowCorpusMean', 'routerCorpusMean', 'flowWinSites', 'adoptRouter', 'recommendation'] }
const ranked = await agent([
  'Synthesize the flow-router re-baseline. ABS per-site composites (build-absolute, honest grader): ' + JSON.stringify(ABS) + '. FLOW per-site (just measured): ' + JSON.stringify((results||[]).filter(Boolean).map((r)=>({site:r.site,comp:r.flowComposite,vis:r.flowVisual,edit:r.flowEditability,struct:r.flowStructural,resp:r.flowResponsive,built:r.built}))) + '. Computed: flowCorpusMean=' + flowMean + ', flowResponsiveMean=' + flowRespMean + ' (vs abs responsive 0.2296), routerMean(best-per-site)=' + routerMean + ' vs abs-only 0.5589.',
  'Produce: flowCorpusMean, flowResponsiveMean, routerCorpusMean, flowWinSites (sites where flow composite > abs), routerGainVsAbs (routerMean - 0.5589), adoptRouter (true iff routerMean > 0.5589 + ~0.01, i.e. routing to the better builder per site is a real corpus win), and a recommendation: should we ROUTE responsive-heavy sites to flow (and which), is flows responsive genuinely higher (the uncapped-lever hypothesis), and what is the next lever after this. Be honest: if flow is worse overall (lower visual/struct outweighs its responsive gain), say the router does NOT help much + abs stays primary.',
].join('\n'), { label: 'router-synth', phase: 'Router', schema: RANKSCHEMA })
log('ROUTER: flowMean=' + (ranked&&ranked.flowCorpusMean) + ' routerMean=' + (ranked&&ranked.routerCorpusMean) + ' gain=' + (ranked&&ranked.routerGainVsAbs) + ' adoptRouter=' + (ranked&&ranked.adoptRouter) + ' flowWins=' + JSON.stringify(ranked&&ranked.flowWinSites))

return { flowMean, flowRespMean, routerMean, routed, perSite: (results||[]).filter(Boolean), ranked, built: ok.length + '/' + SITES.length }

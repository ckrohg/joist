export const meta = {
  name: 'generalization-probe',
  description: 'NORTH-STAR check: the 8 kept recipes are validated only on 4 SaaS sites. This clones + grades 2 FRESH sites (not in the corpus) with the CURRENT cloner to (a) confirm the recipes GENERALIZE (target composite ~0.7), and (b) surface new-site gaps the current corpus does not expose. Read-only on cloner code (uses the current pipeline as-is). Creates 2 throwaway WP pages.',
  phases: [
    { title: 'Probe', detail: 'create page + capture+build+grade each new site' },
    { title: 'Judge', detail: 'generalization verdict + ranked new-site gaps' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const BASE = 'https://georges232.sg-host.com'
const NEW = [
  { name: 'reactdev', url: 'https://react.dev' },
  { name: 'stripe', url: 'https://stripe.com' },
]
const PROBE_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  site: { type: 'string' }, url: { type: 'string' }, pageId: { type: 'number' },
  composite: { type: 'number' }, visual: { type: 'number' }, editability: { type: 'number' }, structuralFidelity: { type: 'number' },
  blockMisses: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { block: { type: 'string' }, source: { type: 'number' }, clone: { type: 'number' } }, required: ['block'] } },
  topDefects: { type: 'array', items: { type: 'string' } }, note: { type: 'string' },
}, required: ['site', 'composite'] }

phase('Probe')
const results = await parallel(NEW.map((s) => () => agent([
  'Clone + grade a FRESH site (' + s.url + ', "' + s.name + '") with the CURRENT cloner to test generalization of the 8 kept recipes. Work in ' + GRADER + '. Do NOT edit any cloner/grader file (read-only — this is a probe of the pipeline as-is).',
  'STEPS (run exactly, wait for each 1-3 min):',
  '1) source /tmp/joist-auth.env',
  '2) Create a throwaway WP page: curl -s -X POST "' + BASE + '/wp-json/wp/v2/pages" -H "Authorization: Basic $JOIST_AUTH_B64" -H "Content-Type: application/json" -d \'{"title":"probe-' + s.name + '","status":"publish","content":""}\' — parse the JSON "id" -> PAGEID. (If it fails, report applied note + pageId 0.)',
  '3) node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/probe-' + s.name + '.json --passes 2',
  '4) node build-absolute.mjs --layout /tmp/probe-' + s.name + '.json --page <PAGEID>',
  '5) node grade-sections.mjs --source ' + s.url + ' --clone "' + BASE + '/?page_id=<PAGEID>" --out /tmp/probe-evg-' + s.name,
  '6) read /tmp/probe-evg-' + s.name + '/sections.json. Return: site="' + s.name + '", url, pageId, composite, visual (visualMean), editability (editabilityMean), structuralFidelity, blockMisses (report.blockMisses — source block types missing in the clone), topDefects (the 3 most common perSection "why" strings), note (anything that broke or looked off vs the 4-site corpus).',
  'Do the reps sequentially on the SAME new page. Report the schema fields.',
].join('\n'), { label: 'probe:' + s.name, phase: 'Probe', schema: PROBE_SCHEMA }).catch(() => null)))

phase('Judge')
const ok = results.filter(Boolean)
const synth = await agent([
  'You are judging GENERALIZATION of a website-cloner. The cloner has 8 recipes validated on 4 SaaS sites (corpus mean ~0.751: tailwind 0.705, supabase 0.806, resend 0.711, framer 0.782). Below are clone+grade results for 2 FRESH sites not in the corpus.',
  'Results JSON:',
  JSON.stringify(ok, null, 2),
  'TASKS: (1) GENERALIZATION VERDICT — do the recipes hold on new sites? Compare each new site\'s composite + per-dimension to the corpus band (~0.70-0.80). Flag any that fell well below (generalization gap) and WHY (from blockMisses/topDefects). (2) NEW GAPS — list defect classes / block types / failure modes that appear on these new sites but were NOT prominent in the 4-site corpus (these are fresh discovery targets — the value of broadening). (3) RECOMMENDATION — should these 2 sites be ADDED to the permanent corpus (if they expose useful new signal), and what are the top 2-3 next fix-targets they reveal? Return a concise markdown verdict + a compact JSON array of the top 3 new gap-fixes {dim, fix, file, expectedValue}.',
].join('\n'), { label: 'judge:generalization', phase: 'Judge' }).catch((e) => 'judge failed: ' + (e && e.message))

log('GENERALIZATION PROBE complete: ' + ok.map((r) => r.site + '=' + r.composite).join(', '))
return { probed: ok.map((r) => ({ site: r.site, composite: r.composite, visual: r.visual, editability: r.editability, struct: r.structuralFidelity, pageId: r.pageId })), judgment: synth }

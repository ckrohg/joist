export const meta = {
  name: 'benchfix-live-gate',
  description: 'LIVE-GATE the bench-text-coverage fix (recipe #29 phantom-bgRect suppression). The live re-baseline AFTER #29 dropped composite 0.5643->0.5399 with coverage UP (0.5182->0.5306) but visual DOWN (0.6726->0.5963) — the signature of #29 overfitting the bench (synthetic bgRects were junk; real-site bgRects carry real background visual). CONFIRM causation: A/B rebuild supabase+tailwind with #29 ON (default) vs OFF (NO_BENCHTEXT_BUILD=1), median-of-2, compare visual+coverage+composite. DECISION: if OFF composite > ON composite (the fix is net-negative on live) -> RESTORE build-absolute to the pre-#29 backup (/tmp/ev-bk-build-absolute-benchtext.mjs, content-verified) and demote #29 (bench-overfit). If ON >= OFF (fix is net-positive or neutral) -> KEEP #29 (the re-baseline drop was something else). Bank the process lesson either way: bench-validated builder fixes MUST pass a live gate.',
  phases: [
    { title: 'Live-AB', detail: 'rebuild supabase+tailwind #29 ON vs OFF (median-of-2); compare visual/coverage/composite' },
    { title: 'Decide', detail: 'if net-negative on live -> restore pre-#29 build-absolute (demote bench-overfit); else keep' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Do NOT edit any file in the AB phase (build+grade only). AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Build-then-grade in THIS agent (consistent). 422 silent-save w/ tree persisted = ok. NO_BENCHTEXT_BUILD=1 disables recipe #29.'

const VS = { type: 'object', additionalProperties: false, properties: {
  site: { type: 'string' }, visualOff: { type: 'number' }, visualOn: { type: 'number' }, coverageOff: { type: 'number' }, coverageOn: { type: 'number' },
  compositeOff: { type: 'number' }, compositeOn: { type: 'number' }, fixNetPositive: { type: 'boolean' }, verdict: { type: 'string' },
}, required: ['site', 'visualOff', 'visualOn', 'compositeOff', 'compositeOn', 'fixNetPositive', 'verdict'] }
phase('Live-AB')
const SITES = [
  { name: 'supabase', url: 'https://supabase.com', page: 2986 },
  { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146 },
]
const ab = await parallel(SITES.map((s) => () => agent([HARD,
  'LIVE A/B recipe #29 (phantom-bgRect suppression) on ONE site. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + '. ' + AUTH + ' before every WP command. You MUST end by calling StructuredOutput. Build-then-grade BOTH modes in THIS agent (one shared capture; only the NO_BENCHTEXT_BUILD env differs).',
  'BUILD+GRADE OFF (NO_BENCHTEXT_BUILD=1, #29 disabled): build-absolute.mjs --publish ; grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" (median-of-2). Record visualOff, coverageOff (areaCoverage), compositeOff.',
  'BUILD+GRADE ON (#29 default-on): same, no flag. Record visualOn, coverageOn, compositeOn (median-of-2).',
  'fixNetPositive = compositeOn >= compositeOff - 0.003 (the fix is net-positive-or-neutral on live). Judge like a human: does #29 ON lose real section backgrounds (visual down) or just remove junk (visual same/up)? Return {site, visualOff, visualOn, coverageOff, coverageOn, compositeOff, compositeOn, fixNetPositive, verdict}.',
].join('\n'), { label: 'liveab:' + s.name, phase: 'Live-AB', schema: VS }))).then((rs) => rs.filter(Boolean))
for (const r of ab) log('AB ' + r.site + ': visual ' + r.visualOff + '->' + r.visualOn + ' coverage ' + r.coverageOff + '->' + r.coverageOn + ' composite ' + r.compositeOff + '->' + r.compositeOn + ' netPos=' + r.fixNetPositive)

phase('Decide')
const netNegative = ab.length && ab.filter((r) => !r.fixNetPositive).length >= ab.length / 2 && ab.some((r) => r.compositeOn < r.compositeOff - 0.005)
let verdict
if (netNegative) {
  const restore = await agent('Recipe #29 (BENCHTEXT phantom-bgRect suppression in build-absolute.mjs) is NET-NEGATIVE on live (overfit the synthetic bench). DEMOTE it by FLIPPING ITS GATE TO DEFAULT-OFF (do NOT restore a backup — the /tmp backup is contaminated; #29 is reversible via NO_BENCHTEXT_BUILD). Work in ' + GRADER + '. Find the BENCHTEXT gate in build-absolute.mjs (the env check like process.env.NO_BENCHTEXT_BUILD !== "1" that defaults the suppression ON). Change it so the suppression is DEFAULT-OFF — i.e. it ONLY runs when explicitly enabled (e.g. process.env.BENCHTEXT_BUILD === "1"). This keeps the code (reversible/re-enablable for the bench) but removes it from the DEFAULT live pipeline. node --check build-absolute.mjs. VERIFY: a default build (no env) no longer applies BENCHTEXT suppression (the phantom-bgRects are emitted again). Return "DEMOTED:" + confirmation a default build skips BENCHTEXT, or "FAILED:".', { label: 'demote-29', phase: 'Decide' })
  verdict = 'DEMOTED recipe #29 (bench-OVERFIT) — net-negative on live (' + ab.map((r)=>r.site+' comp '+r.compositeOff+'->'+r.compositeOn+' visual '+r.visualOff+'->'+r.visualOn).join(' | ') + '). Phantom-bgRect suppression removed REAL section backgrounds on live sites (visual drop > coverage gain). Gate flipped to DEFAULT-OFF (BENCHTEXT_BUILD=1 to re-enable on the bench). ' + String(restore||'').slice(0,140) + ' LESSON: bench-validated builder fixes MUST pass a LIVE gate before keeping; the synthetic bench lacks real-background complexity. Re-baseline to confirm recovery to ~0.5643.'
} else {
  verdict = 'KEEP recipe #29 — net-positive/neutral on live (' + ab.map((r)=>r.site+' comp '+r.compositeOff+'->'+r.compositeOn).join(' | ') + '). The re-baseline composite drop was NOT #29 (likely the perelement restore-to-covsep changed the grader, or capture variance). Investigate the grader-state delta separately; #29 stands.'
}
log('BENCHFIX-LIVE-GATE: ' + verdict)
return { verdict, ab }

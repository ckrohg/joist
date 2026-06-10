export const meta = {
  name: 'evolve-corpus-gated',
  description: 'Phase-2 self-improvement engine, CORPUS-GATED + NOISE-HARDENED: re-clone+grade each corpus site K times (median) BOTH before and after a coder agent fixes the top structural/defect miss -> KEEP iff (corpus mean rises OR structural-fidelity rises) with NO per-site regression beyond that site\'s measured capture-noise band (else auto-restore). Logs a recipe.',
  phases: [
    { title: 'Baseline', detail: 're-clone+grade all sites K times w/ CURRENT code (median + noise band) + rank misses' },
    { title: 'Propose', detail: 'coder agent: backup -> targeted fix for top class -> self-test' },
    { title: 'Gate', detail: 're-clone+grade all sites K times with the fix (median)' },
    { title: 'Decide', detail: 'keep iff (mean up OR structural up) + no per-site regression beyond noise, else restore; log recipe' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const EPS = 0.01, REG_FLOOR = 0.025, REG_CAP = 0.06, STRUCT_EPS = 0.005, K = 2
const SITES = [
  { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146 },
  { name: 'supabase', url: 'https://supabase.com', page: 2986 },
  { name: 'resend', url: 'https://resend.com', page: 2988 },
  { name: 'framer', url: 'https://www.framer.com', page: 2990 },
]
const cloneUrl = (p) => 'https://georges232.sg-host.com/?page_id=' + p
// Driver blacklist: blocks the overnight driver has retired (already built / no-op / non-landing) so auto-target
// skips them. RELIABLE channel = DRIVER_EXCLUDE (the driver edits this line directly — workflow scripts can't
// read files, and Workflow `args` can arrive as a JSON STRING so args.exclude silently no-ops). args is parsed
// defensively as a backup only.
const DRIVER_EXCLUDE = ['video', 'tabs', 'form', 'nav']
const _ARGS = (typeof args === 'string') ? (() => { try { return JSON.parse(args) } catch { return {} } })() : (args || {})
const EXCLUDE = new Set([...DRIVER_EXCLUDE, ...((_ARGS && Array.isArray(_ARGS.exclude)) ? _ARGS.exclude : [])])
const STRUCT_FLOOR = 0.05 // a site whose structuralFidelity <= this captures ~nothing (broken dynamic capture) → its "misses" are capture failures, not builder gaps; don't let them drive auto-target
const med = (a) => { const x = (a || []).filter((n) => typeof n === 'number').slice().sort((p, q) => p - q); if (!x.length) return 0; const m = x.length >> 1; return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2 }
const spread = (a) => { const x = (a || []).filter((n) => typeof n === 'number'); return x.length > 1 ? Math.max(...x) - Math.min(...x) : 0 }
const GRADE_SCHEMA = { type: 'object', additionalProperties: false, properties: { site: { type: 'string' }, composite: { type: 'number', description: 'MEDIAN composite across the K reps' }, composites: { type: 'array', items: { type: 'number' }, description: 'the K per-rep composite scores' }, structuralFidelity: { type: 'number', description: 'MEDIAN structuralFidelity across the K reps' }, defects: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { why: { type: 'array', items: { type: 'string' } }, severity: { type: 'number' }, example: { type: 'string' } }, required: ['why', 'severity'] } }, blockMisses: { type: 'array', description: 'block types in source but missing in clone (last rep)', items: { type: 'object', additionalProperties: false, properties: { block: { type: 'string' }, source: { type: 'number' }, clone: { type: 'number' } }, required: ['block', 'source'] } } }, required: ['site', 'composite', 'composites', 'structuralFidelity', 'defects'] }
const PROPOSE_SCHEMA = { type: 'object', additionalProperties: false, properties: { applied: { type: 'boolean' }, file: { type: 'string' }, selfTestPass: { type: 'boolean' }, diffSummary: { type: 'string' }, note: { type: 'string' } }, required: ['applied', 'file', 'selfTestPass'] }

// Re-clone (capture+build) then grade a site K times IN SEQUENCE, returning median + per-rep scores so the gate
// can measure each site's capture-noise band and avoid false regressions. Always fresh-builds (apples-to-apples:
// baseline reflects CURRENT code, not a stale deployed clone).
function gradeRepsPrompt(s) {
  return [
    'Re-clone (capture+build) then grade ONE site ' + K + ' times IN SEQUENCE to denoise the score. Work in ' + GRADER + '. Do NOT edit any cloner file.',
    'For EACH rep (i = 1..' + K + '), run EXACTLY these, in order, waiting for each to finish (1-3 min each):',
    '  source /tmp/joist-auth.env',
    '  node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/ev-' + s.name + '.json --passes 2',
    '  node build-absolute.mjs --layout /tmp/ev-' + s.name + '.json --page ' + s.page,
    '  node grade-sections.mjs --source ' + s.url + ' --clone "' + cloneUrl(s.page) + '" --out /tmp/evg-' + s.name,
    '  then read /tmp/evg-' + s.name + '/sections.json and note that rep\'s report.composite and report.structuralFidelity.',
    'Run the reps STRICTLY SEQUENTIALLY on the same page (page ' + s.page + ') — NEVER concurrently (they share one page id; concurrent builds corrupt it).',
    'Return: site="' + s.name + '", composites=[the ' + K + ' composite numbers in rep order], composite=the MEDIAN of those, structuralFidelity=the MEDIAN structuralFidelity across reps, defects=the LAST rep\'s failing sections ({why,severity,example} each), blockMisses=the LAST rep\'s report.blockMisses (block types present in source but missing in the clone).',
  ].join('\n')
}

// Grade ALL sites with one retry for any that drop (a long K-rep agent occasionally ends without calling
// StructuredOutput). A 30h unattended loop must NOT silently lose a corpus site, so retry nulls once and warn.
async function gradeAll(phaseName, tag) {
  const run = (s, extra) => agent(gradeRepsPrompt(s) + (extra || ''), { label: tag + ':' + s.name, phase: phaseName, schema: GRADE_SCHEMA })
  const results = await parallel(SITES.map((s) => () => run(s)))
  const miss = []; for (let i = 0; i < results.length; i++) if (!results[i]) miss.push(i)
  if (miss.length) {
    log('retrying ' + miss.length + ' dropped site(s): ' + miss.map((i) => SITES[i].name).join(','))
    const retry = await parallel(miss.map((i) => () => run(SITES[i], '\n\nRETRY: a previous attempt ended WITHOUT returning a result. You MUST finish by calling the StructuredOutput tool with the required fields — do not end your turn without it.')))
    miss.forEach((i, k) => { if (retry[k]) results[i] = retry[k] })
  }
  const ok = results.filter(Boolean)
  if (ok.length < SITES.length) log('WARNING: only ' + ok.length + '/' + SITES.length + ' sites graded (' + phaseName + ') — mean is over the survivors')
  return ok
}

phase('Baseline')
const base = await gradeAll('Baseline', 'base')
const baseMean = base.length ? +(base.reduce((a, r) => a + r.composite, 0) / base.length).toFixed(3) : 0
const baseStructMean = base.length ? +(base.reduce((a, r) => a + (r.structuralFidelity || 0), 0) / base.length).toFixed(3) : 0
const baseBy = {}, baseStructBy = {}, noiseBy = {}
for (const r of base) { baseBy[r.site] = r.composite; baseStructBy[r.site] = r.structuralFidelity || 0; noiseBy[r.site] = +spread(r.composites).toFixed(3) }
const classAgg = {}; const examples = {}
for (const r of base) for (const d of (r.defects || [])) for (const w of (d.why || [])) { classAgg[w] = (classAgg[w] || 0) + (d.severity || 0); if (d.example && !examples[w]) examples[w] = d.example }
const ranked = Object.entries(classAgg).filter(([c]) => c !== 'rastered-text-cheat').sort((a, b) => b[1] - a[1])
// STRUCTURAL misses (block types in source, 0 in clone) drop composite hard (0.3 weight) → prefer them as the
// target. Aggregate across sites by total source-count; pick the most-impactful missing block TYPE.
const structAgg = {}; for (const r of base) { if ((r.structuralFidelity || 0) <= STRUCT_FLOOR) continue; for (const m of (r.blockMisses || [])) { if (EXCLUDE.has(m.block)) continue; if ((m.clone || 0) === 0 && (m.source || 0) > 0) structAgg[m.block] = (structAgg[m.block] || 0) + m.source } }
const structRanked = Object.entries(structAgg).sort((a, b) => b[1] - a[1])
const isStructural = structRanked.length > 0
const topClass = isStructural ? ('structural:' + structRanked[0][0]) : (ranked.length ? ranked[0][0] : 'missing-text')
log('baseline mean ' + baseMean + ' (struct ' + baseStructMean + ') | noise ' + JSON.stringify(noiseBy) + ' | TARGET: ' + topClass + (isStructural ? ' (missing on ' + structRanked[0][1] + ' source instances)' : ' (sev ' + (ranked[0] ? ranked[0][1].toFixed(2) : 0) + ')'))

phase('Propose')
const structBlock = isStructural ? structRanked[0][0] : null
const proposePrompt = isStructural ? [
  'You are the self-improvement engine of a website-cloner. The grader reports the clone reproduces ZERO "' + structBlock + '" widgets though sources have ' + structRanked[0][1] + ' across the corpus (structuralFidelity drags). Make the cloner rebuild "' + structBlock + '" as the CORRECT native Elementor widget (NOT text/raster). Work in ' + GRADER + '. Be surgical + SAFE.',
  'FIRST read knowledge/STRUCTURAL_ROUND_PLAYBOOK.md — if it has a ready-to-apply section for "' + structBlock + '", follow it near-verbatim (it mirrors the grader detector + capability matrix). Otherwise read knowledge/ELEMENTOR_CAPABILITY_MATRIX.md for the "' + structBlock + '" row.',
  'You likely need TWO edits: (a) capture-layout.mjs walk() must DETECT the "' + structBlock + '" block as its own node kind, with a gate that MIRRORS grade-sections.mjs\'s detector for it EXACTLY (so source/clone counting stays symmetric); (b) build-absolute.mjs leafWidget() must emit the matching Elementor widget for that kind. The n.kind===\'list\' detector (capture) + branch (build) are your proven TEMPLATE.',
  'RULES: edit ONLY capture-layout.mjs and/or build-absolute.mjs. Do NOT touch grade-sections.mjs/scoring. Do NOT rasterize. ',
  'STEPS: 1) cp capture-layout.mjs /tmp/ev-bk-capture.mjs ; cp build-absolute.mjs /tmp/ev-bk-build.mjs  2) implement the detection + widget emission for "' + structBlock + '".  3) source /tmp/joist-auth.env ; node grade-sections.mjs --source https://resend.com --selftest → MUST print PASS (else restore both, report applied=false).  4) Report: applied, file, selfTestPass, diffSummary, note. Do NOT build/grade — the engine corpus-gates it.',
].join('\n') : [
  'You are the self-improvement engine of a website-cloner. Improve the cloner CODE to reduce its #1 corpus defect class: ' + topClass + '. Example lost/broken: "' + (examples[topClass] || '') + '". Work in ' + GRADER + '. Be surgical + SAFE.',
  'RULES: edit ONLY capture-layout.mjs OR build-absolute.mjs (pick the right layer). Do NOT touch grade-sections.mjs or any scoring. Do NOT rasterize/screenshot text. Small, targeted change.',
  'STEPS:',
  '1) Back up BOTH files: cp capture-layout.mjs /tmp/ev-bk-capture.mjs ; cp build-absolute.mjs /tmp/ev-bk-build.mjs',
  '2) Make ONE targeted change to the appropriate file to reduce ' + topClass + '. (capture-side for missing-text/capture-loss; build-side for color/background/font/geometry.)',
  '3) source /tmp/joist-auth.env ; node grade-sections.mjs --source https://resend.com --selftest  → MUST print PASS. If not, restore both backups and report applied=false, selfTestPass=false.',
  '4) Report: applied, file (which you edited), selfTestPass, diffSummary (what you changed), note (root cause). Do NOT build/grade — the engine will corpus-gate your change.',
].join('\n')
const prop = await agent(proposePrompt, { label: 'propose:' + topClass, phase: 'Propose', schema: PROPOSE_SCHEMA })

let verdict, afterMean = null, afterStructMean = null, baseMeanC = null, baseStructC = null, perSite = [], regressions = []
if (!prop || !prop.applied || !prop.selfTestPass) {
  verdict = 'NO-OP (no valid change / self-test failed — nothing to gate)'
} else {
  phase('Gate')
  const after = await gradeAll('Gate', 'gate')
  // Compare ONLY over sites graded in BOTH phases (intersection) — a dropped site must not change the
  // denominator and fabricate a gain/loss (this caused round 5's spurious video KEEP when framer dropped out).
  const common = new Set(after.map((r) => r.site).filter((s) => base.some((b) => b.site === s)))
  const cAvg = (arr, key) => { const xs = arr.filter((r) => common.has(r.site)); return xs.length ? +(xs.reduce((a, r) => a + (r[key] || 0), 0) / xs.length).toFixed(3) : 0 }
  baseMeanC = cAvg(base, 'composite'); baseStructC = cAvg(base, 'structuralFidelity')
  afterMean = cAvg(after, 'composite'); afterStructMean = cAvg(after, 'structuralFidelity')
  // per-site regression is NOISE-AWARE: only counts if the drop exceeds max(REG_FLOOR, this site's measured
  // baseline capture-noise spread), capped so a wildly-variant draw can't grant infinite tolerance.
  perSite = after.map((r) => { const tol = Math.min(REG_CAP, Math.max(REG_FLOOR, noiseBy[r.site] || 0)); const delta = +((r.composite || 0) - (baseBy[r.site] || 0)).toFixed(3); return { site: r.site, before: baseBy[r.site], after: r.composite, delta, noise: noiseBy[r.site] || 0, tol: +tol.toFixed(3), structBefore: baseStructBy[r.site], structAfter: r.structuralFidelity || 0 } })
  regressions = perSite.filter((p) => p.delta < -p.tol)
  phase('Decide')
  const meanUp = afterMean > baseMeanC + EPS
  const structUp = afterStructMean > baseStructC + STRUCT_EPS
  // KEEP a change that is harmless (no real regression) AND moves the needle on EITHER axis — measured over the
  // SAME site set in both phases. common.size>=2 guards against thin/dropped-site verdicts.
  const keep = regressions.length === 0 && (meanUp || structUp) && common.size >= 2
  if (!keep) {
    await agent('Restore the cloner code (a proposed fix did not pass the corpus gate). Run: cd ' + GRADER + ' && cp /tmp/ev-bk-capture.mjs capture-layout.mjs && cp /tmp/ev-bk-build.mjs build-absolute.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Decide' })
    const reason = regressions.length ? 'regressed beyond noise: ' + regressions.map((r) => r.site + ' (' + r.delta + ' < -' + r.tol + ')').join(', ') : 'no mean gain (' + baseMeanC + '->' + afterMean + ') / no structural gain (' + baseStructC + '->' + afterStructMean + ') over ' + common.size + ' common sites'
    verdict = 'REJECTED + RESTORED — ' + reason
  } else {
    verdict = 'KEPT (' + (meanUp ? 'mean ' + baseMeanC + '->' + afterMean : 'mean flat') + '; ' + (structUp ? 'struct ' + baseStructC + '->' + afterStructMean : 'struct flat') + '; ' + common.size + ' common sites; no regression beyond noise)'
  }
}
const recipe = { defectClass: topClass, file: prop?.file, baselineMean: (baseMeanC != null ? baseMeanC : baseMean), afterMean, baselineStruct: (baseStructC != null ? baseStructC : baseStructMean), afterStruct: afterStructMean, baselineMean4site: baseMean, perSite, regressions, noiseBy, kept: !!verdict && verdict.startsWith('KEPT'), selfTestPass: prop?.selfTestPass, diffSummary: prop?.diffSummary, note: prop?.note }
log('EVOLVE verdict: ' + verdict)
return { verdict, recipe }

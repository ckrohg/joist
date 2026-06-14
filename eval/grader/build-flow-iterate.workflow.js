export const meta = {
  name: 'build-flow-iterate',
  description: 'SUPERVISED iteration loop for the container-inference flow builder (build-flow.mjs). Applies ONE driver-edited fix directive (SCHEMALESS fix agent to avoid StructuredOutput crashes), then A/Bs on tailwind+linear (PUBLISHED pages 5404/5405) vs absolute baselines + responsiveness at 768/390. Owns build-flow.mjs ONLY; never touches build-absolute/capture-layout/capture-ensemble/grade-sections (the concurrent directed-fix round backs those up).',
  phases: [
    { title: 'Fix', detail: 'apply the v-directive to build-flow.mjs; node --check + dry sanity (schemaless)' },
    { title: 'AB', detail: 'capture-ensemble + flow-build + PUBLISH + grade tailwind & linear; responsive 768/390 vs abs baseline' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'HARD SAFETY: edit ONLY build-flow.mjs. Back it up FIRST to /tmp/ev-bk-buildflow-img.mjs. Do NOT edit/move/delete build-absolute.mjs, capture-layout.mjs, capture-ensemble.mjs, grade-sections.mjs, perelement-score.mjs — READ/RUN only. Never use the ABSOLUTE corpus page ids (2986/2988/2990/3146/4296/4297/4771). Never print JOIST_AUTH_B64. source /tmp/joist-auth.env for WP auth.'

// ===== DRIVER-EDITED v-spec =====
const VLABEL = 'flow-framer-image-recovery: stop dropping distinct image leaves (framer builds 86 image widgets but only ~33 render) — recover the ~53 lost imagery — build-flow ONLY'
const VDIRECTIVE = [
  'CONTEXT: the framer flow clone (recipe #18 recovered its <main> subtree) builds 86 image widgets but only ~33 render live as <img> (the 33 that render are NOT broken — 0 load errors). So ~53 distinct images are LOST between build and render. This starves framer visual mass + areaCoverage (the images ARE in the capture). On the lowest site (framer 0.518), recovering them is the most concrete remaining lever.',
  'STEP A — DIAGNOSE WHERE the 53 are lost (do this FIRST, in the fix agent): count image nodes at three stages on framer — (a) build-flow EMITTED tree (does the output _elementor_data contain 86 or ~33 image widgets?), (b) the WP-saved tree (GET the page _elementor_data after PUT — 86 or 33? = did kses/atomic-save drop them?), (c) the rendered page (33 live <img>). This pinpoints the loss layer: build-side normalize/dedup (a<86), save-side (b<a), or render-side (c<b).',
  'FIX (build-flow.mjs ONLY) — target the loss layer found in STEP A:',
  '1. If build-flow normalize()/dedup COLLAPSES distinct image leaves (most likely): dedup ONLY true duplicates (same src AND ~same box); do NOT collapse distinct images (different src, or different box position) — each distinct source image must emit its own widget.',
  '2. If the loss is save-side (kses/atomic drops widgets): that is NOT build-flow editable here — report it as out-of-scope for this build-flow round (a plugin/kses item) and instead ensure build-flow is not emitting a malformed/duplicate structure that triggers the drop.',
  '3. GUARD: keep recipes #15 (geometryGridCols), #16 (overlay-abs), #17 (minmax), #18 (visiblekid-flatten), #19 (footer-grid) ALL intact. node --check build-flow.mjs.',
  'The point: distinct source images must each survive to render. Recovering ~53 framer images restores real visual mass + areaCoverage on the lowest-scoring site. (NOTE: framer is a dynamic/animated WALL-class source with a known visual ceiling (ssim ~0.46) — this lever lifts the STATIC imagery portion, bounded by that ceiling.)',
].join('\n')
const VEXPECT = 'framer recovers most of the ~53 dropped images (33 -> ~75-86 live <img>) -> visual mass + areaCoverage rise -> framer composite 0.518 -> ~0.55-0.60 (bounded by the dynamic-content ssim ceiling). tailwind + supabase NO regression (the dedup-only-true-duplicates change does not affect sites without dropped-distinct-image issues). build-flow ONLY. The AB reviewer confirms framer img-count rises (33 -> ~75+) + the diagnosis of WHERE the loss was + composite up; tailwind/supabase unchanged.'
// ===== end driver-edited =====

phase('Fix')
const fix = await agent([HARD_RULE,
  'Recover dropped framer image leaves in the FLOW builder. Work in ' + GRADER + '. Read build-flow.mjs (image-leaf emission + normalize()/dedup) first.',
  'FIX (' + VLABEL + '):\n' + VDIRECTIVE,
  'STEP 0: cp build-flow.mjs /tmp/ev-bk-buildflow-img.mjs  (back up first).',
  'STEP A (DIAGNOSE FIRST): build-flow on /tmp/fg-framer.json --page 6005 (capture exists; else capture-ensemble framer). Count image widgets at: (a) the build-flow EMITTED _elementor_data (before PUT), (b) the WP-saved tree (GET page 6005 _elementor_data after publish), (c) the rendered page (live <img> count). Report a/b/c (e.g. 86/?/33) to pinpoint the loss layer.',
  'STEP 1: implement the fix for the loss layer (dedup only true duplicates [same src+box], never distinct images; or report save-side as out-of-scope). node --check build-flow.mjs — MUST pass; if it cannot, restore /tmp/ev-bk-buildflow-img.mjs and say RESTORED.',
  'STEP 2: dry sanity — rebuild framer --page 6005, publish, re-count live <img> (target 33 -> ~75+). LOG the before->after img count + where the loss was.',
  'Return a short PLAIN-TEXT report (NOT a tool call): node --check pass, the STEP-A a/b/c counts (WHERE the loss was), the fix, the live img count before->after. Start with "OK:" if build-flow.mjs is edited and node --check passes, or "RESTORED:" if you reverted (incl. if the loss was save-side/out-of-scope -> RESTORED + explain).',
].join('\n'), { label: 'fix:' + VLABEL, phase: 'Fix' })
log('flow-framer-image: ' + String(fix || '').slice(0, 240))

let ab = null
if (fix && /\bOK:/i.test(String(fix)) && !/\bRESTORED:/i.test(String(fix))) {
  phase('AB')
  const AB_SCHEMA = { type: 'object', additionalProperties: false, properties: {
    site: { type: 'string' }, page: { type: 'number' }, flowComposite: { type: 'number' }, prevFlow: { type: 'number' }, absBaseline: { type: 'number' },
    hRatio: { type: 'number' }, ssim: { type: 'number' }, visual: { type: 'number' }, struct: { type: 'number' }, edit: { type: 'number' },
    responsive: { type: 'string' }, verdict: { type: 'string' }, nextFixes: { type: 'array', items: { type: 'string' } },
  }, required: ['site', 'flowComposite', 'verdict'] }
  const SITES = [
    { name: 'framer', url: 'https://www.framer.com', page: 6005, absBaseline: 0.7215, prevFlow: 0.518 },
    { name: 'tailwind', url: 'https://tailwindcss.com', page: 5405, absBaseline: 0.85, prevFlow: 0.679 },
    { name: 'supabase', url: 'https://supabase.com', page: 6006, absBaseline: 0.823, prevFlow: 0.674 },
  ]
  ab = await parallel(SITES.map((s) => () => agent([HARD_RULE,
    'A/B the FLOW builder on ONE site WITH the re-applied capture markup-strip fix. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + ' (reuse this non-corpus page). abs baseline=' + s.absBaseline + ', HONEST prev-flow baseline=' + s.prevFlow + ' (the number to beat — clean fresh grade, NOT cherry-picked). You MUST end by calling StructuredOutput.',
    'STEPS (sequential, source /tmp/joist-auth.env first):',
    '  1. node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/cf3-' + s.name + '.json --passes 2  (this capture now runs through the markup-stripped capture-layout).',
    '  2. node build-flow.mjs --layout /tmp/cf3-' + s.name + '.json --page ' + s.page,
    '  3. CRITICAL: PUBLISH (POST wp/v2/pages/' + s.page + ' status=publish) BEFORE grading (drafts render BLANK -> false 0). Re-assert meta._elementor_edit_mode=builder.',
    '  4. node grade-sections.mjs --source ' + s.url + ' --clone "' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/?page_id=' + s.page + '" --out /tmp/cfg3-' + s.name + ' ; read report.composite, structuralFidelity, visualMean, editabilityMean, ssimRaw, hRatio (or heightRatio), AND the perElement breakdown (color/text/typo — these were ALL ~0.03, starved by the 2x height drift this fix targets).',
    '  5. IMAGE-RECOVERY CHECK (the key question, FRAMER especially): page.evaluate the live <img> count + screenshot at 1440. For FRAMER CONFIRM the live <img> count rose from ~33 toward ~75+ (the dropped distinct images recovered) and the page shows the recovered imagery (product screenshots, brand strip, template thumbnails). Report the img count before->after + areaCoverage/visual. For TAILWIND/SUPABASE confirm NO regression — the dedup-only-true-duplicates change must not drop their images or alter their grids.',
    '  6. RESPONSIVE: screenshot at 768 and 390; assert docW <= viewport (no h-overflow) and grids collapse. Describe.',
    'KEY QUESTIONS: (a) FRAMER: did the live <img> count rise from ~33 toward ~75+ (distinct images recovered), and did areaCoverage/visual lift? (b) did flow composite rise above the honest baseline ' + s.prevFlow + ' (bounded by framer dynamic-content ssim ceiling ~0.46)? For TAILWIND/SUPABASE: confirm NO regression below their baselines (' + s.prevFlow + ') — images/grids intact, recipes #15-19 hold. Report REAL numbers, do NOT inflate. top 2 nextFixes.',
    'Return {site, page, flowComposite, prevFlow, absBaseline, hRatio, ssim, visual, struct, edit, responsive, verdict, nextFixes[]}. Put the framer img-count before->after + areaCoverage + where-the-loss-was in the verdict string.',
  ].join('\n'), { label: 'ab:' + s.name, phase: 'AB', schema: AB_SCHEMA }))).then(rs => rs.filter(Boolean))
  for (const r of ab) log('AB ' + r.site + ': flow-v3 ' + r.flowComposite + ' (v2 ' + r.prevFlow + ', abs ' + r.absBaseline + ') hRatio ' + r.hRatio + ' -> ' + r.verdict)
} else {
  log('SKIPPED A/B — fix did not report OK (node --check fail or restore).')
}
return { label: VLABEL, fix: String(fix || '').slice(0, 600), ab }

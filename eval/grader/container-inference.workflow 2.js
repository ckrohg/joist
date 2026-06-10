export const meta = {
  name: 'container-inference-build',
  description: 'SUPERVISED (user-greenlit) architectural build: a NEW flow/container builder (build-flow.mjs) that infers a flex/grid Elementor container tree from captured box geometry so nodes flow as children instead of being absolutely pinned — attacking the deep-text-leaf coverage wall + responsiveness that the absolute builder cannot. Staged: parallel read-only investigation -> synthesized spec -> implement build-flow.mjs (NEW file only) -> A/B on tailwind+linear vs the documented absolute baselines + responsiveness check. NEVER edits build-absolute.mjs / capture-layout.mjs / grade-sections.mjs (owned by the running directed-fix round); A/B on FRESH dedicated pages only.',
  phases: [
    { title: 'Investigate', detail: '5 parallel read-only streams: capture schema, absolute builder, PRIOR flow builder (build-tree.mjs) + why it lost, Elementor container schema, inference algorithm' },
    { title: 'Spec', detail: 'synthesize -> knowledge/CONTAINER_INFERENCE_SPEC.md' },
    { title: 'Build', detail: 'implement build-flow.mjs from the spec (NEW file)' },
    { title: 'AB', detail: 'capture+flow-build+grade tailwind & linear on fresh pages; compare vs absolute baselines + responsiveness' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const KN = '/Users/ckrohg/Documents/Claude/tenet-elementor/knowledge'
const HARD_RULE = 'HARD SAFETY RULES (a directed-fix round is running concurrently): do NOT edit, move, or delete build-absolute.mjs, capture-layout.mjs, capture-ensemble.mjs, or grade-sections.mjs — they are backed-up/restored by the running round; touching them corrupts it. You may READ them and may RUN them (they are read-only invocations). All new code goes in NEW files (build-flow.mjs + any build-flow-*.mjs helpers). Never use a corpus page id (2986/2988/2990/3146/4296/4297/4771) for output — create FRESH pages. Never print JOIST_AUTH_B64. source /tmp/joist-auth.env when you need WP auth.'

// ---------------- Phase 1: parallel read-only investigation ----------------
phase('Investigate')
const INV_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  stream: { type: 'string' }, summary: { type: 'string' },
  keyFacts: { type: 'array', items: { type: 'string' } },
  filesRead: { type: 'array', items: { type: 'string' } },
  gotchas: { type: 'array', items: { type: 'string' } },
}, required: ['stream', 'summary', 'keyFacts'] }
const inv = (label, prompt) => agent([HARD_RULE, 'READ-ONLY investigation. Work in ' + GRADER + '. ' + prompt,
  'Return {stream, summary, keyFacts[], filesRead[], gotchas[]} — concrete and specific (field names, function names, line numbers).'].join('\n'),
  { label: 'inv:' + label, phase: 'Investigate', schema: INV_SCHEMA })

const investigations = await parallel([
  () => inv('capture-schema', 'STREAM = capture output schema. Read capture-layout.mjs (and a sample /tmp/ev-*.json or /tmp/cmp-*.json if present). Document EXACTLY what each emitted node contains: geometry (x,y,w,h? absolute or relative? what coordinate space, what width was it captured at?), kind taxonomy, typo/color/bg/paint fields, and CRUCIALLY whether the output preserves DOM HIERARCHY (parent/child nesting) or is a FLAT leaf list. If flat, confirm that containment can be inferred from box rects (A contains B iff B.rect within A.rect). List every field a flow builder can rely on.'),
  () => inv('absolute-builder', 'STREAM = the current absolute builder contract + kept-recipe fidelity to carry over. Read build-absolute.mjs. Document: how it reads the capture JSON (--layout), how it writes the WP page (REST endpoint? Document::save? the _elementor_edit_mode=builder + _elementor_data flow?), how it CREATES vs reuses a page, and the EXACT kept-recipe fidelity logic a flow builder must reuse: color inline-stamp (r41 foreground glyph + r44 background-container w/ the opacity-0.06 <img> probe child), video landing iframe, nav-wrap, tabs role=, font-register reuse, kses-safe patterns. List the helper functions (nativeTypo, collectBg, bgOf, leafWidget, paintOf...) and what each returns.'),
  () => inv('prior-flow-builder', 'STREAM = the PRIOR flow/container builder and WHY ABSOLUTE BEAT IT (critical — do not repeat its failure). Read build-tree.mjs (and build-hybrid.mjs, refine.mjs, build-frugal/page-reuse if present). Memory says a prior flow-layout builder LOST to absolute on the "multi-column overflow wall". Document: what layout approach build-tree used (flex? grid? nesting strategy?), how it inferred containers, and identify the SPECIFIC failure modes (multi-column overflow, gap/justify drift, height mismatch, nesting errors). Extract concrete lessons the new build-flow.mjs MUST address. Grep journals/recipe-library.json/knowledge for "build-tree"/"flow"/"multi-column" history if useful.'),
  () => inv('elementor-container-schema', 'STREAM = Elementor container/flex/grid settings that survive Document::save + kses. Read how build-absolute.mjs emits containers + use the joist MCP introspection if available (search tools for joist_introspect_atomic_schema / joist_get_page_tree). Document the exact settings keys for a CONTAINER: flex_direction/_flex_direction, flex justify/align (content_width, flex_justify_content, flex_align_items), gap/_gap (and its unit object shape), width/min_height, grid columns, background_background, padding/margin (and the kses/edit-mode caveats from memory: padding key is `padding` not `_padding`, edit_mode=builder required). What can a flow builder reliably set?'),
  () => inv('inference-algorithm', 'STREAM = the layout-inference ALGORITHM design. Read ' + KN + '/RESEARCH_FINDINGS.md + ' + KN + '/CLONE_PIPELINE.md for the Locofy-LDM / container-inference research. Design the algorithm concretely: (1) build a CONTAINMENT TREE from captured boxes (parent = smallest box that contains the child; handle overlaps/siblings). (2) At each node, CLASSIFY the child layout: row (children share y-band, increasing x), column (share x, stacked y), grid (regular rows x cols), or overlay/absolute (genuinely overlapping -> keep absolute as an escape hatch). (3) INFER flex props: direction, gap = median inter-child spacing, justify-content from leading/trailing/inter spacing distribution, align-items from cross-axis alignment, wrap. (4) Explicitly handle the multi-column-overflow failure that killed build-tree (e.g. set explicit child widths / flex-basis from captured w, allow wrap, clamp). Produce step-by-step pseudocode.'),
]).then(rs => rs.filter(Boolean))
log('investigation streams returned: ' + investigations.map(i => i.stream).join(', '))

// ---------------- Phase 2: synthesize the spec ----------------
phase('Spec')
const SPEC_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  specPath: { type: 'string' }, algorithmSummary: { type: 'string' },
  dataContract: { type: 'string' }, reusedRecipes: { type: 'array', items: { type: 'string' } },
  priorFailureFixes: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } },
}, required: ['specPath', 'algorithmSummary'] }
const spec = await agent([HARD_RULE,
  'Synthesize the 5 investigation streams below into a concrete build spec for build-flow.mjs. Write it to ' + KN + '/CONTAINER_INFERENCE_SPEC.md (this is a NEW doc — allowed).',
  'The spec MUST contain: (a) exact INPUT data contract (which capture fields, coordinate space, capture width); (b) the full inference ALGORITHM as implementable pseudocode (containment tree -> row/col/grid classification -> flex-prop inference -> absolute-overlay escape hatch); (c) the OUTPUT — nested Elementor container tree with which settings keys, how the page is written (reuse build-absolute\'s proven WP-write flow: edit_mode=builder, the REST/Document::save path), and that it CREATES fresh pages; (d) which KEPT-RECIPE fidelity to reuse (color stamping r41/r44 incl. the probe-child, video, nav, tabs, font-register) and how; (e) EXPLICIT fixes for why build-tree lost to absolute (the multi-column-overflow wall); (f) the A/B + responsiveness test plan.',
  'INVESTIGATION STREAMS:\n' + investigations.map(i => '### ' + i.stream + '\n' + i.summary + '\nKEY: ' + (i.keyFacts || []).join(' | ') + '\nGOTCHAS: ' + (i.gotchas || []).join(' | ')).join('\n\n'),
  'Return {specPath, algorithmSummary, dataContract, reusedRecipes[], priorFailureFixes[], risks[]}.',
].join('\n'), { label: 'spec:synthesize', phase: 'Spec', schema: SPEC_SCHEMA })
log('spec written: ' + (spec ? spec.specPath : 'FAILED'))

// ---------------- Phase 3: implement build-flow.mjs ----------------
phase('Build')
const BUILD_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  built: { type: 'boolean' }, file: { type: 'string' }, nodeCheckPass: { type: 'boolean' },
  reusedRecipes: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' },
  openIssues: { type: 'array', items: { type: 'string' } },
}, required: ['built', 'nodeCheckPass'] }
const build = await agent([HARD_RULE,
  'Implement the NEW flow/container builder at ' + GRADER + '/build-flow.mjs from the spec at ' + (spec ? spec.specPath : KN + '/CONTAINER_INFERENCE_SPEC.md') + '. Read the spec first, then implement.',
  'CONTRACT: build-flow.mjs --layout <captureJson> --page <id>  (same CLI shape as build-absolute.mjs) — but it INFERS a nested flex/grid container tree from box geometry and emits nodes as FLOWING CHILDREN (not absolute). Reuse build-absolute.mjs\'s PROVEN WP-write flow (edit_mode=builder + the _elementor_data REST/Document::save path) and its kept-recipe fidelity helpers (copy/adapt the logic into build-flow.mjs — do NOT import-and-mutate build-absolute.mjs; you may read it and replicate). Keep an ABSOLUTE-OVERLAY escape hatch for genuinely-overlapping subtrees so nothing is lost. Implement the multi-column-overflow fixes from the spec (explicit child flex-basis/width from captured w, wrap, clamp).',
  'Then: node --check build-flow.mjs (MUST pass). Optionally do a DRY structural sanity (build the container tree from an existing /tmp capture json and console.log the inferred row/col counts) WITHOUT writing to WP. Do NOT corpus-grade.',
  'Return {built, file, nodeCheckPass, reusedRecipes[], summary, openIssues[]}.',
].join('\n'), { label: 'build:build-flow', phase: 'Build', schema: BUILD_SCHEMA })
log('build-flow.mjs built=' + (build && build.built) + ' nodeCheck=' + (build && build.nodeCheckPass))

let ab = null
if (build && build.built && build.nodeCheckPass) {
  // ---------------- Phase 4: A/B on fresh pages vs documented absolute baselines ----------------
  phase('AB')
  const AB_SCHEMA = { type: 'object', additionalProperties: false, properties: {
    site: { type: 'string' }, protoPage: { type: 'number' }, flowComposite: { type: 'number' },
    absBaseline: { type: 'number' }, flowCoverage: { type: 'number' }, flowStruct: { type: 'number' },
    flowVisual: { type: 'number' }, flowEdit: { type: 'number' }, responsive: { type: 'string' },
    verdict: { type: 'string' }, honestAssessment: { type: 'string' },
  }, required: ['site', 'flowComposite', 'verdict', 'honestAssessment'] }
  const SITES = [
    { name: 'tailwind', url: 'https://tailwindcss.com', absBaseline: 0.850 },
    { name: 'linear', url: 'https://linear.app', absBaseline: 0.776 },
  ]
  const abRuns = await parallel(SITES.map((s) => () => agent([HARD_RULE,
    'A/B ONE site for the new flow builder. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + '. Absolute baseline composite = ' + s.absBaseline + ' (the number to beat).',
    'STEPS (run sequentially, source /tmp/joist-auth.env first):',
    '  1. Create a FRESH WP page via REST (POST a draft page titled "flowproto-' + s.name + '"); capture its new page id. NEVER reuse a corpus page id.',
    '  2. Capture the source: node capture-layout.mjs --source ' + s.url + ' --out /tmp/cf-' + s.name + '.json --width 1440  (read-only invocation; distinct out path so it cannot collide with the running round).',
    '  3. Build with the NEW builder: node build-flow.mjs --layout /tmp/cf-' + s.name + '.json --page <freshId>.',
    '  4. Grade: node grade-sections.mjs --source ' + s.url + ' --clone "https://georges232.sg-host.com/?page_id=<freshId>" --out /tmp/cfg-' + s.name + ' ; read /tmp/cfg-' + s.name + '/sections.json report.composite, structuralFidelity, visualMean, editabilityMean, perElement.coverage.',
    '  5. RESPONSIVENESS: re-screenshot the clone page at width 768 and 390 (Playwright, isolated) and eyeball whether the flow layout REFLOWS sanely (vs absolute which is desktop-frozen). Describe what you see.',
    'Compare flowComposite vs absBaseline honestly. A v1 that scores BELOW absolute is an EXPECTED, useful baseline — report the real number, do NOT inflate. In honestAssessment: where flow WON (coverage? responsiveness?), where it LOST (overflow? drift?), and the top 2 fixes for the next iteration.',
    'Return {site, protoPage, flowComposite, absBaseline, flowCoverage, flowStruct, flowVisual, flowEdit, responsive, verdict, honestAssessment}.',
  ].join('\n'), { label: 'ab:' + s.name, phase: 'AB', schema: AB_SCHEMA }))).then(rs => rs.filter(Boolean))
  ab = abRuns
  for (const r of abRuns) log('AB ' + r.site + ': flow ' + r.flowComposite + ' vs abs ' + r.absBaseline + ' -> ' + r.verdict)
} else {
  log('SKIPPED A/B — build did not pass node --check; fix build-flow.mjs first.')
}

return { spec, build, ab, investigations: investigations.map(i => i.stream) }

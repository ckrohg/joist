export const meta = {
  name: 'code-block-color',
  description: 'WAVE-5 #1 (struct floor + reactdev color 0.17, the corpus-lowest sub-score): capture syntax-highlighted CODE BLOCKS as per-token colored EDITABLE text (not a bare one-color run, not a raster). DIAGNOSE-FIRST settles two risks before building: (a) is reactdev color 0.17 RAW-color-low (code captured as bare text -> fixable here) or COVERAGE-CRUSH (sub-scores multiplied by coverage on a sparse page -> the real lever is grader re-attribution #6, NOT this)? (b) do inline-color <span style=color> survive the joist PUT + kses (else fall back to whole-line color / Elementor code widget)? Then BUILD: in the code branch, emit each highlighted token <span> as its own colored text leaf (merge adjacent same-color runs, cap token count), keep <pre> a monospace container; build emits inline-color span runs with the kses-safe fallback. Reversible CAPTURE_NO_CODECOLOR=1. GATE: reactdev code renders with real token colors + stays EDITABLE text (not raster) + color/struct UP + no-reg + self-test 1.0, else auto-restore. If diagnose says coverage-crush or kses-strips, do NOT build (record the pivot to #6).',
  phases: [
    { title: 'Diagnose', detail: 'reactdev: color 0.17 = raw-low vs coverage-crush? inline-color spans survive kses? code-token DOM structure?' },
    { title: 'Build', detail: 'capture per-token colors + emit editable colored monospace (kses-safe fallback); behind CAPTURE_NO_CODECOLOR=1; node --check + selftest 1.0' },
    { title: 'Verify+Gate', detail: 'reactdev code colored+editable + color/struct up + no-reg + self-test, else restore / pivot to #6' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Edit ONLY capture-layout.mjs + build-absolute.mjs (+ perelement-score.mjs ONLY if token-weighted code color is needed). Back up each edited file FIRST (/tmp/ev-bk-<file>-codecolor.mjs). Do NOT edit grade-sections. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64.'

const DSCHEMA = { type: 'object', additionalProperties: false, properties: {
  reactdevColorRaw: { type: 'number' }, reactdevColorCoverageMultiplied: { type: 'number' }, reactdevCoverage: { type: 'number' },
  colorIsCoverageCrush: { type: 'boolean' }, colorIsRawLow: { type: 'boolean' },
  inlineSpanColorSurvivesKses: { type: 'boolean' }, codeTokenStructure: { type: 'string' }, codeBlockCount: { type: 'number' },
  buildWorthwhile: { type: 'boolean' }, fixPlan: { type: 'string' },
}, required: ['colorIsCoverageCrush', 'colorIsRawLow', 'inlineSpanColorSurvivesKses', 'buildWorthwhile', 'fixPlan'] }
const diag = await agent([HARD.replace('Edit ONLY capture-layout.mjs + build-absolute.mjs (+ perelement-score.mjs ONLY if token-weighted code color is needed). Back up each edited file FIRST (/tmp/ev-bk-<file>-codecolor.mjs). ', 'DIAGNOSE — read-only, do NOT edit files. '),
  'DIAGNOSE the reactdev code-block color situation. Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput.',
  '(1) COVERAGE-CRUSH vs RAW-LOW: grade reactdev (page 4771) and read /tmp/<grade>/sections.json + the perelement-score output — find the RAW per-pair color sub-score (before coverage multiply) vs the coverage-multiplied color vs the areaCoverage. reactdevColorRaw, reactdevColorCoverageMultiplied (the reported 0.17), reactdevCoverage. colorIsCoverageCrush = true iff reactdevColorRaw is meaningfully higher than 0.17 (e.g. raw>=0.5, crushed by low coverage) -> then this code-color build will NOT move the composite (the real lever is grader #6 re-attribution). colorIsRawLow = true iff raw color is genuinely low (code tokens captured as one bare color -> fixable here).',
  '(2) KSES: hand-author a tiny test page via the joist/v1 PUT with a text-editor widget containing inline-color spans (<span style="color:#e06c75">const</span> <span style="color:#98c379">x</span>) -> GET it back -> do the inline color styles SURVIVE (inlineSpanColorSurvivesKses) or does kses strip the style attr? If stripped, note the fallback (whole-line color / Elementor code widget / class-based).',
  '(3) CODE STRUCTURE: load reactdev in Playwright, inspect a code block — codeTokenStructure (shiki/prism/highlight.js span structure, do tokens carry getComputedStyle color?), codeBlockCount (how many code blocks on the page).',
  'buildWorthwhile = true iff colorIsRawLow (raw color genuinely low from bare-text code) AND inlineSpanColorSurvivesKses (or a viable fallback) AND codeBlockCount>=2. If colorIsCoverageCrush (raw color fine) -> buildWorthwhile=false + fixPlan says "PIVOT to grader #6 coverage-attribution; code-color will not move the crushed score." fixPlan = the concrete build approach (token capture + emit + fallback) OR the pivot.',
  'Return {reactdevColorRaw, reactdevColorCoverageMultiplied, reactdevCoverage, colorIsCoverageCrush, colorIsRawLow, inlineSpanColorSurvivesKses, codeTokenStructure, codeBlockCount, buildWorthwhile, fixPlan}.',
].join('\n'), { label: 'diagnose:code-color', phase: 'Diagnose', schema: DSCHEMA })
log('DIAG: colorRaw=' + (diag&&diag.reactdevColorRaw) + ' (reported ' + (diag&&diag.reactdevColorCoverageMultiplied) + ', cov ' + (diag&&diag.reactdevCoverage) + ') coverageCrush=' + (diag&&diag.colorIsCoverageCrush) + ' rawLow=' + (diag&&diag.colorIsRawLow) + ' ksesSurvives=' + (diag&&diag.inlineSpanColorSurvivesKses) + ' worthwhile=' + (diag&&diag.buildWorthwhile))

let impl = null, verify = null
if (diag && diag.buildWorthwhile) {
  phase('Build')
  impl = await agent([HARD,
    'BUILD code-block per-token color capture + editable colored emit. Work in ' + GRADER + '. DIAGNOSIS: rawColorLow=' + diag.colorIsRawLow + ' ksesSurvives=' + diag.inlineSpanColorSurvivesKses + ' tokenStructure=' + String(diag.codeTokenStructure||'').slice(0,200) + ' codeBlocks=' + diag.codeBlockCount + ' | fixPlan=' + String(diag.fixPlan||'').slice(0,400),
    'Implement per the fixPlan: in capture-layout.mjs code branch, for an element matching pre/code/[class*=shiki]/[class*=language-]/[class*=hljs], emit each highlighted token <span> as its own text leaf carrying getComputedStyle(span).color (merge adjacent SAME-color runs into one leaf to bound count; cap total tokens ~200/block; keep the <pre> as a monospace container; NEVER surface-raster a <pre> that has real token spans). In build-absolute.mjs, emit the code block as a monospace text-editor/container with inline-color <span> runs (or the diagnosed kses-safe fallback if inline span color is stripped — e.g. whole-line dominant color, or per-token text-editor leaves with color_text). Preserve the dark code background + line structure.',
    'REVERSIBILITY: CAPTURE_NO_CODECOLOR=1 -> old (bare code text). node --check both files. SELFTEST: ' + AUTH + ' && node grade-sections.mjs --source https://react.dev --selftest -> 1.0 (no grader change unless you touched perelement; if you did, supabase+tailwind selftest 1.0 too). SMOKE: rebuild reactdev (4771), render -> code blocks show real token COLORS (not one flat color) + the code text is EDITABLE (native text leaves, NOT a raster image) + grade -> color sub-score up from ' + (diag.reactdevColorCoverageMultiplied) + '. If node --check/selftest fails -> restore + RESTORED.',
    'Return "OK:" with reactdev color before->after + code-editable confirmation + token count, or "RESTORED:".',
  ].join('\n'), { label: 'build:code-color', phase: 'Build' })
  log('IMPL: ' + String(impl || '').slice(0, 260))

  const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
  if (okImpl) {
    phase('Verify+Gate')
    const VS = { type: 'object', additionalProperties: false, properties: {
      site: { type: 'string' }, role: { type: 'string' }, codeColored: { type: 'boolean' }, codeEditable: { type: 'boolean' },
      colorOff: { type: 'number' }, colorOn: { type: 'number' }, structOff: { type: 'number' }, structOn: { type: 'number' },
      compositeOff: { type: 'number' }, compositeOn: { type: 'number' }, selftest: { type: 'number' }, regressed: { type: 'boolean' }, verdict: { type: 'string' },
    }, required: ['site', 'role', 'codeColored', 'codeEditable', 'colorOff', 'colorOn', 'compositeOff', 'compositeOn', 'regressed', 'verdict'] }
    const SITES = [
      { name: 'reactdev', url: 'https://react.dev', page: 4771, role: 'TARGET (code blocks)' },
      { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146, role: 'NO-REG (no code)' },
    ]
    verify = await parallel(SITES.map((s) => () => agent([HARD,
      'VERIFY code-block color on ONE site. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + ' role=' + s.role + '. ' + AUTH + ' before every WP command. You MUST end by calling StructuredOutput. Do NOT edit files. Flag CAPTURE_NO_CODECOLOR=1 disables.',
      'A/B BUILD (build-absolute.mjs --publish; one capture per mode): code-color ON (default) + OFF (CAPTURE_NO_CODECOLOR=1). GRADE both: ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/ccg-' + s.name + '-{on|off}. Record color sub-score, structural, composite.',
      'TARGET (reactdev): codeColored=true iff the rendered code blocks show MULTIPLE token colors (syntax highlighting), not one flat color. codeEditable=true iff the code is NATIVE text widgets (selectable/editable), NOT a raster image. colorOn should be > colorOff. selftest = grade-sections --source reactdev --selftest (1.0).',
      'NO-REG (tailwind, no code): regressed=true iff compositeOn < compositeOff - 0.01 (must be no-op). For reactdev: regressed=true iff compositeOn < compositeOff - 0.01.',
      'Judge like a human: do the code blocks now look syntax-highlighted AND remain editable text? Return {site, role, codeColored, codeEditable, colorOff, colorOn, structOff, structOn, compositeOff, compositeOn, selftest, regressed, verdict}.',
    ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify+Gate', schema: VS }))).then((rs) => rs.filter(Boolean))
    for (const r of verify) log('VERIFY ' + r.site + ' [' + r.role + ']: codeColored=' + r.codeColored + ' editable=' + r.codeEditable + ' color ' + r.colorOff + '->' + r.colorOn + ' comp ' + r.compositeOff + '->' + r.compositeOn + ' reg=' + r.regressed)
  }
}

phase('Verify+Gate')
let verdict
if (!diag || !diag.buildWorthwhile) {
  verdict = 'NOT BUILT — diagnosis: ' + (diag && diag.colorIsCoverageCrush ? 'reactdev color 0.17 is COVERAGE-CRUSH (raw color ' + diag.reactdevColorRaw + ', coverage ' + diag.reactdevCoverage + ') NOT raw-low -> code-color would not move the crushed score. PIVOT to grader #6 (report coverage separately + raw per-pair means).' : !diag || !diag.inlineSpanColorSurvivesKses ? 'inline-color spans do NOT survive kses (no viable editable-colored fallback worth it).' : 'not worthwhile') + ' ' + String(diag&&diag.fixPlan||'').slice(0,200) + ' No build edit made.'
} else if (!impl || !/\bOK:/i.test(String(impl)) || /\bRESTORED:/i.test(String(impl))) {
  verdict = 'REVERTED — build failed/self-test: ' + String(impl||'').slice(0,200)
} else {
  const v = verify || []
  const tgt = v.find((r)=>/TARGET/.test(r.role))
  const noreg = v.filter((r)=>/NO-REG/.test(r.role))
  const selftestOK = !tgt || tgt.selftest == null || tgt.selftest >= 0.999
  const win = tgt && tgt.codeColored && tgt.codeEditable && tgt.colorOn > tgt.colorOff && tgt.compositeOn >= tgt.compositeOff - 0.01
  const noregOK = noreg.every((r)=>!r.regressed)
  if (win && noregOK && selftestOK) {
    verdict = 'ADOPTED — code blocks now syntax-highlighted + EDITABLE (reactdev color ' + tgt.colorOff + '->' + tgt.colorOn + ', struct ' + tgt.structOff + '->' + tgt.structOn + ', composite ' + tgt.compositeOff + '->' + tgt.compositeOn + '); no-reg static; self-test 1.0. Keeps code editable (user principle: words rebuilt). Reversible CAPTURE_NO_CODECOLOR=1.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && for f in capture-layout build-absolute perelement-score; do [ -f /tmp/ev-bk-$f-codecolor.mjs ] && cp /tmp/ev-bk-$f-codecolor.mjs $f.mjs; done && node --check capture-layout.mjs && node --check build-absolute.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Verify+Gate' })
    verdict = 'REVERTED — ' + (!selftestOK ? 'self-test != 1.0' : !win ? 'code not colored/editable OR color/composite did not improve' : 'regressed static') + '. ' + JSON.stringify(v.map(r=>({s:r.site,col:[r.colorOff,r.colorOn],edit:r.codeEditable,comp:[r.compositeOff,r.compositeOn],reg:r.regressed})))
  }
}
log('CODE-BLOCK-COLOR: ' + verdict)
return { verdict, diag, impl: String(impl||'').slice(0,400), verify }

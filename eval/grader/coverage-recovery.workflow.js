export const meta = {
  name: 'coverage-recovery',
  description: 'THE CONFIRMED THROTTLE (3x: #6, completeness-coverage, font-family): per-element ACCURACY is excellent (raw ~0.94) but every sub-score is multiplied by areaCoverage (~0.49 supabase) -> the composite gap is COMPLETENESS. The HONEST lever (per #6: un-gating is gameable; the composite=accuracy*coverage is honest) = RECOVER MORE REAL SOURCE CONTENT so more area MATCHES (dynamic-content-emit proved +0.0225 by recovering text bands). This round attacks the NEXT biggest unmatched-source-AREA. DIAGNOSE-FIRST: decompose areaCoverage on supabase+reactdev into the LARGEST unmatched-source-area elements + classify each: RECOVERABLE CONTENT (image/illustration/section the clone drops or rasters wrong -> recover as native/img), DECORATIVE (skip), or MATCHER-FAILURE (present on BOTH but unpaired due to text-Dice<0.5 / position drift -> note, out of builder scope). Recover the DOMINANT recoverable bucket (capture/build). Reversible. GATE: areaCoverage UP + composite UP on >=1 site + self-test 1.0 + no-reg + recovered content is real (not junk), else auto-restore.',
  phases: [
    { title: 'Diagnose', detail: 'supabase+reactdev: decompose areaCoverage -> largest unmatched-source-area elements, classify recoverable/decorative/matcher-failure, pick the dominant recoverable bucket + fix file' },
    { title: 'Fix', detail: 'recover the dominant bucket (capture/build the dropped big-area content); behind a flag; node --check + selftest 1.0' },
    { title: 'Verify+Gate', detail: 'areaCoverage up + composite up + content real + self-test 1.0 + no-reg, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && export JOIST_BASE="${JOIST_BASE:-http://localhost:8001}"; case "$JOIST_BASE" in *sg-host.com*|*georges232*|*35.212.46.254*) echo "FATAL: JOIST_BASE=$JOIST_BASE is a blocked/paused host (host-guard allowlist; renders only target localhost:8001 or JOIST_TRAINING_BASE)"; exit 1;; esac'
const HARD = 'Back up the file you edit FIRST (/tmp/ev-bk-<file>-covrec.mjs). Edit ONLY the ONE file the diagnosis identifies (capture-layout.mjs or build-absolute.mjs). Do NOT edit grade-sections/perelement scoring. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Build-then-grade in this round. 422 silent-save w/ tree persisted = ok.'

const DSCHEMA = { type: 'object', additionalProperties: false, properties: {
  supabaseCoverage: { type: 'number' }, biggestUnmatchedSrc: { type: 'array', items: { type: 'object', additionalProperties: true } },
  recoverablePct: { type: 'number' }, decorativePct: { type: 'number' }, matcherFailurePct: { type: 'number' },
  dominantBucket: { type: 'string' }, unmatchedCloneJunk: { type: 'boolean' }, fixFile: { type: 'string' }, fixPlan: { type: 'string' }, feasible: { type: 'boolean' },
}, required: ['supabaseCoverage', 'biggestUnmatchedSrc', 'dominantBucket', 'feasible', 'fixPlan'] }
const diag = await agent([HARD.replace('Back up the file you edit FIRST (/tmp/ev-bk-<file>-covrec.mjs). Edit ONLY the ONE file the diagnosis identifies (capture-layout.mjs or build-absolute.mjs). ', 'DIAGNOSE — read-only, do NOT edit. '),
  'DIAGNOSE the areaCoverage throttle. Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput. CONFIRMED 3x: accuracy is excellent (raw ~0.94); the composite gap is areaCoverage (supabase ~0.49). areaCoverage = matchedArea/(matchedArea+unmatchedSrcArea+unmatchedCloneArea).',
  'Build+grade supabase (build-absolute --publish 2986) + reactdev (4771) with REFINE_PAIRS=1 (or read perelement matched/unmatched node lists). DECOMPOSE: list the LARGEST unmatched-SOURCE-area elements (by box area) — the big regions dragging coverage. For each, classify: RECOVERABLE CONTENT (a real image/illustration/section/heading the clone DROPS or rasters wrong -> the clone should reproduce it), DECORATIVE (gradient/pointer-events-none/no real content -> correctly skipped), or MATCHER-FAILURE (the content IS present on BOTH source and clone but the matcher did not PAIR them, e.g. text-Dice<0.5 or position drift > threshold -> grader matcher issue, NOT builder).',
  'biggestUnmatchedSrc = [{desc, areaPct, class}] for the top ~8 by area. recoverablePct/decorativePct/matcherFailurePct = the area-share of each class among unmatched-source. unmatchedCloneJunk = is there significant unmatched-CLONE area (clone emits big elements with no source match = junk dragging coverage)? dominantBucket = which class dominates the unmatched-source AREA.',
  'fixFile + fixPlan: if RECOVERABLE-CONTENT dominates -> the specific capture/build recovery (e.g. "supabase Database/Auth feature illustrations are dropped/mis-rastered -> region-capture them as native <img> at their box" or "section X heading/body dropped -> capture it"). if MATCHER-FAILURE dominates -> note it is a grader-matcher issue (out of scope this round; would need a perelement matcher change, supervised). if DECORATIVE dominates -> coverage is already near-honest (the unmatched is correctly-skipped decoration) and recovery has low headroom. feasible = true iff RECOVERABLE-CONTENT is a meaningful share AND a builder/capture fix exists.',
  'Return {supabaseCoverage, biggestUnmatchedSrc, recoverablePct, decorativePct, matcherFailurePct, dominantBucket, unmatchedCloneJunk, fixFile, fixPlan, feasible}.',
].join('\n'), { label: 'diagnose:coverage', phase: 'Diagnose', schema: DSCHEMA })
log('DIAG: cov=' + (diag&&diag.supabaseCoverage) + ' dominant=' + String(diag&&diag.dominantBucket||'').slice(0,80) + ' recoverable%=' + (diag&&diag.recoverablePct) + ' matcherFail%=' + (diag&&diag.matcherFailurePct) + ' decorative%=' + (diag&&diag.decorativePct) + ' feasible=' + (diag&&diag.feasible))

let impl = null, verify = null
if (diag && diag.feasible) {
  phase('Fix')
  const FILE = /capture/.test(diag.fixFile) ? 'capture-layout.mjs' : (/build/.test(diag.fixFile) ? 'build-absolute.mjs' : diag.fixFile)
  const FLAG = 'NO_COVREC'
  impl = await agent([HARD,
    'IMPLEMENT the coverage-recovery fix. Work in ' + GRADER + '. Edit ' + FILE + '. dominantBucket=' + String(diag.dominantBucket||'').slice(0,150) + ' recoverable%=' + diag.recoverablePct + '. biggestUnmatchedSrc(top): ' + JSON.stringify((diag.biggestUnmatchedSrc||[]).slice(0,6)) + '. fixPlan: ' + String(diag.fixPlan||'').slice(0,450),
    'Implement the fixPlan to RECOVER the dominant recoverable-content bucket (big unmatched-source area the clone drops/mis-rasters). HONOR the user principles: words rebuilt as native text; images may be region-captured as element-level <img> at their box (never chunk a row of distinct things); blank-raster guard (no black images). Do NOT recover DECORATIVE noise (would not match anyway) and do NOT touch matcher-failure (grader scope). Preserve recipes #20-28.',
    'REVERSIBILITY: gate behind ' + FLAG + '=1. node --check. SELFTEST: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0. SMOKE: rebuild+grade supabase (2986) -> areaCoverage should RISE from ' + (diag.supabaseCoverage) + ' + composite should rise (coverage multiplies every sub-score). If node --check / self-test fails -> restore + RESTORED.',
    'Return "OK:" with supabase areaCoverage before->after + composite before->after + what content was recovered, or "RESTORED:".',
  ].join('\n'), { label: 'fix:coverage', phase: 'Fix' })
  log('IMPL: ' + String(impl || '').slice(0, 280))

  const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
  if (okImpl) {
    phase('Verify+Gate')
    const FLAG2 = FLAG
    const VS = { type: 'object', additionalProperties: false, properties: {
      site: { type: 'string' }, role: { type: 'string' }, coverageOff: { type: 'number' }, coverageOn: { type: 'number' },
      compositeOff: { type: 'number' }, compositeOn: { type: 'number' }, contentReal: { type: 'boolean' }, selftest: { type: 'number' }, regressed: { type: 'boolean' }, verdict: { type: 'string' },
    }, required: ['site', 'role', 'coverageOff', 'coverageOn', 'compositeOff', 'compositeOn', 'contentReal', 'regressed', 'verdict'] }
    const SITES = [
      { name: 'supabase', url: 'https://supabase.com', page: 2986, role: 'TARGET' },
      { name: 'reactdev', url: 'https://react.dev', page: 4771, role: 'TARGET' },
      { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146, role: 'NO-REG' },
    ]
    verify = await parallel(SITES.map((s) => () => agent([HARD,
      'VERIFY the coverage-recovery fix on ONE site. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + ' role=' + s.role + '. ' + AUTH + ' before every WP command. You MUST end by calling StructuredOutput. Do NOT edit files. Flag ' + FLAG2 + '=1 disables. Build-then-grade in THIS agent.',
      'A/B BUILD (build-absolute.mjs --publish; one capture per mode): recovery ON (default) + OFF (' + FLAG2 + '=1). GRADE both (median-of-2): ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/crv-' + s.name + '-{on,off}. Record areaCoverage, composite.',
      'coverageOn should be > coverageOff. contentReal=true iff the recovered content is genuine source content correctly placed (not junk/black/duplicated) — verify by render. selftest = grade-sections --source ' + s.url + ' --selftest (1.0). regressed=true iff compositeOn < compositeOff - 0.01.',
      'Judge like a human: did the clone gain real missing content (images/sections), correctly placed? Return {site, role, coverageOff, coverageOn, compositeOff, compositeOn, contentReal, selftest, regressed, verdict}.',
    ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify+Gate', schema: VS }))).then((rs) => rs.filter(Boolean))
    for (const r of verify) log('VERIFY ' + r.site + ' [' + r.role + ']: cov ' + r.coverageOff + '->' + r.coverageOn + ' comp ' + r.compositeOff + '->' + r.compositeOn + ' real=' + r.contentReal + ' selftest=' + r.selftest + ' reg=' + r.regressed)
  }
}

phase('Verify+Gate')
let verdict
if (!diag || !diag.feasible) {
  verdict = 'NOT BUILT — diagnosis: coverage not builder-recoverable. dominant=' + (diag&&diag.dominantBucket) + ' recoverable%=' + (diag&&diag.recoverablePct) + ' matcherFail%=' + (diag&&diag.matcherFailurePct) + ' decorative%=' + (diag&&diag.decorativePct) + '. ' + String(diag&&diag.fixPlan||'').slice(0,220) + (diag&&diag.matcherFailurePct>40 ? ' -> coverage drag is largely GRADER MATCHER-FAILURE (present-on-both unpaired); a supervised perelement-matcher round is the real lever.' : '')
} else if (!impl || !/\bOK:/i.test(String(impl)) || /\bRESTORED:/i.test(String(impl))) {
  verdict = 'REVERTED — fix failed/self-test: ' + String(impl||'').slice(0,200)
} else {
  const v = verify || []
  const tgt = v.filter((r)=>/TARGET/.test(r.role))
  const noreg = v.filter((r)=>/NO-REG/.test(r.role))
  const selftestOK = v.every((r)=>r.selftest == null || r.selftest >= 0.999)
  const win = tgt.some((r)=>r.coverageOn > r.coverageOff + 0.02 && r.compositeOn > r.compositeOff + 0.003 && r.contentReal)
  const noregOK = noreg.every((r)=>!r.regressed) && !tgt.some((r)=>r.regressed || r.contentReal===false)
  if (win && noregOK && selftestOK) {
    verdict = 'ADOPTED — coverage-recovery: recovered real missing source content (' + tgt.filter(r=>r.coverageOn>r.coverageOff).map(r=>r.site+' cov '+r.coverageOff+'->'+r.coverageOn+' comp '+r.compositeOff+'->'+r.compositeOn).join(' | ') + '); content real; self-test 1.0; no-reg. Lifts the confirmed throttle (areaCoverage). Reversible ' + FLAG + '=1. Re-baseline.'
  } else {
    const FILE = /capture/.test(diag.fixFile) ? 'capture-layout.mjs' : (/build/.test(diag.fixFile) ? 'build-absolute.mjs' : diag.fixFile)
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-' + FILE.replace(/\..*/,'') + '-covrec.mjs ' + FILE + ' && node --check ' + FILE + ' && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Verify+Gate' })
    verdict = 'REVERTED — ' + (!selftestOK ? 'self-test != 1.0' : !win ? 'coverage/composite did not rise or content not real' : 'regressed/junk') + '. ' + JSON.stringify(v.map(r=>({s:r.site,cov:[r.coverageOff,r.coverageOn],comp:[r.compositeOff,r.compositeOn],real:r.contentReal,reg:r.regressed})))
  }
}
log('COVERAGE-RECOVERY: ' + verdict)
return { verdict, diag, impl: String(impl||'').slice(0,400), verify }

export const meta = {
  name: 'completeness-coverage',
  description: 'ATTACK THE CONFIRMED LEVER: COMPLETENESS/coverage. #6 proved per-element ACCURACY is excellent (~0.85) and the composite gap is COVERAGE (reactdev 82/205 matched = 0.19), which the grader-multiply AMPLIFIES (coverage 0.19->0.4 ~doubles the per-element composite contribution). DIAGNOSE-FIRST: classify the ~123 UNMATCHED source nodes on reactdev+resend as (a) DECORATIVE FRAGMENTS (textless tiny SVG/icon/empty-wrapper/gradient-rect over-counted in srcNodes -> wave-5 #4 fragment-merge reduces srcNodes on BOTH sides symmetrically -> coverage rises honestly, self-test 1.0) vs (b) GENUINELY-MISSING CONTENT (real text/img/section the clone lacks -> capture/build it). Then FIX the DOMINANT cause. Reversible. GATE: coverage UP on >=1 worst-coverage site + composite UP (amplified) + self-test 1.0 + no-reg + (if fragment-merge) symmetric so source-vs-source still 1.0, else auto-restore.',
  phases: [
    { title: 'Diagnose', detail: 'reactdev+resend: classify unmatched source nodes decorative-fragment vs missing-content; pick the dominant sub-lever' },
    { title: 'Fix', detail: 'fragment/section merge (if fragments dominate) OR imagery/content capture (if content) ; behind a flag; node --check + selftest 1.0' },
    { title: 'Verify+Gate', detail: 'coverage up + composite up (amplified) + self-test 1.0 + no-reg, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Back up the file you edit FIRST (/tmp/ev-bk-<file>-completeness.mjs). Edit ONLY the ONE file the diagnosis identifies (capture-layout.mjs most likely). Do NOT edit grade-sections/perelement unless the fix is a symmetric capture-side merge that must mirror in the grader band-detection (then back up both). AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64.'

const DSCHEMA = { type: 'object', additionalProperties: false, properties: {
  reactdevUnmatchedSrc: { type: 'number' }, reactdevDecorativeFragmentPct: { type: 'number' }, reactdevMissingContentPct: { type: 'number' },
  resendUnmatchedSrc: { type: 'number' }, resendDecorativeFragmentPct: { type: 'number' },
  dominantCause: { type: 'string' }, fragmentExamples: { type: 'array', items: { type: 'string' } }, missingContentExamples: { type: 'array', items: { type: 'string' } },
  fixFile: { type: 'string' }, fixPlan: { type: 'string' },
}, required: ['reactdevUnmatchedSrc', 'reactdevDecorativeFragmentPct', 'reactdevMissingContentPct', 'dominantCause', 'fixFile', 'fixPlan'] }
const diag = await agent([HARD.replace('Back up the file you edit FIRST (/tmp/ev-bk-<file>-completeness.mjs). Edit ONLY the ONE file the diagnosis identifies (capture-layout.mjs most likely). ', 'DIAGNOSE — read-only, do NOT edit (grade + inspect the matched/unmatched node lists + source). '),
  'DIAGNOSE the COVERAGE gap. Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput. #6 proved accuracy is fine; coverage is the gap (reactdev 82/205 matched).',
  'Grade reactdev (4771) + resend (2988) and read the perelement matched/unmatched node lists (/tmp/<grade>/sections.json or the pe-*.json the grader writes). For reactdev, enumerate the UNMATCHED SOURCE nodes (the ~123) and CLASSIFY each: DECORATIVE-FRAGMENT = textless tiny SVG/icon/empty-wrapper/gradient-rect/decorative (area small, no own text, no real content) vs MISSING-CONTENT = a real text run / image / section the clone genuinely lacks. reactdevDecorativeFragmentPct + reactdevMissingContentPct (sum ~100). Same for resend (resendDecorativeFragmentPct).',
  'fragmentExamples (3-5 unmatched nodes that are decorative fragments) + missingContentExamples (3-5 that are real missing content). dominantCause = which dominates the unmatched-source set.',
  'fixFile + fixPlan: if DECORATIVE-FRAGMENTS dominate -> wave-5 #4 fragment-merge: in capture-layout.mjs, BEFORE leaf emission, merge a textless tiny SVG/icon/gradient-rect that is inside/adjacent to a text-bearing sibling INTO that sibling container (area-ascending parent attach) instead of emitting as an abs-pinned page peer; this reduces the node count SYMMETRICALLY (source + clone capture the same way) so coverage rises honestly + self-test stays 1.0. If MISSING-CONTENT dominates -> the lever is content capture (imagery region-capture / section capture) — specify which. Be concrete + name the file + the gate (must be symmetric/self-test-safe if a capture-merge).',
  'Return {reactdevUnmatchedSrc, reactdevDecorativeFragmentPct, reactdevMissingContentPct, resendUnmatchedSrc, resendDecorativeFragmentPct, dominantCause, fragmentExamples, missingContentExamples, fixFile, fixPlan}.',
].join('\n'), { label: 'diagnose:completeness', phase: 'Diagnose', schema: DSCHEMA })
log('DIAG: reactdev unmatched=' + (diag&&diag.reactdevUnmatchedSrc) + ' fragment%=' + (diag&&diag.reactdevDecorativeFragmentPct) + ' missing%=' + (diag&&diag.reactdevMissingContentPct) + ' dominant=' + String(diag&&diag.dominantCause||'').slice(0,100) + ' fixFile=' + (diag&&diag.fixFile))

let impl = null, verify = null
if (diag && diag.fixFile && diag.fixPlan) {
  phase('Fix')
  const FILE = /capture/.test(diag.fixFile) ? 'capture-layout.mjs' : (/build/.test(diag.fixFile) ? 'build-absolute.mjs' : diag.fixFile)
  const FLAG = 'CAPTURE_NO_FRAGMERGE'
  impl = await agent([HARD,
    'IMPLEMENT the COMPLETENESS fix. Work in ' + GRADER + '. Edit ' + FILE + '. DOMINANT cause: ' + String(diag.dominantCause||'').slice(0,200) + ' (reactdev fragment% ' + diag.reactdevDecorativeFragmentPct + ' / missing% ' + diag.reactdevMissingContentPct + '). fixPlan: ' + String(diag.fixPlan||'').slice(0,450) + '. fragmentExamples: ' + JSON.stringify(diag.fragmentExamples) + '.',
    'Implement the fixPlan precisely. IF fragment-merge (decorative fragments dominate): merge textless tiny SVG/icon/gradient-rect leaves into their nearest text-bearing/content sibling container (do NOT emit them as separate abs-pinned page peers) — SYMMETRICALLY (the capture treats source + clone identically) so coverage rises honestly. Do NOT merge real content (text/img/meaningful media). IF missing-content (real content dominates): implement the specified content capture (imagery region-capture etc.). Gate behind ' + FLAG + '=1 (reversible).',
    'SELF-TEST RAIL (if capture-merge): ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest AND --source https://tailwindcss.com --selftest -> 1.0 (a symmetric capture-merge keeps source-vs-source at 1.0). STEP 0: cp ' + FILE + ' /tmp/ev-bk-' + FILE.replace(/\..*/,'') + '-completeness.mjs. node --check. SMOKE: rebuild+grade reactdev (4771) -> coverage should RISE from 0.19 + the per-element/composite should RISE (the multiply amplifies coverage). If node --check / self-test fails -> restore + RESTORED.',
    'Return "OK:" with reactdev coverage before->after + composite before->after + self-test 1.0, or "RESTORED:".',
  ].join('\n'), { label: 'fix:completeness', phase: 'Fix' })
  log('IMPL: ' + String(impl || '').slice(0, 260))

  const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
  if (okImpl) {
    phase('Verify+Gate')
    const VS = { type: 'object', additionalProperties: false, properties: {
      site: { type: 'string' }, role: { type: 'string' }, coverageOff: { type: 'number' }, coverageOn: { type: 'number' },
      perElemOff: { type: 'number' }, perElemOn: { type: 'number' }, compositeOff: { type: 'number' }, compositeOn: { type: 'number' },
      selftest: { type: 'number' }, regressed: { type: 'boolean' }, verdict: { type: 'string' },
    }, required: ['site', 'role', 'coverageOff', 'coverageOn', 'compositeOff', 'compositeOn', 'regressed', 'verdict'] }
    const FLAG2 = FLAG
    const SITES = [
      { name: 'reactdev', url: 'https://react.dev', page: 4771, role: 'TARGET (coverage 0.19)' },
      { name: 'resend', url: 'https://resend.com', page: 2988, role: 'TARGET (low coverage)' },
      { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146, role: 'NO-REG (dense)' },
    ]
    verify = await parallel(SITES.map((s) => () => agent([HARD,
      'VERIFY the completeness fix on ONE site. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + ' role=' + s.role + '. ' + AUTH + ' before every WP command. You MUST end by calling StructuredOutput. Do NOT edit files. Flag ' + FLAG2 + '=1 disables.',
      'A/B BUILD (build-absolute.mjs --publish; one capture per mode): fix ON (default) + OFF (' + FLAG2 + '=1). GRADE both: ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/cmp-' + s.name + '-{on|off}. Record coverage (areaCoverage), per-element, composite.',
      'TARGET: coverageOn should be > coverageOff (more source nodes matched) AND compositeOn > compositeOff (the multiply amplifies coverage). selftest = grade-sections --source ' + s.url + ' --selftest (must be 1.0 — a symmetric merge keeps it 1.0). NO-REG (tailwind dense): regressed=true iff compositeOn < compositeOff - 0.01. For targets: regressed=true iff compositeOn < compositeOff - 0.01.',
      'Judge like a human: did the clone gain real content / lose spurious fragment-leaves? Return {site, role, coverageOff, coverageOn, perElemOff, perElemOn, compositeOff, compositeOn, selftest, regressed, verdict}.',
    ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify+Gate', schema: VS }))).then((rs) => rs.filter(Boolean))
    for (const r of verify) log('VERIFY ' + r.site + ' [' + r.role + ']: coverage ' + r.coverageOff + '->' + r.coverageOn + ' perElem ' + r.perElemOff + '->' + r.perElemOn + ' comp ' + r.compositeOff + '->' + r.compositeOn + ' selftest=' + r.selftest + ' reg=' + r.regressed)
  }
}

phase('Verify+Gate')
let verdict
if (!diag || !diag.fixFile) {
  verdict = 'INCONCLUSIVE — diagnosis incomplete.'
} else if (!impl || !/\bOK:/i.test(String(impl)) || /\bRESTORED:/i.test(String(impl))) {
  verdict = 'REVERTED — fix failed/self-test: ' + String(impl||'').slice(0,200)
} else {
  const v = verify || []
  const tgt = v.filter((r)=>/TARGET/.test(r.role))
  const noreg = v.filter((r)=>/NO-REG/.test(r.role))
  const selftestOK = tgt.every((r)=>r.selftest == null || r.selftest >= 0.999)
  const coverageUp = tgt.some((r)=>r.coverageOn > r.coverageOff + 0.02 && r.compositeOn >= r.compositeOff - 0.005)
  const noregOK = noreg.every((r)=>!r.regressed) && !tgt.some((r)=>r.regressed)
  if (coverageUp && noregOK && selftestOK) {
    verdict = 'ADOPTED — completeness lever: coverage UP on the worst-coverage site(s) (' + tgt.filter(r=>r.coverageOn>r.coverageOff).map(r=>r.site+' cov '+r.coverageOff+'->'+r.coverageOn+' comp '+r.compositeOff+'->'+r.compositeOn).join(', ') + '); self-test 1.0; no-reg. Attacks the confirmed completeness gap (amplified by the coverage-multiply). Reversible ' + FLAG + '=1.'
  } else {
    const FILE = /capture/.test(diag.fixFile) ? 'capture-layout.mjs' : (/build/.test(diag.fixFile) ? 'build-absolute.mjs' : diag.fixFile)
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-' + FILE.replace(/\..*/,'') + '-completeness.mjs ' + FILE + ' && node --check ' + FILE + ' && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Verify+Gate' })
    verdict = 'REVERTED — ' + (!selftestOK ? 'self-test != 1.0 (asymmetric merge)' : !coverageUp ? 'coverage/composite did not rise' : 'regressed a site') + '. ' + JSON.stringify(v.map(r=>({s:r.site,cov:[r.coverageOff,r.coverageOn],comp:[r.compositeOff,r.compositeOn],reg:r.regressed})))
  }
}
log('COMPLETENESS-COVERAGE: ' + verdict)
return { verdict, diag, impl: String(impl||'').slice(0,400), verify }

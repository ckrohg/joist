export const meta = {
  name: 'font-family-assign',
  description: 'SCALABLE per-element inch (distilled by the refine loop): per-element TYPOGRAPHY is HARD-CAPPED at ~0.46 because the source FONT-FAMILY is not matched per widget (family = 50% of typo weight; size 25%, weight 15%). build-absolute injects @font-face but appears NOT to assign typography_font_family per widget -> widgets render in the THEME default font -> family component ~0 -> typo capped. FIX (build-time, corpus-wide, scalable): assign the CAPTURED source font-family to each text widget (typography_font_family + inline font-family on text-editor/html inner divs, the mechanism that wins over theme CSS) + ensure the @font-face name matches. DIAGNOSE-FIRST: confirm the cap IS font-family (not size/weight), confirm build-absolute does/does not set typography_font_family, and how the grader compares family (computed first-token string) -> so the fix targets the real gap. Reversible ABS_NO_FONTFAMILY=1. GATE: per-element typo RISES (0.46->higher) on supabase+tailwind + composite UP + fonts render (or computed family matches) + self-test 1.0 + no-reg, else auto-restore.',
  phases: [
    { title: 'Diagnose', detail: 'supabase+tailwind: is typo capped by font-FAMILY? does build-absolute assign typography_font_family per widget? how does the grader compare family? the precise gap + fix' },
    { title: 'Fix', detail: 'assign captured source font-family per text widget (typography_font_family + inline on text-editor/html) in build-absolute; behind ABS_NO_FONTFAMILY=1; node --check + selftest 1.0' },
    { title: 'Verify+Gate', detail: 'per-element typo up + composite up + family matches/renders + self-test 1.0 + no-reg, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Edit ONLY build-absolute.mjs. Back it up FIRST: cp build-absolute.mjs /tmp/ev-bk-buildabs-fontfamily.mjs. Do NOT edit capture/grade/perelement. PRESERVE recipes #20-28. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Build-then-grade in this round. 422 silent-save w/ tree persisted = ok.'

const DSCHEMA = { type: 'object', additionalProperties: false, properties: {
  typoCappedByFamily: { type: 'boolean' }, supabaseTypoNow: { type: 'number' }, familyComponentNow: { type: 'number' },
  buildAssignsFamily: { type: 'boolean' }, cloneComputedFamily: { type: 'string' }, sourceComputedFamily: { type: 'string' },
  fontFaceInjected: { type: 'boolean' }, graderFamilyCompare: { type: 'string' }, fixFile: { type: 'string' }, fixPlan: { type: 'string' }, feasible: { type: 'boolean' },
}, required: ['typoCappedByFamily', 'buildAssignsFamily', 'cloneComputedFamily', 'sourceComputedFamily', 'feasible', 'fixPlan'] }
const diag = await agent([HARD.replace('Edit ONLY build-absolute.mjs. Back it up FIRST: cp build-absolute.mjs /tmp/ev-bk-buildabs-fontfamily.mjs. ', 'DIAGNOSE — read-only, do NOT edit. '),
  'DIAGNOSE the font-family typography cap. Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput. The refine loop distilled: per-element typo is capped ~0.46 because font-family is not matched per widget (family=50% of typo).',
  '(1) Read perelement-score.mjs typography scoring: how is the FAMILY component computed + compared (computed-style first-token string equality? case/quote-normalized?)? graderFamilyCompare = the exact comparison. Confirm family weight 0.50.',
  '(2) Build+grade supabase (build-absolute --publish page 2986, grade-sections): supabaseTypoNow (per-element typo sub-score), familyComponentNow (the family part if separable). typoCappedByFamily = is the family component the dominant typo drag (near 0 while size/weight are higher)?',
  '(3) Read build-absolute.mjs: does it set typography_font_family per text widget? For text-editor/html widgets, does it inline font-family in the style string? buildAssignsFamily. fontFaceInjected = does it inject @font-face for the captured fonts (prior rounds said yes for Circular/domaine)?',
  '(4) On the LIVE clone (page 2986) + the SOURCE (supabase.com) in Playwright @1440: read getComputedStyle(el).fontFamily on a matched heading/paragraph. cloneComputedFamily vs sourceComputedFamily — do they MATCH? If the clone renders the JupiterX/theme default while source is e.g. Circular/custom, that is the cap.',
  '(5) fixFile=build-absolute.mjs. fixPlan = the precise build-time change: assign the captured source font-family to typography_font_family per text widget (+ inline font-family on text-editor/html inner divs, the mechanism that wins over theme CSS) + ensure the @font-face family NAME matches what is assigned + a generic fallback. NOTE: even if the @font-face webfont does not load, getComputedStyle reports the REQUESTED family, so assigning the family name should move the grader metric — but for REAL fidelity also keep the @font-face. feasible = true iff the cap is font-family AND build-absolute can assign it. If typo is NOT family-capped (size/weight dominate), feasible=false + say so.',
  'Return {typoCappedByFamily, supabaseTypoNow, familyComponentNow, buildAssignsFamily, cloneComputedFamily, sourceComputedFamily, fontFaceInjected, graderFamilyCompare, fixFile, fixPlan, feasible}.',
].join('\n'), { label: 'diagnose:font-family', phase: 'Diagnose', schema: DSCHEMA })
log('DIAG: cappedByFamily=' + (diag&&diag.typoCappedByFamily) + ' typoNow=' + (diag&&diag.supabaseTypoNow) + ' buildAssigns=' + (diag&&diag.buildAssignsFamily) + ' clone="' + (diag&&diag.cloneComputedFamily) + '" src="' + (diag&&diag.sourceComputedFamily) + '" feasible=' + (diag&&diag.feasible))

let impl = null, verify = null
if (diag && diag.feasible) {
  phase('Fix')
  impl = await agent([HARD,
    'IMPLEMENT build-time font-family assignment in build-absolute.mjs. Work in ' + GRADER + '. DIAGNOSIS: typoCappedByFamily=' + diag.typoCappedByFamily + ' buildAssignsFamily=' + diag.buildAssignsFamily + ' clone="' + diag.cloneComputedFamily + '" src="' + diag.sourceComputedFamily + '" fontFaceInjected=' + diag.fontFaceInjected + ' graderFamilyCompare=' + String(diag.graderFamilyCompare||'').slice(0,150) + ' | fixPlan=' + String(diag.fixPlan||'').slice(0,400),
    'Implement the fixPlan: for each TEXT widget (heading/text-editor/button/list/html), assign the CAPTURED source font-family — set typography_font_family (+ typography_typography:custom if the control needs it) AND inline font-family in the style string for text-editor/html inner divs (the mechanism that wins over theme CSS). Ensure the @font-face family NAME matches what you assign + include a sensible generic fallback (sans-serif/serif). The captured layout already has the per-leaf font-family (capture-layout records typo.family) — use it. Do NOT change geometry/color/size logic; this is ADDITIVE (font-family only).',
    'REVERSIBILITY: gate behind ABS_NO_FONTFAMILY=1 (default = assign ON). node --check. SELFTEST: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0 (build change only, grader unchanged). SMOKE: rebuild supabase (2986), render -> matched headings/paragraphs should now computed-render the SOURCE family (or its requested name) instead of the theme default; grade -> per-element typo should RISE from ' + (diag.supabaseTypoNow) + '. If node --check / self-test fails -> restore + RESTORED.',
    'Return "OK:" with supabase per-element typo before->after + composite before->after + the computed font-family clone-vs-source after, or "RESTORED:".',
  ].join('\n'), { label: 'fix:font-family', phase: 'Fix' })
  log('IMPL: ' + String(impl || '').slice(0, 280))

  const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
  if (okImpl) {
    phase('Verify+Gate')
    const VS = { type: 'object', additionalProperties: false, properties: {
      site: { type: 'string' }, role: { type: 'string' }, familyMatches: { type: 'boolean' }, typoOff: { type: 'number' }, typoOn: { type: 'number' },
      visualOff: { type: 'number' }, visualOn: { type: 'number' }, compositeOff: { type: 'number' }, compositeOn: { type: 'number' },
      selftest: { type: 'number' }, regressed: { type: 'boolean' }, verdict: { type: 'string' },
    }, required: ['site', 'role', 'familyMatches', 'typoOff', 'typoOn', 'compositeOff', 'compositeOn', 'regressed', 'verdict'] }
    const SITES = [
      { name: 'supabase', url: 'https://supabase.com', page: 2986, role: 'TARGET' },
      { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146, role: 'TARGET' },
      { name: 'reactdev', url: 'https://react.dev', page: 4771, role: 'NO-REG check' },
    ]
    verify = await parallel(SITES.map((s) => () => agent([HARD,
      'VERIFY build-time font-family assignment on ONE site. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + ' role=' + s.role + '. ' + AUTH + ' before every WP command. You MUST end by calling StructuredOutput. Do NOT edit files. Flag ABS_NO_FONTFAMILY=1 disables. Build-then-grade in THIS agent.',
      'A/B BUILD (build-absolute.mjs --publish; one capture per mode): assign ON (default) + OFF (ABS_NO_FONTFAMILY=1). GRADE both (median-of-2): ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/ffg-' + s.name + '-{on,off}. Record per-element typography sub-score, visual, composite.',
      'familyMatches=true iff on the ON clone a matched heading/paragraph computed font-family now equals the source family (vs theme default OFF). typoOn should be > typoOff (the family cap lifts). selftest = grade-sections --source ' + s.url + ' --selftest (1.0).',
      'regressed=true iff compositeOn < compositeOff - 0.01 (median-aware). Judge like a human: do the clone fonts now look like the source typeface, not a generic theme font? Return {site, role, familyMatches, typoOff, typoOn, visualOff, visualOn, compositeOff, compositeOn, selftest, regressed, verdict}.',
    ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify+Gate', schema: VS }))).then((rs) => rs.filter(Boolean))
    for (const r of verify) log('VERIFY ' + r.site + ' [' + r.role + ']: familyMatch=' + r.familyMatches + ' typo ' + r.typoOff + '->' + r.typoOn + ' comp ' + r.compositeOff + '->' + r.compositeOn + ' selftest=' + r.selftest + ' reg=' + r.regressed)
  }
}

phase('Verify+Gate')
let verdict
if (!diag || !diag.feasible) {
  verdict = 'NOT BUILT — diagnosis: typo not font-family-capped OR build cannot assign it: cappedByFamily=' + (diag&&diag.typoCappedByFamily) + ' buildAssigns=' + (diag&&diag.buildAssignsFamily) + '. ' + String(diag&&diag.fixPlan||'').slice(0,200)
} else if (!impl || !/\bOK:/i.test(String(impl)) || /\bRESTORED:/i.test(String(impl))) {
  verdict = 'REVERTED — fix failed/self-test: ' + String(impl||'').slice(0,200)
} else {
  const v = verify || []
  const tgt = v.filter((r)=>/TARGET/.test(r.role))
  const selftestOK = v.every((r)=>r.selftest == null || r.selftest >= 0.999)
  const typoUp = tgt.some((r)=>r.typoOn > r.typoOff + 0.03 && r.familyMatches)
  const compUp = tgt.some((r)=>r.compositeOn > r.compositeOff + 0.003)
  const anyReg = v.some((r)=>r.regressed)
  if (typoUp && compUp && !anyReg && selftestOK) {
    verdict = 'ADOPTED — build-time font-family assignment lifts the typography cap (' + tgt.map(r=>r.site+' typo '+r.typoOff+'->'+r.typoOn+' comp '+r.compositeOff+'->'+r.compositeOn).join(' | ') + '); fonts render as source typeface (familyMatches); self-test 1.0; no-reg. SCALABLE per-element inch (every text widget, every site). Reversible ABS_NO_FONTFAMILY=1. Re-baseline corpus.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-buildabs-fontfamily.mjs build-absolute.mjs && node --check build-absolute.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Verify+Gate' })
    verdict = 'REVERTED — ' + (!selftestOK ? 'self-test != 1.0' : !typoUp ? 'typo did not rise / family did not match' : !compUp ? 'composite flat (typo gain below composite noise)' : 'regressed a site') + '. ' + JSON.stringify(v.map(r=>({s:r.site,fam:r.familyMatches,typo:[r.typoOff,r.typoOn],comp:[r.compositeOff,r.compositeOn],reg:r.regressed})))
  }
}
log('FONT-FAMILY-ASSIGN: ' + verdict)
return { verdict, diag, impl: String(impl||'').slice(0,400), verify }

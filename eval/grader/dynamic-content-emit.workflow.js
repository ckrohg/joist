export const meta = {
  name: 'dynamic-content-emit',
  description: 'TOP ADDRESSABLE LEVER (clean baseline: structural floor 0.4691; resend 0.302): resend testimonials (§18), final-CTA (§20), trust-row (§1), changelog list (§6) are RASTERIZED or DROPPED instead of emitted as NATIVE EDITABLE text/heading/list widgets -> edit=0 on those bands, floored structural + coverage, chunkedMediaCount 7 (x0.68 raster penalty). This is BOTH a fidelity loss AND a direct violation of the USER words-rebuilt principle (words must be native widgets; images OK). DIAGNOSE-FIRST per band: is the cause (a) SURFACE-RASTER/chunked-media OVER-REACH (a text-DENSE band wholesale-rastered — extend the word-safe gate from headings to ANY text-dense region: never raster a band whose text-area fraction is high; emit its text native), (b) CAPTURE DROP (below-fold/lazy/marquee visible() drops it), or (c) CAROUSEL/TAB hidden slides (tabs 4->1, list 9->7). Fix the DOMINANT cause. Reversible. GATE: resend structural UP (0.302->higher) + the named bands render as EDITABLE native text (not raster) + composite UP + self-test 1.0 + no-reg on a clean site, else auto-restore. Honors words-rebuilt.',
  phases: [
    { title: 'Diagnose', detail: 'resend: per band (testimonials/CTA/trust-row/changelog) WHY raster-or-dropped — surface-raster over-reach / capture drop / carousel-hidden; the dominant cause + fix file' },
    { title: 'Fix', detail: 'emit text-dense bands as native editable text (tighten raster to exclude text-dense / capture dropped bands); behind a flag; node --check + selftest 1.0' },
    { title: 'Verify+Gate', detail: 'resend struct up + bands editable-native + composite up + self-test 1.0 + no-reg, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && export JOIST_BASE="${JOIST_BASE:-http://localhost:8001}"; case "$JOIST_BASE" in *sg-host.com*|*georges232*|*35.212.46.254*) echo "FATAL: JOIST_BASE=$JOIST_BASE is a blocked/paused host (host-guard allowlist; renders only target localhost:8001 or JOIST_TRAINING_BASE)"; exit 1;; esac'
const HARD = 'Back up the file you edit FIRST (/tmp/ev-bk-<file>-dynemit.mjs). Edit ONLY the ONE file the diagnosis identifies (most likely capture-layout.mjs). Do NOT edit grade-sections/perelement. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Build-then-grade in THIS round (consistent state). 422 atomic_save_silent_failure w/ tree persisted = treat as built.'

const DSCHEMA = { type: 'object', additionalProperties: false, properties: {
  bands: { type: 'array', items: { type: 'object', additionalProperties: true } },
  surfaceRasterOverreach: { type: 'boolean' }, captureDrop: { type: 'boolean' }, carouselHidden: { type: 'boolean' },
  dominantCause: { type: 'string' }, textDenseRasteredCount: { type: 'number' }, fixFile: { type: 'string' }, fixPlan: { type: 'string' },
}, required: ['bands', 'dominantCause', 'fixFile', 'fixPlan'] }
const diag = await agent([HARD.replace('Back up the file you edit FIRST (/tmp/ev-bk-<file>-dynemit.mjs). Edit ONLY the ONE file the diagnosis identifies (most likely capture-layout.mjs). ', 'DIAGNOSE — read-only, do NOT edit (capture + inspect the tree + source). '),
  'DIAGNOSE why resend text bands are rasterized/dropped. Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput. Clean baseline: resend structural 0.302; testimonials §18, final-CTA §20, trust-row §1, changelog §6 are raster-or-dropped; chunkedMediaCount 7; block misses list 9->7, tabs 4->1.',
  'Capture resend: node capture-layout.mjs --source https://resend.com --out /tmp/de-resend.json. For EACH named band (testimonials, final-CTA "email reimagined. available today.", trust-row "companies of all sizes trust resend", changelog "jun 05" list), inspect: in the SOURCE (Playwright @1440) is the band real text? In the CAPTURED tree, is that band (a) a surface-raster/mockup leaf (kind mockup/surface:true / a .raster image) that SWALLOWED the text [surface-raster over-reach], (b) ABSENT entirely [capture drop — check if it is below-fold/lazy/in an off-screen marquee that visible() drops], or (c) inside a tab/carousel with hidden slides [only the active slide captured]? Record per band in bands[]: {band, sourceText (snippet), inClone: raster|dropped|present, cause}.',
  'surfaceRasterOverreach = true iff >=1 text-dense band is wholesale-rastered (a surface/mockup raster leaf covering a region that is mostly real text). textDenseRasteredCount = how many. captureDrop = true iff >=1 band is absent (not rastered, just missing). carouselHidden = true iff content is in unexpanded tabs/carousels.',
  'dominantCause = which dominates. fixFile + fixPlan: if surface-raster over-reach -> extend the word-safe gate in capture-layout (the surface-raster detector ~L295-366): NEVER raster a band whose text-area fraction within the box is high (e.g. >15-20% text-leaf area, OR contains >=2 headings/paragraphs) — for such a band, skip the raster and let the walk emit its text natively (mirror the existing heading word-safe logic but for text-DENSE regions, not just single headings). If capture drop -> the specific capture fix (force-load below-fold / off-screen marquee handling). If carousel -> expand slides (bounded). Be concrete + name the file.',
  'Return {bands, surfaceRasterOverreach, captureDrop, carouselHidden, dominantCause, textDenseRasteredCount, fixFile, fixPlan}.',
].join('\n'), { label: 'diagnose:dyn-emit', phase: 'Diagnose', schema: DSCHEMA })
log('DIAG: dominant=' + String(diag&&diag.dominantCause||'').slice(0,120) + ' surfaceOverreach=' + (diag&&diag.surfaceRasterOverreach) + ' textDenseRastered=' + (diag&&diag.textDenseRasteredCount) + ' captureDrop=' + (diag&&diag.captureDrop) + ' carousel=' + (diag&&diag.carouselHidden) + ' fixFile=' + (diag&&diag.fixFile))

let impl = null, verify = null
if (diag && diag.fixFile && diag.fixPlan) {
  phase('Fix')
  const FILE = /capture/.test(diag.fixFile) ? 'capture-layout.mjs' : (/build/.test(diag.fixFile) ? 'build-absolute.mjs' : diag.fixFile)
  const FLAG = 'CAPTURE_NO_DYNEMIT'
  impl = await agent([HARD,
    'IMPLEMENT the dynamic-content-emit fix. Work in ' + GRADER + '. Edit ' + FILE + '. DOMINANT cause: ' + String(diag.dominantCause||'').slice(0,250) + ' | surfaceRasterOverreach=' + diag.surfaceRasterOverreach + ' captureDrop=' + diag.captureDrop + ' carouselHidden=' + diag.carouselHidden + '. bands: ' + JSON.stringify((diag.bands||[]).slice(0,6)) + '. fixPlan: ' + String(diag.fixPlan||'').slice(0,450),
    'Implement the fixPlan precisely, HONORING the user words-rebuilt principle: text-bearing bands MUST become native editable text/heading/list widgets, NOT rasters. If surface-raster over-reach (most likely): extend the surface-raster word-safe gate so a band whose text-area fraction is HIGH (>~15-20%) OR that contains >=2 headings/paragraphs is NEVER wholesale-rastered — skip the raster + let the walk emit its text natively (only genuinely text-free visual surfaces raster). If capture drop: the specific fix to capture the dropped band. Preserve genuine text-free surface-raster (recipe #25/#26 wins) + all other recipes.',
    'REVERSIBILITY: gate behind ' + FLAG + '=1. SELF-TEST: ' + AUTH + ' && node grade-sections.mjs --source https://resend.com --selftest -> 1.0 (and supabase --selftest 1.0 if shared logic). STEP 0: cp ' + FILE + ' /tmp/ev-bk-' + FILE.replace(/\..*/,'') + '-dynemit.mjs. node --check. SMOKE: rebuild+grade resend (2988) -> the named bands (testimonials/CTA/trust-row/changelog) should now render as NATIVE editable text + structural should RISE from 0.302 + chunkedMediaCount should DROP from 7. If node --check / self-test fails -> restore + RESTORED.',
    'Return "OK:" with resend structural before->after + chunkedMediaCount before->after + which bands are now native-text + self-test 1.0, or "RESTORED:".',
  ].join('\n'), { label: 'fix:dyn-emit', phase: 'Fix' })
  log('IMPL: ' + String(impl || '').slice(0, 260))

  const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
  if (okImpl) {
    phase('Verify+Gate')
    const VS = { type: 'object', additionalProperties: false, properties: {
      site: { type: 'string' }, role: { type: 'string' }, bandsNativeText: { type: 'boolean' }, chunkedMediaOff: { type: 'number' }, chunkedMediaOn: { type: 'number' },
      structOff: { type: 'number' }, structOn: { type: 'number' }, editOff: { type: 'number' }, editOn: { type: 'number' }, coverageOff: { type: 'number' }, coverageOn: { type: 'number' },
      compositeOff: { type: 'number' }, compositeOn: { type: 'number' }, selftest: { type: 'number' }, regressed: { type: 'boolean' }, verdict: { type: 'string' },
    }, required: ['site', 'role', 'bandsNativeText', 'structOff', 'structOn', 'compositeOff', 'compositeOn', 'regressed', 'verdict'] }
    const FLAG2 = FLAG
    const SITES = [
      { name: 'resend', url: 'https://resend.com', page: 2988, role: 'TARGET (struct 0.302)' },
      { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146, role: 'NO-REG (text-dense, clean)' },
    ]
    verify = await parallel(SITES.map((s) => () => agent([HARD,
      'VERIFY the dynamic-content-emit fix on ONE site. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + ' role=' + s.role + '. ' + AUTH + ' before every WP command. You MUST end by calling StructuredOutput. Do NOT edit files. Flag ' + FLAG2 + '=1 disables. Build-then-grade in THIS agent (consistent state).',
      'A/B BUILD (build-absolute.mjs --publish; one capture per mode): fix ON (default) + OFF (' + FLAG2 + '=1). GRADE both (median-of-2 to dampen variance): ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/deg-' + s.name + '-{on,off}. Record structural, editability, coverage, composite, chunkedMediaCount.',
      'TARGET (resend): bandsNativeText=true iff the testimonials/final-CTA/trust-row/changelog render as NATIVE editable text (selectable, not inside a raster image) — verify by render + tree inspection. structOn should be > structOff (target 0.302->0.45+). chunkedMediaOn should be < chunkedMediaOff (7->lower). selftest = grade-sections --source resend --selftest (1.0).',
      'NO-REG (tailwind text-dense): regressed=true iff compositeOn < compositeOff - 0.015 (median-aware; tailwind is text-dense so the gate must not wrongly de-raster legit visual surfaces or over-emit). For resend: regressed=true iff compositeOn < compositeOff - 0.015 (expect RISE).',
      'Judge like a human: are the testimonial/CTA/trust words now REAL editable text instead of baked into an image? Return {site, role, bandsNativeText, chunkedMediaOff, chunkedMediaOn, structOff, structOn, editOff, editOn, coverageOff, coverageOn, compositeOff, compositeOn, selftest, regressed, verdict}.',
    ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify+Gate', schema: VS }))).then((rs) => rs.filter(Boolean))
    for (const r of verify) log('VERIFY ' + r.site + ' [' + r.role + ']: bandsNative=' + r.bandsNativeText + ' chunked ' + r.chunkedMediaOff + '->' + r.chunkedMediaOn + ' struct ' + r.structOff + '->' + r.structOn + ' comp ' + r.compositeOff + '->' + r.compositeOn + ' selftest=' + r.selftest + ' reg=' + r.regressed)
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
  const tgt = v.find((r)=>/TARGET/.test(r.role))
  const noreg = v.filter((r)=>/NO-REG/.test(r.role))
  const selftestOK = !tgt || tgt.selftest == null || tgt.selftest >= 0.999
  // CORRECTED GATE (gateCalibrationLesson2): keep on the HEADLINE objective — composite UP + the user-principle the round serves (bands native) + struct not-down — NOT an arbitrary struct-delta a real win can miss by noise (v1 missed a +0.042 composite win because struct rose 0.019 vs >0.02).
  const win = tgt && tgt.bandsNativeText && tgt.compositeOn > tgt.compositeOff + 0.005 && tgt.structOn >= tgt.structOff - 0.005
  const noregOK = noreg.every((r)=>!r.regressed) && !(tgt && tgt.regressed)
  if (win && noregOK && selftestOK) {
    verdict = 'ADOPTED — dynamic-content bands now NATIVE EDITABLE text (honors words-rebuilt): resend struct ' + tgt.structOff + '->' + tgt.structOn + ', chunkedMedia ' + tgt.chunkedMediaOff + '->' + tgt.chunkedMediaOn + ', composite ' + tgt.compositeOff + '->' + tgt.compositeOn + '; self-test 1.0; no-reg. Attacks the #1 addressable lever (structural floor). Reversible ' + FLAG + '=1.'
  } else {
    const FILE = /capture/.test(diag.fixFile) ? 'capture-layout.mjs' : (/build/.test(diag.fixFile) ? 'build-absolute.mjs' : diag.fixFile)
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-' + FILE.replace(/\..*/,'') + '-dynemit.mjs ' + FILE + ' && node --check ' + FILE + ' && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Verify+Gate' })
    verdict = 'REVERTED — ' + (!selftestOK ? 'self-test != 1.0' : !win ? 'bands not native-text OR struct/composite did not rise' : 'regressed a clean site (de-rastered legit surfaces / over-emit)') + '. ' + JSON.stringify(v.map(r=>({s:r.site,native:r.bandsNativeText,struct:[r.structOff,r.structOn],comp:[r.compositeOff,r.compositeOn],reg:r.regressed})))
  }
}
log('DYNAMIC-CONTENT-EMIT: ' + verdict)
return { verdict, diag, impl: String(impl||'').slice(0,400), verify }

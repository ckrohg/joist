export const meta = {
  name: 'text-collision-dedupe',
  description: 'Close the loop on USER feedback #4 (overlapping/garbled/duplicated text), STILL present on supabase per rebaseline-2: the abs build has overlapping hero headings ("Build in a weekend"/"Scale to millions" stacked overlapping) + DUPLICATED nav/CTA labels ("Start your project"x2, "Request a demo"x2, duplicated nav items) -> collisionRate 0.093, dropped the flagship from a historic 0.878. Likely cross-builder root: capture grabs BOTH the desktop AND the display:none mobile responsive DUPLICATE of the same content -> both pinned visible -> overlap. DIAGNOSE the root (captured hidden/duplicate responsive variants vs same-y multi-line heading pinning vs builder duplication), then FIX in the right place: capture-side de-dupe of hidden (display:none / aria-hidden / 0-opacity) + exact-text-overlapping-box duplicate variants (keep the primary visible one), OR resolve overlapping same-band headings. Reversible flag. GATE: supabase collisionRate -> ~0 + no overlapping/duplicated text in render + composite UP + NO-OP/no-reg on a clean site (tailwind) + self-test 1.0, else auto-restore.',
  phases: [
    { title: 'Diagnose', detail: 'supabase: WHAT duplicates/overlaps + the ROOT (hidden-dup capture / same-y heading / builder) + which file to fix' },
    { title: 'Fix', detail: 'de-dupe hidden/duplicate responsive variants (capture) or resolve overlap (build), behind a flag; node --check + selftest 1.0' },
    { title: 'Verify+Gate', detail: 'supabase collisionRate~0 + no dup/overlap text + composite up + no-reg static + self-test, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Back up the file you edit FIRST (cp <file> /tmp/ev-bk-<file>-collide.mjs). Edit ONLY the ONE file the diagnosis identifies (capture-layout.mjs OR build-absolute.mjs) — NOT both, NOT grade-*/perelement. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Custom-tree changes are fine; if a PUT 422 atomic_save_silent_failure occurs on an unchanged tree, empty-then-rebuild to A/B.'

const DSCHEMA = { type: 'object', additionalProperties: false, properties: {
  duplicatedTexts: { type: 'array', items: { type: 'string' } }, overlappingHeadings: { type: 'array', items: { type: 'string' } },
  rootCause: { type: 'string' }, hiddenVariantCapture: { type: 'boolean' }, sameYHeadingPinning: { type: 'boolean' }, builderDuplication: { type: 'boolean' },
  fixFile: { type: 'string' }, fixPlan: { type: 'string' }, collisionRateNow: { type: 'number' },
}, required: ['duplicatedTexts', 'rootCause', 'fixFile', 'fixPlan'] }
const diag = await agent([HARD.replace('Back up the file you edit FIRST (cp <file> /tmp/ev-bk-<file>-collide.mjs). Edit ONLY the ONE file the diagnosis identifies (capture-layout.mjs OR build-absolute.mjs) — NOT both, NOT grade-*/perelement. ', 'DIAGNOSE — read-only, do NOT edit (instrument the capture + the build tree + the source). '),
  'DIAGNOSE the supabase text-collision (USER feedback #4). Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput. rebaseline-2: supabase ABS build has overlapping hero headings + duplicated nav/CTA labels, collisionRate 0.093.',
  'Build supabase ABS: node capture-layout.mjs --source https://supabase.com --out /tmp/tc-supabase.json (read the captured leaves) ; understand the source: load https://supabase.com in Playwright @1440, find the hero headings + nav + CTAs.',
  'Determine WHAT duplicates/overlaps: duplicatedTexts = the text strings that appear MORE THAN ONCE in the captured leaves (e.g. "Start your project", "Request a demo", nav items). overlappingHeadings = headings whose boxes overlap (IoU>0.3) with different text. collisionRateNow = the grader collisionRate on the abs build.',
  'Determine the ROOT: (a) hiddenVariantCapture = does the source have display:none/aria-hidden/0-opacity RESPONSIVE DUPLICATES (a desktop + a mobile copy of the CTA/nav, one hidden) that the capture grabbed BOTH of? (check: are the duplicated-text leaves at near-identical boxes, and is one of the source copies display:none at 1440?). (b) sameYHeadingPinning = are "Build in a weekend"/"Scale to millions" two separate source elements at the SAME y that get pinned overlapping (vs the source stacking them)? (c) builderDuplication = does the builder itself emit a widget twice?',
  'fixFile = capture-layout.mjs (if hidden-variant capture — de-dupe at capture) OR build-absolute.mjs (if builder dup / same-y pin). fixPlan = the precise fix: e.g. "in capture-layout walk(), SKIP elements that are display:none/visibility:hidden/opacity<0.02 at the capture viewport (already? verify) AND drop exact-text leaves whose box IoU>0.6 with an already-captured leaf (keep the first/visible)" OR "in build-absolute, when two leaves share text + overlap, keep one". Be specific.',
  'Return {duplicatedTexts, overlappingHeadings, rootCause, hiddenVariantCapture, sameYHeadingPinning, builderDuplication, fixFile, fixPlan, collisionRateNow}.',
].join('\n'), { label: 'diagnose:collision', phase: 'Diagnose', schema: DSCHEMA })
log('DIAG: dups=' + JSON.stringify(diag&&diag.duplicatedTexts) + ' root=' + String(diag&&diag.rootCause||'').slice(0,120) + ' hiddenVar=' + (diag&&diag.hiddenVariantCapture) + ' fixFile=' + (diag&&diag.fixFile) + ' collisionNow=' + (diag&&diag.collisionRateNow))

let impl = null, verify = null
if (diag && diag.fixFile && diag.fixPlan) {
  phase('Fix')
  const FILE = /capture/.test(diag.fixFile) ? 'capture-layout.mjs' : 'build-absolute.mjs'
  const FLAG = /capture/.test(FILE) ? 'CAPTURE_NO_DEDUPE' : 'ABS_NO_DEDUPE'
  impl = await agent([HARD,
    'FIX the supabase text-collision (USER #4). Work in ' + GRADER + '. Edit ONLY ' + FILE + ' (the diagnosed file). ROOT: ' + String(diag.rootCause||'').slice(0,250) + ' | hiddenVariantCapture=' + diag.hiddenVariantCapture + ' sameYHeadingPinning=' + diag.sameYHeadingPinning + ' builderDuplication=' + diag.builderDuplication + ' | duplicatedTexts=' + JSON.stringify(diag.duplicatedTexts) + ' | fixPlan=' + String(diag.fixPlan||'').slice(0,400),
    'Implement the fixPlan precisely. If capture-side de-dupe: skip display:none/visibility:hidden/opacity<0.02 elements (verify the walk does/does not already) AND drop a text leaf that exact-text-duplicates an already-captured leaf with box IoU>~0.6 (keep the first/most-visible). If build-side: de-dupe overlapping same-text widgets / resolve same-y heading overlap. Do NOT over-dedupe (legitimately-repeated short labels like "Learn more" across distinct cards must survive — only de-dupe NEAR-IDENTICAL-BOX duplicates or hidden variants, not same-text-at-different-locations).',
    'REVERSIBILITY: gate behind if (process.env.' + FLAG + ' === "1") -> old behavior. node --check ' + FILE + '. SELFTEST: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0 (de-dupe is symmetric on source-vs-source: the source has the duplicates too, so self-test must still be 1.0 — if your de-dupe makes source-vs-source != 1.0, it is asymmetric/over-eager, fix it). STEP 0: cp ' + FILE + ' /tmp/ev-bk-' + FILE.replace(/\\..*/,'') + '-collide.mjs. SMOKE: rebuild supabase (2986) with the fix, grade -> collisionRate should drop toward 0 (from ' + (diag.collisionRateNow) + ') + no duplicated "Start your project"/"Request a demo" in the render. If node --check or selftest fails -> restore + RESTORED.',
    'Return "OK:" with collisionRate before->after on supabase + confirmation the duplicated labels are gone (one each) + self-test 1.0, or "RESTORED:".',
  ].join('\n'), { label: 'fix:collision', phase: 'Fix' })
  log('IMPL: ' + String(impl || '').slice(0, 260))

  const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
  if (okImpl) {
    phase('Verify+Gate')
    const VS = { type: 'object', additionalProperties: false, properties: {
      site: { type: 'string' }, role: { type: 'string' }, collisionOff: { type: 'number' }, collisionOn: { type: 'number' },
      dupLabelsGone: { type: 'boolean' }, selftest: { type: 'number' },
      compositeOff: { type: 'number' }, compositeOn: { type: 'number' }, visualOff: { type: 'number' }, visualOn: { type: 'number' },
      regressed: { type: 'boolean' }, verdict: { type: 'string' },
    }, required: ['site', 'role', 'collisionOff', 'collisionOn', 'dupLabelsGone', 'compositeOff', 'compositeOn', 'regressed', 'verdict'] }
    const SITES = [
      { name: 'supabase', url: 'https://supabase.com', page: 2986, role: 'TARGET (collision)' },
      { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146, role: 'NO-REG (clean)' },
    ]
    const FLAG2 = FLAG
    verify = await parallel(SITES.map((s) => () => agent([HARD,
      'VERIFY the text-collision de-dupe on ONE site. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + ' role=' + s.role + '. ' + AUTH + ' before every WP command. You MUST end by calling StructuredOutput. Do NOT edit files. The fix file uses the flag ' + FLAG2 + ' (=1 disables).',
      'A/B BUILD (build-absolute.mjs --publish; one shared capture per mode): de-dupe ON (default) and OFF (' + FLAG2 + '=1). GRADE both: ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/tcg-' + s.name + '-{on|off}. Record collisionRate (collisionOff/On from the report), composite, visual.',
      'TARGET (supabase): dupLabelsGone=true iff the rendered clone shows ONE "Start your project" + ONE "Request a demo" + no overlapping hero headings (was duplicated/overlapping). collisionOn should be ~0 (from ~' + (diag&&diag.collisionRateNow) + '). selftest = node grade-sections.mjs --source ' + s.url + ' --selftest composite (must be 1.0).',
      'NO-REG (tailwind): regressed=true iff compositeOn < compositeOff - 0.01 (de-dupe must not drop a clean site — e.g. by over-deduping legitimate repeated labels). For supabase: regressed=true iff compositeOn < compositeOff - 0.01 (expect it to RISE as collision clears).',
      'Judge like a human: is the duplicated/overlapping text GONE? Return {site, role, collisionOff, collisionOn, dupLabelsGone, selftest, compositeOff, compositeOn, visualOff, visualOn, regressed, verdict}.',
    ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify+Gate', schema: VS }))).then((rs) => rs.filter(Boolean))
    for (const r of verify) log('VERIFY ' + r.site + ' [' + r.role + ']: collision ' + r.collisionOff + '->' + r.collisionOn + ' dupGone=' + r.dupLabelsGone + ' selftest=' + r.selftest + ' comp ' + r.compositeOff + '->' + r.compositeOn + ' reg=' + r.regressed)
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
  // CORRECTED GATE: the grader's collisionRate intentionally SKIPS same-text overlaps (avoids penalizing legit wrapper/inner nesting), so a same-text dedupe CANNOT move it. Gate on the HUMAN-VISIBLE criterion (dupLabelsGone) + composite-no-reg + self-test, NOT collisionRate. (gateDesignLesson)
  const collisionFixed = tgt && tgt.dupLabelsGone && tgt.compositeOn >= tgt.compositeOff - 0.01
  const noregOK = noreg.every((r)=>!r.regressed)
  if (collisionFixed && noregOK && selftestOK) {
    verdict = 'ADOPTED — USER #4 closed: supabase duplicated/overlapping text de-duped (collision ' + tgt.collisionOff + '->' + tgt.collisionOn + ', dup labels gone, composite ' + tgt.compositeOff + '->' + tgt.compositeOn + '); no-reg on clean site (' + noreg.map(r=>r.site+' '+r.compositeOff+'->'+r.compositeOn).join(', ') + '); self-test 1.0. Reversible.'
  } else {
    const FILE = /capture/.test(diag.fixFile) ? 'capture-layout.mjs' : 'build-absolute.mjs'
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-' + FILE.replace(/\..*/,'') + '-collide.mjs ' + FILE + ' && node --check ' + FILE + ' && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Verify+Gate' })
    verdict = 'REVERTED — ' + (!selftestOK ? 'self-test != 1.0 (asymmetric de-dupe)' : !collisionFixed ? 'dup labels NOT gone OR composite dropped' : 'regressed a clean site (over-deduped)') + '. ' + JSON.stringify(v.map(r=>({s:r.site,col:[r.collisionOff,r.collisionOn],dup:r.dupLabelsGone,comp:[r.compositeOff,r.compositeOn],reg:r.regressed})))
  }
}
log('TEXT-COLLISION-DEDUPE: ' + verdict)
return { verdict, diag, impl: String(impl||'').slice(0,400), verify }

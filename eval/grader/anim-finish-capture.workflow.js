export const meta = {
  name: 'anim-finish-capture',
  description: 'RESEARCH BACKLOG #1 (top autonomousSafe, attacks the biggest wall A=dynamic content): add a document-wide reveal pass to capture-layout.mjs BEFORE the DOM walk — stepped-scroll to trigger IntersectionObserver scroll-reveals, then document.getAnimations().finish() (try/catch; infinite-iteration anims -> currentTime=activeDuration end) to land GSAP/Framer/CSS reveal animations at their DESIGNED end-state, then scroll back to top. This recovers the framer/resend reveal-hidden content the static walk currently drops (the ~4-leaf collapse). Idempotent + inert when no animations exist. Behind a reversible flag (CAPTURE_NO_ANIMFINISH=1 disables) for A/B + revert. GATE: KEEP iff a Framer-built target (resend/framer) recovers meaningful real content (more text leaves + higher captured-text length, composite up) AND static no-reg sites (tailwind/supabase) stay within noise. Else auto-restore.',
  phases: [
    { title: 'Fold', detail: 'add the reveal pass to capture-layout.mjs behind CAPTURE_NO_ANIMFINISH=1; node --check; A/B capture on resend confirms it changes leaf/text' },
    { title: 'Verify', detail: 'parallel: resend+framer (target recovery) + tailwind+supabase (no-reg); capture OFF vs ON deltas + build+grade composite' },
    { title: 'Gate', detail: 'keep iff target recovers + no-reg holds, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD = 'Edit ONLY capture-layout.mjs. Back it up FIRST: cp capture-layout.mjs /tmp/ev-bk-capture-animfinish.mjs. Do NOT edit build-*/grade-*/perelement. source /tmp/joist-auth.env. Never print JOIST_AUTH_B64.'

const impl = await agent([HARD,
  'IMPLEMENT research backlog #1 — a document-wide REVEAL pass in capture-layout.mjs, run BEFORE the DOM box-tree walk. Work in ' + GRADER + '. First READ capture-layout.mjs: find (a) where the page is loaded + any existing full-page scroll-through / lazy-load trigger / settle (networkidle, height-stability, animations:disabled, reducedMotion), and (b) where the actual DOM walk begins. The new pass goes AFTER load/settle but BEFORE the walk.',
  'WHY: framer.com / resend.com are Framer-built — their content starts opacity:0 + transformed and is revealed by IntersectionObserver-triggered GSAP/Web-Animations on scroll. The static walk sees the pre-reveal state and drops the content (the ~4-leaf collapse, ssim ~0.46 ceiling). We must land the page at its DESIGNED end-state.',
  'THE PASS (a single page.evaluate, wrapped so it can NEVER throw out / hang — synchronous, no network waits):',
  '(1) TRIGGER reveals: scroll the page top->bottom in viewport-sized steps (e.g. window.scrollTo for each step, small awaited delay via page.waitForTimeout ~120ms between steps so IntersectionObservers fire + scroll-triggered animations register). If capture-layout ALREADY does a full scroll-through for lazy-load, REUSE/extend it rather than duplicating. Cap total steps (~40) so it cannot loop forever.',
  '(2) LAND animations at end-state: in page.evaluate, for (const a of document.getAnimations()) { try { const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {}; if (t.iterations === Infinity) { /* infinite loop anim: pin to one active-duration end, do not finish() (throws) */ const dur = (a.effect.getComputedTiming && a.effect.getComputedTiming().activeDuration) || 0; a.currentTime = (t.delay||0) + dur; } else { a.finish(); } } catch(e){} }  // also forces CSSTransition/CSSAnimation to end. Idempotent; empty on static sites.',
  '(3) Optionally also clear lingering will-change/transform inline that some libs leave mid-tween by reading computed end-state AFTER finish() (the walk already reads computed style — finishing the animations is enough; do NOT mutate styles yourself beyond what finish() does).',
  '(4) scroll back to top (window.scrollTo(0,0)) + one short settle, THEN proceed to the existing walk.',
  'CRITICAL: gate the ENTIRE pass behind a flag: if (process.env.CAPTURE_NO_ANIMFINISH === "1") skip it (reversible + A/B). Default = ON. The pass MUST be inert when there are no animations (document.getAnimations() empty -> the loop is a no-op) so static sites are byte-identical. NO new networkidle/long waits (crash-robustness lesson: capture must not hang on a network blip — the scroll delays are fixed short timeouts, not network waits).',
  'STEP 0: cp capture-layout.mjs /tmp/ev-bk-capture-animfinish.mjs. STEP 1 implement. node --check capture-layout.mjs (and capture-ensemble.mjs if it imports). STEP 2 A/B SMOKE on a Framer target: node capture-layout.mjs --source https://resend.com --out /tmp/af-resend-ON.json ; CAPTURE_NO_ANIMFINISH=1 node capture-layout.mjs --source https://resend.com --out /tmp/af-resend-OFF.json (use capture-ensemble.mjs if that is the real entry; match existing CLI). Report leaf count + total visible-text length for ON vs OFF (ON should be >= OFF, ideally substantially MORE real content recovered). STEP 3 A/B on a STATIC site: same for https://tailwindcss.com -> ON and OFF should be ~identical (idempotent/inert).',
  'Return PLAIN-TEXT "OK:" with the resend ON-vs-OFF (leaves, textLen) + tailwind ON-vs-OFF deltas, or "RESTORED:" if node --check fails (restore the backup). Leave the file in place for the verifier.',
].join('\n'), { label: 'fold:anim-finish', phase: 'Fold' })
log('IMPL: ' + String(impl || '').slice(0, 300))

const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
let verify = null
if (okImpl) {
  phase('Verify')
  const VS = { type: 'object', additionalProperties: false, properties: {
    site: { type: 'string' }, role: { type: 'string' },
    leavesOff: { type: 'number' }, leavesOn: { type: 'number' },
    textLenOff: { type: 'number' }, textLenOn: { type: 'number' },
    compositeOff: { type: 'number' }, compositeOn: { type: 'number' },
    recovered: { type: 'boolean' }, regressed: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['site', 'role', 'leavesOff', 'leavesOn', 'compositeOff', 'compositeOn', 'recovered', 'regressed', 'verdict'] }
  const SITES = [
    { name: 'resend', url: 'https://resend.com', page: 2988, role: 'TARGET (Framer-built reveal-collapse)' },
    { name: 'framer', url: 'https://www.framer.com', page: 2990, role: 'TARGET (Framer-built reveal-collapse)' },
    { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146, role: 'NO-REG (static)' },
    { name: 'supabase', url: 'https://supabase.com', page: 2986, role: 'NO-REG (static)' },
  ]
  verify = await parallel(SITES.map((s) => () => agent([HARD,
    'VERIFY the anim-finish capture pass on ONE site. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' clonePage=' + s.page + ' role=' + s.role + '. You MUST end by calling StructuredOutput. Do NOT edit any file.',
    'A/B CAPTURE: capture with the pass ON (default) and OFF (CAPTURE_NO_ANIMFINISH=1) using the SAME entry the impl used (capture-layout.mjs or capture-ensemble.mjs). Record leaf count + total visible-text length for OFF and ON.',
    'A/B BUILD+GRADE: build the clone from BOTH captures to the same page (' + s.page + ') one at a time and grade each: node <builder> --layout <captureJson> --page ' + s.page + ' --publish ; node grade-sections.mjs --source ' + s.url + ' --clone "' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/?page_id=' + s.page + '" --out /tmp/afg-' + s.name + '-{on|off}. Use whichever builder the corpus uses for this site (default build-flow.mjs; if unsure try build-absolute.mjs too and report the better). compositeOff vs compositeOn.',
    'TARGET sites (resend/framer): recovered=true iff ON recovers meaningfully more real content (leavesOn >> leavesOff OR textLenOn >> textLenOff) AND compositeOn >= compositeOff (ideally up). NO-REG sites (tailwind/supabase): regressed=true iff compositeOn < compositeOff - 0.01 OR leavesOn < leavesOff (the pass should be inert here). Judge like a human: did ON actually pull in the hidden hero/sections that OFF dropped?',
    'Return {site, role, leavesOff, leavesOn, textLenOff, textLenOn, compositeOff, compositeOn, recovered, regressed, verdict}.',
  ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify', schema: VS }))).then((rs) => rs.filter(Boolean))
  for (const r of verify) log('VERIFY ' + r.site + ' [' + r.role + ']: leaves ' + r.leavesOff + '->' + r.leavesOn + ' text ' + (r.textLenOff||0) + '->' + (r.textLenOn||0) + ' composite ' + r.compositeOff + '->' + r.compositeOn + ' recovered=' + r.recovered + ' regressed=' + r.regressed)
}

phase('Gate')
let verdict
if (!okImpl) {
  verdict = 'REVERTED — impl failed node --check: ' + String(impl || '').slice(0, 200)
} else {
  const tgt = (verify || []).filter((r) => /TARGET/.test(r.role))
  const noreg = (verify || []).filter((r) => /NO-REG/.test(r.role))
  const anyRecovered = tgt.some((r) => r.recovered)
  const anyRegressed = noreg.some((r) => r.regressed) || tgt.some((r) => r.compositeOn < r.compositeOff - 0.02)
  if (anyRecovered && !anyRegressed) {
    verdict = 'ADOPTED — getAnimations().finish() reveal pass recovers Framer/GSAP reveal-hidden content at end-state (target ' + tgt.filter((r)=>r.recovered).map((r)=>r.site+' '+r.compositeOff+'->'+r.compositeOn).join(', ') + '); no-reg held (' + noreg.map((r)=>r.site+' '+r.compositeOff+'->'+r.compositeOn).join(', ') + '). Reversible via CAPTURE_NO_ANIMFINISH=1. Attacks wall A (dynamic content).'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-capture-animfinish.mjs capture-layout.mjs && node --check capture-layout.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
    verdict = 'REVERTED — ' + (!anyRecovered ? 'no target recovered (reveals not landed by getAnimations().finish() alone — likely scroll-trigger not firing in headless; queue #6 content-present readiness gate)' : 'a no-reg site regressed') + '. targets=' + JSON.stringify(tgt.map((r)=>({s:r.site,off:r.compositeOff,on:r.compositeOn,rec:r.recovered}))) + ' noreg=' + JSON.stringify(noreg.map((r)=>({s:r.site,off:r.compositeOff,on:r.compositeOn,reg:r.regressed})))
  }
}
log('ANIM-FINISH: ' + verdict)
return { verdict, impl: String(impl || '').slice(0, 600), verify }

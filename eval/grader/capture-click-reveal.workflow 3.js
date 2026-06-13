export const meta = {
  name: 'capture-click-reveal',
  description: 'PIVOT to the #2 corpus lever (STRUCTURAL floor 0.4973): wave-4 #1 click-to-reveal interaction capture. reactdev (struct 0.34), resend (0.337), framer (0.383) LOSE display:none-until-interacted content (tabs/accordions/carousels/show-more, code-sandbox panels) that step-scroll + anim-finish cannot reach. DIAGNOSE-FIRST: on reactdev+resend, quantify HOW MUCH content is click-gated (vs already-rendered) + which trigger patterns, so we only build if the lever is real. Then a HARDENED capture-explore pass (bounded clicks <=15, per-click timeout <=800ms, try/catch, NO infinite waits — the wifi-stall lesson) that clicks interactive triggers, captures newly-visible leaves, dedupes by geometry, appends to the tree (REPORT-FIRST: recover leaves; native Tabs/Accordion widget merge is v2). Reversible CAPTURE_NO_EXPLORE=1. GATE: recovers real hidden content on >=1 dynamic site (more leaves + structural up after build+grade) + NO-OP on a static site (tailwind) + no hang/crash + grader self-test 1.0, else auto-restore.',
  phases: [
    { title: 'Diagnose', detail: 'reactdev+resend: how much content is click-gated + which trigger patterns; is the lever real?' },
    { title: 'Build', detail: 'hardened capture-explore pass (bounded clicks, short timeouts, report-first leaf recovery); behind CAPTURE_NO_EXPLORE=1; node --check + selftest 1.0' },
    { title: 'Verify', detail: 'reactdev/resend recover hidden content + structural up; tailwind no-op; no hang; reversible' },
    { title: 'Gate', detail: 'keep iff real recovery on dynamic + no-op static + no hang + self-test 1.0, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Edit ONLY capture-layout.mjs (+ a NEW capture-explore.mjs it imports). Back up FIRST: cp capture-layout.mjs /tmp/ev-bk-capture-clickreveal.mjs. Do NOT edit grade-*/build-*/perelement. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64.'

const DSCHEMA = { type: 'object', additionalProperties: false, properties: {
  reactdevClickGatedLeaves: { type: 'number' }, reactdevBaselineLeaves: { type: 'number' }, reactdevPctGated: { type: 'number' },
  resendClickGatedLeaves: { type: 'number' }, triggerPatterns: { type: 'array', items: { type: 'string' } },
  leverIsReal: { type: 'boolean' }, recommendation: { type: 'string' },
}, required: ['reactdevClickGatedLeaves', 'reactdevBaselineLeaves', 'leverIsReal', 'triggerPatterns', 'recommendation'] }
const diag = await agent([HARD.replace('Edit ONLY capture-layout.mjs (+ a NEW capture-explore.mjs it imports). ', 'DIAGNOSE — read-only, do NOT edit any file (isolated Playwright probing only). '),
  'DIAGNOSE whether click-to-reveal is a REAL lever. Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput. The re-baseline found reactdev (struct 0.34) / resend (0.337) lose interactive content. CONFIRM how much is actually CLICK-GATED (display:none until interacted) vs already-rendered-on-load (which step-scroll already gets).',
  'In isolated Playwright, load reactdev (https://react.dev) + resend (https://resend.com) at 1440. (1) BASELINE: count visible text/media leaves after load + a full step-scroll (mimic the current capture). (2) Then find INTERACTIVE TRIGGERS: elements matching role=tab, [aria-expanded=false], [aria-selected=false], <summary>/<details>, [data-state=closed/inactive], buttons/links with text matching /show|view|more|expand|see all|tab|example|preview/i, and obvious tab/accordion/carousel class patterns. Click each (bounded ~15, 800ms wait, try/catch) and COUNT how many NEW visible text/media leaves appear that were NOT in the baseline (reactdevClickGatedLeaves / resendClickGatedLeaves). reactdevPctGated = clickGated/(baseline+clickGated).',
  'triggerPatterns = the distinct selector/pattern types that actually revealed content. leverIsReal=true iff click-gated leaves are a MEANINGFUL fraction (>~8% of total, or >20 leaves on either site) — i.e. building click-to-reveal would recover real structural content. If most content is already rendered (click-gated tiny), leverIsReal=false (say so honestly — then click-reveal is NOT worth building + the structural gap is elsewhere e.g. canvas/SVG/React-output-panels).',
  'Return {reactdevClickGatedLeaves, reactdevBaselineLeaves, reactdevPctGated, resendClickGatedLeaves, triggerPatterns, leverIsReal, recommendation}.',
].join('\n'), { label: 'diagnose:click-reveal', phase: 'Diagnose', schema: DSCHEMA })
log('DIAG: reactdev gated=' + (diag&&diag.reactdevClickGatedLeaves) + '/' + (diag&&diag.reactdevBaselineLeaves) + ' (' + (diag&&diag.reactdevPctGated) + ') resend gated=' + (diag&&diag.resendClickGatedLeaves) + ' leverIsReal=' + (diag&&diag.leverIsReal))

let impl = null, verify = null
if (diag && diag.leverIsReal) {
  phase('Build')
  impl = await agent([HARD,
    'IMPLEMENT a HARDENED click-to-reveal capture pass (wave-4 #1). Work in ' + GRADER + '. DIAGNOSIS: reactdev ' + (diag.reactdevClickGatedLeaves) + ' click-gated leaves, resend ' + (diag.resendClickGatedLeaves) + '; trigger patterns: ' + JSON.stringify(diag.triggerPatterns) + '. Read capture-layout.mjs (the existing settle + step-scroll + the DOM walk).',
    'Create capture-explore.mjs exporting a function exploreReveal(page) and import+call it in capture-layout.mjs AFTER load/step-scroll but BEFORE the walk, gated: if (process.env.CAPTURE_NO_EXPLORE !== "1") await exploreReveal(page).',
    'exploreReveal: in page.evaluate-driven steps, find interactive triggers matching the diagnosed patterns (role=tab, aria-expanded=false, <summary>, data-state closed, show/more/expand/tab buttons). For EACH (HARD CAPS: at most 15 triggers total, process in document order, skip offscreen): click it via Playwright, await page.waitForTimeout(<=600ms) for content (NOT networkidle, NOT waitForFunction without timeout — fixed short waits only, the wifi-stall lesson), then let the EXISTING walk pick up the now-visible content on its normal pass. The simplest robust approach: click all triggers (revealing their panels), THEN run the normal walk once — so newly-visible content is captured naturally + deduped by the walks existing seen-set. Wrap EVERYTHING in try/catch; a failed/timed-out click must not abort the capture. Total added time must be bounded (<=15 clicks x 600ms ~ 9s worst case).',
    'REPORT-FIRST (v1): just RECOVER the revealed content as normal leaves (do NOT yet synthesize native Tabs/Accordion widgets — that is v2). Idempotent + inert on static pages (no triggers -> no clicks -> no-op).',
    'REVERSIBILITY: CAPTURE_NO_EXPLORE=1 skips the whole pass (exact prior behavior). STEP 0: cp capture-layout.mjs /tmp/ev-bk-capture-clickreveal.mjs. node --check capture-layout.mjs + capture-explore.mjs. SELFTEST (grader unchanged): ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0. SMOKE: node capture-layout.mjs --source https://react.dev --out /tmp/cr-react-ON.json ; CAPTURE_NO_EXPLORE=1 ... --out /tmp/cr-react-OFF.json -> report leaf count ON (should be > OFF by ~the diagnosed gated count) + confirm tailwind ON==OFF (no-op static) + NO hang (completes in bounded time). If node --check fails or it hangs -> restore + RESTORED.',
    'Return PLAIN-TEXT "OK:" with reactdev leaf count ON vs OFF + tailwind ON vs OFF (must be ~equal) + confirmation no hang, or "RESTORED:".',
  ].join('\n'), { label: 'build:click-reveal', phase: 'Build' })
  log('IMPL: ' + String(impl || '').slice(0, 280))

  const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
  if (okImpl) {
    phase('Verify')
    const VS = { type: 'object', additionalProperties: false, properties: {
      site: { type: 'string' }, role: { type: 'string' }, leavesOff: { type: 'number' }, leavesOn: { type: 'number' },
      structOff: { type: 'number' }, structOn: { type: 'number' }, compositeOff: { type: 'number' }, compositeOn: { type: 'number' },
      recovered: { type: 'boolean' }, regressed: { type: 'boolean' }, hang: { type: 'boolean' }, verdict: { type: 'string' },
    }, required: ['site', 'role', 'leavesOff', 'leavesOn', 'structOff', 'structOn', 'compositeOff', 'compositeOn', 'recovered', 'regressed', 'hang', 'verdict'] }
    const SITES = [
      { name: 'reactdev', url: 'https://react.dev', page: 4771, role: 'TARGET (interactive, struct 0.34)' },
      { name: 'resend', url: 'https://resend.com', page: 2988, role: 'TARGET (interactive, struct 0.337)' },
      { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146, role: 'NO-REG (static)' },
    ]
    verify = await parallel(SITES.map((s) => () => agent([HARD,
      'VERIFY click-to-reveal on ONE site. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + ' role=' + s.role + '. ' + AUTH + ' before every WP command. You MUST end by calling StructuredOutput. Do NOT edit files.',
      'A/B BUILD (reuse ONE capture per mode; build-absolute.mjs --publish): explore ON (default) and OFF (CAPTURE_NO_EXPLORE=1). Record captured leaf count OFF/ON. hang=true iff the ON capture did not complete in bounded time (~<60s) — a FAIL.',
      'GRADE A/B: ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/crg-' + s.name + '-{on|off}. Record structOff/structOn (structural sub-score) + compositeOff/compositeOn.',
      'TARGET sites: recovered=true iff leavesOn > leavesOff (real hidden content recovered) AND structOn >= structOff (the recovered content lifts structural, or at least does not hurt). NO-REG (tailwind): regressed=true iff compositeOn < compositeOff - 0.01 OR leavesOn != leavesOff (must be a no-op on static). Judge like a human: did ON pull in real sections (tabs/accordion panels) OFF was missing?',
      'Return {site, role, leavesOff, leavesOn, structOff, structOn, compositeOff, compositeOn, recovered, regressed, hang, verdict}.',
    ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify', schema: VS }))).then((rs) => rs.filter(Boolean))
    for (const r of verify) log('VERIFY ' + r.site + ' [' + r.role + ']: leaves ' + r.leavesOff + '->' + r.leavesOn + ' struct ' + r.structOff + '->' + r.structOn + ' comp ' + r.compositeOff + '->' + r.compositeOn + ' recovered=' + r.recovered + ' hang=' + r.hang)
  }
}

phase('Gate')
let verdict
if (!diag || !diag.leverIsReal) {
  verdict = 'NOT BUILT — diagnosis says click-to-reveal is NOT a real lever (reactdev click-gated ' + (diag&&diag.reactdevClickGatedLeaves) + '/' + (diag&&diag.reactdevBaselineLeaves) + '). ' + String(diag&&diag.recommendation||'').slice(0,300) + ' -> the structural gap is elsewhere (canvas/SVG/React-output panels); pivot the structural attack there. No capture edit made.'
} else if (!impl || !/\bOK:/i.test(String(impl)) || /\bRESTORED:/i.test(String(impl))) {
  verdict = 'REVERTED — build failed/hung: ' + String(impl||'').slice(0,200)
} else {
  const v = verify || []
  const tgt = v.filter((r)=>/TARGET/.test(r.role))
  const noreg = v.filter((r)=>/NO-REG/.test(r.role))
  const anyHang = v.some((r)=>r.hang)
  const recovered = tgt.some((r)=>r.recovered && r.structOn >= r.structOff - 0.005)
  const noregOK = noreg.every((r)=>!r.regressed)
  if (recovered && noregOK && !anyHang) {
    verdict = 'ADOPTED — click-to-reveal recovers hidden interactive content (' + tgt.filter(r=>r.recovered).map(r=>r.site+' leaves '+r.leavesOff+'->'+r.leavesOn+' struct '+r.structOff+'->'+r.structOn).join(', ') + '); no-op on static (' + noreg.map(r=>r.site+' '+r.compositeOff+'->'+r.compositeOn).join(', ') + '); no hang. Attacks the #2 structural floor. Reversible CAPTURE_NO_EXPLORE=1. (v2: synthesize native Tabs/Accordion widgets.)'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-capture-clickreveal.mjs capture-layout.mjs && rm -f capture-explore.mjs && node --check capture-layout.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
    verdict = 'REVERTED — ' + (anyHang ? 'capture HUNG (interaction not bounded)' : !recovered ? 'no real structural recovery on targets' : 'regressed a static site') + '. ' + JSON.stringify(v.map(r=>({s:r.site,leaves:[r.leavesOff,r.leavesOn],struct:[r.structOff,r.structOn],comp:[r.compositeOff,r.compositeOn],rec:r.recovered,hang:r.hang})))
  }
}
log('CLICK-REVEAL: ' + verdict)
return { verdict, diag, impl: String(impl||'').slice(0,400), verify }

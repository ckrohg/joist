export const meta = {
  name: 'abs-vertical-reflow',
  description: 'THE #1 LEVER (corpus re-baseline, objective: responsive 0.3625 is the floor, worst sub-score on 7/8 sites): fix VERTICAL mobile reflow in build-absolute. The chrome-unpin solved HORIZONTAL overflow (scrollWidth390=390 everywhere) but vertically the recipe-#20 un-pin sets position:relative+width:100% WITHOUT resetting the desktop top-offset/height -> un-pinned widgets stack with cumulative gaps + desktop-fixed heights -> mobile doc-height balloons 2.1x (tailwind) to 9.5x (framer) vs source -> near-empty 390 column. DIAGNOSE the dominant ballooning cause (retained top:Ypx relative offset gaps vs fixed height/min-height vs container height) on tailwind+framer, then FIX recipe #20 at <=1024 to RESET the vertical pins (top/bottom/transform:none + height/min-height:auto + margin:0) so widgets compact into a natural-height mobile stack in DOM/visual order. Reversible ABS_NO_VREFLOW=1. GATE: desktop(1440) byte-identical (<=1024-only change) + 390 docH ratio (clone/source) drops toward ~1-1.5x (from 2-9.5x) on >=2 sites + responsive RLG up + composite no-reg, else auto-restore. One fix lifts the whole corpus.',
  phases: [
    { title: 'Diagnose', detail: 'instrument 390 render on tailwind+framer: pin WHY docH is 2-9.5x source (top-offset gaps / fixed heights / container)' },
    { title: 'Fix', detail: 'recipe #20 un-pin resets vertical pins at <=1024 so widgets compact to natural-height stack; behind ABS_NO_VREFLOW=1; node --check + selftest 1.0' },
    { title: 'Verify', detail: 'tailwind+supabase+framer: 390 docH ratio toward 1 + proper mobile stack + desktop identical + responsive up + composite no-reg' },
    { title: 'Gate', detail: 'keep iff desktop-identical + 390 height compacts on >=2 sites + composite no-reg, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Edit ONLY build-absolute.mjs. Back it up FIRST: cp build-absolute.mjs /tmp/ev-bk-buildabs-vreflow.mjs. Do NOT edit capture/grade/perelement/build-flow. PRESERVE recipes #20 (responsive-unpin) #21 (chrome-unpin) #22 (fluid-fonts) — ENHANCE the #20 un-pin. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64.'

const DSCHEMA = { type: 'object', additionalProperties: false, properties: {
  tailwindDocH390: { type: 'number' }, tailwindSrcDocH390: { type: 'number' }, framerDocH390: { type: 'number' },
  dominantCause: { type: 'string' }, retainedTopOffset: { type: 'boolean' }, retainedFixedHeight: { type: 'boolean' },
  currentUnpinCss: { type: 'string' }, fixPlan: { type: 'string' },
}, required: ['tailwindDocH390', 'dominantCause', 'fixPlan'] }
const diag = await agent([HARD.replace('Edit ONLY build-absolute.mjs. ', 'DIAGNOSE phase — do NOT edit build-absolute yet (read-only + instrument). '),
  'DIAGNOSE the vertical mobile-reflow ballooning. Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput. The corpus re-baseline found: at 390 the abs clone doc-height is 2.1x-9.5x the source (tailwind 36937 vs 17254; framer 90608 vs 9534), a near-empty column, even though horizontal overflow is fixed (scrollWidth390=390).',
  'Read build-absolute.mjs recipe #20 (the responsive-unpin custom_css, ~lines 595-630): capture the EXACT CSS rules it injects at <=1024 (currentUnpinCss — e.g. .elementor-absolute{position:relative;width:100%} etc). Identify whether it resets top/bottom/transform/height/min-height or leaves the desktop values.',
  'INSTRUMENT a live clone at 390 (use the already-published tailwind page 3146 + framer page 2990; render in isolated Playwright at width 390): for the tallest few elements, read computed position, top, height, min-height, marginTop, transform, and their getBoundingClientRect().top. DETERMINE the dominant ballooning cause: (a) retainedTopOffset — widgets are position:relative but KEEP top:Ypx (desktop), so each sits Ypx below its flow position -> cumulative gaps; (b) retainedFixedHeight — widgets keep a desktop height/min-height much taller than their content; (c) container/section heights fixed. Report tailwindDocH390, tailwindSrcDocH390 (~17254), framerDocH390, dominantCause (one sentence, evidence-based), retainedTopOffset, retainedFixedHeight.',
  'fixPlan: the precise CSS reset to add to recipe #20 at <=1024 to compact the stack (e.g. "add top:auto!important;bottom:auto;transform:none;height:auto!important;min-height:0!important;margin-top:0 to the .elementor-absolute un-pin rule, + container height:auto"). Be specific about WHICH properties + selectors.',
  'Return {tailwindDocH390, tailwindSrcDocH390, framerDocH390, dominantCause, retainedTopOffset, retainedFixedHeight, currentUnpinCss, fixPlan}.',
].join('\n'), { label: 'diagnose:vreflow', phase: 'Diagnose', schema: DSCHEMA })
log('DIAG: tailwindDocH390=' + (diag&&diag.tailwindDocH390) + ' (src ' + (diag&&diag.tailwindSrcDocH390) + ') cause=' + (diag&&diag.dominantCause||'').slice(0,120) + ' topOffset=' + (diag&&diag.retainedTopOffset) + ' fixedH=' + (diag&&diag.retainedFixedHeight))

phase('Fix')
const impl = await agent([HARD,
  'FIX the vertical mobile reflow in build-absolute.mjs recipe #20 (the <=1024 responsive un-pin). Work in ' + GRADER + '. DIAGNOSIS: dominantCause=' + String(diag&&diag.dominantCause||'').slice(0,300) + ' | retainedTopOffset=' + (diag&&diag.retainedTopOffset) + ' retainedFixedHeight=' + (diag&&diag.retainedFixedHeight) + ' | currentUnpinCss=' + String(diag&&diag.currentUnpinCss||'').slice(0,300) + ' | fixPlan=' + String(diag&&diag.fixPlan||'').slice(0,400),
  'Implement the fixPlan: ENHANCE the recipe #20 un-pin custom_css so at <=1024 the un-pinned widgets COMPACT into a natural-height mobile stack. Based on the diagnosis, add the vertical resets (top:auto / bottom:auto / transform:none / height:auto / min-height:0 / margin reset as the diagnosis indicates) to the un-pin selector(s), AND ensure the section/container heights go auto so the column collapses. Keep position:relative + width:100% + the horizontal chrome-fix. Stacking is DOM-order (position:relative) — the build emits widgets roughly in capture order; if the diagnosis shows DOM order != visual order causing scramble, ALSO note it (but the primary fix is the vertical compaction).',
  'PRESERVE desktop EXACTLY: the change is INSIDE the @media(max-width:1024px) block ONLY — desktop (>1024) must be byte-identical. PRESERVE recipes #21 (chrome-unpin) + #22 (fluid-fonts).',
  'REVERSIBILITY: gate the new vertical-reset behind if (process.env.ABS_NO_VREFLOW === "1") -> the OLD recipe #20 (position:relative+width:100% only). Default = vertical-compact ON.',
  'STEP 0: cp build-absolute.mjs /tmp/ev-bk-buildabs-vreflow.mjs. STEP 1 implement. node --check. STEP 2 SELFTEST: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0. STEP 3 SMOKE: rebuild tailwind (3146) vreflow ON, render @390 -> docH should DROP a lot vs the diagnosed ' + (diag&&diag.tailwindDocH390) + ' (toward source ~' + (diag&&diag.tailwindSrcDocH390||17254) + '); render @1440 vs ABS_NO_VREFLOW=1 @1440 -> >=99.5% pixel-identical (desktop invariant). If node --check fails or desktop breaks -> restore + RESTORED.',
  'Return PLAIN-TEXT "OK:" with the CSS added + tailwind @390 docH BEFORE(' + (diag&&diag.tailwindDocH390) + ')->AFTER + the desktop @1440 ON-vs-OFF pixel match %, or "RESTORED:".',
].join('\n'), { label: 'fix:vreflow', phase: 'Fix' })
log('IMPL: ' + String(impl || '').slice(0, 280))

const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
let verify = null
if (okImpl) {
  phase('Verify')
  const VS = { type: 'object', additionalProperties: false, properties: {
    site: { type: 'string' }, desktopMatchPct: { type: 'number' }, desktopIdentical: { type: 'boolean' },
    docH390Off: { type: 'number' }, docH390On: { type: 'number' }, srcDocH390: { type: 'number' }, ratioOff: { type: 'number' }, ratioOn: { type: 'number' },
    properMobileStack: { type: 'boolean' }, respOff: { type: 'number' }, respOn: { type: 'number' }, compositeOff: { type: 'number' }, compositeOn: { type: 'number' },
    regressed: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['site', 'desktopMatchPct', 'desktopIdentical', 'docH390Off', 'docH390On', 'ratioOff', 'ratioOn', 'properMobileStack', 'respOff', 'respOn', 'compositeOff', 'compositeOn', 'regressed', 'verdict'] }
  const SITES = [
    { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146 },
    { name: 'supabase', url: 'https://supabase.com', page: 2986 },
    { name: 'framer', url: 'https://www.framer.com', page: 2990 },
  ]
  verify = await parallel(SITES.map((s) => () => agent([HARD,
    'VERIFY the vertical-reflow fix on ONE site, ABS builder. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + '. ' + AUTH + ' before every WP command. You MUST end by calling StructuredOutput. Do NOT edit files.',
    'A/B BUILD (build-absolute.mjs --publish; reuse ONE shared capture): vreflow ON (default) and OFF (ABS_NO_VREFLOW=1).',
    'MOBILE HEIGHT (@390, the core metric): document.documentElement.scrollHeight for OFF (docH390Off) and ON (docH390On); srcDocH390 = source scrollHeight at 390. ratioOff = docH390Off/srcDocH390, ratioOn = docH390On/srcDocH390. The fix WORKS iff ratioOn is much closer to 1 than ratioOff (e.g. ratioOff ~2-9x -> ratioOn ideally <=1.6x). properMobileStack=true iff the 390 render is a readable compact vertical stack of the content (not a near-empty column with giant gaps).',
    'DESKTOP INVARIANT (@1440): ON vs OFF full-page render -> desktopMatchPct; desktopIdentical=true iff >=99.5% AND same docH (the change is <=1024-only).',
    'GRADE A/B: ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/vr-' + s.name + '-{on|off}. respOff/respOn (0.25 RLG) + compositeOff/compositeOn. regressed=true iff compositeOn<compositeOff-0.01 OR desktopIdentical false.',
    'Judge like a human at 390: is it now a proper mobile page (content stacked, readable, compact) instead of a near-empty 2-9x-tall column? Return {site, desktopMatchPct, desktopIdentical, docH390Off, docH390On, srcDocH390, ratioOff, ratioOn, properMobileStack, respOff, respOn, compositeOff, compositeOn, regressed, verdict}.',
  ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify', schema: VS }))).then((rs) => rs.filter(Boolean))
  for (const r of verify) log('VERIFY ' + r.site + ': docH@390 ' + r.docH390Off + '->' + r.docH390On + ' (src ' + r.srcDocH390 + ', ratio ' + r.ratioOff + '->' + r.ratioOn + ') stack=' + r.properMobileStack + ' desk ' + r.desktopMatchPct + '% resp ' + r.respOff + '->' + r.respOn + ' comp ' + r.compositeOff + '->' + r.compositeOn + ' reg=' + r.regressed)
}

phase('Gate')
let verdict
if (!okImpl) {
  verdict = 'REVERTED — impl failed/desktop broke: ' + String(impl || '').slice(0, 200)
} else {
  const v = verify || []
  const deskOK = v.length && v.every((r) => r.desktopIdentical)
  const compacts = v.filter((r) => r.ratioOn < r.ratioOff - 0.3 && r.ratioOn < r.ratioOff * 0.7).length >= 2
  const anyReg = v.some((r) => r.regressed)
  const respUp = v.some((r) => r.respOn > r.respOff + 0.01)
  if (deskOK && compacts && !anyReg) {
    verdict = 'ADOPTED — abs vertical mobile-reflow: un-pinned widgets compact into a natural-height stack at <=1024, desktop byte-identical. Mobile docH ratio crushed (' + v.map((r)=>r.site+' '+r.ratioOff+'->'+r.ratioOn+' resp '+r.respOff+'->'+r.respOn+' comp '+r.compositeOff+'->'+r.compositeOn).join(' | ') + '). Attacks the #1 corpus lever (responsive floor 0.3625). ' + (respUp?'Responsive UP. ':'') + 'Reversible ABS_NO_VREFLOW=1. RE-BASELINE the corpus next.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-buildabs-vreflow.mjs build-absolute.mjs && node --check build-absolute.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
    verdict = 'REVERTED — ' + (!deskOK ? 'desktop NOT identical (<=1024 change leaked to desktop)' : !compacts ? 'mobile height did not compact on >=2 sites (ratio not crushed -> ballooning cause not the vertical pins, or stack still gappy)' : 'a site regressed') + '. ' + JSON.stringify(v.map((r)=>({s:r.site,ratio:[r.ratioOff,r.ratioOn],dSame:r.desktopIdentical,stack:r.properMobileStack,comp:[r.compositeOff,r.compositeOn],reg:r.regressed})))
  }
}
log('ABS-VERTICAL-REFLOW: ' + verdict)
return { verdict, diag, impl: String(impl || '').slice(0, 400), verify }

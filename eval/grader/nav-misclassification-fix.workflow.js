export const meta = {
  name: 'nav-misclassification-fix',
  description: 'GENERALIZING builder bug (corpus-breadth #1 lever, critical): build-absolute MIS-CLASSIFIES a dense repeated-row CONTENT list as a NAV-MENU — on HackerNews the 195 story rows became a 195-item Pro nav-menu (structural=0, the real list content lost, textCollision 0.20). Per the breadth synth this generalizes to ecommerce grids, search results, comment threads, changelogs, pricing/API tables (a huge real-web swath) -> a clear clone-ANY-site blocker. ROOT: build-absolute header/nav detection (detectHeaderNav / Path A) collects ALL anchors in too-wide a band -> a full-page repeated-row content list is mistaken for a nav. FIX (guard the nav gate): a NAV is a SMALL header band of links (topmost band, small y-range, ~3-15 items, horizontal-ish row), NOT a full-page vertical repeated-row content list. Add a guard so a candidate nav with too many items / spanning too much page-height / vertically-stacked content rows is NOT classified as a nav -> those rows emit as native CONTENT (list/text widgets). DIAGNOSE-FIRST (why it fires on HN). CRITICAL NO-REG: real navs on the dev-marketing sites (supabase/tailwind/resend Pro nav-menu = the user-feedback-#2 win) MUST still be detected. Reversible. GATE: HN structural UP + nav item-count sane (not ~195) + story rows emit as content AND real-nav STILL detected on supabase+tailwind (no-reg on the real-nav win) + self-test 1.0, else auto-restore.',
  phases: [
    { title: 'Diagnose', detail: 'HN: why does nav-detection grab 195 content rows? + the precise guard (item-count/band-height/horizontality)' },
    { title: 'Fix', detail: 'guard the nav gate so dense repeated-row content lists are NOT navs (emit as content); behind a flag; node --check + selftest 1.0' },
    { title: 'Verify+Gate', detail: 'HN struct up + nav sane + rows=content AND real-nav still detected on supabase+tailwind (no-reg) + self-test 1.0, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && export JOIST_BASE="${JOIST_BASE:-http://localhost:8001}"; case "$JOIST_BASE" in *sg-host.com*|*georges232*|*35.212.46.254*) echo "FATAL: JOIST_BASE=$JOIST_BASE is a blocked/paused host (host-guard allowlist; renders only target localhost:8001 or JOIST_TRAINING_BASE)"; exit 1;; esac'
const HARD = 'Edit ONLY build-absolute.mjs. STEP 0: cp build-absolute.mjs /tmp/ev-bk-buildabs-navfix.mjs AND VERIFY grep -c NAVFIX /tmp/ev-bk-buildabs-navfix.mjs == 0 (clean base). Do NOT edit capture/grade/perelement. PRESERVE the real-nav win (recipe #2/Path A nav-menu MUST still fire on real header navs). AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. HN is built on page 11066; supabase 2986, tailwind 3146. 422 silent-save w/ tree persisted = ok.'

const DSCHEMA = { type: 'object', additionalProperties: false, properties: {
  hnNavItemCount: { type: 'number' }, navBandYRange: { type: 'number' }, navIsVerticalContent: { type: 'boolean' },
  detectFn: { type: 'string' }, whyOverfires: { type: 'string' }, realNavSignature: { type: 'string' }, fixPlan: { type: 'string' }, feasible: { type: 'boolean' },
}, required: ['hnNavItemCount', 'whyOverfires', 'detectFn', 'fixPlan', 'feasible'] }
const diag = await agent([HARD.replace('Edit ONLY build-absolute.mjs. STEP 0: cp build-absolute.mjs /tmp/ev-bk-buildabs-navfix.mjs AND VERIFY grep -c NAVFIX /tmp/ev-bk-buildabs-navfix.mjs == 0 (clean base). ', 'DIAGNOSE — read-only, do NOT edit. '),
  'DIAGNOSE the nav-misclassification. Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput. corpus-breadth found build-absolute turned HackerNews 195 story rows into a 195-item nav-menu.',
  'Read build-absolute.mjs nav/header detection (detectHeaderNav ~L1130 + the Path A nav-menu emit + how it collects anchor items for the menu). Build HN: node capture-layout.mjs --source https://news.ycombinator.com/ --out /tmp/nf-hn.json (or reuse /tmp/br-hackernews.json) -> trace what the nav detector collects: hnNavItemCount (it found ~195), navBandYRange (the y-span of the elements it treated as nav — small header band, or the WHOLE page?), navIsVerticalContent (are the 195 items a horizontal header row, or a VERTICAL repeated-row content list spanning the page?).',
  'detectFn = the function + line range. whyOverfires = the precise reason (e.g. it collects ALL anchors in the page / the first container / a band that is too tall, with no item-count cap or horizontality/header-band check). realNavSignature = what a REAL header nav looks like (topmost band, small y-range ~<120px tall, ~3-15 links in a horizontal row) so the guard can distinguish it from a content list. fixPlan = the guard: classify as a nav ONLY if (items <= ~15 AND band height <= ~120px AND links are horizontally arranged in the topmost band); otherwise the rows are CONTENT -> emit as native list/text widgets, not a nav-menu. feasible = true iff a clean guard distinguishes real navs from content lists.',
  'Return {hnNavItemCount, navBandYRange, navIsVerticalContent, detectFn, whyOverfires, realNavSignature, fixPlan, feasible}.',
].join('\n'), { label: 'diagnose:navfix', phase: 'Diagnose', schema: DSCHEMA })
log('DIAG: hnNavItems=' + (diag&&diag.hnNavItemCount) + ' bandY=' + (diag&&diag.navBandYRange) + ' verticalContent=' + (diag&&diag.navIsVerticalContent) + ' fn=' + String(diag&&diag.detectFn||'').slice(0,50) + ' feasible=' + (diag&&diag.feasible))

let impl = null, verify = null
if (diag && diag.feasible) {
  phase('Fix')
  impl = await agent([HARD,
    'IMPLEMENT the nav-misclassification guard in build-absolute.mjs (use a NAVFIX comment token). Work in ' + GRADER + '. DIAGNOSIS: detectFn=' + String(diag.detectFn||'').slice(0,100) + ' whyOverfires=' + String(diag.whyOverfires||'').slice(0,200) + ' realNavSignature=' + String(diag.realNavSignature||'').slice(0,150) + ' | fixPlan: ' + String(diag.fixPlan||'').slice(0,400),
    'Guard the nav gate so a candidate "nav" is classified as a real nav ONLY if it matches the real-nav signature (topmost band, small y-range ~<=120px, ~3-15 links, horizontally arranged). A candidate with too many items (>~15) OR spanning too much page-height OR vertically-stacked repeated content rows is NOT a nav -> let those rows emit as native CONTENT (the normal widget path: list/text/heading widgets), not a Pro nav-menu. PRESERVE the real-nav detection (recipe #2) for genuine header navs (supabase/tailwind/resend MUST still get their nav-menu).',
    'REVERSIBILITY: gate behind ABS_NO_NAVFIX=1 (default = guard ON). node --check. SELFTEST: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0. SMOKE: (a) rebuild HN (page 11066) -> the nav should now be a small real nav (or none) NOT 195 items + the story rows emit as content + structural should RISE from ~0; (b) rebuild supabase (2986) -> the REAL nav-menu MUST still be created (Path A, the header nav still detected) — confirm realNavOk still true. If node --check / self-test fails or supabase real-nav breaks -> restore /tmp/ev-bk-buildabs-navfix.mjs + RESTORED.',
    'Return "OK:" with HN nav-item-count before->after + HN structural before->after + confirmation supabase real-nav still detected, or "RESTORED:".',
  ].join('\n'), { label: 'fix:navfix', phase: 'Fix' })
  log('IMPL: ' + String(impl || '').slice(0, 280))

  const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
  if (okImpl) {
    phase('Verify+Gate')
    const VS = { type: 'object', additionalProperties: false, properties: {
      hnNavItemsOff: { type: 'number' }, hnNavItemsOn: { type: 'number' }, hnStructOff: { type: 'number' }, hnStructOn: { type: 'number' }, hnCompOff: { type: 'number' }, hnCompOn: { type: 'number' },
      supaRealNavOff: { type: 'boolean' }, supaRealNavOn: { type: 'boolean' }, supaCompOff: { type: 'number' }, supaCompOn: { type: 'number' }, twRealNavOn: { type: 'boolean' },
      selftest: { type: 'number' }, realNavPreserved: { type: 'boolean' }, ok: { type: 'boolean' }, verdict: { type: 'string' },
    }, required: ['hnNavItemsOff', 'hnNavItemsOn', 'hnStructOff', 'hnStructOn', 'supaRealNavOn', 'supaCompOff', 'supaCompOn', 'selftest', 'realNavPreserved', 'ok', 'verdict'] }
    verify = await agent([HARD,
      'INDEPENDENTLY VERIFY the nav-misclassification guard. Work in ' + GRADER + '. ' + AUTH + '. Flag ABS_NO_NAVFIX=1 disables. Prior: ' + String(impl||'').slice(0,200) + '. You MUST end by calling StructuredOutput. Run only.',
      'HN A/B (page 11066): build+grade ON (default) vs ABS_NO_NAVFIX=1 OFF. hnNavItemsOff/On (the nav-menu item count — OFF ~195, ON should be small/0), hnStructOff/On (structural — should RISE), hnCompOff/On.',
      'REAL-NAV NO-REG (CRITICAL — must not break the user-#2 win): build+grade supabase (2986) + tailwind (3146) ON. supaRealNavOff/On (is the Pro nav-menu still created? realNavOk detector), twRealNavOn, supaCompOff/On. realNavPreserved = true iff supabase + tailwind STILL get their real header nav-menu with the guard ON (the guard only blocks content-list-as-nav, never a real header nav).',
      'selftest = grade-sections --source supabase --selftest (1.0). ok = hnStructOn>hnStructOff+0.05 AND hnNavItemsOn<30 AND realNavPreserved AND supaCompOn>=supaCompOff-0.005 AND selftest==1.0. Return all fields + verdict.',
    ].join('\n'), { label: 'verify:navfix', phase: 'Verify+Gate', schema: VS })
    log('VERIFY: HN navItems ' + (verify&&verify.hnNavItemsOff) + '->' + (verify&&verify.hnNavItemsOn) + ' struct ' + (verify&&verify.hnStructOff) + '->' + (verify&&verify.hnStructOn) + ' realNavPreserved=' + (verify&&verify.realNavPreserved) + ' supaComp ' + (verify&&verify.supaCompOff) + '->' + (verify&&verify.supaCompOn) + ' ok=' + (verify&&verify.ok))
  }
}

phase('Verify+Gate')
let verdict
if (!diag || !diag.feasible) {
  verdict = 'NOT BUILT — diagnosis: no clean guard distinguishes real navs from content lists. ' + String(diag&&diag.fixPlan||'').slice(0,200)
} else if (!impl || !/\bOK:/i.test(String(impl)) || /\bRESTORED:/i.test(String(impl))) {
  verdict = 'REVERTED — fix failed/self-test/real-nav broke: ' + String(impl||'').slice(0,200)
} else if (verify && verify.ok) {
  verdict = 'ADOPTED — nav-misclassification guard: HN nav items ' + verify.hnNavItemsOff + '->' + verify.hnNavItemsOn + ', HN structural ' + verify.hnStructOff + '->' + verify.hnStructOn + ', composite ' + verify.hnCompOff + '->' + verify.hnCompOn + '; REAL-NAV PRESERVED (supabase+tailwind still get their header nav-menu, ' + verify.supaCompOff + '->' + verify.supaCompOn + '); self-test 1.0. A GENERALIZING fix (ecommerce grids/search/threads/changelogs/tables no longer mis-read as navs) toward clone-ANY-site. Reversible ABS_NO_NAVFIX=1.'
} else {
  await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-buildabs-navfix.mjs build-absolute.mjs && node --check build-absolute.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Verify+Gate' })
  verdict = 'REVERTED — ' + (verify&&!verify.realNavPreserved ? 'BROKE the real-nav win (supabase/tailwind lost their header nav-menu — guard too aggressive)' : verify&&verify.hnStructOn<=verify.hnStructOff ? 'HN structural did not rise' : 'gate not met') + '. ' + JSON.stringify(verify || {}).slice(0, 260)
}
log('NAV-MISCLASSIFICATION-FIX: ' + verdict)
return { verdict, diag, impl: String(impl||'').slice(0,400), verify }

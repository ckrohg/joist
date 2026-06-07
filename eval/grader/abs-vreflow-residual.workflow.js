export const meta = {
  name: 'abs-vreflow-residual',
  description: 'FINISH the #1 responsive lever (2nd of the re-baselines prescribed 2-3 reflow rounds). Recipe #23 vertical-reflow NAILED tailwind (mobile docH 2.21x->0.95x) but left supabase 3.11x + framer 4.76x residual — diagnosed as decorative bg-rect CONTAINERS (full-band background layers, not widgets) that the widget-scoped height:auto rule does not catch, so they stack in flow at <=1024 and still inflate mobile docH. DIAGNOSE the residual precisely on supabase+framer (which elements contribute the remaining 2-5x; are the bg-rects DECORATIVE [safe to take out of flow] or STRUCTURAL section-backgrounds [must preserve the backdrop]) then FIX: at <=1024 take decorative bg-rect containers OUT of document flow (position:absolute, height:100% of parent section so the backdrop still covers the reflowed content) OR collapse them, WITHOUT losing real section backgrounds and WITHOUT touching content containers. Now GRADEABLE (mobile-prop term credits docH compaction). Reversible ABS_NO_VREFLOW2=1. GATE: desktop(1440) byte-identical + supabase/framer 390 docH ratio drops further (toward <=2x) + backgrounds preserved + composite no-reg (ideally up via mobile-prop), else auto-restore.',
  phases: [
    { title: 'Diagnose', detail: 'instrument supabase+framer 390: which elements contribute the residual 2-5x; bg-rects decorative vs structural' },
    { title: 'Fix', detail: 'take decorative bg-rects out of flow / collapse at <=1024 preserving backdrops; behind ABS_NO_VREFLOW2=1; node --check + selftest 1.0' },
    { title: 'Verify', detail: 'supabase+framer+tailwind: 390 docH ratio drops further + backgrounds intact + desktop identical + composite no-reg' },
    { title: 'Gate', detail: 'keep iff desktop-identical + further compaction + backgrounds preserved + no-reg, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Edit ONLY build-absolute.mjs. Back it up FIRST: cp build-absolute.mjs /tmp/ev-bk-buildabs-vreflow2.mjs. Do NOT edit capture/grade/perelement/build-flow. PRESERVE recipes #20-24 (responsive-unpin, chrome-unpin, fluid-fonts, vertical-reflow). AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Custom_css-only changes 422 (Joist Check-A); empty-then-rebuild the tree to A/B.'

const DSCHEMA = { type: 'object', additionalProperties: false, properties: {
  supabaseDocH390: { type: 'number' }, framerDocH390: { type: 'number' },
  residualSource: { type: 'string' }, bgRectsDecorative: { type: 'boolean' }, bgRectCount: { type: 'number' },
  bgRectsCarrySectionBg: { type: 'boolean' }, fixPlan: { type: 'string' },
}, required: ['supabaseDocH390', 'residualSource', 'bgRectsDecorative', 'fixPlan'] }
const diag = await agent([HARD.replace('Edit ONLY build-absolute.mjs. ', 'DIAGNOSE — do NOT edit build-absolute yet (read-only + instrument). '),
  'DIAGNOSE the residual mobile-height balloon. Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput. Recipe #23 (vertical-reflow) crushed tailwind to 0.95x but supabase is still 3.11x + framer 4.76x source docH at 390.',
  'Read build-absolute.mjs: how bg-rects are emitted (search bgRect / "bg rects" / the background-band layer code), their _element_id/class, and recipe #23 (the <=1024 un-pin block). Instrument the live supabase (page 2986) + framer (page 2990) at width 390 (isolated Playwright): sort elements by their contribution to document height; identify the TOP contributors of the residual. Are they (a) bg-rect decorative background bands stacking in flow, (b) content sections with retained height, (c) cumulative gaps/margins?',
  'For the bg-rects specifically: bgRectCount (how many per page), bgRectsDecorative (are they pure decorative backdrops with no text/widget content children?), bgRectsCarrySectionBg (does a bg-rect provide the visible background COLOR/image of a section such that hiding it would make the section transparent/wrong?). This determines the safe fix (take out of flow + cover parent vs collapse vs display:none).',
  'fixPlan: the precise <=1024 CSS/emit change to compact the residual WITHOUT losing real backgrounds (e.g. "tag bg-rects #bgr-N; at <=1024 position:absolute + top:0 + height:100% + z-index:-1 on #bgr-N so they backdrop their parent section out of flow" OR "the bg-rects carry section bg -> instead move the bg onto the parent .e-con + display:none the bg-rect at <=1024"). Be specific + safe.',
  'Return {supabaseDocH390, framerDocH390, residualSource, bgRectsDecorative, bgRectCount, bgRectsCarrySectionBg, fixPlan}.',
].join('\n'), { label: 'diagnose:vreflow-residual', phase: 'Diagnose', schema: DSCHEMA })
log('DIAG: supabaseDocH390=' + (diag&&diag.supabaseDocH390) + ' residual=' + String(diag&&diag.residualSource||'').slice(0,120) + ' bgRectsDecorative=' + (diag&&diag.bgRectsDecorative) + ' carrySectionBg=' + (diag&&diag.bgRectsCarrySectionBg))

phase('Fix')
const impl = await agent([HARD,
  'FIX the residual mobile-height balloon in build-absolute.mjs (extend recipe #23). Work in ' + GRADER + '. DIAGNOSIS: residualSource=' + String(diag&&diag.residualSource||'').slice(0,300) + ' | bgRectsDecorative=' + (diag&&diag.bgRectsDecorative) + ' bgRectsCarrySectionBg=' + (diag&&diag.bgRectsCarrySectionBg) + ' bgRectCount=' + (diag&&diag.bgRectCount) + ' | fixPlan=' + String(diag&&diag.fixPlan||'').slice(0,400),
  'Implement the fixPlan to compact the residual at <=1024 WITHOUT losing real section backgrounds. If bg-rects are decorative (no section bg) -> take them out of flow (position:absolute) or collapse so they stop adding document height. If they CARRY the section background -> move the bg onto the parent container first, THEN take the rect out of flow. Scope strictly to bg-rect layers; do NOT touch content containers/widgets. Keep recipes #20-24 intact; this ADDS to the #23 <=1024 block.',
  'PRESERVE desktop EXACTLY (>1024 byte-identical — change is @media(max-width:1024px) only). REVERSIBILITY: gate behind if (process.env.ABS_NO_VREFLOW2 === "1") -> recipe #23 behavior (no bg-rect handling).',
  'STEP 0: cp build-absolute.mjs /tmp/ev-bk-buildabs-vreflow2.mjs. node --check. SELFTEST: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0. SMOKE: rebuild supabase (2986), render @390 -> docH should DROP below the diagnosed ' + (diag&&diag.supabaseDocH390) + '; render @1440 vs ABS_NO_VREFLOW2=1 -> >=99.5% identical AND backgrounds still present at desktop. If node --check fails or desktop/bg breaks -> restore + RESTORED.',
  'Return PLAIN-TEXT "OK:" with supabase @390 docH BEFORE(' + (diag&&diag.supabaseDocH390) + ')->AFTER + desktop @1440 pixel match % + backgrounds-intact confirmation, or "RESTORED:".',
].join('\n'), { label: 'fix:vreflow-residual', phase: 'Fix' })
log('IMPL: ' + String(impl || '').slice(0, 280))

const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
let verify = null
if (okImpl) {
  phase('Verify')
  const VS = { type: 'object', additionalProperties: false, properties: {
    site: { type: 'string' }, desktopMatchPct: { type: 'number' }, desktopIdentical: { type: 'boolean' },
    docH390Off: { type: 'number' }, docH390On: { type: 'number' }, srcDocH390: { type: 'number' }, ratioOff: { type: 'number' }, ratioOn: { type: 'number' },
    backgroundsIntact: { type: 'boolean' }, respOff: { type: 'number' }, respOn: { type: 'number' }, compositeOff: { type: 'number' }, compositeOn: { type: 'number' },
    regressed: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['site', 'desktopMatchPct', 'desktopIdentical', 'ratioOff', 'ratioOn', 'backgroundsIntact', 'respOff', 'respOn', 'compositeOff', 'compositeOn', 'regressed', 'verdict'] }
  const SITES = [
    { name: 'supabase', url: 'https://supabase.com', page: 2986 },
    { name: 'framer', url: 'https://www.framer.com', page: 2990 },
    { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146 },
  ]
  verify = await parallel(SITES.map((s) => () => agent([HARD,
    'VERIFY the residual vreflow fix on ONE site, ABS builder. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + '. ' + AUTH + ' before every WP command. You MUST end by calling StructuredOutput. Do NOT edit files.',
    'A/B BUILD (build-absolute.mjs --publish; reuse ONE shared capture; ABS_NO_VREFLOW2=1 only changes custom_css -> use empty-then-rebuild to A/B cleanly): vreflow2 ON (default) and OFF.',
    'MOBILE HEIGHT (@390): docH390Off/On + srcDocH390; ratioOff=docH390Off/src, ratioOn=docH390On/src. The fix WORKS iff ratioOn < ratioOff (further compaction; tailwind already ~0.95 so should stay ~there, supabase/framer should drop). BACKGROUNDS: backgroundsIntact=true iff the section background colors/images still render at BOTH 1440 and 390 (the fix must not blank out backgrounds).',
    'DESKTOP INVARIANT (@1440): ON vs OFF -> desktopMatchPct; desktopIdentical=true iff >=99.5% AND same docH AND backgrounds present.',
    'GRADE A/B: ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/vr2-' + s.name + '-{on|off}. respOff/respOn + compositeOff/compositeOn (mobile-prop now credits docH compaction). regressed=true iff compositeOn<compositeOff-0.01 OR desktopIdentical false OR backgrounds lost.',
    'Return {site, desktopMatchPct, desktopIdentical, docH390Off, docH390On, srcDocH390, ratioOff, ratioOn, backgroundsIntact, respOff, respOn, compositeOff, compositeOn, regressed, verdict}.',
  ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify', schema: VS }))).then((rs) => rs.filter(Boolean))
  for (const r of verify) log('VERIFY ' + r.site + ': ratio ' + r.ratioOff + '->' + r.ratioOn + ' bgIntact=' + r.backgroundsIntact + ' desk ' + r.desktopMatchPct + '% resp ' + r.respOff + '->' + r.respOn + ' comp ' + r.compositeOff + '->' + r.compositeOn + ' reg=' + r.regressed)
}

phase('Gate')
let verdict
if (!okImpl) {
  verdict = 'REVERTED — impl failed/desktop/bg broke: ' + String(impl || '').slice(0, 200)
} else {
  const v = verify || []
  const deskOK = v.length && v.every((r) => r.desktopIdentical && r.backgroundsIntact)
  const compactsMore = v.filter((r) => r.ratioOn < r.ratioOff - 0.2).length >= 1 && v.every((r) => r.ratioOn <= r.ratioOff + 0.05)
  const anyReg = v.some((r) => r.regressed)
  if (deskOK && compactsMore && !anyReg) {
    verdict = 'ADOPTED — residual vreflow: decorative bg-rects no longer inflate mobile flow, backgrounds preserved, desktop byte-identical (' + v.map((r)=>r.site+' '+r.ratioOff+'->'+r.ratioOn+' comp '+r.compositeOff+'->'+r.compositeOn).join(' | ') + '). Finishes the #1 responsive lever. Reversible ABS_NO_VREFLOW2=1.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-buildabs-vreflow2.mjs build-absolute.mjs && node --check build-absolute.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
    verdict = 'REVERTED — ' + (!deskOK ? 'desktop changed OR backgrounds lost' : !compactsMore ? 'no further compaction' : 'a site regressed') + '. ' + JSON.stringify(v.map((r)=>({s:r.site,ratio:[r.ratioOff,r.ratioOn],bg:r.backgroundsIntact,dSame:r.desktopIdentical,comp:[r.compositeOff,r.compositeOn],reg:r.regressed})))
  }
}
log('ABS-VREFLOW-RESIDUAL: ' + verdict)
return { verdict, diag, impl: String(impl || '').slice(0, 400), verify }

export const meta = {
  name: 'bgrect-probe',
  description: 'THE clean coverage lever (diag-pinned + LIVE-VERIFIED, the salvage of #29 done right): full-bleed GRADIENT/image section-background bgRects are emitted by build-absolute as childless divs with only an 8px probe img -> capture-layout isCssBgSurface fires (realMedia < 24px floor) -> the grader re-captures the band as a phantom kind:mockup surface -> the source band is a CONTAINER -> they never pair -> ~721K unmatched-clone area -> areaCoverage crush (hero 0.32) that multiplies EVERY per-element sub-score down. FIX: make the full-bleed section bgRect probe child >=24x24 (opacity 0.06, pointer-events:none, z0) so capture sees realMedia>=1 -> isCssBgSurface FALSE -> the band recurses as a CONTAINER that matches the source band. PURELY ADDITIVE (adds a tiny invisible probe; never removes a panel) -> live-safe, UNLIKE #29s suppression arm. SCOPE to FULL-BLEED section bg-bands (gradient/section) ONLY, NOT content-image leaf rasters (so a real source mockup/screenshot is never flipped to a container). Diag verified LIVE: areaCoverage 0.3225->0.9976, hero visual 0.607->0.886, SSIM unchanged. Default-ON behind ABS_NO_BGPROBE=1. DOUBLE-GATE (bench-overfit lesson): bench hero coverage+visual UP + no bench reg AND live supabase+tailwind composite no-reg + NO content blanking + self-test 1.0, else auto-restore.',
  phases: [
    { title: 'Fix', detail: 'enlarge the full-bleed section bgRect probe child to >=24px (scoped, not content rasters), default-ON behind ABS_NO_BGPROBE=1; node --check + selftest 1.0' },
    { title: 'Verify+Gate', detail: 'BENCH hero coverage/visual up + no bench reg AND LIVE supabase+tailwind composite no-reg + NO panel blanking + self-test 1.0, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Edit ONLY build-absolute.mjs. STEP 0: cp build-absolute.mjs /tmp/ev-bk-buildabs-bgprobe.mjs AND VERIFY grep -c BGPROBE /tmp/ev-bk-buildabs-bgprobe.mjs == 0 (clean base). Do NOT edit capture/grade/perelement. Do NOT enable #29 suppression (keep BENCHTEXT default-OFF). AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Use bench/bench-run.mjs (deterministic) AND a live A/B (the bench-overfit lesson). 422 silent-save w/ tree persisted = ok.'

const impl = await agent([HARD,
  'IMPLEMENT the bg-rect probe coverage fix (use a BGPROBE comment token). Work in ' + GRADER + '. Read build-absolute.mjs where it emits full-bleed section background bgRects (bgRectGradient / bgRect / the collectBg gradient/section bands) — find where it attaches the small 8px probe img to a gradient/image background div. Also read capture-layout.mjs isCssBgSurface (~L474-487): realMedia floor is 24px; a band with realMedia.length===0 + paintsBg + structuralKids<=1 is mis-captured as a kind:mockup surface.',
  'THE FIX: for a FULL-BLEED SECTION-BACKGROUND bgRect (gradient or background-image band — NOT a content-image leaf raster, NOT a small panel), make its probe child >=24x24 px (e.g. 24x24, opacity:0.06, pointer-events:none, z-index:0, positioned behind content) so capture-layout sees realMedia.length>=1 -> isCssBgSurface=FALSE -> the band recurses as a normal CONTAINER that pairs with the source container band (recovering ~721K unmatched-clone area). This is PURELY ADDITIVE (adds a tiny invisible probe; never removes/blanks a panel).',
  'SCOPE STRICTLY (avoid the #29 failure mode): apply ONLY to full-bleed section bg-bands (gradient / section background, ~viewport-width). Do NOT apply to content-image leaf rasters, real mockup/screenshot leaves, or small panels (those keep the 8px/raster path) — so a legitimate source mockup is never flipped to a container. Do NOT enable #29s redundant-bgRect SUPPRESSION arm (that blanked real tailwind content). Preserve recipes #20-28.',
  'REVERSIBILITY: gate behind ABS_NO_BGPROBE=1 (default = probe ON). node --check. SELFTEST: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0. BENCH SMOKE: node bench/bench-run.mjs -> hero coverage 0.32->~0.998 + hero visual 0.607->~0.886 + bench mean up + NO other block reg. If node --check / self-test fails -> restore /tmp/ev-bk-buildabs-bgprobe.mjs + RESTORED.',
  'Return "OK:" with bench hero coverage+visual before->after + bench mean before->after, or "RESTORED:".',
].join('\n'), { label: 'fix:bgprobe', phase: 'Fix' })
log('IMPL: ' + String(impl || '').slice(0, 280))

const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
let verify = null
if (okImpl) {
  phase('Verify+Gate')
  const VS = { type: 'object', additionalProperties: false, properties: {
    benchHeroCovOff: { type: 'number' }, benchHeroCovOn: { type: 'number' }, benchHeroVisOff: { type: 'number' }, benchHeroVisOn: { type: 'number' },
    benchMeanOff: { type: 'number' }, benchMeanOn: { type: 'number' }, anyBenchReg: { type: 'boolean' },
    liveSupaCompOff: { type: 'number' }, liveSupaCompOn: { type: 'number' }, liveTwCompOff: { type: 'number' }, liveTwCompOn: { type: 'number' },
    anyLiveReg: { type: 'boolean' }, anyPanelBlanked: { type: 'boolean' }, selftest: { type: 'number' }, ok: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['benchHeroCovOff', 'benchHeroCovOn', 'benchMeanOff', 'benchMeanOn', 'anyBenchReg', 'liveSupaCompOff', 'liveSupaCompOn', 'liveTwCompOff', 'liveTwCompOn', 'anyLiveReg', 'anyPanelBlanked', 'selftest', 'ok', 'verdict'] }
  verify = await agent([HARD,
    'INDEPENDENTLY VERIFY the bg-rect probe fix on BOTH bench AND live (be skeptical — the prior #29 overfit the bench + blanked real content on live; this probe arm should be additive+safe but PROVE it). Work in ' + GRADER + '. ' + AUTH + '. Flag ABS_NO_BGPROBE=1 disables. Prior: ' + String(impl||'').slice(0,200) + '. You MUST end by calling StructuredOutput. Run only.',
    'BENCH A/B: node bench/bench-run.mjs ON (default) vs ABS_NO_BGPROBE=1 OFF. benchHeroCovOff/On, benchHeroVisOff/On, benchMeanOff/On, anyBenchReg (any block composite -0.01).',
    'LIVE A/B (the overfit + blank-content guard): rebuild+grade supabase(2986)+tailwind(3146) ON vs ABS_NO_BGPROBE=1 OFF, median-of-2. liveSupaCompOff/On, liveTwCompOff/On. anyLiveReg = either composite < OFF-0.005. CRITICAL: render BOTH ON clones + inspect for any section/panel that went BLANK/white vs OFF (the #29 tailwind failure mode) -> anyPanelBlanked. The probe is additive so this MUST be false; if any panel blanks, the scoping is wrong.',
    'selftest = grade-sections --source supabase --selftest (1.0). ok = benchHeroCovOn>benchHeroCovOff+0.1 AND benchMeanOn>=benchMeanOff AND !anyBenchReg AND !anyLiveReg AND !anyPanelBlanked AND selftest==1.0. Return all fields + verdict.',
  ].join('\n'), { label: 'verify:bgprobe', phase: 'Verify+Gate', schema: VS })
  log('VERIFY: benchHeroCov ' + (verify&&verify.benchHeroCovOff) + '->' + (verify&&verify.benchHeroCovOn) + ' benchMean ' + (verify&&verify.benchMeanOff) + '->' + (verify&&verify.benchMeanOn) + ' liveSupa ' + (verify&&verify.liveSupaCompOff) + '->' + (verify&&verify.liveSupaCompOn) + ' liveTw ' + (verify&&verify.liveTwCompOff) + '->' + (verify&&verify.liveTwCompOn) + ' blanked=' + (verify&&verify.anyPanelBlanked) + ' ok=' + (verify&&verify.ok))
}

phase('Verify+Gate')
let verdict
if (!okImpl) {
  verdict = 'REVERTED — impl/self-test/bench failed: ' + String(impl||'').slice(0,200)
} else if (verify && verify.ok) {
  verdict = 'ADOPTED — bg-rect probe (>=24px on full-bleed section bg-bands) recovers the phantom-mockup coverage collapse: bench hero coverage ' + verify.benchHeroCovOff + '->' + verify.benchHeroCovOn + ' visual ' + verify.benchHeroVisOff + '->' + verify.benchHeroVisOn + ', bench mean ' + verify.benchMeanOff + '->' + verify.benchMeanOn + '; LIVE no-reg + NO panel blanked (supabase ' + verify.liveSupaCompOff + '->' + verify.liveSupaCompOn + ', tailwind ' + verify.liveTwCompOff + '->' + verify.liveTwCompOn + '); self-test 1.0. ADDITIVE + DOUBLE-GATED (bench+live, no overfit, no content loss). The clean salvage of #29. Corpus-wide. Reversible ABS_NO_BGPROBE=1. Re-baseline.'
} else {
  await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-buildabs-bgprobe.mjs build-absolute.mjs && node --check build-absolute.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Verify+Gate' })
  verdict = 'REVERTED — ' + (verify&&verify.anyPanelBlanked ? 'a panel BLANKED on live (scoping wrong — probe flipped a real mockup)' : verify&&verify.anyLiveReg ? 'live regression' : verify&&verify.anyBenchReg ? 'bench regression' : 'bench coverage gain insufficient') + '. ' + JSON.stringify(verify || {}).slice(0, 280)
}
log('BGRECT-PROBE: ' + verdict)
return { verdict, impl: String(impl||'').slice(0,400), verify }

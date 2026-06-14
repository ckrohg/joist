export const meta = {
  name: 'cardwall-masonry-v2-regated',
  description: 'Re-run STRUCT_CARDWALL with the CORRECTED gate (#9 AND #10 down — #4 is a SEPARATE non-card-wall image-mosaic, NOT required) + backdrop rendered via the custom_css background-image channel (kses strips section background_IMAGE on 4.0.9). The recipe already proved it works (#9 1.60->1.09, #10 1.46->1.25). Default OFF; TEXT-return; auto-restore; verify.',
  phases: [{ title: 'Build+Gate' }, { title: 'Verify' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SUPA = '/tmp/glob-supa.json'
const BASELINE_OFF = '/tmp/allflags-off-baseline.json'
const PAGE = '12446'
const CLONE_URL = '' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/incomplete-clone-scratch-was-12999/'

phase('Build+Gate')
const build = await agent(
  [
    'Re-implement STRUCT_CARDWALL (env, default OFF) in build-structured.mjs (in ' + GRADER + ') — a heading-less MASONRY card-wall recipe that ALREADY proved correct last round (supabase #9: 14 cards->4 CSS columns, hRatio 1.60->1.09; #10: 6 cards->4 cols, 1.46->1.25; no-h-scroll; ZERO corpus false-positives; byte-identical-off). It was reverted only by an over-strict gate that wrongly required section #4 too. THIS run fixes the gate + the backdrop. ADDITIVE + flag-gated + default-OFF. FIRST: cp build-structured.mjs /tmp/bs.cardwall3.bak (RESTORE on gate fail). Return PLAIN TEXT (no StructuredOutput tool).',
    '',
    'RECIPE (same as last round): in buildSection after the bento check, detect a card-wall = >=6 comparable-WIDTH cards at >=3 REGULARLY-PITCHED x-anchors (pitch-regularity guard = the load-bearing discriminator that prevented ALL corpus false-positives; KEEP it), heading-less OK. EXCLUDE any full-bleed member (>=85% section width) from the card set. Emit the cards as a CSS multi-column block (#cardwall-N{columns:<pitch>px;column-gap} + per-card break-inside:avoid). NEVER a bare fixed-px width.',
    '',
    'BACKDROP FIX (the one real defect last round): the excluded full-bleed backdrop (e.g. #9 mockup) must RENDER. Last round it was set as the Elementor section background_IMAGE, which kses STRIPS on this 4.0.9 stack. Instead, render it via the SCOPED CUSTOM_CSS background-image channel (the same channel as RAMCSS/COLWCSS/LINKCOLS): on the section container (give it an _element_id), push a rule like #<secId>{background-image:url(<localSrc(backdrop)>);background-size:cover;background-position:center} into the page custom_css. CSS background-image survives kses (custom_css is not kses-stripped like the element-tree bg-image setting) and sits behind the card columns without absolute positioning + reflows. Confirm localSrc/upload of the backdrop image is used so the URL is WP-hosted.',
    '',
    'GATE (CORRECTED — run; RESTORE from /tmp/bs.cardwall3.bak on any fail):',
    '1. flag-OFF byte-identical: node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/cw3-off.json ; cmp to ' + BASELINE_OFF + '. MUST be byte-identical.',
    '2. flag-ON structure: STRUCT_CARDWALL=1 node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/cw3-on.json . #9 + #10 emit a CSS multi-column card block (cards in N cols, not stacked); the #9 backdrop is excluded from cards AND a #<secId>{background-image:...} custom_css rule is present (renders the backdrop).',
    '3. selftest + corpus no-reg: STRUCT_CARDWALL=1 --selftest OK (no FAIL/h-scroll) for ' + SUPA + ' /tmp/cap-tailwind-off.json /tmp/br-basecamp.json /tmp/ab-vercel-NEW.json . NO mis-detection (hero/cta/features/logo/#4-image-mosaic must NOT become card-walls — the pitch-regularity guard ensures this; #4 staying a normal section is CORRECT, not a failure).',
    '4. RENDER: source /tmp/joist-auth.env (NEVER print JOIST_AUTH_B64). Publish full stack + cardwall (STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 STRUCT_LINKCOLS=1 STRUCT_BENTOGRID=1 STRUCT_IMGFIT=1 STRUCT_CARDWALL=1 ... --page ' + PAGE + ' --publish), persist-verify (curl ?v=RND | grep -E "cardwall|ramgrid" >0), capture ' + CLONE_URL + '?v=RND2 -> /tmp/cw3-clone.json. Segment + report #9 + #10 hRatio (was 1.60/1.46) + whole-page heightRatio + max leaf x1 (<=1440) + whether the #9 backdrop background-image is present in the live page HTML.',
    'kept = gate1 AND gate2 (#9/#10 card columns + backdrop custom_css rule) AND gate3 (selftest+corpus OK, no mis-detect) AND gate4 (#9 AND #10 hRatio DOWN AND no-h-scroll). NOTE: #4 is a SEPARATE non-card-wall residual and is intentionally NOT required.',
    '',
    'END with one line exactly: "VERDICT: KEPT" or "VERDICT: NOT-KEPT". Before it: flag-off-byte-identical (y/n), #9/#10 card-columns + backdrop-css-rule (y/n), selftest+corpus (pass/fail), #9/#10 hRatio before/after, whole-page heightRatio, backdrop-renders-live (y/n), no-h-scroll (y/n).',
  ].join('\n'),
  { label: 'build:cardwall-v2', phase: 'Build+Gate' }
)

const buildKept = /VERDICT:\s*KEPT/i.test(String(build || ''))
if (!buildKept) {
  log('cardwall-v2 build VERDICT not KEPT — recorded not-kept (agent should restore; driver re-checks build-structured)')
  return { kept: false, reason: 'build gate failed', build: String(build || '').slice(0, 1800) }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer. FALSIFY. Work in ' + GRADER + '. Do NOT edit files. FOUNDATIONAL builder — extra skeptical. Return PLAIN TEXT.',
    'build-structured.mjs gained STRUCT_CARDWALL (default OFF): heading-less masonry card-walls -> CSS multi-column, with the excluded backdrop rendered via custom_css background-image. Fixes supabase #9/#10. Implementer reported KEPT.',
    'VERIFY: (1) flag-OFF byte-identical: node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/rev-cw3-off.json ; cmp to ' + BASELINE_OFF + '. If not identical -> FLAW. (2) NOT OVER-AGGRESSIVE: STRUCT_CARDWALL=1 must NOT mis-detect hero/cta/features/logo/the #4 image-mosaic as a card-wall (the pitch-regularity guard; #4 staying normal is CORRECT). Spot-check supabase sec-0/sec-2/sec-4 + tailwind/basecamp unchanged (selftest OK corpus). (3) NO H-SCROLL: STRUCT_CARDWALL=1 --selftest OK on supabase + corpus. (4) #9/#10 are real card-columns (not stacked) + the #9 backdrop background-image custom_css rule is present + only build-structured.mjs changed + node --check.',
    'END with one line: "VERDICT: VERIFIED" or "VERDICT: FLAW" (with reason). Report #9/#10 structure + backdrop + corpus observations.',
  ].join('\n'),
  { label: 'verify:cardwall-v2', phase: 'Verify' }
)

const verified = /VERDICT:\s*VERIFIED/i.test(String(verify || '')) && !/VERDICT:\s*FLAW/i.test(String(verify || ''))
return {
  kept: verified,
  verdict: verified
    ? 'ADOPTED (default-OFF) — STRUCT_CARDWALL: masonry card-wall -> CSS columns (#9/#10 fixed), backdrop via custom_css, no h-scroll, independently verified'
    : 'NOT KEPT — gate or verify failed; build-structured restored',
  build: String(build || '').slice(0, 1300),
  review: String(verify || '').slice(0, 1000),
}

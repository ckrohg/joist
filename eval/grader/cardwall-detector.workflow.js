export const meta = {
  name: 'cardwall-masonry-detector',
  description: 'STRUCT_CARDWALL (default OFF): detect heading-less MASONRY card-wall sections (testimonial/tweet walls: many comparable-width cards at >=3 x-column anchors, uneven heights) that RAMGRID/BENTOGRID miss, and emit them as CSS multi-column so cards pack into N columns instead of stacking — EXCLUDING any full-bleed backdrop. Fixes supabase #4/#9/#10 (~52% of remaining overage). TEXT-return; gate byte-identical-off + target hRatios down + backdrop preserved + no-h-scroll + corpus no-reg; auto-restore; verify.',
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
    'Add STRUCT_CARDWALL (env, default OFF) to build-structured.mjs (in ' + GRADER + ') — a heading-less MASONRY card-wall recipe. ADDITIVE + flag-gated + default-OFF (byte-identical when off). FIRST: cp build-structured.mjs /tmp/bs.cardwall2.bak (RESTORE on any gate fail). Return PLAIN TEXT (no StructuredOutput tool).',
    '',
    'TARGET (diagnosed): supabase testimonial sections #4/#9/#10 (~52% of the remaining page overage) are heading-less tweet/customer-card WALLS that stack tall in flex. #9 = a 5-column masonry wall (avatar+handle+variable-height tweet cards at x-anchors 46/366/686/1006/1326, ~254px wide, UNEVEN heights) PLUS a full-bleed mockup backdrop (1400x524 ~ its band). #10 = a 4-col continuation. #4 = 4 mockup customer-story cards. RAMGRID misses them (wants comparable-HEIGHT cells), BENTOGRID misses them (needs >=4 HEADINGS).',
    '',
    'THE RECIPE (STRUCT_CARDWALL=1), in buildSection before the normal path (and after the bento check):',
    '1. DETECT a card-wall: cluster the section members into CARDS (group members by x-column-anchor + proximity). Qualify iff there are >=6 cards at >=3 distinct x-column-anchors of COMPARABLE WIDTH (within ~30%), heading-less or heading-light (do NOT require headings). EXCLUDE from the card set any FULL-BLEED member (width >= 85% of section width — e.g. #9 backdrop mockup): that backdrop is the section background, NOT a card; keep it as a background/first child, do not grid it.',
    '2. EMIT the cards as a CSS MULTI-COLUMN block (columns:<cardPitch>px; column-gap; break-inside:avoid per card) via the existing scoped custom_css channel (like LINKCOLS) — CSS columns flow uneven-height (masonry) cards into N columns far better than a fixed grid. cardPitch from the x-anchor pitch (~254 for #9). NEVER a bare fixed-px width -> no h-scroll. Place the excluded backdrop as a full-width background behind/above the columns as appropriate.',
    '',
    'GATE (run; RESTORE from /tmp/bs.cardwall2.bak on any fail):',
    '1. flag-OFF byte-identical: node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/cardwall-off.json ; cmp to ' + BASELINE_OFF + '. MUST be byte-identical.',
    '2. flag-ON structure: STRUCT_CARDWALL=1 node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/cardwall-on.json . Confirm sections #9/#10 (and #4 if it qualifies) now emit a CSS multi-column card block (cards in N columns, NOT stacked) AND the #9 full-bleed backdrop is PRESERVED (not turned into a column).',
    '3. selftest + corpus no-reg: STRUCT_CARDWALL=1 --selftest OK (no FAIL/h-scroll) for ' + SUPA + ' /tmp/cap-tailwind-off.json /tmp/br-basecamp.json /tmp/ab-vercel-NEW.json . A normal section (hero/cta/features) must NOT be mis-detected as a card-wall.',
    '4. RENDER: source /tmp/joist-auth.env (NEVER print JOIST_AUTH_B64). Publish full stack + cardwall (STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 STRUCT_LINKCOLS=1 STRUCT_BENTOGRID=1 STRUCT_IMGFIT=1 STRUCT_CARDWALL=1 ... --page ' + PAGE + ' --publish), persist-verify (curl ?v=RND | grep -E "ramgrid|cardwall" >0), capture ' + CLONE_URL + '?v=RND2 -> /tmp/cardwall-clone.json. Segment + report #9/#10/#4 hRatio (was ~1.5/1.46/1.49) + whole-page heightRatio + max leaf x1 (<=1440).',
    'kept = gate1 AND gate2 (#9/#10 = card columns, backdrop preserved) AND gate3 (selftest+corpus OK, no mis-detect) AND gate4 (#9/#10/#4 hRatio DOWN AND no-h-scroll).',
    '',
    'END with one line exactly: "VERDICT: KEPT" or "VERDICT: NOT-KEPT". Before it: flag-off-byte-identical (y/n), #9/#10 card-column structure + backdrop-preserved (y/n), selftest+corpus (pass/fail), #9/#10/#4 hRatio before/after, whole-page heightRatio, no-h-scroll (y/n).',
  ].join('\n'),
  { label: 'build:cardwall', phase: 'Build+Gate' }
)

const buildKept = /VERDICT:\s*KEPT/i.test(String(build || ''))
if (!buildKept) {
  log('cardwall build VERDICT not KEPT — recorded not-kept (agent should restore; driver re-checks build-structured)')
  return { kept: false, reason: 'build gate failed', build: String(build || '').slice(0, 1800) }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer. FALSIFY. Work in ' + GRADER + '. Do NOT edit files. FOUNDATIONAL builder — extra skeptical. Return PLAIN TEXT.',
    'build-structured.mjs gained STRUCT_CARDWALL (default OFF): heading-less masonry card-walls -> CSS multi-column (fixes supabase testimonial #4/#9/#10 stacking). Implementer reported KEPT (#9/#10 now card columns + backdrop preserved, hRatios down, byte-identical off, corpus OK).',
    'VERIFY: (1) flag-OFF byte-identical: node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/rev-cardwall-off.json ; cmp to ' + BASELINE_OFF + '. If not identical -> FLAW. (2) NOT OVER-AGGRESSIVE: STRUCT_CARDWALL=1 must NOT mis-detect a hero/cta/feature/logo section as a card-wall + must NOT grid the #9 full-bleed backdrop. Spot-check supabase sec-0/sec-2 + a tailwind/basecamp section unchanged/sane (selftest OK corpus). If it mis-fires -> FLAW. (3) NO H-SCROLL: STRUCT_CARDWALL=1 --selftest OK on supabase + corpus. (4) the #9/#10 card-column structure is real (cards in N columns, not stacked) + backdrop preserved + only build-structured.mjs changed + node --check.',
    'END with one line: "VERDICT: VERIFIED" or "VERDICT: FLAW" (with reason). Report what you observed for #9/#10 + the corpus.',
  ].join('\n'),
  { label: 'verify:cardwall', phase: 'Verify' }
)

const verified = /VERDICT:\s*VERIFIED/i.test(String(verify || '')) && !/VERDICT:\s*FLAW/i.test(String(verify || ''))
return {
  kept: verified,
  verdict: verified
    ? 'ADOPTED (default-OFF) — STRUCT_CARDWALL: heading-less masonry card-wall -> CSS columns, fixes supabase testimonial stacking, backdrop preserved, no h-scroll, independently verified'
    : 'NOT KEPT — gate or verify failed; build-structured restored',
  build: String(build || '').slice(0, 1300),
  review: String(verify || '').slice(0, 1000),
}

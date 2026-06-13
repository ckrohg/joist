export const meta = {
  name: 'bento-tilegrid-recipe',
  description: 'STRUCT_BENTOGRID (default OFF): detect a tile-bento (>=4 heading-led tiles on N column-anchors x M row-anchors) + group members into tiles + emit a CSS GRID (reuse the kses-safe RAM-grid channel) so tiles pack side-by-side (recovers ~855px vs ~2800px stacked) — no absolute, no h-scroll. Fixes the dominant residual (supabase #2 hRatio 3.08). TEXT-return; gate byte-identical-off + #2 grids-as-tiles + height-down + no-h-scroll + corpus no-reg; auto-restore; verify.',
  phases: [{ title: 'Build+Gate' }, { title: 'Verify' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SUPA = '/tmp/glob-supa.json'
const BASELINE_OFF = '/tmp/colwidth-baseline.json'   // all-recipe-flags-OFF supabase dry dump (sha 11e8aba2)
const PAGE = '12446'                                  // scratch (NOT 12157 — keep the user's good page)
const CLONE_URL = 'https://georges232.sg-host.com/incomplete-clone-scratch-was-12999/'

phase('Build+Gate')
const build = await agent(
  [
    'Add STRUCT_BENTOGRID (env, default OFF) to build-structured.mjs (in ' + GRADER + ') — a TILE-BENTO recipe that fixes the dominant clone residual: dense feature-bento sections stack tall in flex (supabase #2: 3.08x, +2182px = 42% of page overage). DIAGNOSED REGULAR: #2 is a 4-col x 2-row tile grid (heading-x column anchors 211/494/777/1060 @283px pitch; heading-y row anchors 832/1241; one col-span-2 Postgres tile; members snap within 13px; NO cross-tile overlap). The 3x is side-by-side-vs-stack ONLY -> a CSS grid placing the 7 tiles in 2 rows recovers ~855px. build-structured is FOUNDATIONAL: additive + flag-gated + default-OFF (byte-identical when off). FIRST: cp build-structured.mjs /tmp/bs.bento2.bak (RESTORE on any gate fail). Return PLAIN TEXT (no StructuredOutput tool).',
    '',
    'THE RECIPE (STRUCT_BENTOGRID=1), in buildSection BEFORE the normal clusterRows/rowColumns path:',
    '1. DETECT a tile-bento: gather the section heading members (kind heading / large text). Snap their X to column-anchors (cluster heading-x, tol ~28px) -> N columns; snap their Y to row-anchors (cluster heading-y, tol ~28px) -> M rows. Qualify as a tile-bento iff N>=2 AND M>=2 AND headings>=4 (a real tile grid, e.g. supabase #2 N=4 M=2). A single-row feature row (M=1) is the existing RAM-grid case — do NOT hijack it. A hero/cta (no tile grid) must NOT qualify.',
    '2. GROUP members into TILES: for each heading, its tile = that heading + the non-heading members (text/image/mockup/svg/list) whose centers are nearest THIS heading among all headings (assign each non-heading member to its nearest heading by center distance, biased to same-column). Each tile = a vertical stack (heading, text, image) in a column container.',
    '3. EMIT a CSS GRID over the tiles (REUSE the existing RAM-grid kses-safe channel: container_type:grid + grid_columns_grid custom unit + the scoped #ramgrid-N display:grid custom_css; you have that machinery). grid-template-columns = repeat(N, minmax(0,1fr)) (or the auto-fit minmax(min(<colpitch>px,100%),1fr) so it reflows N->1 on narrow). Place tiles in DOM order (grid auto-flow row places them across N columns, M rows). Handle the col-span-2 tile: if a heading-tile spans ~2 column pitches (its width ~2x the others, e.g. Postgres), give it grid-column:span 2. The tiles now sit 2 rows x 3-4 cols instead of 7 stacked -> recovers the height. NO position:absolute, NO bare fixed-px width (use the grid track + min(...,100%) so no h-scroll).',
    '',
    'GATE (run + report; RESTORE from /tmp/bs.bento2.bak on any fail):',
    '1. flag-OFF byte-identical: node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/bento-off.json ; cmp to ' + BASELINE_OFF + '. MUST be byte-identical.',
    '2. flag-ON structure: STRUCT_BENTOGRID=1 (+ the other recipes off for isolation) node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/bento-on.json . Confirm section sec-2 now emits a CSS GRID whose grid children are the ~7 TILES placed across ~4 columns (NOT 7 stacked rows). Report the sec-2 grid column count + tile/child count.',
    '3. selftest + corpus no-regression: STRUCT_BENTOGRID=1 node build-structured.mjs --layout <f> --selftest prints OK (no FAIL / no h-scroll) for f in ' + SUPA + ' /tmp/cap-tailwind-off.json /tmp/br-basecamp.json /tmp/ab-vercel-NEW.json . A hero/cta/single-row-feature must NOT be wrongly converted (spot-check supabase hero sec-0 is unchanged).',
    '4. RENDER height: source /tmp/joist-auth.env (NEVER print JOIST_AUTH_B64). Publish full stack + bentogrid (STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 STRUCT_LINKCOLS=1 STRUCT_BENTOGRID=1 ... --page ' + PAGE + ' --publish), capture ' + CLONE_URL + '?v=RANDOM -> /tmp/bento-clone.json (CONFIRM the capture is fresh: it should contain the bento grid; if leaves look stale, re-capture). Segment + report section #2 hRatio (was 3.08; target < 2.0, ideally ~1.0-1.3) + whole-page heightRatio + max leaf x1 (<=1440 no-h-scroll).',
    'kept = gate1 (byte-identical-off) AND gate2 (sec-2 = tile grid, ~4 cols, tiles not stacked) AND gate3 (selftest+corpus OK, hero unchanged) AND gate4 (sec-2 hRatio < 2.0 AND no h-scroll).',
    '',
    'END with one line exactly: "VERDICT: KEPT" or "VERDICT: NOT-KEPT". Before it: flag-off-byte-identical (yes/no), sec-2 grid cols + tile count, selftest (pass/fail) + corpus (pass/fail), sec-2 hRatio before(3.08)/after, no-h-scroll (yes/no).',
  ].join('\n'),
  { label: 'build:bento-tilegrid', phase: 'Build+Gate' }
)

const buildKept = /VERDICT:\s*KEPT/i.test(String(build || ''))
if (!buildKept) {
  log('bento-tilegrid build VERDICT not KEPT — recorded not-kept (agent should restore; driver re-checks build-structured)')
  return { kept: false, reason: 'build gate failed', build: String(build || '').slice(0, 1600) }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer, no stake. FALSIFY. Work in ' + GRADER + '. Do NOT edit files. FOUNDATIONAL builder file — extra skeptical. Return PLAIN TEXT.',
    'build-structured.mjs gained STRUCT_BENTOGRID (default OFF): groups a tile-bento section into tiles + emits a CSS grid so tiles pack side-by-side (fixes supabase #2 3.08x stretch). Implementer reported KEPT (sec-2 now a ~4-col tile grid, hRatio dropped <2.0, byte-identical off, corpus OK).',
    'VERIFY: (1) flag-OFF byte-identical: node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/rev-bento-off.json ; cmp to ' + BASELINE_OFF + '. If not identical -> FLAW. (2) NOT OVER-AGGRESSIVE: STRUCT_BENTOGRID=1 must NOT convert a hero/cta/single-row-feature into a bogus tile grid — spot-check supabase sec-0 (hero) + a tailwind/basecamp section are unchanged/sane (selftest OK on all corpus). If it mis-fires on non-bento sections -> FLAW. (3) NO H-SCROLL: STRUCT_BENTOGRID=1 --selftest prints OK (no bare fixed-px) on supabase + corpus. (4) the sec-2 tile grid is REAL (a grid with the ~7 tiles across ~4 columns, not 7 stacked) and only build-structured.mjs changed + node --check passes.',
    'END with one line exactly: "VERDICT: VERIFIED" or "VERDICT: FLAW" (with reason). Report what you observed for sec-2 + the corpus selftests.',
  ].join('\n'),
  { label: 'verify:bento-tilegrid', phase: 'Verify' }
)

const verified = /VERDICT:\s*VERIFIED/i.test(String(verify || '')) && !/VERDICT:\s*FLAW/i.test(String(verify || ''))
return {
  kept: verified,
  verdict: verified
    ? 'ADOPTED (default-OFF) — STRUCT_BENTOGRID: tile-bento -> CSS grid, fixes the dominant supabase #2 stretch, no h-scroll, independently verified'
    : 'NOT KEPT — gate or verify failed; build-structured restored',
  build: String(build || '').slice(0, 1200),
  review: String(verify || '').slice(0, 1000),
}

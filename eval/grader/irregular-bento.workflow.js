export const meta = {
  name: 'irregular-bento-cssgrid',
  description: 'Tackle IRREGULAR bento/overlap (supabase #4 image-mosaic, gcv 0.47, +292px — the largest remaining supabase residual) WITHIN the no-h-scroll veto: diagnose overlap-necessity, then pack it via CSS GRID (explicit grid-area spans for irregular-non-overlap; same-cell + z-index for true overlap) — NEVER absolute positioning. STRUCT_IRREGBENTO default-OFF. Gate byte-identical-off + #4 improves + NO h-scroll + corpus no-reg; auto-restore; verify. If genuinely impossible without absolute/h-scroll, report that (respect the veto). TEXT-return.',
  phases: [{ title: 'Diagnose+Build+Gate' }, { title: 'Verify' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SUPA = '/tmp/glob-supa.json'
const BASELINE_OFF = '/tmp/allflags-off-baseline.json'  // legacy/all-off baseline (STRUCT_LEGACY=1 target)
const PAGE = '12446'
const CLONE_URL = 'https://georges232.sg-host.com/incomplete-clone-scratch-was-12999/'

phase('Diagnose+Build+Gate')
const build = await agent(
  [
    'Tackle IRREGULAR bento — the genuinely-irregular image-mosaic sections that the regular tile-bento recipe (BENTOGRID, pitch-CV guard gcv<=0.25) does NOT handle. Target: supabase section #4 (gcv 0.47, +292px, ratio 1.31 — the LARGEST remaining supabase residual; a designed customer-stories image-mosaic). HARD CONSTRAINT (user veto): NO horizontal scroll, NO absolute positioning (absolute would reintroduce the h-scroll the user explicitly vetoed). Work in ' + GRADER + '. Return PLAIN TEXT (no StructuredOutput tool). FIRST: cp build-structured.mjs /tmp/bs.irreg.bak (RESTORE on gate fail).',
    '',
    'STEP A — DIAGNOSE #4 (segment ' + SUPA + ', section idx 4; inspect member boxes):',
    '  - Is it TRUE OVERLAP (member boxes intersect in BOTH x and y — needs layering) or IRREGULAR-NON-OVERLAP (no intersection, just uneven/varying cell sizes + spans on a coarse grid)? Quantify member-pair area-intersections.',
    '  - Can a COARSE grid (snap member x-edges + y-edges to a small set of lines, tol ~24px) represent it with per-member grid-area spans (col-span/row-span)? How many column-lines + row-lines? What is the packed height vs the current stacked height?',
    '',
    'STEP B — BUILD STRUCT_IRREGBENTO (default OFF) IF tractable within the veto:',
    '  - For an irregular-bento section, derive a CSS GRID template (grid-template-columns/rows from the snapped line set) + place each member into its grid-area (grid-column/grid-row span from its box). For TRUE-OVERLAP members, place them in the SAME grid cell with z-index (CSS grid allows overlapping items in one cell — reflows, no absolute, no h-scroll). For irregular-non-overlap, explicit spans. Reuse the kses-safe scoped custom_css grid channel. NEVER position:absolute, NEVER a bare fixed-px width (use minmax/fr tracks + min(...,100%) so no h-scroll).',
    '  - DETECTION must be conservative: only fire on a real irregular image-mosaic (>=4 media members, multi-row, that BENTOGRID/CARDWALL did NOT claim); a hero/cta/normal-grid must NOT trigger.',
    '  - IF the diagnosis shows #4 GENUINELY requires absolute/pixel overlap that a reflowing CSS grid cannot approximate (true free-form overlap with no snappable grid), DO NOT build an h-scroll/absolute version — report kept=false + "needs reflow-vs-positional (veto-limited)" + restore. That is a valid, veto-respecting outcome.',
    '',
    'GATE (RESTORE on any fail):',
    '1. flag-OFF byte-identical: node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/irreg-off.json with STRUCT_IRREGBENTO disabled (it is default-off; but ALSO confirm STRUCT_LEGACY=1 dump == ' + BASELINE_OFF + ' byte-identical, i.e. the new recipe is under the legacy revert too).',
    '2. flag-ON #4 packed: STRUCT_IRREGBENTO=1 node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/irreg-on.json -> section #4 emits a CSS grid packing its members (NOT a tall stack). RENDER: source /tmp/joist-auth.env (NEVER print JOIST_AUTH_B64); publish full stack + STRUCT_IRREGBENTO=1 to page ' + PAGE + '; persist-verify (curl grep grid>0); capture ' + CLONE_URL + '?v=RND -> /tmp/irreg-clone.json; report #4 hRatio (was 1.31, target lower) + whole-page heightRatio + max leaf x1 (<=1440 NO h-scroll).',
    '3. selftest + corpus no-reg: STRUCT_IRREGBENTO=1 --selftest OK (no FAIL/h-scroll) for ' + SUPA + ' /tmp/cap-tailwind-off.json /tmp/br-basecamp.json /tmp/ab-vercel-NEW.json ; no mis-detect (hero/cta/normal sections unchanged).',
    'kept = gate1 AND gate2 (#4 packs, hRatio down, NO h-scroll) AND gate3 (corpus OK, no mis-detect). NO h-scroll is NON-NEGOTIABLE (max leaf x1 must stay <=1440).',
    '',
    'END with one line exactly: "VERDICT: KEPT" or "VERDICT: NOT-KEPT". Before it: the #4 overlap diagnosis (true-overlap / irregular-non-overlap / free-form-needs-absolute), flag-off/legacy byte-identical (y/n), #4 hRatio before(1.31)/after, max leaf x1 (no-h-scroll y/n), corpus (pass/fail). If NOT-KEPT, whether it is veto-limited (needs absolute) or a fixable gate issue.',
  ].join('\n'),
  { label: 'build:irreg-bento', phase: 'Diagnose+Build+Gate' }
)

const buildKept = /VERDICT:\s*KEPT/i.test(String(build || ''))
if (!buildKept) {
  log('irregular-bento NOT-KEPT (likely veto-limited: #4 needs absolute/overlap a reflowing grid cannot do) — recorded; agent should restore')
  return { kept: false, reason: 'veto-limited (needs absolute) or gate fail', build: String(build || '').slice(0, 1800) }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer. FALSIFY. Work in ' + GRADER + '. Do NOT edit files. The NON-NEGOTIABLE constraint is NO HORIZONTAL SCROLL + NO absolute positioning. Return PLAIN TEXT.',
    'build-structured.mjs gained STRUCT_IRREGBENTO (default OFF): packs irregular image-mosaic sections via CSS grid (spans / same-cell z-index), no absolute. Fixes supabase #4. Implementer reported KEPT.',
    'VERIFY: (1) flag-OFF byte-identical: node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/rev-irreg-off.json ; cmp to ' + BASELINE_OFF + ' (with STRUCT_LEGACY=1). If not identical -> FLAW. (2) NO H-SCROLL + NO ABSOLUTE (critical): STRUCT_IRREGBENTO=1 --selftest OK (the selftest checks no bare fixed-px / no position:absolute) on supabase + corpus; grep the new code for "position" / "absolute" — there must be NONE. If it introduces absolute or any h-scroll -> FLAW (violates the user veto). (3) NOT OVER-AGGRESSIVE: hero/cta/normal-grid sections not mis-detected. (4) #4 actually packs (grid, not stack) + only build-structured.mjs changed + node --check.',
    'END with one line: "VERDICT: VERIFIED" or "VERDICT: FLAW" (reason). Report #4 structure + the no-absolute/no-h-scroll check.',
  ].join('\n'),
  { label: 'verify:irreg-bento', phase: 'Verify' }
)

const verified = /VERDICT:\s*VERIFIED/i.test(String(verify || '')) && !/VERDICT:\s*FLAW/i.test(String(verify || ''))
return {
  kept: verified,
  verdict: verified
    ? 'ADOPTED (default-OFF) — STRUCT_IRREGBENTO: irregular image-mosaic packed via CSS grid (no absolute, no h-scroll), #4 improved, independently verified'
    : 'NOT KEPT — gate/verify failed OR #4 is veto-limited (genuinely needs absolute/h-scroll, which the user vetoed); build-structured restored',
  build: String(build || '').slice(0, 1500),
  review: String(verify || '').slice(0, 1000),
}

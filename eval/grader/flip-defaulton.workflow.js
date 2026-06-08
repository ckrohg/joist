export const meta = {
  name: 'flip-recipes-default-on',
  description: 'SHIP the near-1:1 gains: flip all 8 recipes DEFAULT-ON (6 build in build-structured.mjs + 2 capture in capture-layout.mjs), with per-recipe revert flags + a global STRUCT_LEGACY / CAPTURE_LEGACY full-revert. Gate: legacy-revert byte-identical to the OLD default + new-default == all-recipes-on + corpus no-regression + no-h-scroll. Backup + auto-restore + independent verify. TEXT-return.',
  phases: [{ title: 'Build+Gate' }, { title: 'Verify' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SUPA = '/tmp/glob-supa.json'
const OLD_DEFAULT = '/tmp/allflags-off-baseline.json'   // pre-flip default (all recipes off), the legacy-revert target

phase('Build+Gate')
const build = await agent(
  [
    'SHIP the validated near-1:1 clone gains by flipping all 8 recipes DEFAULT-ON, with clean reversibility. The user approved this. Work in ' + GRADER + '. Two files: build-structured.mjs (6 build recipes) + capture-layout.mjs (2 capture recipes). FIRST back up BOTH: cp build-structured.mjs /tmp/bs.flip2.bak ; cp capture-layout.mjs /tmp/cl.flip2.bak (RESTORE both on any gate fail). Return PLAIN TEXT (no StructuredOutput tool).',
    '',
    'THE FLIP — for each recipe flag, change the default from OFF to ON with a NEGATED revert env, AND add a global LEGACY revert:',
    '  build-structured.mjs (6): STRUCT_GRIDFIX, STRUCT_COLWIDTH, STRUCT_LINKCOLS, STRUCT_BENTOGRID, STRUCT_IMGFIT, STRUCT_CARDWALL.',
    '    OLD: const X = process.env.STRUCT_X === "1"   (default OFF)',
    '    NEW: const X = process.env.STRUCT_LEGACY !== "1" && process.env.STRUCT_NO_<NAME> !== "1"   (default ON; off if STRUCT_LEGACY=1 OR its own STRUCT_NO_<NAME>=1). Use the existing per-recipe revert names where they already exist (e.g. STRUCT_NO_RAMGRID, STRUCT_NO_TABLE, STRUCT_NO_HYGIENE already exist — keep those working); for the new recipes add STRUCT_NO_GRIDFIX/COLWIDTH/LINKCOLS/BENTOGRID/IMGFIT/CARDWALL.',
    '  capture-layout.mjs (2): CAPTURE_BANDBG, CAPTURE_COLORSCHEME -> default ON unless CAPTURE_LEGACY=1 or CAPTURE_NO_BANDBG / CAPTURE_NO_COLORSCHEME =1.',
    '  Keep each recipe internal logic UNCHANGED — only the default of the gating boolean flips.',
    '',
    'GATE (run; RESTORE BOTH backups on any fail):',
    '1. LEGACY-REVERT BYTE-IDENTICAL (reversibility, load-bearing): STRUCT_LEGACY=1 node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/flip-legacy.json ; cmp to ' + OLD_DEFAULT + '. MUST be byte-identical (proves the full revert reproduces the exact pre-flip default).',
    '2. NEW DEFAULT == ALL-RECIPES-ON: node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/flip-newdefault.json (NO flags). It MUST equal the explicit all-on build: STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 STRUCT_LINKCOLS=1 STRUCT_BENTOGRID=1 STRUCT_IMGFIT=1 STRUCT_CARDWALL=1 node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/flip-allon.json -> cmp /tmp/flip-newdefault.json /tmp/flip-allon.json byte-identical. (Proves the new default = the validated near-1:1 build; confirm it carries ramgrid+colw+linkcols+bento markers + imgfit/cardwall logic.)',
    '3. CORPUS NO-REGRESSION (new default): node build-structured.mjs --layout <f> --selftest (NO flags) prints OK (no FAIL / no h-scroll) for ' + SUPA + ' /tmp/cap-tailwind-off.json /tmp/br-basecamp.json /tmp/ab-vercel-NEW.json /tmp/br-overreacted.json .',
    '4. capture-layout: node --check capture-layout.mjs passes; with CAPTURE_LEGACY=1 the band-bg / colorscheme code paths are inert (legacy capture). With the new default ON, capture-layout still node --checks + (sanity) capturing the canonical fixture flow is unbroken (you may skip a live capture; the key is node --check + the flags default ON + CAPTURE_LEGACY reverts).',
    'kept = gate1 (legacy byte-identical) AND gate2 (new default == all-on) AND gate3 (corpus OK) AND gate4 (capture-layout valid + legacy-revertible).',
    '',
    'END with one line exactly: "VERDICT: KEPT" or "VERDICT: NOT-KEPT". Before it: legacy-byte-identical (y/n), new-default==all-on (y/n), corpus selftest (pass/fail per site), capture-layout node --check + CAPTURE_LEGACY revert (y/n).',
  ].join('\n'),
  { label: 'build:flip-on', phase: 'Build+Gate' }
)

const buildKept = /VERDICT:\s*KEPT/i.test(String(build || ''))
if (!buildKept) {
  log('flip build VERDICT not KEPT — recorded not-kept (agent should restore both; driver re-checks)')
  return { kept: false, reason: 'gate failed', build: String(build || '').slice(0, 1800) }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer. FALSIFY. Work in ' + GRADER + '. Do NOT edit files. This flips the DEFAULT behavior of the whole clone engine — be extra skeptical about REVERSIBILITY. Return PLAIN TEXT.',
    'build-structured.mjs (6 recipes) + capture-layout.mjs (2 recipes) were flipped DEFAULT-ON, with per-recipe revert flags + global STRUCT_LEGACY / CAPTURE_LEGACY. Implementer reported KEPT.',
    'VERIFY: (1) LEGACY-REVERT BYTE-IDENTICAL (the load-bearing reversibility claim): STRUCT_LEGACY=1 node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/rev-flip-legacy.json ; cmp to ' + OLD_DEFAULT + '. If NOT byte-identical -> FLAW (the revert does not reproduce the old default). (2) NEW DEFAULT == ALL-ON: confirm the no-flags dump equals the explicit all-recipes-on dump (cmp). If they differ -> FLAW (a recipe is not actually default-on). (3) CORPUS: new-default --selftest OK (no h-scroll) on supabase + tailwind + basecamp + vercel + overreacted. (4) node --check BOTH files; only those 2 files changed. (5) Spot-check the diff: ONLY the gating-boolean defaults changed, no recipe internal logic altered.',
    'END with one line: "VERDICT: VERIFIED" or "VERDICT: FLAW" (with reason). Report the two cmp results + the corpus selftests.',
  ].join('\n'),
  { label: 'verify:flip-on', phase: 'Verify' }
)

const verified = /VERDICT:\s*VERIFIED/i.test(String(verify || '')) && !/VERDICT:\s*FLAW/i.test(String(verify || ''))
return {
  kept: verified,
  verdict: verified
    ? 'ADOPTED — 8 recipes flipped DEFAULT-ON, legacy-revert byte-identical, new-default==all-on, corpus no-regression, independently verified. The near-1:1 gains are now the LIVE DEFAULT.'
    : 'NOT KEPT — gate or verify failed; both files restored',
  build: String(build || '').slice(0, 1400),
  review: String(verify || '').slice(0, 1000),
}

export const meta = {
  name: 'per-section-grade-vs-spec',
  description: 'Build grade-spec.mjs (per-section fidelity attribution via the section-spec layer), self-test for honesty + anti-gaming, then codex cross-model verify',
  phases: [
    { title: 'Build', detail: 'create grade-spec.mjs + self-test (src-vs-src approx 1.0/section, incomplete-clone low)' },
    { title: 'Verify', detail: 'codex adversarial honesty verification' },
  ],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SRC = '/tmp/pe-layout-gsec-supabasecom-mq2hv9sv-src.json'              // supabase.com source box-tree (206 leaves)
const INCOMPLETE = '/tmp/pe-layout-gsec-supabasecom-mq2hv9sv-clone.json'    // incomplete clone (57 leaves) - anti-gaming control
const GOODCLONE_URL = 'https://georges232.sg-host.com/structured-supabase/' // the production good clone (page 12157)

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    created: { type: 'boolean', description: 'grade-spec.mjs created' },
    selftestSrcVsSrc: { type: 'number', description: 'per-section mean grading source against itself (must be ~1.0)' },
    selftestIncomplete: { type: 'number', description: 'per-section mean grading the incomplete clone (must be clearly lower, anti-gaming)' },
    selftestPass: { type: 'boolean', description: 'true iff srcVsSrc>=0.95 AND incomplete<srcVsSrc-0.25 (anti-gaming holds)' },
    goodCloneCaptured: { type: 'boolean' },
    perSection: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { idx: { type: 'number' }, role: { type: 'string' }, coverage: { type: 'number' } } }, description: 'per-section attribution for the GOOD clone (or incomplete if capture failed)' },
    weakest: { type: 'array', items: { type: 'number' }, description: 'section indices with the lowest coverage (the refine targets)' },
    summary: { type: 'string' },
  },
  required: ['created', 'selftestPass', 'summary'],
}

phase('Build')
const build = await agent(
  [
    'Build a NEW per-section fidelity grader for an Elementor website-cloning pipeline. Work ONLY in ' + GRADER + '. This is a SUPERVISED grader build - it must be ADDITIVE (a new file grade-spec.mjs; do NOT edit grade-sections.mjs / perelement-score.mjs / capture-layout.mjs / segment.mjs / build-structured.mjs / section-spec.mjs) and HONEST (never fake-grade).',
    '',
    'WHY: the live whole-page grader gives ONE opaque composite (supabase good clone = 0.575, area-coverage 0.328). That single number is a BLUR - it hides WHICH sections are under-covered. We just built section-spec.mjs (exports buildSpec(seg,L); segment.mjs exports segment(L)), which partitions a page into semantic sections. The job: attribute coverage PER SECTION so refine can target the real misses.',
    '',
    'INPUTS (box-tree captures shaped {url,pageH,vw,root,fonts}; a node with kind!=="container" and a box is a leaf; gather leaves recursively; leaf = {kind,tag,text,box:{x,y,w,h},paint,typo,...}):',
    '- SOURCE: ' + SRC + '  (supabase.com, pageH 7578, 206 leaves)',
    '- INCOMPLETE CLONE (anti-gaming control): ' + INCOMPLETE + '  (57 leaves, ~23% present)',
    '- GOOD CLONE is live at ' + GOODCLONE_URL + ' (page 12157). BEST-EFFORT capture it fresh: read capture-layout.mjs CLI usage (head of the file) and run it to /tmp/gradespec-goodclone.json. If capture fails (network/headless), set goodCloneCaptured=false and report perSection on the INCOMPLETE clone instead - the deliverable stands either way.',
    '',
    'DESIGN of grade-spec.mjs (CLI: node grade-spec.mjs --src <srcCapture> --clone <cloneCapture> [--summary] ; and node grade-spec.mjs --selftest):',
    '1. segment(srcCapture) then buildSpec(seg, srcCapture) to get the SECTION SPEC (sections[] each with bbox{y..} + role).',
    '2. Compute a single y-scale S = clone.pageH / src.pageH (the clone may be a different height). Map a src-y to clone-y via *S.',
    '3. For EACH spec section band [y0,y1] (src coords):',
    '   - srcLeaves = source leaves whose vertical center is in [y0,y1].',
    '   - For each srcLeaf, MATCH = is there an UNUSED clone leaf whose center is near the SCALED src position (tolerance ~8% of vw in x, ~6% of clone band height in y) AND same kind-class (text/heading grouped as text-ish; image/svg/mockup grouped as media) AND for text shares >=1 significant token OR box-area within 2x? Each clone leaf may be consumed by AT MOST ONE src leaf (no double-count inflation).',
    '   - section coverage = (sum of matched srcLeaf box-area) / (sum of all srcLeaf box-area in band), clamped 0..1; guard divide-by-zero (empty band coverage = 1 with a flag, or skip).',
    '   - also report matched/total + textCoverage (fraction of src text chars matched).',
    '4. Output per-section {idx, role, coverage, textCoverage, matched, total} + overall mean + WEAKEST 3 section indices.',
    '',
    'SELFTEST (node grade-spec.mjs --selftest) - MANDATORY, must print PASS/FAIL + set exit code:',
    '- srcVsSrc: grade ' + SRC + ' against ITSELF (clone==src, S=1.0) -> EVERY section coverage must be ~1.0 (mean >=0.95). If not, the matcher is broken - fix it.',
    '- incomplete: grade ' + SRC + ' against ' + INCOMPLETE + ' -> mean coverage must be CLEARLY LOWER (a clone missing ~77% cannot score high). Require incomplete_mean < srcVsSrc_mean - 0.25.',
    '- PASS iff both hold. This proves honesty BY CONSTRUCTION (perfect on identity, low on incomplete).',
    '',
    'After building + self-testing, run it on the GOOD clone (or incomplete if capture failed) and report the per-section attribution. Add a @purpose header comment. Report via the structured schema. Be truthful - if the self-test fails, report selftestPass=false and say why.',
  ].join('\n'),
  { schema: BUILD_SCHEMA, label: 'build:grade-spec', phase: 'Build' }
)

if (!build || !build.created || !build.selftestPass) {
  log('build did not pass self-test (created=' + (build && build.created) + ', selftestPass=' + (build && build.selftestPass) + ') - NOT verifying; recorded as not-kept')
  return { kept: false, reason: 'self-test failed or not created', build }
}

phase('Verify')
const verify = await agent(
  [
    'INDEPENDENT CROSS-MODEL ADVERSARIAL VERIFICATION. You are a skeptical reviewer with NO stake in the implementer being right - try to FALSIFY. Work in ' + GRADER + '.',
    '',
    'A new per-section fidelity grader grade-spec.mjs was just built. Claims: it attributes clone-vs-source coverage PER SECTION (using segment.mjs + section-spec.mjs buildSpec), and its self-test proves honesty: grading source-against-itself yields ~1.0 per section (reported ' + build.selftestSrcVsSrc + '), while grading an incomplete clone (~23% present) yields a clearly lower mean (reported ' + build.selftestIncomplete + '), so it cannot be gamed by an empty/incomplete clone.',
    '',
    'VERIFY (try to break each):',
    '1. RUN: node grade-spec.mjs --selftest  yourself. Does it actually PASS? Do the reported srcVsSrc (>=0.95) and incomplete (< srcVsSrc-0.25) numbers reproduce? If the implementer-reported numbers do not match what you observe -> FLAW.',
    '2. HONEST / NON-VACUOUS? Read grade-spec.mjs. Could srcVsSrc be ~1.0 for a TRIVIAL reason (matches every leaf unconditionally, coverage hardcoded, matcher returns 1.0 regardless)? Falsify: run  node grade-spec.mjs --src ' + SRC + ' --clone ' + INCOMPLETE + ' --summary  and sanity-check the per-section numbers are plausible (sections present in the incomplete clone score higher than absent ones, not a uniform constant).',
    '3. DID IT EDIT ANYTHING IT SHOULD NOT? Confirm grade-spec.mjs is NEW and grade-sections.mjs / perelement-score.mjs / capture-layout.mjs / segment.mjs / section-spec.mjs / build-structured.mjs were NOT modified (git status / mtimes).',
    '4. Bugs in y-scale + matching: divide-by-zero on an empty band, NaN coverage, a single clone leaf double-counted against many src leaves inflating coverage?',
    '',
    'OUTPUT (plain text): start with "VERIFIED:" if 1+2+3 hold (honest, self-test really passes, nothing improper edited), else "FLAW-FOUND:". Then one line per check with PASS/FAIL + concrete evidence (the actual selftest output you observed, specific line numbers for any bug). Do NOT edit files.',
  ].join('\n'),
  { agentType: 'codex:codex-rescue', label: 'verify:codex', phase: 'Verify' }
)

const codexVerified = /\bVERIFIED:/i.test(String(verify || '')) && !/\bFLAW-FOUND:/i.test(String(verify || ''))
return {
  kept: codexVerified,
  verdict: codexVerified
    ? 'ADOPTED - grade-spec.mjs (per-section attribution) built, self-test honest+anti-gaming, codex cross-model VERIFIED'
    : 'NOT KEPT - codex flagged a flaw or self-test not reproduced',
  build,
  codex: String(verify || '').slice(0, 1200),
}

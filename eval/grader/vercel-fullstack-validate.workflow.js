export const meta = {
  name: 'vercel-fullstack-validate-darkfix',
  description: 'Re-clone vercel.com with the FULL flag stack (CAPTURE_COLORSCHEME + CAPTURE_BANDBG capture; GRIDFIX+COLWIDTH+LINKCOLS build) to validate the dark-site fixes end-to-end (vercel renders DARK not white? anchoredMean up from 0.345?) + discover the next defect. TEXT-return; read-mostly (one scratch publish).',
  phases: [{ title: 'Reclone+Grade+Diagnose' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SRC_URL = 'https://vercel.com/'
const SRC_OUT = '/tmp/vercel-dark-src.json'
const PAGE = '12446'
const CLONE_URL = '' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/incomplete-clone-scratch-was-12999/'

phase('Reclone+Grade+Diagnose')
const r = await agent(
  [
    'Validate the dark-site capture fixes END-TO-END by re-cloning vercel.com with the FULL flag stack, then grade + diagnose. Work in ' + GRADER + '. EDIT NO CODE — run the pipeline + measure. Return PLAIN TEXT.',
    'SECURITY: source /tmp/joist-auth.env (set -a; . /tmp/joist-auth.env; set +a) for JOIST_AUTH_B64. NEVER print/echo/cat it.',
    '',
    'BASELINE (prior vercel clone, flags OFF): rendered ENTIRELY LIGHT/white (0 dark bands), anchoredMean 0.345, heightRatio 1.167 — the dark design was lost. The new fixes: CAPTURE_COLORSCHEME (emulate vercel\'s declared dark scheme -> captures dark) + CAPTURE_BANDBG (sample dark/canvas/gradient bands). QUESTION: does a full-stack clone now render vercel\'s DARK design + improve fidelity?',
    '',
    'STEPS:',
    '1. CAPTURE vercel with the dark fixes: CAPTURE_COLORSCHEME=1 CAPTURE_BANDBG=1 node capture-layout.mjs --source ' + SRC_URL + ' --out ' + SRC_OUT + ' 2>&1 | tail -4 . Segment it -> report pageBg + dark-band count (should be DARK now, vs 0 before). srcPageH + leaves.',
    '2. BUILD + PUBLISH full stack: STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 STRUCT_LINKCOLS=1 JOIST_SECTIONSPEC=1 node build-structured.mjs --layout ' + SRC_OUT + ' --page ' + PAGE + ' --publish 2>&1 | tail -15 . Record OK line + builtOk/publishOk (422 atomic_save_silent harmless).',
    '3. CAPTURE the clone (unique buster): node capture-layout.mjs --source "' + CLONE_URL + '?v=RANDOM" --out /tmp/vc-dark-clone.json . Report clonePageH + dark-band count (does the CLONE now render dark sections, not white?). heightRatio = clonePageH/srcPageH.',
    '4. GRADE: node grade-spec.mjs --src ' + SRC_OUT + ' --clone /tmp/vc-dark-clone.json --anchored --summary -> anchoredMean. Compare to the 0.345 baseline.',
    '5. DIAGNOSE: did the dark design carry through (src dark bands -> clone dark bands)? What is the TOP remaining defect now (bento? font? a NEW one)? Be specific.',
    '',
    'CONCLUDE: did the dark-site fixes work end-to-end (vercel clone now renders dark, anchoredMean improved)? + the next defect. Report: src dark bands, clone dark bands, anchoredMean before(0.345)/after, heightRatio, top remaining defect.',
    'END with one line: "VERDICT: DARK-FIXED" (clone renders dark + anchoredMean improved) or "VERDICT: PARTIAL" or "VERDICT: NO-CHANGE", preceded by the measurements.',
  ].join('\n'),
  { label: 'validate:vercel-dark', phase: 'Reclone+Grade+Diagnose' }
)

log('vercel dark-validate: ' + String(r || '').slice(-220))
return { kept: /VERDICT:\s*DARK-FIXED/i.test(String(r || '')), report: String(r || '').slice(0, 2500) }

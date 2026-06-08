export const meta = {
  name: 'supabase-fullstack-reclone-closeloop',
  description: 'Re-clone supabase (the user feedback URL, page 12157) with the FULL build stack (GRIDFIX+COLWIDTH+LINKCOLS) + grade with the now-complete grader (structural+text+anchored+color+height). Closes the loop on the original "doesnt feel close" feedback (user URL = best build) + definitive current-state + precise top remaining defect. TEXT-return.',
  phases: [{ title: 'Reclone+Grade+Report' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SRC = '/tmp/glob-supa.json'
const SRC_PAGEH = 7578
const PAGE = '12157'
const CLONE_URL = 'https://georges232.sg-host.com/structured-supabase/'

phase('Reclone+Grade+Report')
const r = await agent(
  [
    'Re-clone supabase to page ' + PAGE + ' (the URL the user gave "doesnt feel close" feedback on: ' + CLONE_URL + ') with the FULL build stack, then grade with the complete grader + report the cumulative current state + precise top remaining defect. Work in ' + GRADER + '. EDIT NO CODE — run pipeline + measure. Return PLAIN TEXT.',
    'SECURITY: source /tmp/joist-auth.env (set -a; . /tmp/joist-auth.env; set +a). NEVER print/echo/cat JOIST_AUTH_B64.',
    '',
    'CONTEXT: 12157 currently = GRIDFIX+COLWIDTH (from a prior round). LINKCOLS (supabase footer has real CSS-column link lists) was NOT yet applied to it. This re-clone adds LINKCOLS + gives the definitive all-dimensions grade. Baselines: GRIDFIX-only heightRatio ~1.523; colwidth anchored area ~0.456.',
    '',
    'STEPS:',
    '1. BUILD+PUBLISH full stack: STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 STRUCT_LINKCOLS=1 JOIST_SECTIONSPEC=1 node build-structured.mjs --layout ' + SRC + ' --page ' + PAGE + ' --publish 2>&1 | tail -15 . Record OK line (containers, RAM-grid rows, colw, linkcols, native widgets). builtOk/publishOk (422 atomic_save_silent harmless).',
    '2. CAPTURE clone (unique buster): node capture-layout.mjs --source "' + CLONE_URL + '?v=RANDOM" --out /tmp/supa-full-clone.json . clonePageH + leaves. heightRatio = clonePageH/' + SRC_PAGEH + ' (vs ~1.523 GRIDFIX-only).',
    '3. GRADE (all dimensions): node grade-spec.mjs --src ' + SRC + ' --clone /tmp/supa-full-clone.json --anchored --summary . Record anchoredMean, colorMatch, scoreWithColor, + per-section coverage. Also the clean per-section height attribution (segment both, ratio per section) to see which sections still stretch.',
    '4. REPORT cumulative state: heightRatio now vs 1.523; did LINKCOLS shrink the footer? did anchored area hold ~0.456+? colorMatch (supabase is light, expect high). Then the PRECISE top remaining defect (likely bento #2/#8 — confirm with the per-section height ratios) + whether it is architectural (bento) or a new tractable lever.',
    '',
    'END with one line: "VERDICT: <heightRatio> <anchoredMean> <topDefect>" preceded by the measurements + a 1-line honest assessment of how close the user-feedback clone now feels vs the original.',
  ].join('\n'),
  { label: 'reclone:supabase-full', phase: 'Reclone+Grade+Report' }
)

log('supabase full-stack reclone: ' + String(r || '').slice(-220))
return { kept: true, report: String(r || '').slice(0, 2500) }

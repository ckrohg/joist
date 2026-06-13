export const meta = {
  name: 'supabase-cumulative-with-bento',
  description: 'Re-clone supabase to 12157 with ALL 4 build recipes incl the new BENTOGRID -> definitive cumulative heightRatio (bento #2 was 42% of overage; expect a big drop from 1.556) + update the user feedback URL to the best build. TEXT-return.',
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
    'Re-clone supabase to page ' + PAGE + ' (the user feedback URL ' + CLONE_URL + ') with ALL FOUR build recipes including the new STRUCT_BENTOGRID, then grade + report the cumulative heightRatio. Work in ' + GRADER + '. EDIT NO CODE. Return PLAIN TEXT. SECURITY: source /tmp/joist-auth.env (set -a; . /tmp/joist-auth.env; set +a); NEVER print JOIST_AUTH_B64.',
    '',
    'CONTEXT: 12157 was last built GRIDFIX+COLWIDTH+LINKCOLS (heightRatio 1.556; dominant residual = bento #2 hRatio 3.08, +2182px = 42% of overage). STRUCT_BENTOGRID now packs #2 as a 4-col tile grid (recovers ~1900px). Expect the page heightRatio to DROP from 1.556 toward ~1.2-1.35.',
    '',
    'STEPS:',
    '1. BUILD+PUBLISH all-4: STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 STRUCT_LINKCOLS=1 STRUCT_BENTOGRID=1 JOIST_SECTIONSPEC=1 node build-structured.mjs --layout ' + SRC + ' --page ' + PAGE + ' --publish 2>&1 | tail -15 . OK line (containers, RAM-grid rows, bento note). publishOk (422 atomic_save harmless).',
    '2. VERIFY PERSIST: curl -s "' + CLONE_URL + '?v=RANDOM" | grep -c ramgrid (should be >0, confirms the new build persisted — avoid the stale-capture trap).',
    '3. CAPTURE (unique buster): node capture-layout.mjs --source "' + CLONE_URL + '?v=RANDOM2" --out /tmp/supa-bento-clone.json . clonePageH + leaves. heightRatio = clonePageH/' + SRC_PAGEH + ' (vs 1.556 before bento).',
    '4. GRADE: node grade-spec.mjs --src ' + SRC + ' --clone /tmp/supa-bento-clone.json --anchored --summary -> anchoredMean, colorMatch, scoreWithColor. Clean per-section height attribution (segment both) -> #2 hRatio now (was 3.08) + the new worst-stretch sections.',
    '5. REPORT the cumulative win: heightRatio before(1.556)/after; #2 hRatio before(3.08)/after; what is the NEW dominant residual (if #2 is fixed, what is next — #8? #6?); 1-line honest assessment of how close the user-feedback clone now is.',
    '',
    'END with one line: "VERDICT: <heightRatio_after> <#2_hRatio_after> <new_top_defect>" preceded by the measurements.',
  ].join('\n'),
  { label: 'reclone:supabase-bento', phase: 'Reclone+Grade+Report' }
)

log('supabase cumulative-with-bento: ' + String(r || '').slice(-220))
return { kept: true, report: String(r || '').slice(0, 2500) }

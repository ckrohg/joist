export const meta = {
  name: 'pricing-dense-table-discover',
  description: 'Clone a PRICING page (dense comparison matrix — a known weak spot: recipe #36 lost <table> semantics) with the full stack, grade + diagnose the table-fidelity defect, and determine if a tractable #36 fix exists. TEXT-return; read-mostly (one scratch publish).',
  phases: [{ title: 'Clone+Grade+Diagnose' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SRC_URL = 'https://supabase.com/pricing'
const SRC_OUT = '/tmp/supa-pricing-src.json'
const PAGE = '12446'
const CLONE_URL = '' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/incomplete-clone-scratch-was-12999/'

phase('Clone+Grade+Diagnose')
const r = await agent(
  [
    'Clone a PRICING page (dense comparison/feature matrix) end-to-end with the full stack + diagnose the TABLE-fidelity defect. Work in ' + GRADER + '. EDIT NO CODE — pipeline + measure. Return PLAIN TEXT. A pricing page is a distinct page-TYPE that stresses native <table> emission (recipe #36) + tier-card grids — a known weak spot: a prior multi-page round found dense comparison matrices LOSE <table> semantics (block-type table 3->0, decomposed into per-row grids losing row-headers).',
    'SECURITY: source /tmp/joist-auth.env (set -a; . /tmp/joist-auth.env; set +a). NEVER print/echo/cat JOIST_AUTH_B64.',
    '',
    'STEPS:',
    '1. CAPTURE: node capture-layout.mjs --source ' + SRC_URL + ' --out ' + SRC_OUT + ' 2>&1 | tail -4 . captureOk = leaves>=50 + sane pageH. Count captured <table> nodes in the source tree (nodes with tag=="table"). If pricing renders behind interaction/JS-walled (tiny/blank), report + try the home pricing section instead, or stop with that finding.',
    '2. BUILD+PUBLISH full stack: STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 STRUCT_LINKCOLS=1 STRUCT_NO_TABLE unset (so the native-table recipe #36 fires) JOIST_SECTIONSPEC=1 node build-structured.mjs --layout ' + SRC_OUT + ' --page ' + PAGE + ' --publish 2>&1 | tail -18 . Record the OK line — CRUCIALLY the native table count ("N native table(s) (M <table tag(s))") + RAM-grid rows + tier-card grids. builtOk/publishOk.',
    '3. CAPTURE clone + GRADE: capture ' + CLONE_URL + '?v=RANDOM -> /tmp/pricing-clone.json; node grade-spec.mjs --src ' + SRC_OUT + ' --clone /tmp/pricing-clone.json --anchored --summary -> anchoredMean/colorMatch/heightRatio + per-section.',
    '4. DIAGNOSE the table fidelity precisely: how many source <table>/comparison-matrices were there, and how many did the clone preserve as native <table> (count <table tags in the built tree / via matchTableForSection)? If the dense matrix did NOT preserve table semantics, WHY (read matchTableForSection + buildTableWidget in build-structured.mjs: did it fail to MATCH the section to the table, or fail to BUILD usable columns)? Is the source pricing matrix even captured AS a <table> (or as flex divs)? Name the precise gap + whether a tractable #36 fix exists (e.g. relax matchTableForSection overlap/left-edge thresholds, or handle div-based grid matrices).',
    '',
    'END with one line: "VERDICT: TABLE-OK" (matrices preserved as native tables) or "VERDICT: TABLE-DEFECT <tractable|capture-walled|div-based>" preceded by: src table-nodes, clone native-table count, anchoredMean, heightRatio, and the precise root cause + tractable-fix recommendation.',
  ].join('\n'),
  { label: 'discover:pricing-table', phase: 'Clone+Grade+Diagnose' }
)

log('pricing-table discover: ' + String(r || '').slice(-220))
return { kept: false, report: String(r || '').slice(0, 2500) }

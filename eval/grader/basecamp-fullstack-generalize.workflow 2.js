export const meta = {
  name: 'basecamp-fullstack-generalize',
  description: 'Clone basecamp.com end-to-end with the FULL stack (GRIDFIX + COLWIDTH + section-spec), render, grade per-section, and surface the top defect — 3rd-site generalization (different archetype: editorial/stats) + GRIDFIX/COLWIDTH render-check on the edge-case site + next-target discovery',
  phases: [{ title: 'Clone+Grade+Diagnose', detail: 'build+publish basecamp, capture, grade-spec anchored, clean per-section height attribution, top-defect' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SRC = '/tmp/br-basecamp.json'    // basecamp.com source (pageH 4909, 7 sections)
const SRC_PAGEH = 4909
const PAGE = '12446'                    // scratch page
const CLONE_URL = 'https://georges232.sg-host.com/incomplete-clone-scratch-was-12999/'

const SCHEMA = {
  type: 'object', additionalProperties: true,
  properties: {
    builtOk: { type: 'boolean' },
    publishOk: { type: 'boolean' },
    cloneCaptured: { type: 'boolean' },
    clonePageH: { type: 'number' },
    heightRatio: { type: 'number', description: 'clonePageH / 4909 (1.0 ideal)' },
    anchoredMean: { type: 'number', description: 'grade-spec --anchored per-section mean' },
    gridSectionsRecovered: { type: 'number' },
    colwidthSectionsNarrowed: { type: 'number' },
    noHScroll: { type: 'boolean' },
    perSectionStretch: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { idx: { type: 'number' }, srcH: { type: 'number' }, cloneH: { type: 'number' }, ratio: { type: 'number' } } } },
    topDefectClass: { type: 'string', description: 'biggest remaining defect on basecamp: bento/overlap | grid-cells-tall | font/wrap | missing | near-1:1 — with worst section(s) + cause' },
    newDefectVsSupaTw: { type: 'string', description: 'any defect class NOT already seen on supabase/tailwind (the discovery), or "none — same classes"' },
    generalizes: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['builtOk', 'summary'],
}

phase('Clone+Grade+Diagnose')
const r = await agent(
  [
    'Clone basecamp.com end-to-end with the FULL current build stack and grade per-section, to (a) prove the stack generalizes to a 3rd, DIFFERENT-archetype site (basecamp = editorial/big-type/stats, not a SaaS feature-grid), (b) render-validate GRIDFIX+COLWIDTH on basecamp (the GRIDFIX "neutral 7->7" edge case), and (c) discover any NEW defect class beyond supabase/tailwind. Work in ' + GRADER + '. EDIT NO CODE — run the pipeline + measure.',
    '',
    'SECURITY: source /tmp/joist-auth.env (set -a; . /tmp/joist-auth.env; set +a) for JOIST_AUTH_B64. NEVER print/echo/cat it.',
    '',
    'STEPS:',
    '1. BUILD+PUBLISH full stack: STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 JOIST_SECTIONSPEC=1 node build-structured.mjs --layout ' + SRC + ' --page ' + PAGE + ' --publish 2>&1 | tail -20 . Record OK: line (containers, RAM-grid rows, colw count, native widgets) + section-spec log. builtOk=OK+no FAIL. publishOk=PUT ok (422 atomic_save_silent harmless). gridSectionsRecovered=ramgrid count; colwidthSectionsNarrowed=colw-N count (from a --dry --dump if not in the log).',
    '2. CAPTURE with unique buster: node capture-layout.mjs --source "' + CLONE_URL + '?v=RANDOM" --out /tmp/bc-clone.json . clonePageH + leaves. heightRatio=clonePageH/' + SRC_PAGEH + '. noHScroll = max leaf x1 <= 1440.',
    '3. GRADE: node grade-spec.mjs --src ' + SRC + ' --clone /tmp/bc-clone.json --anchored --summary -> anchoredMean.',
    '4. CLEAN per-section height attribution: import segment.mjs, segment BOTH ' + SRC + ' and /tmp/bc-clone.json, compare srcH vs cloneH per section -> perSectionStretch[] + flag ratio>1.8.',
    '5. DIAGNOSE topDefectClass (inspect worst-stretch section members like prior rounds) + newDefectVsSupaTw: is the dominant defect a class ALREADY seen (bento/overlap, grid-cells-tall, font/wrap) or something NEW basecamp surfaces (e.g. big-editorial-type wrap, stats-band layout, overlap-illustration)? Name it.',
    '6. generalizes = built+rendered+noHScroll+heightRatio clearly beating a naive single-column stack.',
    '',
    'Report all fields. Be truthful — a NEW tractable defect class is the most valuable discovery; a regression on basecamp (GRIDFIX/COLWIDTH edge case) is critical to surface.',
  ].join('\n'),
  { schema: SCHEMA, label: 'clone+grade:basecamp', phase: 'Clone+Grade+Diagnose' }
)

log('basecamp generalize: builtOk=' + (r && r.builtOk) + ' heightRatio=' + (r && r.heightRatio) + ' anchoredMean=' + (r && r.anchoredMean) + ' topDefect=' + (r && r.topDefectClass) + ' new=' + (r && r.newDefectVsSupaTw))
return r

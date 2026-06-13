export const meta = {
  name: 'tailwind-fullstack-generalize',
  description: 'Clone tailwindcss.com end-to-end with the full current stack (GRIDFIX + section-spec), render, grade per-section (anchored + clean heightRatio), and surface the top remaining defect — generalization proof on a 2nd site + next-target discovery',
  phases: [{ title: 'Clone+Grade+Diagnose', detail: 'build+publish tailwind, capture, grade-spec, segment-based per-section height attribution, top-defect' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SRC = '/tmp/cap-tailwind-off.json'   // tailwindcss.com source (pageH 11649, 8 sections)
const SRC_PAGEH = 11649
const PAGE = '12446'                        // scratch page (incomplete-clone-scratch — safe to reuse)
const CLONE_URL = 'https://georges232.sg-host.com/incomplete-clone-scratch-was-12999/'

const SCHEMA = {
  type: 'object', additionalProperties: true,
  properties: {
    builtOk: { type: 'boolean' },
    publishOk: { type: 'boolean' },
    cloneCaptured: { type: 'boolean' },
    clonePageH: { type: 'number' },
    heightRatio: { type: 'number', description: 'clonePageH / 11649 (1.0 ideal)' },
    anchoredMean: { type: 'number', description: 'grade-spec --anchored per-section mean on the tailwind clone' },
    gridSectionsRecovered: { type: 'number', description: 'how many sections rendered as multi-col grids (RAM-grid) with GRIDFIX on' },
    perSectionStretch: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { idx: { type: 'number' }, role: { type: 'string' }, srcH: { type: 'number' }, cloneH: { type: 'number' }, ratio: { type: 'number' }, anchoredCov: { type: 'number' } } } },
    topDefectClass: { type: 'string', description: 'the single biggest remaining defect on tailwind: e.g. "bento/overlap stretch" | "grid cells too tall" | "missing content/section" | "near-1:1 (clean)" — with the worst section(s)' },
    generalizes: { type: 'boolean', description: 'true iff the full stack produced a sane tailwind clone (built+rendered, no h-scroll, grids recovered, heightRatio better than a naive single-column stack)' },
    summary: { type: 'string' },
  },
  required: ['builtOk', 'summary'],
}

phase('Clone+Grade+Diagnose')
const r = await agent(
  [
    'Clone tailwindcss.com end-to-end with the FULL current build stack and grade it per-section, to (a) prove the stack generalizes beyond supabase and (b) discover the top remaining defect on a 2nd site. Work in ' + GRADER + '. EDIT NO CODE — run the pipeline + measure.',
    '',
    'SECURITY: source /tmp/joist-auth.env (set -a; . /tmp/joist-auth.env; set +a) to load JOIST_AUTH_B64. NEVER print/echo/cat that var or the file.',
    '',
    'STEPS:',
    '1. BUILD + PUBLISH with the full stack: STRUCT_GRIDFIX=1 JOIST_SECTIONSPEC=1 node build-structured.mjs --layout ' + SRC + ' --page ' + PAGE + ' --publish 2>&1 | tail -20 . Record the OK: line (containers, RAM-grid rows, native widgets) + the section-spec classification log. builtOk = OK: line + no FAIL. publishOk = page PUT succeeded (422 atomic_save_silent is harmless). gridSectionsRecovered = the RAM-grid row count from the OK line (or count ramgrid in a --dry --dump).',
    '2. CAPTURE the rendered clone with a UNIQUE cache-buster: node capture-layout.mjs --source "' + CLONE_URL + '?v=RANDOM" --out /tmp/tw-clone.json . Report clonePageH + leaves. heightRatio = clonePageH / ' + SRC_PAGEH + '.',
    '3. GRADE per-section: node grade-spec.mjs --src ' + SRC + ' --clone /tmp/tw-clone.json --anchored --summary . Record anchoredMean + per-section anchoredCov.',
    '4. CLEAN per-section height attribution (the reliable method — NOT anchor-based): write a tiny node script that imports segment.mjs, segments BOTH ' + SRC + ' and /tmp/tw-clone.json, and for each section i compares srcH=(s.y1-s.y0) vs cloneH, ratio=cloneH/srcH. Report perSectionStretch[] + flag sections with ratio>1.8 as TALL.',
    '5. DIAGNOSE topDefectClass: inspect the worst-stretch section(s) from /tmp/tw-clone.json (member kinds/heights, like the supabase analysis). Classify the dominant cause: "bento/overlap stretch" (large images packed via overlap that flex stacks — sum of image heights >> source band height), "grid cells too tall" (grid present but tall cells), "missing content/section", or "near-1:1 (clean)". Name the worst section(s) + cause.',
    '6. generalizes = built + rendered + no horizontal scroll (check the clone: scrollWidth vs 1440; or trust that build-structured guarantees it) + grids recovered + heightRatio clearly better than a pure single-column stack would give.',
    '',
    'Report ALL fields via the schema. Be truthful — if tailwind clones WORSE than supabase or reveals a NEW defect class, say so plainly (that is the valuable discovery).',
  ].join('\n'),
  { schema: SCHEMA, label: 'clone+grade:tailwind', phase: 'Clone+Grade+Diagnose' }
)

log('tailwind generalize: builtOk=' + (r && r.builtOk) + ' heightRatio=' + (r && r.heightRatio) + ' anchoredMean=' + (r && r.anchoredMean) + ' topDefect=' + (r && r.topDefectClass))
return r

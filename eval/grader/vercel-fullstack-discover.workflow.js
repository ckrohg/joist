export const meta = {
  name: 'vercel-fullstack-discover',
  description: 'Capture vercel.com fresh + clone end-to-end with the full stack (GRIDFIX+COLWIDTH+LINKCOLS+section-spec), grade per-section, surface the top defect / any NEW class — 4th-site discovery (dark/gradient/dev archetype)',
  phases: [{ title: 'Capture+Clone+Grade+Diagnose', detail: 'capture vercel src, build+publish, capture clone, grade, per-section height attribution, top-defect + new-class' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SRC_URL = 'https://vercel.com/'
const SRC_OUT = '/tmp/vercel-src.json'
const PAGE = '12446'
const CLONE_URL = '' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/incomplete-clone-scratch-was-12999/'

const SCHEMA = {
  type: 'object', additionalProperties: true,
  properties: {
    captureOk: { type: 'boolean', description: 'vercel.com captured with a sane tree (>=50 leaves); if it is a dynamic-capture-walled site (like Stripe), report false + that finding' },
    srcLeaves: { type: 'number' },
    srcPageH: { type: 'number' },
    builtOk: { type: 'boolean' },
    publishOk: { type: 'boolean' },
    cloneCaptured: { type: 'boolean' },
    clonePageH: { type: 'number' },
    heightRatio: { type: 'number' },
    anchoredMean: { type: 'number' },
    gridSectionsRecovered: { type: 'number' },
    colwidthNarrowed: { type: 'number' },
    linkListsDetected: { type: 'number' },
    noHScroll: { type: 'boolean' },
    perSectionStretch: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { idx: { type: 'number' }, ratio: { type: 'number' } } } },
    topDefectClass: { type: 'string' },
    newDefectVsPrior: { type: 'string', description: 'a defect class NOT seen on supabase/tailwind/basecamp (bento/overlap, grid-cells-tall, font/wrap, link-list) — the discovery — or "none — same classes / near-1:1"' },
    generalizes: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['captureOk', 'summary'],
}

phase('Capture+Clone+Grade+Diagnose')
const r = await agent(
  [
    'Clone vercel.com end-to-end with the FULL current stack and grade it, as a 4th-site discovery (dark/gradient/dev archetype — distinct from the 3 done: supabase SaaS-grid, tailwind docs/SaaS, basecamp editorial). Goal: surface the NEXT tractable defect class OR confirm broad generalization. Work in ' + GRADER + '. EDIT NO CODE — pipeline + measure.',
    '',
    'SECURITY: source /tmp/joist-auth.env (set -a; . /tmp/joist-auth.env; set +a) for JOIST_AUTH_B64. NEVER print/echo/cat it.',
    '',
    'STEPS:',
    '1. CAPTURE SOURCE FRESH: node capture-layout.mjs --source ' + SRC_URL + ' --out ' + SRC_OUT + ' 2>&1 | tail -4 . captureOk = leaves>=50 + a sane pageH. If vercel is DYNAMIC-CAPTURE-WALLED (blank/tiny tree like Stripe), set captureOk=false, report that as the finding (a real capture-side limit), and STOP (do not publish a garbage clone).',
    '2. BUILD+PUBLISH full stack: STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 STRUCT_LINKCOLS=1 JOIST_SECTIONSPEC=1 node build-structured.mjs --layout ' + SRC_OUT + ' --page ' + PAGE + ' --publish 2>&1 | tail -20 . Record OK line (containers, RAM-grid rows, colw, linkcols, native widgets) + section-spec log. builtOk=OK+no FAIL. publishOk=PUT ok (422 atomic_save_silent harmless). gridSectionsRecovered/colwidthNarrowed/linkListsDetected from the dump/log.',
    '3. CAPTURE clone (unique buster): node capture-layout.mjs --source "' + CLONE_URL + '?v=RANDOM" --out /tmp/vc-clone.json . clonePageH+leaves. heightRatio=clonePageH/srcPageH. noHScroll = max leaf x1<=1440.',
    '4. GRADE: node grade-spec.mjs --src ' + SRC_OUT + ' --clone /tmp/vc-clone.json --anchored --summary -> anchoredMean.',
    '5. CLEAN per-section height attribution (segment both) -> perSectionStretch[] + flag ratio>1.8.',
    '6. DIAGNOSE topDefectClass + newDefectVsPrior: is the dominant defect a KNOWN class (bento/overlap, grid-cells-tall, font/wrap, link-list) or something NEW vercel surfaces (e.g. gradient/background fidelity, dark-mode color, sticky/overlay header, video/canvas hero)? Inspect the worst-stretch section members. Name it.',
    '7. generalizes = captured + built + rendered + noHScroll + heightRatio beating a naive stack.',
    '',
    'Report all fields. The MOST valuable outcomes: a NEW tractable defect class (-> next fix), OR near-1:1 confirming broad generalization (-> discovery well drying up). A capture-wall finding is also valuable. Be truthful.',
  ].join('\n'),
  { schema: SCHEMA, label: 'discover:vercel', phase: 'Capture+Clone+Grade+Diagnose' }
)

log('vercel discover: captureOk=' + (r && r.captureOk) + ' heightRatio=' + (r && r.heightRatio) + ' anchoredMean=' + (r && r.anchoredMean) + ' topDefect=' + (r && r.topDefectClass) + ' new=' + (r && r.newDefectVsPrior))
return r

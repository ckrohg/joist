export const meta = {
  name: 'clone-econ-grader-fix',
  description: 'SUPERVISED grader-perception fix: capture-layout MAXD=8 collides with Elementor clone wrapper nesting (.e-con>.e-con-inner>.elementor-element>.elementor-widget>.elementor-widget-container ~5 levels), so the CLONE capture under-counts rendered widgets (~45 of 313) -> areaCoverage ~0.19 crushes EVERY perElement sub-score -> the grader UNDERVALUES clones (flow v5: raw color 0.51 reported 0.099). Fix: Elementor structural wrappers must NOT consume the MAXD depth budget (free-descend through chrome). Source sites lack these classes -> source capture + self-test unaffected (symmetric). Reversible flag + self-test=1.0 + A/B (clone coverage rises ACCURATELY, source unchanged). MUST run only when NO directed-fix round is active (it edits capture-layout.mjs, which those rounds back up).',
  phases: [
    { title: 'Fix', detail: 'free-descend Elementor wrappers in walk(); back up; self-test=1.0 (source unaffected)' },
    { title: 'AB', detail: 're-grade corpus clones old-vs-new capture; coverage rises accurately + source unchanged' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SITES = [
  { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146 },
  { name: 'supabase', url: 'https://supabase.com', page: 2986 },
  { name: 'resend', url: 'https://resend.com', page: 2988 },
  { name: 'linear', url: 'https://linear.app', page: 4297 },
  { name: 'vercel', url: 'https://vercel.com', page: 4296 },
  { name: 'reactdev', url: 'https://react.dev', page: 4771 },
]
const cloneUrl = (p) => '' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/?page_id=' + p
const SCHEMA = { type: 'object', additionalProperties: false, properties: {
  applied: { type: 'boolean' }, selfTestPass: { type: 'boolean' }, selfTestDetail: { type: 'string' }, adopted: { type: 'boolean' },
  perSite: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    site: { type: 'string' }, oldCoverage: { type: 'number' }, newCoverage: { type: 'number' },
    oldComposite: { type: 'number' }, newComposite: { type: 'number' }, cloneLeavesOld: { type: 'number' }, cloneLeavesNew: { type: 'number' },
  }, required: ['site'] } },
  diffSummary: { type: 'string' }, accuracyCheck: { type: 'string' }, note: { type: 'string' },
}, required: ['applied', 'selfTestPass', 'adopted'] }

const r = await agent([
  'SUPERVISED grader-perception fix. Work in ' + GRADER + '. Reversible + careful — this changes how the grader SEES the clone (and thus all reported scores). The flow v5 A/B proved capture-layout under-counts the CLONE\'s rendered widgets (detected ~45 of 313) because Elementor wraps each widget in ~5 structural chrome divs and capture\'s MAXD=8 depth cap stops before reaching widget content; source sites have no such wrappers so they are captured fully. Net: areaCoverage (~0.19 on dark sites) multiplies down EVERY perElement sub-score, undervaluing clones.',
  'THE FIX (capture-layout.mjs walk()): Elementor STRUCTURAL WRAPPER elements must NOT consume the MAXD depth budget. When walk() recurses into a child whose class matches an Elementor chrome wrapper (.e-con, .e-con-inner, .e-con-boxed, .elementor-element, .elementor-widget, .elementor-widget-container, .elementor-section, .elementor-column, .elementor-row, .elementor-container), recurse at the SAME depth (do not increment), i.e. free-descent through chrome — so clone widget content is reached at its EFFECTIVE (source-equivalent) depth. Implement minimally + robustly (a class-set test on the element; keep the existing display:contents free-descent too). Do NOT change source behavior (source pages lack these classes, so they are inherently unaffected). Do NOT touch any OTHER file. Read walk() + the MAXD usage first to place the change correctly.',
  'STEP 0: cp capture-layout.mjs /tmp/ev-bk-capture-econ.mjs',
  'STEP 1: implement. node --check capture-layout.mjs.',
  'STEP 2 SELF-TEST (HARD GATE): node grade-sections.mjs --source https://resend.com --selftest -> composite MUST be 1.0 and perElement subs 1.0 (source-vs-source, unaffected since no Elementor wrappers). If not 1.0, restore /tmp/ev-bk-capture-econ.mjs, report applied=false selfTestPass=false.',
  'STEP 3 A/B (source /tmp/joist-auth.env): for EACH of the ' + SITES.length + ' corpus sites, grade the EXISTING clone (NO rebuild) TWICE — once with the OLD capture-layout (restore the backup, grade) and once with the NEW (re-apply, grade) — OR cleanly capture the clone both ways and diff the detected clone-leaf count. Report perSite {site, oldCoverage, newCoverage, oldComposite, newComposite, cloneLeavesOld, cloneLeavesNew}. End with the NEW version in place.',
  'STEP 4 ACCURACY CHECK (critical — must be MORE accurate, not just higher): confirm the newly-detected clone leaves are REAL rendered widgets (cross-check against the clone DOM widget count / the editability text-match, which already showed the text is present). State in accuracyCheck whether the coverage rise reflects genuinely-present-but-previously-missed widgets (adopt) vs phantom inflation (revert).',
  'DECIDE adopt: iff selfTestPass AND clone coverage RISES on the under-counted dark sites (linear/vercel/reactdev) AND source-vs-source self-test stays 1.0 AND the accuracy check confirms real widgets. Reversible: if anything looks like inflation rather than accuracy, restore the backup + adopted=false.',
  'Return {applied, selfTestPass, selfTestDetail, adopted, perSite, diffSummary, accuracyCheck, note}.',
].join('\n'), { label: 'fix:clone-econ-descent', phase: 'Fix', schema: SCHEMA }).catch((e) => ({ applied: false, selfTestPass: false, adopted: false, note: 'failed: ' + (e && e.message) }))

log('CLONE-ECON grader fix: applied=' + r.applied + ' selfTest=' + r.selfTestPass + ' adopted=' + r.adopted)
return { r }

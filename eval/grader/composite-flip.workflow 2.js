export const meta = {
  name: 'composite-flip-perelement',
  description: 'SUPERVISED (user-greenlit) objective change: blend the validated per-element metric (perelement-score.mjs) into grade-sections.mjs visual term so per-element COLOR + content-completeness become rewardable (un-saturate Wall A). Reversible flag; self-test=1.0 HARD gate (revert if broken); A/B re-grade the 7-site corpus old-vs-new + report. Adopt iff self-test=1.0 + no catastrophic recipe regression.',
  phases: [
    { title: 'Flip', detail: 'integrate per-element into visual term (reversible flag) + self-test=1.0' },
    { title: 'AB', detail: 'A/B re-grade 7-site corpus old-vs-new; adopt or revert' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SITES = [
  { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146 },
  { name: 'supabase', url: 'https://supabase.com', page: 2986 },
  { name: 'resend', url: 'https://resend.com', page: 2988 },
  { name: 'framer', url: 'https://www.framer.com', page: 2990 },
  { name: 'linear', url: 'https://linear.app', page: 4297 },
  { name: 'vercel', url: 'https://vercel.com', page: 4296 },
  { name: 'reactdev', url: 'https://react.dev', page: 4771 },
]
const cloneUrl = (p) => 'https://georges232.sg-host.com/?page_id=' + p
const SCHEMA = { type: 'object', additionalProperties: false, properties: {
  applied: { type: 'boolean' }, selfTestPass: { type: 'boolean' }, selfTestDetail: { type: 'string' }, adopted: { type: 'boolean' },
  perSite: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    site: { type: 'string' }, oldComposite: { type: 'number' }, newComposite: { type: 'number' },
    color: { type: 'number' }, typography: { type: 'number' }, position: { type: 'number' }, text: { type: 'number' }, coverage: { type: 'number' },
  }, required: ['site'] } },
  diffSummary: { type: 'string' }, note: { type: 'string' },
}, required: ['applied', 'selfTestPass', 'adopted'] }

const fix = await agent([
  'SUPERVISED, USER-GREENLIT objective change for the Joist grader. Work in ' + GRADER + '. Be careful + reversible — this changes the flywheel objective. The per-element metric perelement-score.mjs is built + validated (self-test source-vs-source=1.0; CIEDE2000 + Hungarian verified). Blend it into grade-sections.mjs visual term.',
  'CHANGE (grade-sections.mjs): add a reversible flag `const USE_PERELEMENT = (process.env.GRADER_SSIM_ONLY ? false : true)` (default ON; GRADER_SSIM_ONLY=1 restores the old behavior). When ON: compute the per-element sub-scores for the source-vs-clone pair (import the scoring from perelement-score.mjs, or capture both box-trees via capture-layout the same way perelement-score does, then score) -> perElement = 0.35*color + 0.25*typography + 0.20*position + 0.20*text (each sub-score already x symmetric area-coverage per the metric). Redefine the VISUAL term: visual = 0.5*SSIM + 0.5*perElement. Keep composite = 0.4*visual + 0.3*editability + 0.3*structuralFidelity (top-level weights unchanged). KEEP every existing report field (visualMean, editabilityMean, structuralFidelity, blocksSource/Clone, perSection, etc.) and ADD perElement:{color,typography,position,text,coverage} + ssimRaw (the pre-blend SSIM) so nothing downstream breaks.',
  'STEP 0: cp grade-sections.mjs /tmp/ev-bk-grade.mjs',
  'STEP 1: implement. node --check grade-sections.mjs.',
  'STEP 2 — SELF-TEST (HARD GATE): node grade-sections.mjs --source https://resend.com --selftest -> composite MUST be 1.0 AND perElement sub-scores MUST be 1.0 (source-vs-source). If composite != 1.0 or any sub-score != 1.0, the blend is buggy/asymmetric -> RESTORE /tmp/ev-bk-grade.mjs, report applied=false, selfTestPass=false. Report selfTestDetail.',
  'STEP 3 — A/B RE-GRADE: source /tmp/joist-auth.env. For EACH of the 7 corpus sites, grade the EXISTING clone (no rebuild) TWICE: once with GRADER_SSIM_ONLY=1 (old composite) and once default (new blended composite). Report perSite=[{site, oldComposite, newComposite, color, typography, position, text, coverage}].',
  'STEP 4 — DECIDE adoption: ADOPT (leave the flip in, flag default-ON) iff selfTestPass AND no site\'s newComposite collapses in a way attributable to a BUG (vs the expected uniform stricter-metric drop — color/content drag is EXPECTED + correct, not a regression). The 9 kept recipes are structural/capture (color-neutral) so they should not become net-negative; if any site looks pathological (e.g. a recipe clearly now hurts), note it but still ADOPT the flag-ON default (it is reversible via GRADER_SSIM_ONLY) unless self-test failed. If self-test failed -> adopted=false (reverted).',
  'Report {applied, selfTestPass, selfTestDetail, adopted, perSite, diffSummary, note}. This is the objective the directed-fix loop will gate on going forward; color/content fixes now move the score.',
].join('\n'), { label: 'flip:composite', phase: 'Flip', schema: SCHEMA }).catch((e) => ({ applied: false, selfTestPass: false, adopted: false, note: 'failed: ' + (e && e.message) }))

log('COMPOSITE-FLIP: applied=' + fix.applied + ' selfTest=' + fix.selfTestPass + ' adopted=' + fix.adopted)
return { fix }

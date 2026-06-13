export const meta = {
  name: 'effects-fold',
  description: 'SUPERVISED-discipline grader fold (rubric gap, cheap): add an EFFECTS sub-score (box-shadow + border-radius + backdrop-filter) to the per-element metric — data the capture ALREADY records (border/radius/boxShadow per node) but the grader never scored (rubric cat 1.3). Reversible flag + self-test=1.0 + A/B + independent-Claude verify. Makes the grader truer (per grader_strictness_is_progress) + gives both builders a new fidelity target. Low-risk: a small new perElement term, renormalized.',
  phases: [
    { title: 'Fold', detail: 'add effects sub-score to perElement (reversible) + self-test=1.0' },
    { title: 'Verify', detail: 'independent reviewer: self-test holds, effects scores sane, no other sub-score corrupted' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const impl = await agent([
  'Add an EFFECTS sub-score to the per-element fidelity metric. Work in ' + GRADER + '. Read perelement-score.mjs + grade-sections.mjs first to see the existing perElement blend (color/typo/position/text x coverage) + what the capture records per node (border, radius, boxShadow are captured but UNSCORED).',
  'CHANGE (perelement-score.mjs, the per-element metric): add an EFFECTS sub-score over matched node pairs = agreement of {border-radius (relative px tolerance), box-shadow (presence + rough offset/blur/color match), backdrop-filter/blur (presence)} — symmetric, x the same area-coverage as the other sub-scores. Renormalize perElement to include it at a MODEST weight, e.g. perElement = 0.30*color + 0.22*typo + 0.18*position + 0.18*text + 0.12*effects (keep color dominant; effects is the smallest term). Add a reversible flag `const USE_EFFECTS = !process.env.GRADER_NO_EFFECTS` (GRADER_NO_EFFECTS=1 -> exact prior 0.35/0.25/0.20/0.20 blend). KEEP every existing report field + ADD effects to the perElement breakdown. Do NOT change the top-level composite weights (visual/edit/struct/responsive) — effects folds INSIDE the perElement term only.',
  'STEP 0: cp perelement-score.mjs /tmp/ev-bk-perelem.mjs (+ grade-sections.mjs if you must touch it). STEP 1: implement. node --check. STEP 2 SELF-TEST (HARD): grade-sections.mjs --source https://resend.com --selftest -> composite 1.0 AND perElement subs (incl. effects) all 1.0 (source-vs-source). If not, restore + report FAILED. Also verify GRADER_NO_EFFECTS=1 selftest still 1.0 (reversibility). STEP 3 A/B: source /tmp/joist-auth.env; grade 2-3 existing corpus clones old (GRADER_NO_EFFECTS=1) vs new; report per-site composite old->new + the effects sub-score. The composite will dip slightly (clones imperfect on shadows/radius) — EXPECTED honest re-baseline, NOT a regression.',
  'Return PLAIN-TEXT starting "OK:" if implemented + self-test 1.0 (both modes) + A/B reconciles (effects sub-score is a sane 0-1 that explains the small dip), else "FAILED:". Leave it in place for the reviewer.',
].join('\n'), { label: 'fold:effects', phase: 'Fold' })
log('EFFECTS-FOLD impl: ' + String(impl || '').slice(0, 250))

const verify = await agent([
  'INDEPENDENT ADVERSARIAL VERIFICATION (Codex unavailable -> interim fresh-Claude reviewer; be skeptical). Work in ' + GRADER + '. A prior agent added an EFFECTS sub-score to perelement-score.mjs.',
  'Prior report: ' + String(impl || '(none)').slice(0, 400),
  'VERIFY: (1) self-test source-vs-source composite=1.0 AND effects sub=1.0 (run it); (2) reversibility: GRADER_NO_EFFECTS=1 reproduces the EXACT prior blend (composite identical to backup behavior on one clone); (3) the effects sub-score is a sane [0,1] that did NOT corrupt color/typo/pos/text (diff a clone grade old-vs-new — only the effects term + the renormalized blend should change); (4) no NaN/undefined on a clone with no shadows. Return "VERIFIED:" or "FLAW-FOUND:" with specifics.',
].join('\n'), { label: 'independent-verify', phase: 'Verify' }).catch((e) => 'verify-failed: ' + (e && e.message))
log('VERIFY: ' + String(verify || '').slice(0, 250))

// Robust adopt-check: agents PREFIX prose before OK: (the ^OK: anchor wrongly reverted a good fold). Use \bOK: contains + explicit-fail guards.
const implOK = /\bOK:/i.test(String(impl || '')) && !/\bFAILED:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
const verifyOK = /\bVERIFIED:/i.test(String(verify || '')) && !/\bFLAW-FOUND:/i.test(String(verify || ''))
const ok = implOK && verifyOK
let verdict
if (ok) verdict = 'ADOPTED — effects sub-score folded into perElement (reversible GRADER_NO_EFFECTS=1; self-test 1.0; independent-verified). Rubric cat-1.3 gap closed; both builders now have a shadow/radius target.'
else { await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-perelem.mjs perelement-score.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Verify' }); verdict = 'REVERTED — ' + (/^\s*OK:/i.test(String(impl || '')) ? 'reviewer flagged: ' + String(verify || '').slice(0, 160) : 'impl failed: ' + String(impl || '').slice(0, 160)) }
log('EFFECTS-FOLD: ' + verdict)
return { verdict, impl: String(impl || '').slice(0, 600), verify: String(verify || '').slice(0, 600) }

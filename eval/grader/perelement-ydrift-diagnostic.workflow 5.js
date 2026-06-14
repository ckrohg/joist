export const meta = {
  name: 'perelement-ydrift-diagnostic',
  description: 'DIAGNOSTIC (NO edits). SMOKING GUN: supabase flow clone has ssim 0.897 + struct 1.0 (pixels 90% similar -> colors/text ARE right) yet perElement color 0.048 / text 0.087. Hypothesis: the perElement Hungarian matcher matches source<->clone by POSITION, so a uniformly-stretched clone (hRatio 1.486) fails to match -> color/typo/text (position-INDEPENDENT content props) go uncredited = y-drift DOUBLE-PENALIZED. Instrument perelement-score.mjs matching: dump matched pairs + per-prop scores, then re-match with the clone y-normalized (scaled by 1/hRatio) and see if color/text JUMP. Quantify the artifact + scope the supervised fix + the over-credit guard. Read/run only; edits nothing.',
  phases: [
    { title: 'Measure', detail: 'instrument perElement matcher on supabase (+framer); position-dependence; y-normalized re-match delta; over-credit guard' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'READ/RUN ONLY — this is a DIAGNOSTIC: edit/move/delete NO files (you MAY write throwaway probe scripts to /tmp). source /tmp/joist-auth.env for WP auth. Never use the ABSOLUTE corpus page ids (2986/2988/2990/3146/4296/4297/4771). Never print JOIST_AUTH_B64.'
// supabase = the clearest contradiction (ssim 0.897 / perElement color 0.048 / hRatio 1.486). framer = second deep-drift case.
const SITES = [
  { name: 'supabase', url: 'https://supabase.com', page: 6006, ssim: 0.897, hRatio: 1.486 },
  { name: 'linear', url: 'https://linear.app', page: 5404, ssim: 0.607, hRatio: 1.137 },
]
const SCHEMA = { type: 'object', additionalProperties: false, properties: {
  site: { type: 'string' },
  matcherCostBasis: { type: 'string' },
  ssim: { type: 'number' },
  perElementColorNow: { type: 'number' }, perElementTextNow: { type: 'number' }, matchedPairsNow: { type: 'number' }, sourceNodes: { type: 'number' },
  perElementColorYNorm: { type: 'number' }, matchedPairsYNorm: { type: 'number' },
  isDoublePenalty: { type: 'boolean' }, magnitudeComposite: { type: 'number' },
  overCreditRisk: { type: 'string' },
  targetedFixDirective: { type: 'string' }, honestVerdict: { type: 'string' },
}, required: ['site', 'matcherCostBasis', 'isDoublePenalty', 'targetedFixDirective', 'honestVerdict'] }

phase('Measure')
const out = await parallel(SITES.map((s) => () => agent([HARD_RULE,
  'INVESTIGATE whether the perElement matcher DOUBLE-PENALIZES vertical drift (deflating color/typo/text on a uniformly-stretched-but-correct clone). Work in ' + GRADER + '. site=' + s.name + ' clone=sg-host page ' + s.page + ' (ssim ' + s.ssim + ', hRatio ' + s.hRatio + '). You MUST end by calling StructuredOutput. BE SKEPTICAL BOTH WAYS — confirm OR refute with real numbers.',
  'STEP 1 — READ perelement-score.mjs: how are source nodes matched to clone nodes? Is the match cost POSITION-based (box x/y distance / IoU)? Are color/typo/text measured ONLY on matched pairs (so an unmatched source node contributes 0 color even if its content exists in the clone)? Identify the exact cost function + whether a uniform y-scale would break matches.',
  'STEP 2 — DUMP the current match on ' + s.name + ': run grade-sections (or a /tmp probe calling perelement-score on the captured source+clone) and report matchedPairs, sourceNodes, and per-prop sub-scores (color/typo/text). What fraction of source nodes went UNMATCHED, and are the unmatched ones the color/text contributors?',
  'STEP 3 — HYPOTHESIS TEST (the key): re-run the matching with the CLONE node y-coordinates scaled by srcDocH/cloneDocH (= 1/hRatio ~= ' + (1 / s.hRatio).toFixed(3) + ') so a uniformly-stretched clone aligns to source y. Does matchedPairs RISE and do color/typo/text JUMP (toward the ~ssim level)? Report perElementColorYNorm + matchedPairsYNorm vs the current. (If color stays low even y-normalized, the content is genuinely wrong -> NOT a matcher artifact.)',
  'STEP 4 — OVER-CREDIT GUARD: would a y-tolerant match also credit a GENUINELY mis-positioned (not uniformly-stretched) clone? Reason about / test whether the fix should tolerate only a UNIFORM global y-scale (safe) vs arbitrary y-shifts (unsafe). The position sub-score + hRatio/responsive must STILL penalize the drift — only color/typo/text should be measured on content-matched pairs.',
  'STEP 5 — VERDICT + FIX: isDoublePenalty (true/false)? magnitudeComposite = estimated composite lift on this site if color/typo/text were credited honestly. targetedFixDirective = the precise SUPERVISED perelement-score change (e.g. match on content+x with a uniform-y-scale-normalized cost, OR a two-pass: position sub-score on raw boxes [keeps the drift penalty] + color/typo/text on y-normalized content-matched pairs). honestVerdict — is this a real false-deflation worth a supervised fix, or is the clone genuinely wrong (no fix)?',
  'Return {site, matcherCostBasis, ssim, perElementColorNow, perElementTextNow, matchedPairsNow, sourceNodes, perElementColorYNorm, matchedPairsYNorm, isDoublePenalty, magnitudeComposite, overCreditRisk, targetedFixDirective, honestVerdict}.',
].join('\n'), { label: 'ydrift:' + s.name, phase: 'Measure', schema: SCHEMA }))).then((rs) => rs.filter(Boolean))

for (const r of out) log('YDRIFT ' + r.site + ': color ' + r.perElementColorNow + ' -> yNorm ' + r.perElementColorYNorm + ' | doublePenalty=' + r.isDoublePenalty + ' | ' + r.honestVerdict)
return { diagnostics: out }

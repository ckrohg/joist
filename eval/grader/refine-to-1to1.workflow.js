export const meta = {
  name: 'refine-to-1to1',
  description: 'ROADMAP #1 (user-prioritized, highest ceiling-raise): a PER-CLONE inner REFINE loop that drives ONE page toward 1:1 by iterating on its OWN graded residuals — render -> grade -> extract top-K per-element residuals WITH their Elementor control keys (the metric->fix repair-map) -> PATCH those controls on the live page tree -> re-grade -> keep-the-patch-if-composite-rose -> repeat (bounded). Then DISTILL which repairs generalized into recipes. This flips the flywheel from nudge-the-average to perfect-one-then-generalize. ASSESS-FIRST: refine.mjs exists (tasks #16/#25) but predates the current build-absolute + honest grade-sections + per-element deltas — check if usable + whether per-pair {srcValue,cloneValue,channel} are available, then wire the MINIMAL viable loop (SAFE operators first: color->text_color, typography->font_size/weight, position->_position offset) and PROVE it raises supabase composite over baseline. Reversible (refine is opt-in; page rebuilds clean). GATE: supabase composite RISES over baseline across the refine iterations (median-of-2, monotonic-ish, each kept patch re-graded) + self-test 1.0 + editability not down + no garbage patches, else record findings (no keep).',
  phases: [
    { title: 'Assess', detail: 'inspect refine.mjs + perelement per-pair deltas + the live-page patch path; report usability + the minimal-viable repair-map loop plan' },
    { title: 'Build+Prove', detail: 'wire the minimal refine loop (grade->top-K residuals+control-keys->patch live page->re-grade->keep-if-up, bounded ~6 iters) + run it on supabase; report the composite trajectory' },
    { title: 'Gate+Distill', detail: 'keep iff supabase composite rose monotonic-ish + self-test 1.0 + editability held; distill generalizable repairs into recipes' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && export JOIST_BASE="${JOIST_BASE:-http://localhost:8001}"; case "$JOIST_BASE" in *sg-host.com*|*georges232*|*35.212.46.254*) echo "FATAL: JOIST_BASE=$JOIST_BASE is a blocked/paused host (host-guard allowlist; renders only target localhost:8001 or JOIST_TRAINING_BASE)"; exit 1;; esac'
const HARD = 'New refine driver = refine-clone.mjs (create it) OR fix/extend the existing refine.mjs. You MAY add a per-pair repair-map OUTPUT to perelement-score.mjs (additive, behind a flag, must keep self-test 1.0) but do NOT change its scoring math. Do NOT edit build-absolute/grade-sections scoring. The refine loop PATCHES the live PAGE tree (via the joist PUT), not the builders. Back up any edited existing file first (/tmp/ev-bk-<file>-refine.mjs). AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Build-then-grade in this round (consistent state). 422 silent-save w/ tree persisted = ok.'

const ASCHEMA = { type: 'object', additionalProperties: false, properties: {
  refineMjsExists: { type: 'boolean' }, refineMjsUsable: { type: 'boolean' }, refineMjsNotes: { type: 'string' },
  perPairDeltasAvailable: { type: 'boolean' }, deltaChannels: { type: 'array', items: { type: 'string' } }, controlKeyMapKnown: { type: 'boolean' },
  livePagePatchPath: { type: 'string' }, minimalLoopPlan: { type: 'string' }, feasible: { type: 'boolean' },
}, required: ['refineMjsExists', 'refineMjsUsable', 'perPairDeltasAvailable', 'feasible', 'minimalLoopPlan'] }
const assess = await agent([HARD.replace('New refine driver = refine-clone.mjs (create it) OR fix/extend the existing refine.mjs. You MAY add a per-pair repair-map OUTPUT to perelement-score.mjs (additive, behind a flag, must keep self-test 1.0) but do NOT change its scoring math. Do NOT edit build-absolute/grade-sections scoring. The refine loop PATCHES the live PAGE tree (via the joist PUT), not the builders. ', 'ASSESS — read-only, do NOT edit (inspect files + the grader output). '),
  'ASSESS feasibility of a per-clone refine-to-1:1 loop. Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput.',
  '(1) refine.mjs: does it exist? Read it. Does it still RUN against the current build-absolute + grade-sections pipeline, or is it stale (wrong builder/grader interface)? refineMjsExists, refineMjsUsable, refineMjsNotes (what it does + what is stale).',
  '(2) PER-PAIR DELTAS: grade supabase (build-absolute --publish page 2986, then grade-sections) + read the perelement-score output (/tmp/pe-*.json or the sections.json). Does it expose, per MATCHED pair, the SOURCE value vs CLONE value per channel (color/typography/position/size)? perPairDeltasAvailable, deltaChannels (which channels have src-vs-clone values). controlKeyMapKnown = is the mapping channel->Elementor-control-key obvious (color->text_color/color, typo->typography_font_size/_font_weight, position->_position offset / _element_custom_width)?',
  '(3) LIVE-PAGE PATCH PATH: how does build-absolute PUT the tree (the joist/v1 PUT + expected_hash flow)? Can a refine driver GET the current tree, mutate specific widget settings (e.g. set widget#id.settings.color = srcColor), and PUT it back? livePagePatchPath = the concrete mechanism.',
  '(4) minimalLoopPlan = the concrete minimal-viable refine loop: grade -> extract top-K (~5) worst per-element residuals that have a known control-key (start SAFE: color, font-size, font-weight; position-nudge if low-risk) -> patch those widgets on the live page tree -> re-grade -> keep the patch iff composite rose (else revert that patch) -> repeat ~6 iters or until convergence. feasible = true iff per-pair deltas + a patch path exist (even if refine.mjs must be rewritten as refine-clone.mjs).',
  'Return {refineMjsExists, refineMjsUsable, refineMjsNotes, perPairDeltasAvailable, deltaChannels, controlKeyMapKnown, livePagePatchPath, minimalLoopPlan, feasible}.',
].join('\n'), { label: 'assess:refine', phase: 'Assess', schema: ASCHEMA })
log('ASSESS: refineMjs exists=' + (assess&&assess.refineMjsExists) + ' usable=' + (assess&&assess.refineMjsUsable) + ' perPairDeltas=' + (assess&&assess.perPairDeltasAvailable) + ' channels=' + JSON.stringify(assess&&assess.deltaChannels) + ' feasible=' + (assess&&assess.feasible))

let impl = null, gate = null
if (assess && assess.feasible) {
  phase('Build+Prove')
  impl = await agent([HARD,
    'BUILD a minimal per-clone REFINE loop + PROVE it on supabase. Work in ' + GRADER + '. ASSESS: refineMjsUsable=' + assess.refineMjsUsable + ' (' + String(assess.refineMjsNotes||'').slice(0,200) + '); perPairDeltas=' + assess.perPairDeltasAvailable + ' channels=' + JSON.stringify(assess.deltaChannels) + '; patchPath=' + String(assess.livePagePatchPath||'').slice(0,200) + '. PLAN: ' + String(assess.minimalLoopPlan||'').slice(0,400),
    'IMPLEMENT refine-clone.mjs (or fix refine.mjs) — a driver that, for a given page: (a) ensures the per-element repair-map is available (if not, add an additive per-pair {srcId, channel, srcValue, cloneValue, elementorKey} OUTPUT to perelement-score.mjs behind a flag — keep self-test 1.0, do NOT change scoring); (b) grades the live clone; (c) extracts the top-K (~5) worst matched-pair residuals that have a SAFE known control-key (color->text_color, font-size->typography_font_size, font-weight->typography_font_weight; add position-offset only if low-risk); (d) GETs the live page tree, sets those specific widget settings to the SOURCE values, PUTs it back (expected_hash/409-retry like build-absolute); (e) re-grades; (f) KEEPS the patch-set iff composite rose, else reverts; (g) repeats up to ~6 iterations or until no top-residual improves. Log the composite after each iteration (the trajectory).',
    'PROVE on supabase (page 2986): rebuild clean (build-absolute --publish) -> record baseline composite (median-of-2) -> run the refine loop -> record composite after each iteration + the final. The loop must be SAFE: only patch matched pairs (never invent content), only SAFE channels, keep-if-up gating per iteration so it cannot regress.',
    'node --check refine-clone.mjs (+ perelement-score.mjs if edited). SELFTEST (if perelement edited): ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0. Return "OK:" with the supabase composite TRAJECTORY (baseline -> iter1 -> ... -> final) + how many patches kept + which channels helped, or "FAILED:" with why.',
  ].join('\n'), { label: 'build+prove:refine', phase: 'Build+Prove' })
  log('IMPL: ' + String(impl || '').slice(0, 300))

  const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bFAILED:/i.test(String(impl || ''))
  if (okImpl) {
    phase('Gate+Distill')
    const VS = { type: 'object', additionalProperties: false, properties: {
      baselineComposite: { type: 'number' }, finalComposite: { type: 'number' }, trajectory: { type: 'array', items: { type: 'number' } },
      patchesKept: { type: 'number' }, channelsThatHelped: { type: 'array', items: { type: 'string' } },
      selftest: { type: 'number' }, editabilityHeld: { type: 'boolean' }, anyGarbagePatch: { type: 'boolean' },
      generalizableRepairs: { type: 'array', items: { type: 'string' } }, ok: { type: 'boolean' }, verdict: { type: 'string' },
    }, required: ['baselineComposite', 'finalComposite', 'patchesKept', 'selftest', 'editabilityHeld', 'anyGarbagePatch', 'ok', 'verdict'] }
    gate = await agent([HARD,
      'INDEPENDENT VERIFY + DISTILL the refine-to-1:1 loop on supabase (be skeptical — a refine loop that games the grader or corrupts editability is worse than none). Work in ' + GRADER + '. ' + AUTH + '. Prior report: ' + String(impl||'').slice(0,300) + '. You MUST end by calling StructuredOutput.',
      'VERIFY: rebuild supabase (2986) clean -> baselineComposite (median-of-2). Run the refine loop (node refine-clone.mjs --page 2986 or the impl entrypoint) -> finalComposite (median-of-2) + the trajectory array. patchesKept = how many patches survived the keep-if-up gate. channelsThatHelped.',
      'RAILS: (1) finalComposite > baselineComposite (the loop genuinely raised this clone). (2) selftest = grade-sections --source supabase --selftest == 1.0 (if perelement was edited, the repair-map output did not corrupt scoring). (3) editabilityHeld = the editability sub-score did NOT drop (patches set values, do not destroy widgets). (4) anyGarbagePatch = did any patch set a widget to a wrong/invented value (inspect a few patched widgets vs source)? must be FALSE. (5) the loop is keep-if-up gated so it cannot regress a clone.',
      'DISTILL: generalizableRepairs = which repair operators consistently helped (e.g. "snap matched-pair text_color to source color when dE>3") that should become standing recipes / fold into build-absolute. ok = finalComposite>baselineComposite AND selftest==1.0 AND editabilityHeld AND !anyGarbagePatch. Return {baselineComposite, finalComposite, trajectory, patchesKept, channelsThatHelped, selftest, editabilityHeld, anyGarbagePatch, generalizableRepairs, ok, verdict}.',
    ].join('\n'), { label: 'gate+distill:refine', phase: 'Gate+Distill', schema: VS })
    log('GATE: baseline=' + (gate&&gate.baselineComposite) + ' final=' + (gate&&gate.finalComposite) + ' kept=' + (gate&&gate.patchesKept) + ' selftest=' + (gate&&gate.selftest) + ' editHeld=' + (gate&&gate.editabilityHeld) + ' garbage=' + (gate&&gate.anyGarbagePatch) + ' ok=' + (gate&&gate.ok))
  }
}

phase('Gate+Distill')
let verdict
if (!assess || !assess.feasible) {
  verdict = 'NOT BUILT — refine loop not feasible on the current pipeline: perPairDeltas=' + (assess&&assess.perPairDeltasAvailable) + ' refineUsable=' + (assess&&assess.refineMjsUsable) + '. ' + String(assess&&assess.minimalLoopPlan||'').slice(0,200) + ' -> prerequisite (per-pair repair-map output) must be built first.'
} else if (!impl || !/\bOK:/i.test(String(impl)) || /\bFAILED:/i.test(String(impl))) {
  verdict = 'NO-KEEP — refine impl failed: ' + String(impl||'').slice(0,200)
} else if (gate && gate.ok) {
  verdict = 'ADOPTED — refine-to-1:1 loop PROVEN: supabase composite ' + gate.baselineComposite + ' -> ' + gate.finalComposite + ' (trajectory ' + JSON.stringify(gate.trajectory) + ', ' + gate.patchesKept + ' patches kept, channels ' + JSON.stringify(gate.channelsThatHelped) + '); self-test 1.0; editability held; no garbage patches. The flywheel can now drive a SINGLE clone toward 1:1 + distill repairs (' + JSON.stringify(gate.generalizableRepairs) + '). This raises the ceiling on every site. Roadmap #1 landed.'
} else {
  verdict = 'NO-KEEP — refine loop did not cleanly raise supabase / failed a rail: ' + JSON.stringify(gate || {}).slice(0, 300) + '. refine-clone.mjs left in place for inspection (opt-in, does not affect the default pipeline); findings banked.'
}
log('REFINE-TO-1TO1: ' + verdict)
return { verdict, assess, impl: String(impl||'').slice(0,500), gate }

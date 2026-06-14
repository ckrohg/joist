export const meta = {
  name: 'abs-responsive-diagnostic',
  description: 'DIAGNOSTIC (read-only on cloner files; may publish throwaway probe pages). The honest transition finding: absolute (0.625) and flow (0.616) are TIED + complementary; a best-per-site router = 0.654. Absolute wins 4 sites and is held back ONLY by responsive (0.04-0.33, desktop-pixel-pinned). The biggest router-ceiling lever = give ABSOLUTE responsive reflow. Per-breakpoint offset keys are kses-stripped, so test the MOBILE-FLOW FALLBACK path: can an absolute clone be made to reflow below 768 (switch root abs containers to position:relative + the page to flex-column) in a way that SURVIVES the joist PUT/kses + actually reflows? Output the viable path (if any) + the expected responsive lift -> whether abs-responsive is buildable. Edits NO cloner files.',
  phases: [
    { title: 'Probe', detail: 'instrument abs responsive failure on tailwind 3146; test a mobile-flow-fallback that survives kses + reflows' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'READ-ONLY on cloner files (build-absolute.mjs/build-flow.mjs/capture-*/grade-*/perelement-* — do NOT edit). You MAY publish a THROWAWAY probe page (create a new page, NOT a corpus page) to test kses survival. source /tmp/joist-auth.env. Never print JOIST_AUTH_B64.'
const SCHEMA = { type: 'object', additionalProperties: false, properties: {
  absResponsiveNow: { type: 'number' },
  whyLow: { type: 'string' },
  ksesStripsPerBreakpointOffsets: { type: 'boolean' },
  mobileFlowFallbackSurvivesKses: { type: 'boolean' },
  mobileFlowFallbackReflows: { type: 'boolean' },
  expectedResponsiveLift: { type: 'string' },
  viablePath: { type: 'string' },
  targetedFixDirective: { type: 'string' },
  honestVerdict: { type: 'string' },
}, required: ['whyLow', 'viablePath', 'honestVerdict'] }

phase('Probe')
const out = await agent([HARD_RULE,
  'INVESTIGATE whether the ABSOLUTE builder can be given responsive reflow (the biggest router-ceiling lever). Work in ' + GRADER + '. Use the absolute tailwind clone (configured-host page 3146, honest responsive 0.3313 — the best abs responsive on the corpus; most others are 0.04-0.21). You MUST end by calling StructuredOutput.',
  'STEP 1 — WHY is abs responsive low: render page 3146 at 1440/768/390 (isolated Playwright). Confirm the failure mode: do the absolutely-positioned widgets keep their desktop x/y/w at narrow viewports (clone docW stays ~1440 / content does not reflow / docH stays desktop height while source grows)? Quantify (docW + docH per breakpoint vs source). Read build-absolute.mjs (READ-ONLY) to see how it emits position:absolute + offsets + whether it sets ANY responsive keys.',
  'STEP 2 — kses check on per-breakpoint offsets: confirm (from build-absolute + a probe) that _offset_x_tablet/_offset_y_mobile/_element_custom_width_tablet etc. are STRIPPED by the joist PUT/kses (only desktop px persist) — this is the documented blocker.',
  'STEP 3 — TEST THE MOBILE-FLOW FALLBACK (the candidate path): on a THROWAWAY probe page (create a NEW page, do NOT touch 3146 or any corpus page), build a SMALL hand-authored Elementor tree with 2-3 absolutely-positioned widgets inside a container, then add responsive settings that below 768 switch the container to position:relative / display:flex / flex-direction:column AND the children to position:relative (un-pin). Publish + re-assert edit_mode=builder. Render at 1440 vs 390. Does the mobile-flow reflow (a) SURVIVE the PUT/kses (do the responsive position/display keys persist?) and (b) actually REFLOW (children stack vertically at 390, docW==390)? Report both booleans + what keys survived.',
  'STEP 4 — VERDICT: is abs-responsive BUILDABLE via the mobile-flow fallback? If yes, the targetedFixDirective = the precise build-absolute change (emit the responsive un-pin on root abs containers below 768) + expectedResponsiveLift (abs responsive 0.2-0.33 -> ~? ; abs corpus 0.625 -> ? ; router ceiling 0.654 -> ?). If kses strips even the responsive display/position keys, say abs-responsive is NOT buildable this way -> the router/flow split is the answer + abs stays desktop-only.',
  'Return {absResponsiveNow, whyLow, ksesStripsPerBreakpointOffsets, mobileFlowFallbackSurvivesKses, mobileFlowFallbackReflows, expectedResponsiveLift, viablePath, targetedFixDirective, honestVerdict}.',
].join('\n'), { label: 'abs-responsive-probe', phase: 'Probe', schema: SCHEMA })

log('ABS-RESPONSIVE: survives-kses=' + (out && out.mobileFlowFallbackSurvivesKses) + ' reflows=' + (out && out.mobileFlowFallbackReflows) + ' | ' + (out && out.honestVerdict))
return { diagnostic: out }

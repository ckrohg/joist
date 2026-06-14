export const meta = {
  name: 'stack-migration-dualarm',
  description: 'FIRST Claude+Codex DUAL-ARM (user-greenlit). Ships the clean-stack migration (Elementor 3.x legacy_v3) + proves the cross-model loop. Phase 1 (Claude): apply the 1-2 line html-widget custom-positioning fix to build-absolute.mjs (per CLEAN_STACK_MIGRATION.md) + build+grade tailwind on the local Elementor-3.x sandbox -> confirm schema-valid (no 422) + renders (not blank) + real composite. Phase 2 (CODEX, codex:codex-rescue — independent model): adversarially verify the fix is correct/complete + the clean-stack clone really rendered (not the blank trap) + no kept-recipe broken. Adopt iff Claude OK AND Codex VERIFIED, else restore. MUST run only when NO directed-fix round owns build-absolute.mjs.',
  phases: [
    { title: 'Implement', detail: 'Claude: html-widget fix + build+grade tailwind on the 3.x sandbox' },
    { title: 'Verify', detail: 'Codex: independent adversarial verification of the fix + clean-stack render' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const KN = '/Users/ckrohg/Documents/Claude/tenet-elementor/knowledge'

// ---- Phase 1: Claude implements + validates on the clean 3.x sandbox ----
phase('Implement')
const impl = await agent([
  'Ship the clean-stack migration fix. Work in ' + GRADER + '. Read ' + KN + '/CLEAN_STACK_MIGRATION.md FIRST (the exact root cause + minimal fix).',
  'ROOT CAUSE: build-absolute.mjs absPos() spreads Custom-Positioning keys (_position,_offset_orientation_h/v,_offset_x*,_offset_y*,_element_width,_element_custom_width,_z_index) onto EVERY widget incl. html; the Elementor HTML widget does NOT register the Custom-Positioning control group -> on Elementor 3.x the SchemaValidator 422-rejects 8 keys (heading/text/image register the group + pass). ',
  'FIX (build-absolute.mjs only, minimal): make the html widget NOT carry the Custom-Positioning keys — wrap each absolutely-positioned HTML widget in a positioned CONTAINER (the absPos/custom-positioning keys go on the container, which registers the group; the html widget keeps only its { html } + safe widget settings). Equivalent: emit the html widget as a child of a positioned container instead of positioning the html widget itself. Preserve identical rendered position. Keep ALL kept recipes (color r41/r44/r45/r48, nav-wrap, video, tabs, list, gradient, completeness landmarks) intact. cp build-absolute.mjs /tmp/ev-bk-build-stack.mjs first. node --check.',
  'VALIDATE on the clean Elementor-3.x sandbox (already on 3.28.4, legacy_v3, Hello theme): source /tmp/joist-auth-1.env (local sandbox JOIST_BASE=localhost:8001 + auth). Resolve the tailwind page id (seed-3146 slug) + ensure it is an Elementor doc (edit_mode=builder, data []). Build: node build-absolute.mjs --layout /tmp/p0-tailwind.json --page <id> (capture exists at /tmp/p0-tailwind.json; if missing, node capture-ensemble.mjs --source https://tailwindcss.com --out /tmp/p0-tailwind.json --passes 2). PUBLISH the page (status=publish) + re-assert edit_mode=builder. Then node grade-sections.mjs --source https://tailwindcss.com --clone "http://localhost:8001/?page_id=<id>" --out /tmp/sm-tw.',
  'CONFIRM: (a) the PUT returned 200 with NO 422 schema.invalid_settings (the fix worked); (b) _elementor_data is NON-EMPTY (not []); (c) the grade composite is a REAL number (not the blank-page ~0.10). Report PLAIN-TEXT starting "OK:" if all three hold (with the composite + the PUT status + a 1-line diff summary) or "FAILED:" (with which condition failed). Leave the fix IN PLACE for Codex to verify.',
].join('\n'), { label: 'claude:stack-fix', phase: 'Implement' })
log('CLAUDE impl: ' + String(impl || '').slice(0, 300))

// ---- Phase 2: Codex independently verifies (cross-model adversarial) ----
phase('Verify')
const verify = await agent([
  'INDEPENDENT ADVERSARIAL VERIFICATION (Codex is UNAVAILABLE in this env — ChatGPT-account model-tier error; this is the interim SAME-MODEL fallback: you are a FRESH independent reviewer with no stake in the implementer being right — be maximally skeptical, try to FALSIFY the claim). Work in ' + GRADER + '. A prior agent applied a clean-stack fix to build-absolute.mjs and claims it makes the cloner schema-valid + rendering on Elementor 3.x. Find a flaw if one exists.',
  'Claude reported: ' + String(impl || '(no report)').slice(0, 600),
  'VERIFY independently: (1) DIFF the fix: `diff /tmp/ev-bk-build-stack.mjs build-absolute.mjs` — is the change correct + MINIMAL + scoped to html widgets only? Did it remove the Custom-Positioning keys from OTHER widget types (would break their positioning)? Did it break any kept recipe (color/nav/video/tabs/list/gradient/completeness)? (2) REALITY-CHECK the clean-stack render: read /tmp/sm-tw/sections.json — is the composite a REAL number (NOT ~0.10 blank)? Independently confirm _elementor_data is non-empty on the sandbox page (source /tmp/joist-auth-1.env; curl the joist pages GET or wp). (3) Confirm the PUT had NO 422 (re-build or read the log if needed). (4) Sanity: does the rendered clone page actually have content (curl http://localhost:8001/?page_id=<id> | check non-trivial body)? ',
  'Return PLAIN-TEXT verdict: "VERIFIED:" (fix correct + complete + clean-stack genuinely renders, with the evidence you checked) or "FLAW-FOUND:" (the specific problem — e.g. other widgets affected, render still blank, recipe broken, composite is the blank-page artifact). Do NOT rubber-stamp; if you cannot confirm the render is real, say FLAW-FOUND.',
].join('\n'), { label: 'independent-verify', phase: 'Verify' }).catch((e) => 'verify-failed: ' + (e && e.message))
log('INDEPENDENT verify: ' + String(verify || '').slice(0, 300))

// ---- Decide ----
const claudeOK = /^\s*OK:/i.test(String(impl || ''))
const codexOK = /\bVERIFIED:/i.test(String(verify || '')) && !/\bFLAW-FOUND:/i.test(String(verify || ''))
let verdict
if (claudeOK && codexOK) {
  verdict = 'ADOPTED — clean-stack fix kept (built schema-valid + rendering on Elementor 3.x; independent fresh-Claude reviewer VERIFIED). NOTE: interim SAME-MODEL verify — Codex unavailable (ChatGPT-account model-tier error); re-run with true cross-model Codex once its auth is fixed.'
} else {
  await agent('Restore the pre-fix build-absolute: cd ' + GRADER + ' && cp /tmp/ev-bk-build-stack.mjs build-absolute.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Verify' })
  verdict = 'REVERTED — ' + (!claudeOK ? 'Claude build did not pass (schema/render).' : 'Codex flagged a flaw: ' + String(verify || '').slice(0, 200))
}
log('STACK-MIGRATION DUAL-ARM: ' + verdict)
return { verdict, claude: String(impl || '').slice(0, 800), codex: String(verify || '').slice(0, 800) }

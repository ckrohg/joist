export const meta = {
  name: 'flow-clean-stack-validate',
  description: 'Test the REFRAMED clean-stack path: build-flow.mjs (flex/grid CONTAINERS, NO custom-positioning) should write schema-valid + render with a SANE layout on the clean Elementor-3.x sandbox — UNLIKE build-absolute, which is coupled to 4.x custom-positioning and produced a 2.76x-tall destroyed stack on 3.x. If flow renders sane on 3.x, the clean-stack farm path = flow builder on Elementor-3.x. Independent-Claude adversarial verify (Codex still unavailable).',
  phases: [
    { title: 'Build', detail: 'build-flow tailwind on the 3.x sandbox + grade (no 422? renders? hRatio sane?)' },
    { title: 'Verify', detail: 'independent reviewer: is the layout actually sane (not destroyed), not just non-blank?' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const impl = await agent([
  'Test whether the FLOW builder works on the clean Elementor-3.x sandbox (the reframed clean-stack path). Work in ' + GRADER + '. Do NOT edit build-absolute.mjs. You MAY make MINIMAL build-flow.mjs fixes if it hits a 3.x schema issue (flow uses flex/grid CONTAINERS + native widgets, NO custom-positioning, so it SHOULD be clean — but verify).',
  'STEPS: source /tmp/joist-auth-1.env (local sandbox JOIST_BASE=localhost:8001, Elementor 3.28.4, Hello). Resolve the tailwind page (seed-3146 slug) id; ensure it is an Elementor doc (edit_mode=builder, data []). Build: node build-flow.mjs --layout /tmp/p0-tailwind.json --page <id> (capture exists at /tmp/p0-tailwind.json; else node capture-ensemble.mjs --source https://tailwindcss.com --out /tmp/p0-tailwind.json --passes 2). PUBLISH (status=publish) + re-assert edit_mode=builder. Grade: node grade-sections.mjs --source https://tailwindcss.com --clone "http://localhost:8001/?page_id=<id>" --out /tmp/fcs-tw.',
  'CONFIRM + REPORT the KEY numbers (this is what build-absolute FAILED on 3.x): (a) PUT 200 with NO 422 schema.invalid_settings? (b) _elementor_data non-empty? (c) composite + esp. hRatio/heightRatio — is it ~1.0 (SANE layout) or blown up like build-absolute\'s 2.76x? (d) how many containers rendered + did the flex/grid layout hold (not a collapsed vertical stack)? ',
  'Return PLAIN-TEXT starting "OK:" if flow writes schema-valid + renders with a SANE layout (hRatio not blown up) on 3.x, or "FAILED:" (with the blocking issue). Leave the result for the reviewer.',
].join('\n'), { label: 'flow-on-3x', phase: 'Build' })
log('FLOW-on-3.x: ' + String(impl || '').slice(0, 300))

const verify = await agent([
  'INDEPENDENT ADVERSARIAL VERIFICATION (Codex unavailable -> interim fresh-Claude reviewer; be maximally skeptical — the LAST build-absolute migration LOOKED OK on surface metrics but had a 2.76x-tall DESTROYED layout that only a real render check caught). Work in ' + GRADER + '. A prior agent claims the FLOW builder renders SANE on the Elementor-3.x sandbox.',
  'Prior report: ' + String(impl || '(none)').slice(0, 500),
  'VERIFY by ACTUALLY RENDERING (do not trust the composite alone): (1) read /tmp/fcs-tw/sections.json — hRatio/heightRatio: is the clone height ~= source (sane) or blown up (destroyed)? (2) render http://localhost:8001/?page_id=<id> headless at 1440 (or curl + measure) — count containers + check the layout is NOT a collapsed single-column 2-3x-tall stack; (3) confirm no 422 + _elementor_data non-empty; (4) is the flex/grid layout actually holding (multi-column rows present where the source has them)? ',
  'Return "VERIFIED:" (flow renders a SANE layout on 3.x — the clean-stack path is viable) or "FLAW-FOUND:" (layout destroyed / blank / 422 / collapsed). Do NOT rubber-stamp a non-blank-but-broken layout (that was the last failure mode).',
].join('\n'), { label: 'independent-verify', phase: 'Verify' }).catch((e) => 'verify-failed: ' + (e && e.message))
log('VERIFY: ' + String(verify || '').slice(0, 300))

const ok = /^\s*OK:/i.test(String(impl || '')) && /\bVERIFIED:/i.test(String(verify || '')) && !/\bFLAW-FOUND:/i.test(String(verify || ''))
const verdict = ok
  ? 'CLEAN-STACK PATH CONFIRMED — build-flow renders a SANE layout on Elementor 3.x (independent-verified). Farm path = flow builder on Elementor-3.x sandboxes.'
  : 'NOT confirmed — ' + (/^\s*OK:/i.test(String(impl || '')) ? 'reviewer flagged: ' + String(verify || '').slice(0, 200) : 'build failed: ' + String(impl || '').slice(0, 200))
log('FLOW-CLEAN-STACK: ' + verdict)
return { verdict, impl: String(impl || '').slice(0, 800), verify: String(verify || '').slice(0, 800) }

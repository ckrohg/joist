export const meta = {
  name: 'grader-deep-flatten',
  description: 'SUPERVISED grader-honesty fix (corrects a confirmed false-deflation). The grader clone-capture (capture-layout MAXD=8 + 40-leaf flatten cap) under-counts deep-DOM clones — framer clone renders 392 leaves but the grader resolves 49 (1 text leaf), one cap swallowing the depth-22 page -> areaCoverage 0.048 vs ~0.65 honest -> composite deflated ~0.59->0.51. Asymmetric (source 96% vs clone 11%) so NOT self-cancelling. FIX: grader-side deep-flatten — page-spanning wrappers (box.h>0.5*pageH) bypass the 40-cap + harvest all visible descendants, applied SYMMETRICALLY to source+clone in grade-sections, ISOLATED from the builder-input capture (capture-ensemble stays capped -> NO builder change -> avoids the round-42 clutter regression). Reversible flag + self-test=1.0 + independent adversarial verify + my-own-backup auto-restore.',
  phases: [
    { title: 'Fold', detail: 'add deepFlatten opt-in to capture-layout flatten; grade-sections passes it for source+clone; self-test=1.0; framer honesty check' },
    { title: 'Verify', detail: 'independent reviewer: self-test holds both modes, symmetry, BUILDER capture UNCHANGED, framer rises honestly, reversibility' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const impl = await agent([
  'Implement a SUPERVISED grader-honesty fix that corrects a CONFIRMED false-deflation. Work in ' + GRADER + '. source /tmp/joist-auth.env for WP auth. Never print JOIST_AUTH_B64.',
  'CONTEXT (from grader-coverage-undercount-diagnostic wlui7yahj): grade-sections measures areaCoverage by capturing the SOURCE and the CLONE (via capture-layout.mjs flatten path, lines ~436-503) and matching source regions to clone widgets. The 40-leaf flatten cap + MAXD=8 collide with a deep clone DOM (framer clone is depth-22): ONE page-spanning container hits the cap and only ~40 of ~392 leaves are surfaced -> the clone resolves 49 nodes (1 text) vs 392 rendered -> areaCoverage crushed to 0.048 (honest ~0.65). The SOURCE (well-nested) never hits the cap, so it is ASYMMETRIC = a real false-deflation. (Verified: uncapping a well-nested source changes nothing.)',
  'THE FIX (isolated to the GRADER measurement; the BUILDERS must be untouched):',
  '1. capture-layout.mjs: add an OPT-IN param/option `deepFlatten` (default FALSE = exact current behavior). When deepFlatten===true, in the flatten branch, a container whose box.h > 0.5*pageH (a PAGE-SPANNING wrapper, NOT a card) BYPASSES the 40-leaf cap and harvests ALL visible text/img/svg/video descendants (dedup by text@y exactly as leaf() already does). Cards/normal containers (box.h <= 0.5*pageH) keep the 40-cap unchanged.',
  '2. grade-sections.mjs: pass deepFlatten=true to BOTH the source capture AND the clone capture used for the coverage metric (SYMMETRIC — this is essential; both sides use the same rule). Add reversibility: const USE_DEEP_FLATTEN = !process.env.GRADER_NO_DEEP_FLATTEN — when GRADER_NO_DEEP_FLATTEN=1, grade-sections passes deepFlatten=false (exact prior behavior).',
  '3. DO NOT change capture-ensemble.mjs or how the BUILDERS capture their input — they must keep the 40-cap (raising builder capture nodes regressed all sites at round 42 via clutter). Only the GRADER measurement gets deepFlatten. DO NOT change the matching/scoring math — only the node-surfacing.',
  'STEP 0: cp capture-layout.mjs /tmp/ev-bk-capture-df.mjs ; cp grade-sections.mjs /tmp/ev-bk-grade-df.mjs (back up).',
  'STEP 1: implement. node --check both files.',
  'STEP 2 SELF-TEST (HARD): node grade-sections.mjs --source https://tailwindcss.com --selftest -> MUST be composite 1.0 (deepFlatten is symmetric so source-vs-source is unaffected). ALSO GRADER_NO_DEEP_FLATTEN=1 selftest -> still 1.0 (reversibility). If either fails, restore both backups + report FAILED.',
  'STEP 3 HONESTY CHECK: re-grade framer clone (node grade-sections.mjs --source https://www.framer.com --clone "https://georges232.sg-host.com/?page_id=6005" --out /tmp/df-framer): areaCoverage should climb from ~0.048 toward ~0.55-0.75 and the resolved clone-node count from ~49 toward ~300+. Report the before (GRADER_NO_DEEP_FLATTEN=1) vs after numbers.',
  'STEP 4 SYMMETRY+ISOLATION CHECK: confirm (a) a WELL-NESTED source is unchanged by deepFlatten (re-capture tailwind SOURCE both modes -> same leaf count, proving symmetry/no over-count); (b) capture-ensemble (builder input) output is BYTE-IDENTICAL both modes (the builders are unaffected — same clone would be built).',
  'Return PLAIN-TEXT starting "OK:" if implemented + self-test 1.0 (both modes) + framer coverage rises honestly + source unchanged + builder-capture unchanged, else "FAILED:". Leave it in place for the reviewer.',
].join('\n'), { label: 'fold:grader-deep-flatten', phase: 'Fold' })
log('GRADER-DEEP-FLATTEN impl: ' + String(impl || '').slice(0, 250))

const verify = await agent([
  'INDEPENDENT ADVERSARIAL VERIFICATION (be skeptical — this is a SUPERVISED grader change that RE-BASELINES the corpus; a wrong move corrupts every verdict). Work in ' + GRADER + '. A prior agent added a grader-side deepFlatten to capture-layout + grade-sections to fix a confirmed clone-capture undercount.',
  'Prior report: ' + String(impl || '(none)').slice(0, 500),
  'VERIFY (run things yourself, do not trust the report): (1) self-test source-vs-source composite=1.0 in BOTH modes (default + GRADER_NO_DEEP_FLATTEN=1) — symmetry intact; (2) framer 6005 areaCoverage genuinely rises (0.048 -> ~0.55+) AND the resolved clone-node count rises (~49 -> ~300+) — confirm it is counting REAL rendered widgets, not fabricating; (3) ISOLATION: capture-ensemble (builder input) output is unchanged both modes (the BUILDERS are not affected — no round-42 clutter risk); (4) SYMMETRY: a well-nested SOURCE (tailwind) capture is unchanged by deepFlatten (no source over-count that would re-inflate the OTHER way); (5) reversibility: GRADER_NO_DEEP_FLATTEN=1 reproduces the EXACT prior areaCoverage on framer (~0.048). (6) Sanity: deepFlatten only bypasses the cap for box.h>0.5*pageH (page-spanning), not for cards. Return "VERIFIED:" or "FLAW-FOUND:" with specifics.',
].join('\n'), { label: 'independent-verify', phase: 'Verify' }).catch((e) => 'verify-failed: ' + (e && e.message))
log('VERIFY: ' + String(verify || '').slice(0, 250))

const implOK = /\bOK:/i.test(String(impl || '')) && !/\bFAILED:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
const verifyOK = /\bVERIFIED:/i.test(String(verify || '')) && !/\bFLAW-FOUND:/i.test(String(verify || ''))
const ok = implOK && verifyOK
let verdict
if (ok) verdict = 'ADOPTED — grader deep-flatten corrects the confirmed clone-capture false-deflation (framer areaCoverage 0.048->honest ~0.6+; symmetric; builders UNCHANGED; reversible GRADER_NO_DEEP_FLATTEN=1; self-test 1.0 both modes; independent-verified). Corpus re-baselines HONESTLY upward on deep-DOM clones. Re-run the flow-corpus + absolute-corpus to capture the honest new baselines.'
else { await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-capture-df.mjs capture-layout.mjs && cp /tmp/ev-bk-grade-df.mjs grade-sections.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Verify' }); verdict = 'REVERTED — ' + (implOK ? 'reviewer flagged: ' + String(verify || '').slice(0, 200) : 'impl failed: ' + String(impl || '').slice(0, 200)) }
log('GRADER-DEEP-FLATTEN: ' + verdict)
return { verdict, impl: String(impl || '').slice(0, 700), verify: String(verify || '').slice(0, 700) }

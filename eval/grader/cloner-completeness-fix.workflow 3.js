export const meta = {
  name: 'cloner-completeness-fix',
  description: 'CLONER-side fix for the user-flagged gap (clones miss nav/hero/CTA/footer): make build-absolute emit recognizable whole-page COMPONENTS + explicit ARIA landmark roles so grade-completeness detects them. Capability-before-incentive: this raises the completeness SHADOW score before completeness is promoted into the composite. Gate = completeness shadow RISES + composite (grade-sections, responsive-on) NO-REGRESSION + self-test. Edits build-absolute.mjs ONLY. SCHEMALESS agent (avoids the StructuredOutput crash).',
  phases: [{ title: 'Fix+Gate', detail: 'emit landmark components; A/B completeness + composite on 2 sites; keep or restore' }],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const fix = await agent([
  'CLONER completeness fix. Work in ' + GRADER + '. Edit build-absolute.mjs ONLY. Goal: make the clone reproduce recognizable WHOLE-PAGE COMPONENTS so grade-completeness.mjs stops flagging them missing. Read knowledge/WEBSITE_COMPLETENESS_GRADING.md + grade-completeness.mjs first to see exactly what it detects (ARIA landmark roles + position bands + content signatures: header/nav, logo, hero, primary CTA, main, FOOTER+subparts).',
  'CONCRETE EDITS (build-absolute.mjs):',
  '1. EXPLICIT LANDMARK ROLES (kses-safe — role= survives, proven by the tabs recipe): the existing nav-wrap html-widget gets role="navigation"; wrap the top header band in role="banner"; emit the primary content area with role="main" (EXACTLY ONE — fix the 2-main cardinality violation grade-completeness found: ensure only a single role=main/<main> is emitted); wrap the bottom-band content in a real FOOTER (html widget <footer role="contentinfo"> ... </footer>) carrying the captured footer links/legal/copyright text.',
  '2. FOOTER COMPONENT: if a captured bottom band exists (y near pageH with links/copyright/legal text), emit it as a single role=contentinfo footer component wrapping those leaves (like the nav-wrap recipe but for the footer). ',
  '3. HERO + CTA: ensure the first above-the-fold large heading + its primary button land as recognizable text/button leaves (not collapsed/rastered) so the hero+CTA detectors fire.',
  'Keep ALL kept recipes (color r41/r44/r45/r48, nav-wrap, video, tabs, list, gradient) intact. No rasterization. node --check after.',
  'STEP 0: cp build-absolute.mjs /tmp/ev-bk-build-complete.mjs',
  'STEP 1: implement. node --check build-absolute.mjs.',
  'STEP 2 SELF-TEST: node grade-sections.mjs --source https://resend.com --selftest -> composite MUST be 1.0 (else restore + report FAILED).',
  'STEP 3 A/B GATE (source /tmp/joist-auth.env) on TWO absolute corpus sites tailwind(page 3146, src https://tailwindcss.com) + supabase(page 2986, src https://supabase.com): for each, BEFORE = restore /tmp/ev-bk-build-complete.mjs then build+grade; AFTER = re-apply then build+grade. Grade BOTH: node grade-completeness.mjs --source <src> --clone "https://georges232.sg-host.com/?page_id=<id>" (completenessScore) AND node grade-sections.mjs --source <src> --clone <clone> (composite). Report per site: completeness OLD->NEW + composite OLD->NEW + which components flipped present.',
  'DECIDE: KEEP (leave NEW in place) iff self-test=1.0 AND completeness RISES on both sites AND composite does NOT regress (>EPS 0.01) on either. Else restore /tmp/ev-bk-build-complete.mjs.',
  'Return PLAIN-TEXT: start "OK:" if kept (with per-site completeness OLD->NEW + composite OLD->NEW + components-now-present) or "RESTORED:" if reverted (with why). End with that text.',
].join('\n'), { label: 'cloner-completeness', phase: 'Fix+Gate' })
log('CLONER-COMPLETENESS: ' + String(fix || '').slice(0, 400))
return { fix: String(fix || '').slice(0, 1400) }

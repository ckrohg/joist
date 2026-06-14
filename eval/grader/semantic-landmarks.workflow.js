export const meta = {
  name: 'semantic-html5-landmarks',
  description: 'STRUCT_SEMANTIC (default OFF): set each top-level container Elementor HTML-tag from its structural role — nav band -> <nav>, each section -> <section>, footer -> <footer>, page root -> <main> — for SEO + a11y + round-trip editability (Navigator legibility), AND to fix the footer-mis-paired-as-section grader artifact. Gate: byte-identical-off + LIVE rendered HTML carries the semantic tags (survives kses) + no-h-scroll + corpus no-reg; auto-restore; verify.',
  phases: [{ title: 'Build+Gate' }, { title: 'Verify' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SUPA = '/tmp/glob-supa.json'
const BASELINE_OFF = '/tmp/allflags-off-baseline.json'
const PAGE = '12446'
const CLONE_URL = '' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/incomplete-clone-scratch-was-12999/'

phase('Build+Gate')
const build = await agent(
  [
    'Add STRUCT_SEMANTIC (env, default OFF) to build-structured.mjs (in ' + GRADER + ') — emit SEMANTIC HTML5 landmarks by setting each top-level container Elementor HTML-tag from its structural role: the NAV band -> "nav", each SECTION container (the per-section full-width containers, _element_id sec-N) -> "section", the FOOTER container -> "footer", and the page ROOT container -> "main". Additive + flag-gated + default-OFF (byte-identical when off). FIRST: cp build-structured.mjs /tmp/bs.semantic2.bak (RESTORE on gate fail). Return PLAIN TEXT (no StructuredOutput tool).',
    '',
    'STEP A — find the correct Elementor container HTML-TAG key. Elementor 3.x flexbox containers support an HTML-Tag control. Determine the exact settings key + valid values (likely the container settings field for the wrapper tag — e.g. settings on the elType:"container" node). You can introspect via the joist atomic schema tool, or test a small PUT, or inspect how Elementor stores it. CONFIRM the chosen key (a) is accepted by the Joist save (NOT stripped by kses / not a 422), and (b) actually renders the semantic tag in the live HTML. If the native container-tag control is unavailable/stripped on this 4.0.x stack, FALL BACK to wrapping the section content in an html widget carrying the semantic tag, OR report that the stack cannot carry semantic container tags (a finding).',
    '',
    'STEP B — set tags by role in build-structured: nav container -> nav; buildSection section container -> section; buildFooter container -> footer; root container -> main. (Use the existing nav/section/footer/root structure; no section-spec dependency required.) Inner/boxed wrappers + widgets stay div/default. Gate behind STRUCT_SEMANTIC.',
    '',
    'GATE (RESTORE on any fail):',
    '1. flag-OFF byte-identical: node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/sem-off.json ; cmp to ' + BASELINE_OFF + '. MUST be byte-identical (also confirm STRUCT_LEGACY=1 keeps it off).',
    '2. LIVE SEMANTIC TAGS (the real gate — must survive kses + render): source /tmp/joist-auth.env (NEVER print JOIST_AUTH_B64). Publish full stack + STRUCT_SEMANTIC=1 to page ' + PAGE + ' ; curl the live page (unique ?v=) and confirm the rendered HTML contains real <nav, <section, and <footer tags (count them; need >=1 footer, >=1 nav, >=3 section). If the tags do NOT appear live (kses-stripped / Elementor ignored the key), the recipe does not work on this stack -> report kept=false + the finding + RESTORE.',
    '3. no-h-scroll + corpus no-reg: capture the published page (max leaf x1<=1440); STRUCT_SEMANTIC=1 node build-structured.mjs --layout <f> --selftest OK for ' + SUPA + ' /tmp/cap-tailwind-off.json /tmp/br-basecamp.json /tmp/ab-vercel-NEW.json (the selftest tree-validators must still pass; semantic tags must not break the structure).',
    '4. (bonus) footer-pairing: segment the published clone capture — is the footer now detected as a footer (not a trailing section)? report y/n.',
    'kept = gate1 (byte-identical-off) AND gate2 (live HTML has <nav>/<section>/<footer>) AND gate3 (no-h-scroll + corpus selftest OK).',
    '',
    'END with one line exactly: "VERDICT: KEPT" or "VERDICT: NOT-KEPT". Before it: the Elementor tag key used (+ kses-survived y/n), flag-off byte-identical (y/n), live <nav>/<section>/<footer> counts, no-h-scroll (y/n), corpus (pass/fail), footer-now-detected (y/n). If NOT-KEPT, whether the stack cannot carry semantic tags (finding) or a fixable issue.',
  ].join('\n'),
  { label: 'build:semantic', phase: 'Build+Gate' }
)

const buildKept = /VERDICT:\s*KEPT/i.test(String(build || ''))
if (!buildKept) {
  log('semantic build NOT-KEPT (maybe stack strips container tags) — recorded; agent should restore')
  return { kept: false, reason: 'live tags not rendered / stack strips them, or gate fail', build: String(build || '').slice(0, 1800) }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer. FALSIFY. Work in ' + GRADER + '. Do NOT edit files. Return PLAIN TEXT.',
    'build-structured.mjs gained STRUCT_SEMANTIC (default OFF): sets container HTML-tags nav/section/footer/main. Implementer reported KEPT (live HTML carries the semantic tags, byte-identical-off, no-h-scroll, corpus OK).',
    'VERIFY: (1) flag-OFF byte-identical: node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/rev-sem-off.json ; cmp to ' + BASELINE_OFF + '. If not identical -> FLAW. (2) LIVE TAGS (the core claim): publish supabase with STRUCT_SEMANTIC=1 to a scratch page yourself (source /tmp/joist-auth.env, NEVER print it) OR re-curl the implementer\'s published page; confirm the LIVE rendered HTML actually contains <nav / <section / <footer (not just in the tree — kses could strip them). If they are absent live -> FLAW (the recipe does not work). (3) no-h-scroll + corpus selftest OK with the flag. (4) only build-structured.mjs changed + node --check.',
    'END with one line: "VERDICT: VERIFIED" or "VERDICT: FLAW" (reason). Report the live tag counts you observed.',
  ].join('\n'),
  { label: 'verify:semantic', phase: 'Verify' }
)

const verified = /VERDICT:\s*VERIFIED/i.test(String(verify || '')) && !/VERDICT:\s*FLAW/i.test(String(verify || ''))
return {
  kept: verified,
  verdict: verified
    ? 'ADOPTED (default-OFF) — STRUCT_SEMANTIC: nav/section/footer/main HTML5 landmarks render live (SEO/a11y/editability), byte-identical-off, no h-scroll, independently verified'
    : 'NOT KEPT — gate/verify failed OR the 4.0.x stack strips container semantic tags (finding); build-structured restored',
  build: String(build || '').slice(0, 1400),
  review: String(verify || '').slice(0, 1000),
}

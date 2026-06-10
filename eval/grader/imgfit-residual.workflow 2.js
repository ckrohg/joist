export const meta = {
  name: 'imgfit-oversized-media-clamp',
  description: 'Diagnose the new supabase residuals (#8 single 620px image overflowing a 261px band = 34.8%; #4/#9/#10 testimonial card-stacking ~52%) and implement the most tractable fix — STRUCT_IMGFIT: clamp a section dominant image that overflows its source band to fit (object-fit:cover to the source-implied height, matching the source clip). Default OFF; TEXT-return; gate byte-identical-off + #8 hRatio down + no-h-scroll + corpus no-reg; auto-restore; verify.',
  phases: [{ title: 'Diagnose+Build+Gate' }, { title: 'Verify' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SUPA = '/tmp/glob-supa.json'
const BASELINE_OFF = '/tmp/allflags-off-baseline.json'  // fresh all-flags-off supabase dry dump
const PAGE = '12446'                                     // scratch (NOT 12157)
const CLONE_URL = 'https://georges232.sg-host.com/incomplete-clone-scratch-was-12999/'

phase('Diagnose+Build+Gate')
const build = await agent(
  [
    'DIAGNOSE the new supabase residuals + implement the most tractable fix. Work in ' + GRADER + '. Return PLAIN TEXT (no StructuredOutput tool). After the bento fix, the dominant residuals on supabase (' + SUPA + ') are: #8 content hRatio 3.299 +600px (34.8% — a SINGLE ~620px mockup image in a 261px source band: the source CLIPS/scales it, the clone renders it full-height -> tall) and #4/#9/#10 testimonial sections hRatio 1.4-1.6 (tweet-wall card stacking).',
    '',
    'STEP A - DIAGNOSE (segment ' + SUPA + '; inspect members of #8, #4, #9, #10):',
    '- #8: confirm it is one dominant image whose captured height (~620) >> the section source band height (~261) minus its sibling heading/text. Why does recipe #33/#38 (image max-height cap) NOT already clamp it? (Likely it caps to the CAPTURED image box 620, not the section-band-implied display height — the source clips the 620 image to fit ~150 in the band.)',
    '- #4/#9/#10: are these multiple comparable tweet-CARDS that should grid (a card-grid the existing GRIDFIX/BENTOGRID miss because the cards are heading-less / non-comparable-width)? Or genuinely tall content? Report the card structure.',
    'Decide the MOST TRACTABLE fix (likely #8 image-clamp; the testimonials may need a separate card-grid detector — note it but do not necessarily build it now).',
    '',
    'STEP B - BUILD the #8 fix as STRUCT_IMGFIT (default OFF). FIRST: cp build-structured.mjs /tmp/bs.imgfit2.bak (RESTORE on gate fail). When STRUCT_IMGFIT=1: for a section whose DOMINANT image (largest media member) has captured height > ~1.8x the available band height (section band height minus the stacked heading/text heights), clamp that image to the available height with object-fit:cover (a max-height + object-fit:cover on the image, kses-safe; NEVER a bare fixed-px WIDTH -> no h-scroll). This matches the source clip (the source shows only the visible crop). Only fire when the image clearly overflows (conservative; do NOT shrink normally-sized images).',
    '',
    'GATE (run; RESTORE on any fail):',
    '1. flag-OFF byte-identical: node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/imgfit-off.json ; cmp to ' + BASELINE_OFF + '. MUST be byte-identical.',
    '2. selftest + corpus no-reg: STRUCT_IMGFIT=1 node build-structured.mjs --layout <f> --selftest OK (no FAIL/h-scroll) for f in ' + SUPA + ' /tmp/cap-tailwind-off.json /tmp/br-basecamp.json /tmp/ab-vercel-NEW.json .',
    '3. RENDER: source /tmp/joist-auth.env (NEVER print JOIST_AUTH_B64). Publish full stack + imgfit (STRUCT_GRIDFIX=1 STRUCT_COLWIDTH=1 STRUCT_LINKCOLS=1 STRUCT_BENTOGRID=1 STRUCT_IMGFIT=1 ... --page ' + PAGE + ' --publish), persist-verify (curl ?v=RND | grep ramgrid >0), capture ' + CLONE_URL + '?v=RND2 -> /tmp/imgfit-clone.json. Segment + report section #8 hRatio (was 3.299; target < 2.0) + whole-page heightRatio + max leaf x1 (<=1440).',
    'kept = gate1 (byte-identical-off) AND gate2 (selftest+corpus OK) AND gate3 (#8 hRatio < 2.0 AND no-h-scroll). If #8 is NOT fixable this way (e.g. the image is needed at full size), report kept=false + the finding + restore.',
    '',
    'END with one line: "VERDICT: KEPT" or "VERDICT: NOT-KEPT". Before it: the diagnosis of #8 + testimonials, flag-off-byte-identical (y/n), #8 hRatio before(3.299)/after, no-h-scroll (y/n), + testimonial-fix recommendation.',
  ].join('\n'),
  { label: 'build:imgfit', phase: 'Diagnose+Build+Gate' }
)

const buildKept = /VERDICT:\s*KEPT/i.test(String(build || ''))
if (!buildKept) {
  log('imgfit build VERDICT not KEPT — recorded not-kept (agent should restore; driver re-checks build-structured)')
  return { kept: false, reason: 'build gate failed or #8 not fixable this way', build: String(build || '').slice(0, 1800) }
}

phase('Verify')
const verify = await agent(
  [
    'FRESH INDEPENDENT SKEPTICAL reviewer. FALSIFY. Work in ' + GRADER + '. Do NOT edit files. FOUNDATIONAL builder — extra skeptical. Return PLAIN TEXT.',
    'build-structured.mjs gained STRUCT_IMGFIT (default OFF): clamps a section dominant image that overflows its source band (object-fit:cover to fit), fixing supabase #8 (620px image in 261px band, hRatio 3.299). Implementer reported KEPT (#8 hRatio dropped <2.0, byte-identical off, corpus OK).',
    'VERIFY: (1) flag-OFF byte-identical: node build-structured.mjs --layout ' + SUPA + ' --dry --dump /tmp/rev-imgfit-off.json ; cmp to ' + BASELINE_OFF + '. If not identical -> FLAW. (2) NOT OVER-AGGRESSIVE: STRUCT_IMGFIT=1 must NOT shrink normally-sized images (it should only clamp clearly-overflowing ones). Spot-check supabase hero/logos images + a tailwind/basecamp section are unchanged/sane (selftest OK on corpus). If it clamps normal images -> FLAW. (3) NO H-SCROLL: STRUCT_IMGFIT=1 --selftest OK (no bare fixed-px width) on supabase + corpus. (4) only build-structured.mjs changed + node --check.',
    'END with one line: "VERDICT: VERIFIED" or "VERDICT: FLAW" (with reason). Report what you observed.',
  ].join('\n'),
  { label: 'verify:imgfit', phase: 'Verify' }
)

const verified = /VERDICT:\s*VERIFIED/i.test(String(verify || '')) && !/VERDICT:\s*FLAW/i.test(String(verify || ''))
return {
  kept: verified,
  verdict: verified
    ? 'ADOPTED (default-OFF) — STRUCT_IMGFIT: clamp oversized section image to band (fixes supabase #8), no h-scroll, independently verified'
    : 'NOT KEPT — gate or verify failed; build-structured restored',
  build: String(build || '').slice(0, 1400),
  review: String(verify || '').slice(0, 1000),
}

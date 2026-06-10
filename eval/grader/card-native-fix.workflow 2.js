export const meta = {
  name: 'card-native-fix',
  description: 'USER #4 PROPER FIX (overlap). The previous textMask only partially erased baked card text -> grey bleed-through under the live overlay (abase / world-most-trusted). Masking a screenshot is fragile AND violates the user element-level principle (a masked screenshot is still a chunk-screenshot). PROPER FIX (capture-layout.mjs, the rescued-text mockup branch ~line 347): for a text-bearing feature card, DROP the whole-card raster and recurse to NATIVE elements — heading + body as real text widgets, and capture ONLY the illustration sub-region as its own <img> leaf (element-level), never the text. No baked text -> no bleed. Verify by RENDER: card text clean (single set, no grey) + illustration present + image mass held + no major regression. Shared capture -> verify FLOW + ABS.',
  phases: [
    { title: 'Fix', detail: 'capture-layout: text-bearing card -> native recursion (heading/body widgets) + illustration-only img leaf; node --check + selftest 1.0' },
    { title: 'Verify', detail: 'rebuild+publish supabase-FLOW 6006 + abs 3146; render: card text clean (no grey bleed) + illustration present + no major regression' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'Edit ONLY capture-layout.mjs. Back it up FIRST to /tmp/ev-bk-capture-cardnative.mjs. Do NOT edit build-flow/build-absolute/grade-sections/perelement. capture-layout is SHARED -> verify FLOW + ABS. source /tmp/joist-auth.env. Never print JOIST_AUTH_B64.'

const fix = await agent([HARD_RULE,
  'Apply the PROPER USER #4 fix (kill the feature-card text bleed-through, element-level). Work in ' + GRADER + '. Read capture-layout.mjs: the mockup gate (~line 317), the rescued-text branch children:[mock, ...rescued] (~line 347), the textMask (the partial white-fill), and how a leaf vs a sub-region image is emitted.',
  'PROBLEM: text-bearing feature cards (supabase Database/Authentication/Edge Functions/Storage) are rasterized into a PNG that bakes ALL the card text; a live text overlay is then placed on top; the textMask only PARTIALLY erases the baked text so grey glyphs bleed through (abase, ull Postgres, world-most-trusted). Masking is fragile + a masked screenshot is still a chunk-screenshot (violates element-level).',
  'FIX (capture-layout.mjs ONLY): for a mockup region that has RESCUED TEXT (i.e. it is a content card, not pure imagery), do NOT emit the whole-card raster + masked overlay. Instead:',
  '1. DROP the whole-card raster and RECURSE into the card so its heading + body capture as NATIVE text leaves (real widgets), exactly like normal recursion. No baked text at all.',
  '2. If the card has a distinct ILLUSTRATION/graphic (an <img>/<svg>/<canvas> child, OR a clearly-non-text visual sub-region), capture ONLY that illustration sub-box as its own image leaf (element-level) so the card art is preserved — but NEVER include the text region in that image.',
  '3. KEEP the logo-wall decomposition (it works) + all other recipes. Only change the text-bearing-card path (rescued-text branch) from raster+mask to recurse+illustration-leaf.',
  'GUARD: if a card is genuinely image-dominant with NO separable text (rare), the existing raster path may stay. The corpus-gate + render-verify protect against losing card art. node --check capture-layout.mjs. SELF-TEST: node grade-sections.mjs --source https://resend.com --selftest -> composite 1.0. If not, restore + RESTORED.',
  'STEP 0: cp capture-layout.mjs /tmp/ev-bk-capture-cardnative.mjs (back up FIRST).',
  'Return PLAIN-TEXT starting "OK:" if edited + node --check + self-test pass, or "RESTORED:" if reverted. Describe how you route text-bearing cards to native + isolate the illustration.',
].join('\n'), { label: 'fix:card-native', phase: 'Fix' })
log('card-native fix: ' + String(fix || '').slice(0, 220))

let verify = null
if (fix && /\bOK:/i.test(String(fix)) && !/\bRESTORED:/i.test(String(fix))) {
  phase('Verify')
  const VSCHEMA = { type: 'object', additionalProperties: false, properties: {
    site: { type: 'string' }, page: { type: 'number' }, cardTextClean: { type: 'boolean' }, greyBleedGone: { type: 'boolean' },
    illustrationPresent: { type: 'boolean' }, composite: { type: 'number' }, prevComposite: { type: 'number' }, verdict: { type: 'string' },
  }, required: ['site', 'cardTextClean', 'verdict'] }
  const SITES = [
    { name: 'supabase-FLOW', url: 'https://supabase.com', page: 6006, builder: 'build-flow.mjs', prev: 0.633 },
    { name: 'tailwind-ABS', url: 'https://tailwindcss.com', page: 3146, builder: 'build-absolute.mjs', prev: 0.755 },
  ]
  verify = await parallel(SITES.map((s) => () => agent([HARD_RULE,
    'VERIFY the card-native fix on ONE clone. Work in ' + GRADER + '. site=' + s.name + ' page=' + s.page + ' builder=' + s.builder + ' prevComposite=' + s.prev + '. You MUST end by calling StructuredOutput.',
    'STEPS: node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/cn-' + s.name + '.json --passes 2 ; node ' + s.builder + ' --layout /tmp/cn-' + s.name + '.json --page ' + s.page + ' ; PUBLISH (status=publish).',
    'RENDER CHECK (isolated Playwright, 1440, ZOOM into the feature-card band): (a) cardTextClean = is the card text now a SINGLE clean set of labels (e.g. "Authentication" + its body) with NO doubled/garbled/grey-bleed text behind it? (b) greyBleedGone = is the baked grey text (abase / ull Postgres / world-most-trusted) GONE? (c) illustrationPresent = is the card illustration/graphic still visible (not lost when the raster was dropped)? Report what the cards show.',
    'GRADE: node grade-sections.mjs --source ' + s.url + ' --clone "https://georges232.sg-host.com/?page_id=' + s.page + '" --out /tmp/cng-' + s.name + ' ; composite vs prevComposite=' + s.prev + ' (no-major-regression guard).',
    'Return {site, page, cardTextClean, greyBleedGone, illustrationPresent, composite, prevComposite, verdict}.',
  ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify', schema: VSCHEMA }))).then((rs) => rs.filter(Boolean))
  for (const r of verify) log('VERIFY ' + r.site + ': cardTextClean=' + r.cardTextClean + ' bleedGone=' + r.greyBleedGone + ' illus=' + r.illustrationPresent + ' composite ' + r.prevComposite + '->' + r.composite)
} else { log('SKIPPED verify — fix not OK') }
return { fix: String(fix || '').slice(0, 500), verify }

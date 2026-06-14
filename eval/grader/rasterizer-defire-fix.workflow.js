export const meta = {
  name: 'rasterizer-defire-fix',
  description: 'USER FEEDBACK #3 (chunk-screenshots) + #4 (overlapping text) — ONE root cause: the mockup region-rasterizer (capture-layout.mjs:317) OVER-FIRES. It (a) rasterizes the trusted-by LOGO WALL as one chunk instead of per-logo <img>, and (b) rasterizes feature cards into PNGs that BAKE IN the title text, which then gets a live text overlay -> doubled/garbled "AuAuthentication". FIX (capture-layout.mjs): (1) LOGO/ICON-WALL guard before line 317 -> force normal recursion so each logo is its own image/svg leaf (no chunk); (2) for rasterized mockups WITH rescued text (the children:[mock,...rescued] branch ~line 347), MASK (white-out) the rescued-text bounding boxes in the cropped PNG before upload (~line 560 cropPng) so the baked text is gone and only the live overlay shows (no double-paint), keeping the card image. Verify by RENDER (logos individual + no overlapping text) + composite NO-MAJOR-REGRESSION (guards against image loss). Shared capture -> verify FLOW (where user saw it) + ABS no-reg.',
  phases: [
    { title: 'Fix', detail: 'capture-layout: logo-wall recursion guard + feature-card raster text-mask; node --check + selftest 1.0' },
    { title: 'Verify', detail: 'rebuild+publish supabase-FLOW 6006 + abs 3146; render: logos individual + NO overlapping card text + composite no-major-regression' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'Edit ONLY capture-layout.mjs. Back it up FIRST to /tmp/ev-bk-capture-defire.mjs. Do NOT edit build-flow/build-absolute/grade-sections/perelement. capture-layout is SHARED (both builders) -> verify FLOW + ABS no-regression. source /tmp/joist-auth.env. Never print JOIST_AUTH_B64.'

const fix = await agent([HARD_RULE,
  'Apply USER-FEEDBACK fixes #3 (no chunk-screenshots) + #4 (no overlapping text) — ONE root cause: the mockup region-rasterizer over-fires. Work in ' + GRADER + '. Read capture-layout.mjs around the mockup gate (line ~317), the rescued-text branch (children:[mock,...rescued] ~line 347), and cropPng (~line 560) to ground every edit.',
  'FIX (capture-layout.mjs ONLY) — TWO guards:',
  '1. LOGO/ICON-WALL DECOMPOSITION (fixes chunk-logos pt3): BEFORE the mockup gate at line 317, detect a logo/icon wall = a container whose direct/near media children are MANY (>=4 visible) AND UNIFORM-SMALL (each media getBoundingClientRect height roughly 16-80px AND area well under ~12% of the band) AND the band is SHORT (mb.h <= ~260) AND low real-text. When detected, do NOT rasterize -> fall through to NORMAL RECURSION so each logo becomes its OWN image/svg leaf (per-element). (Marquee duplicates are fine; dedup by src if needed.)',
  '2. FEATURE-CARD TEXT-MASK (fixes overlap pt4): in the rasterized-mockup-WITH-rescued-text branch (~line 347, children:[mock, ...rescued]), the source text is BAKED into the PNG UNDER the live overlay text -> double-paint. FIX: before cropPng (~line 560) writes/uploads the mockup PNG, PAINT WHITE (fillRect) over the bounding box of EVERY rescued text leaf in the cropped raster (translate each rescued leaf box into crop-local coords) so the baked text is erased and only the live overlay text shows. Keep the card IMAGE (do NOT drop the whole raster — masking preserves the visual while removing the duplicate text). If masking is infeasible for a given card (text covers >~60% of it = text-dominant, not image), DROP the raster + route to native recursion instead.',
  '3. node --check capture-layout.mjs. SELF-TEST: node grade-sections.mjs --source https://resend.com --selftest -> composite 1.0 (capture change is symmetric; selftest must hold). If not, restore + report RESTORED.',
  'STEP 0: cp capture-layout.mjs /tmp/ev-bk-capture-defire.mjs (back up FIRST).',
  'Return PLAIN-TEXT starting "OK:" if edited + node --check + self-test pass, or "RESTORED:" if reverted. Describe the logo-wall gate + the masking approach.',
].join('\n'), { label: 'fix:rasterizer-defire', phase: 'Fix' })
log('rasterizer-defire fix: ' + String(fix || '').slice(0, 220))

let verify = null
if (fix && /\bOK:/i.test(String(fix)) && !/\bRESTORED:/i.test(String(fix))) {
  phase('Verify')
  const VSCHEMA = { type: 'object', additionalProperties: false, properties: {
    site: { type: 'string' }, page: { type: 'number' }, logoCount: { type: 'number' }, logosIndividual: { type: 'boolean' },
    cardTextOverlap: { type: 'boolean' }, composite: { type: 'number' }, prevComposite: { type: 'number' }, imageMassHeld: { type: 'boolean' }, verdict: { type: 'string' },
  }, required: ['site', 'logosIndividual', 'cardTextOverlap', 'verdict'] }
  const SITES = [
    { name: 'supabase-FLOW', url: 'https://supabase.com', page: 6006, builder: 'build-flow.mjs', prev: 0.648 },
    { name: 'tailwind-ABS', url: 'https://tailwindcss.com', page: 3146, builder: 'build-absolute.mjs', prev: 0.755 },
  ]
  verify = await parallel(SITES.map((s) => () => agent([HARD_RULE,
    'VERIFY the rasterizer de-fire on ONE clone. Work in ' + GRADER + '. site=' + s.name + ' page=' + s.page + ' builder=' + s.builder + ' prevComposite=' + s.prev + '. You MUST end by calling StructuredOutput.',
    'STEPS: node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/df-' + s.name + '.json --passes 2 ; node ' + s.builder + ' --layout /tmp/df-' + s.name + '.json --page ' + s.page + ' ; PUBLISH (status=publish).',
    'RENDER CHECK (isolated Playwright, 1440): (a) for SUPABASE the trusted-by logo strip (betashares/submagic/mozilla/GitHub/1Password) — are the logos now INDIVIDUAL <img> elements (count them; logosIndividual=true if >=4 distinct img, NOT one chunked image)? (b) cardTextOverlap — do the feature cards (Database/Authentication/Edge Functions/Storage) still show DOUBLED/overlapping text, or is it clean now (one set of labels)? (c) imageMassHeld — are the card images / logo images still VISIBLE (the de-fire must not have lost the imagery)?',
    'GRADE: node grade-sections.mjs --source ' + s.url + ' --clone "' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/?page_id=' + s.page + '" --out /tmp/dfg-' + s.name + ' ; composite vs prevComposite=' + s.prev + ' (NO-MAJOR-REGRESSION guard against image loss; the grader does not yet penalize overlap/chunk so it will not reward the fix — that is fix #3).',
    'Return {site, page, logoCount, logosIndividual, cardTextOverlap, composite, prevComposite, imageMassHeld, verdict}.',
  ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify', schema: VSCHEMA }))).then((rs) => rs.filter(Boolean))
  for (const r of verify) log('VERIFY ' + r.site + ': logosIndividual=' + r.logosIndividual + ' overlapGone=' + (!r.cardTextOverlap) + ' imgHeld=' + r.imageMassHeld + ' composite ' + r.prevComposite + '->' + r.composite)
} else { log('SKIPPED verify — fix not OK') }
return { fix: String(fix || '').slice(0, 500), verify }

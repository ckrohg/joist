export const meta = {
  name: 'full-width-canvas-fix',
  description: 'USER FEEDBACK #1 (full-width) + removes leftover theme chrome. The clone renders in a centered ~1100px column because the page uses the DEFAULT Jupiter X theme template (Elementor mounts inside #jupiterx-primary.col-lg-12 boxed Bootstrap column), so content_width:full resolves against 1100px not the viewport. FIX: assign the elementor_canvas page template on write (in BOTH build-flow.mjs and build-absolute.mjs WP-write paths) so bands go full-bleed (x=0, width=viewport) AND the JupiterX header navbar (My WordPress + Search) is removed. Verify by RENDER (not grader — it does not measure full-bleed yet): bands span the viewport + theme navbar gone + composite no-regression. Backs up both builders.',
  phases: [
    { title: 'Fix', detail: 'set elementor_canvas template in both builders WP-write path; node --check' },
    { title: 'Verify', detail: 'rebuild+publish supabase flow 6006 + abs tailwind 3146; render at 1440; confirm full-bleed + no theme navbar + composite no-regression' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'Edit ONLY build-flow.mjs + build-absolute.mjs (the WP-write/PUT path — the page template assignment). Do NOT edit capture-layout/grade-sections/perelement. Back up both first. source /tmp/joist-auth.env. Never print JOIST_AUTH_B64.'

const fix = await agent([HARD_RULE,
  'Apply USER-FEEDBACK fix #1 (full-width). Work in ' + GRADER + '. Read the WP-write path in build-flow.mjs (~line 1265-1279, the PUT body + the _elementor_edit_mode meta POST) AND the equivalent in build-absolute.mjs to ground the edit.',
  'ROOT CAUSE (verified): the page uses the default Jupiter X theme template -> Elementor content is mounted in the theme boxed Bootstrap column (#jupiterx-primary.col-lg-12, ~1100px) -> content_width:full caps at 1100px, never the viewport; the theme also injects a "My WordPress + Search" navbar. FIX: assign Elementor Canvas template on the page so the theme chrome + boxed column are bypassed.',
  'FIX (build-flow.mjs AND build-absolute.mjs — the WP-write path):',
  '1. After the successful page PUT, set the page template to canvas. In the existing meta POST (the one that sets _elementor_edit_mode:builder), ALSO set the REST top-level `template` field to "elementor_canvas" AND the meta key `_wp_page_template`:"elementor_canvas". I.e. POST wp/v2/pages/<id> with body {template:"elementor_canvas", meta:{_elementor_edit_mode:"builder", _wp_page_template:"elementor_canvas"}}. (If a REST 400 says template not in the allowed set, fall back to writing ONLY meta._wp_page_template + a second POST of the top-level template; or use "elementor_header_footer" if canvas is unavailable.) Apply the SAME change in BOTH builders.',
  '2. node --check both files.',
  'STEP 0: cp build-flow.mjs /tmp/ev-bk-buildflow-fw.mjs ; cp build-absolute.mjs /tmp/ev-bk-buildabs-fw.mjs (back up FIRST).',
  'Return PLAIN-TEXT starting "OK:" if both files edited + node --check passes, or "RESTORED:" if you reverted. State the exact template-assignment code you added in each.',
].join('\n'), { label: 'fix:full-width-canvas', phase: 'Fix' })
log('full-width fix: ' + String(fix || '').slice(0, 220))

let verify = null
if (fix && /\bOK:/i.test(String(fix)) && !/\bRESTORED:/i.test(String(fix))) {
  phase('Verify')
  const VSCHEMA = { type: 'object', additionalProperties: false, properties: {
    site: { type: 'string' }, page: { type: 'number' }, fullBleed: { type: 'boolean' }, bandX: { type: 'number' }, bandWidth: { type: 'number' }, viewport: { type: 'number' },
    themeNavbarGone: { type: 'boolean' }, composite: { type: 'number' }, prevComposite: { type: 'number' }, verdict: { type: 'string' },
  }, required: ['site', 'fullBleed', 'verdict'] }
  const SITES = [
    { name: 'supabase-FLOW', url: 'https://supabase.com', page: 6006, builder: 'build-flow.mjs', prev: 0.675 },
    { name: 'tailwind-ABS', url: 'https://tailwindcss.com', page: 3146, builder: 'build-absolute.mjs', prev: 0.755 },
  ]
  verify = await parallel(SITES.map((s) => () => agent([HARD_RULE,
    'VERIFY the full-width canvas fix on ONE clone. Work in ' + GRADER + '. site=' + s.name + ' page=' + s.page + ' builder=' + s.builder + ' prevComposite=' + s.prev + '. You MUST end by calling StructuredOutput.',
    'STEPS (source /tmp/joist-auth.env): node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/fw-' + s.name + '.json --passes 2 ; node ' + s.builder + ' --layout /tmp/fw-' + s.name + '.json --page ' + s.page + ' ; PUBLISH (status=publish). The builder should now ALSO set the elementor_canvas template — VERIFY via GET wp/v2/pages/' + s.page + ' that template/_wp_page_template == elementor_canvas.',
    'RENDER CHECK (isolated Playwright, 1440): (a) fullBleed = do the top-level .e-con section bands now span the viewport (min band x <= ~5, max band right >= ~viewport-5, bandWidth ~= 1440)? Report bandX + bandWidth + viewport. (b) themeNavbarGone = is the JupiterX "My WordPress / Search" navbar GONE (canvas template removes theme chrome)? (c) confirm content is still visible + not broken.',
    'GRADE: node grade-sections.mjs --source ' + s.url + ' --clone "https://georges232.sg-host.com/?page_id=' + s.page + '" --out /tmp/fwg-' + s.name + ' ; composite vs prevComposite=' + s.prev + ' (NO-REGRESSION check — canvas should be neutral-to-better; the grader does not measure full-bleed yet so this just guards against breakage).',
    'Return {site, page, fullBleed, bandX, bandWidth, viewport, themeNavbarGone, composite, prevComposite, verdict}.',
  ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify', schema: VSCHEMA }))).then((rs) => rs.filter(Boolean))
  for (const r of verify) log('VERIFY ' + r.site + ': fullBleed=' + r.fullBleed + ' bandW=' + r.bandWidth + '/' + r.viewport + ' navbarGone=' + r.themeNavbarGone + ' composite ' + r.prevComposite + '->' + r.composite)
} else { log('SKIPPED verify — fix not OK') }
return { fix: String(fix || '').slice(0, 500), verify }

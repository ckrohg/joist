export const meta = {
  name: 'real-nav-build',
  description: 'USER #2 BUILD (proven by nav-probe wnd12phc1): replace the flat nav-as-body-<a> with a REAL Elementor navigation. Path A (Pro, proven on throwaway 6724): detect the header band -> create a per-page WP menu (wp/v2/menus + menu-items) -> emit an Elementor nav-menu widget bound by slug, inside a sticky full-width header container (logo + nav-menu + CTA). Renders a real horizontal nav bar + collapses to a hamburger at 390. Multi-nav = per-page menu slug (N clones = N menus, no collision). FALLBACK (no Pro): Path C structural sticky header (per-link widgets + CSS hamburger; _flex_grow:0 NOT width:0). Apply to build-flow.mjs + build-absolute.mjs. Verify by RENDER (real nav bar at 1440 + hamburger at 390 + nav at the NAV level, not body content) + composite no-regression.',
  phases: [
    { title: 'Build', detail: 'both builders: header detection + per-page WP menu + nav-menu widget (Pro) or structural header (fallback); node --check + selftest' },
    { title: 'Verify', detail: 'rebuild+publish supabase-FLOW 6006 + abs 3146; render: real horizontal nav @1440 + hamburger @390 + sticky header (not body links) + no-regression' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'Edit ONLY build-flow.mjs + build-absolute.mjs. Back up both FIRST (/tmp/ev-bk-buildflow-nav.mjs, /tmp/ev-bk-buildabs-nav.mjs). Do NOT edit capture-layout/grade-sections/perelement. source /tmp/joist-auth.env. Never print JOIST_AUTH_B64. wp/v2 menu writes use Basic auth; joist/v1 page writes need X-Joist-Session-Id (start a session if needed).'

const fix = await agent([HARD_RULE,
  'BUILD USER FEEDBACK #2 — a REAL Elementor navigation (proven path from nav-probe wnd12phc1). Work in ' + GRADER + '. Read build-flow.mjs buildHeaderNav (~L1130-1149) + the per-link text-editor <a> emission (~L378) AND the equivalent in build-absolute.mjs.',
  'PROVEN PATH A (Pro IS licensed on this stack; nav-menu round-trips the PUT untouched, renders a real nav bar + hamburger):',
  '(a) DETECT NAV in the header band: the topmost full-width band (the set already gathered at build-flow ~L1142) is the header; collect its ANCHOR leaves (text + href) in DOM order as nav items; detect the LOGO (first image/wordmark in the band) + a trailing CTA (last button-styled anchor).',
  '(b) CREATE A PER-PAGE WP MENU (once per clone, in the WP-write path): POST wp/v2/menus {name:`clone-<pageId>-nav`, slug:`clone-<pageId>-nav`} (Basic auth) -> capture the term id; for EACH captured nav item POST wp/v2/menu-items {title, url, status:"publish", menus:<termId>}. (status must be publish to attach; menus expects the term id.) If the menu slug already exists from a prior run, reuse/replace its items (idempotent).',
  '(c) EMIT THE REAL NAV inside a STICKY FULL-WIDTH HEADER container (replace the flat <nav> of <a>): the header container = position:fixed (or sticky), content_width:full, width:100%, high _z_index, the captured header bg; it holds {a logo widget (image or text), then the nav-menu widget}. nav-menu widget = { elType:"widget", widgetType:"nav-menu", settings:{ menu:"<slug>", menu_name:"<slug>", layout:"horizontal", align_items:"end", dropdown:"mobile", toggle:"burger", menu_typography_typography:"custom", menu_typography_font_size:{unit:"px",size:<captured>}, color_menu_item:"<captured>", color_menu_item_hover:"<captured>" } }, plus the CTA button widget.',
  '(d) BIND PER-PAGE: settings.menu = the per-page slug -> each clone references only its own menu (no Theme-Builder, no global conditions, no collision).',
  '(e) GATE Pro-vs-fallback: detect Elementor Pro (joist_get_site_info / GET wp-json for elementor-pro + nav-menu widget schema). If Pro present -> Path A. If NOT -> FALLBACK Path C: a fixed full-width flex header { logo text-editor, a flex sub-container (use _flex_grow:0 + default/auto width — NEVER width:0, which collapses to 0px) of per-link text-editor <a> widgets, a native button CTA } + a checkbox-hack hamburger html widget + the responsive collapse + :has(#burger:checked) toggle injected into page_settings.custom_css.',
  'Do the SAME in build-absolute.mjs. Remove/replace the old flat-nav-as-body-content path so nav links are NO LONGER emitted as centered body text. node --check both. SELF-TEST: node grade-sections.mjs --source https://resend.com --selftest -> composite 1.0 (no grader change). If a builder cannot pass node --check, restore its backup + say RESTORED.',
  'STEP 0: cp build-flow.mjs /tmp/ev-bk-buildflow-nav.mjs ; cp build-absolute.mjs /tmp/ev-bk-buildabs-nav.mjs (back up FIRST).',
  'Return PLAIN-TEXT starting "OK:" if both edited + node --check + self-test pass, or "RESTORED:" if reverted. Describe the header-detection + menu-creation + nav-menu emission + the Pro gate.',
].join('\n'), { label: 'build:real-nav', phase: 'Build' })
log('real-nav build: ' + String(fix || '').slice(0, 220))

let verify = null
if (fix && /\bOK:/i.test(String(fix)) && !/\bRESTORED:/i.test(String(fix))) {
  phase('Verify')
  const VSCHEMA = { type: 'object', additionalProperties: false, properties: {
    site: { type: 'string' }, page: { type: 'number' }, realNavBar: { type: 'boolean' }, navAtNavLevel: { type: 'boolean' }, hamburgerAt390: { type: 'boolean' },
    menuCreated: { type: 'boolean' }, navLinksResolved: { type: 'number' }, composite: { type: 'number' }, prevComposite: { type: 'number' }, verdict: { type: 'string' },
  }, required: ['site', 'realNavBar', 'navAtNavLevel', 'verdict'] }
  const SITES = [
    { name: 'supabase-FLOW', url: 'https://supabase.com', page: 6006, builder: 'build-flow.mjs', prev: 0.663 },
    { name: 'tailwind-ABS', url: 'https://tailwindcss.com', page: 3146, builder: 'build-absolute.mjs', prev: 0.756 },
  ]
  verify = await parallel(SITES.map((s) => () => agent([HARD_RULE,
    'VERIFY the real-nav build on ONE clone. Work in ' + GRADER + '. site=' + s.name + ' page=' + s.page + ' builder=' + s.builder + ' prevComposite=' + s.prev + '. You MUST end by calling StructuredOutput.',
    'STEPS: node capture-ensemble.mjs --source ' + s.url + ' --out /tmp/nv-' + s.name + '.json --passes 2 ; node ' + s.builder + ' --layout /tmp/nv-' + s.name + '.json --page ' + s.page + ' ; PUBLISH (status=publish). Confirm a per-page WP menu (clone-' + s.page + '-nav) was created (GET wp/v2/menus).',
    'RENDER CHECK (isolated Playwright): (a) realNavBar @1440 = is the nav a REAL horizontal nav bar (a nav-menu widget ul.flex OR a sticky header flex row) with the source nav links resolved, NOT flat centered body text? Count navLinksResolved. (b) navAtNavLevel = is the nav in a STICKY/FIXED full-width HEADER at the top (logo + links + CTA), not floating in the hero body? (c) hamburgerAt390 = at 390 does it collapse to a working hamburger/toggle? (d) confirm the OLD centered-body-text nav is GONE.',
    'GRADE: node grade-sections.mjs --source ' + s.url + ' --clone "https://georges232.sg-host.com/?page_id=' + s.page + '" --out /tmp/nvg-' + s.name + ' ; composite vs prevComposite=' + s.prev + ' (no-major-regression guard; grader does not score nav-quality yet -> that is fix #3).',
    'Return {site, page, realNavBar, navAtNavLevel, hamburgerAt390, menuCreated, navLinksResolved, composite, prevComposite, verdict}.',
  ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify', schema: VSCHEMA }))).then((rs) => rs.filter(Boolean))
  for (const r of verify) log('VERIFY ' + r.site + ': realNavBar=' + r.realNavBar + ' navLevel=' + r.navAtNavLevel + ' hamburger=' + r.hamburgerAt390 + ' links=' + r.navLinksResolved + ' composite ' + r.prevComposite + '->' + r.composite)
} else { log('SKIPPED verify — build not OK') }
return { fix: String(fix || '').slice(0, 500), verify }

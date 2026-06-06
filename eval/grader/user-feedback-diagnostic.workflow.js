export const meta = {
  name: 'user-feedback-diagnostic',
  description: 'GROUND-TRUTH user feedback on the supabase flow clone (flow-native-clone-5): (1) not full-width (centered ~1360 column, huge gutters); (2) nav is rendered as flat PAGE content, not a real Elementor Nav/header bound to a WP menu (+ skill: multiple navs per multi-site WP); (3) chunk-screenshots instead of TRUE element-level (logos rasterized as a row, not per-logo <img>); (4) overlapping/garbled feature-card text + other non-1:1/responsive. PLUS the meta: the grader scored this ~0.67 (INFLATING — it must SEE these defects). 5 parallel diagnostic streams: each root-causes one issue against the live clone + source + the builder/grader code and returns a precise targeted fix directive + effort. Read/inspect only (no cloner edits) — produces the prioritized fix plan.',
  phases: [
    { title: 'Diagnose', detail: '5 parallel streams: full-width / nav-level / element-granularity / overlap+other / grader-gap' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'READ/INSPECT ONLY — edit NO cloner/grader files. source /tmp/joist-auth.env. Never print JOIST_AUTH_B64. The clone under review is the supabase FLOW clone at https://georges232.sg-host.com/flow-native-clone-5/ (resolve its page_id via GET wp/v2/pages?search=flow-native-clone). Source of truth = https://supabase.com. Inspect with isolated Playwright at 1440 + 390.'
const SCHEMA = { type: 'object', additionalProperties: false, properties: {
  point: { type: 'string' },
  currentBehavior: { type: 'string' },
  rootCause: { type: 'string' },
  builderFileAndLoc: { type: 'string' },
  targetedFixDirective: { type: 'string' },
  graderShouldDetect: { type: 'string' },
  effort: { type: 'string' },
  confidence: { type: 'string' },
}, required: ['point', 'rootCause', 'targetedFixDirective'] }

const STREAMS = [
  { key: 'full-width', brief: 'FULL-WIDTH. The clone renders in a centered ~1360px column with large white gutters; the source supabase is full-bleed (sections span the viewport, content max-width inside). ROOT-CAUSE: inspect the clone root + section containers (content_width boxed vs full? a fixed width? the root .e-con max-width?) vs how the SOURCE lays out (full-bleed sections + inner max-width). Read build-flow.mjs (root/section container emission + content_width). DIRECTIVE: how to emit full-width sections (content_width:full) with inner content max-width matched to source, so the page is full-bleed like the source — NOT a centered column.' },
  { key: 'nav-level', brief: 'NAV AT THE NAV LEVEL. The nav (Product/Developers/Solutions/Pricing/Docs/Blog/Sign in/Start your project) is rendered as flat CENTERED PAGE CONTENT (text links in the body), not a real navigation. The user wants it built as a real Elementor NAV (Nav Menu widget OR a header Template) backed by a WP menu, linked to the page(s) — AND the SKILL of building MULTIPLE navs in ONE WordPress (multiple "sites") and binding each nav to its pages. RESEARCH + inspect: how does Elementor build navs (Nav Menu widget, Theme Builder header templates, WP wp_nav_menu / wp/v2/menus REST)? How is the nav currently emitted in build-flow/build-absolute? DIRECTIVE: a concrete approach to (a) create a WP menu from the captured nav links, (b) emit an Elementor Nav Menu widget OR a header template referencing it, (c) bind per-page so multiple clones in one WP each get their own correct nav. Note any Pro/Theme-Builder requirement.' },
  { key: 'element-granularity', brief: 'TRUE ELEMENT LEVEL — NO CHUNK SCREENSHOTS. The trusted-by logo row (betashares/submagic/mozilla/GitHub/1Password) appears faint/greyscale and possibly rasterized as ONE chunk. The user demands each logo be its OWN <img> element, never a screenshot of the whole row/region. INSPECT the clone: are the logos individual <img> with real src, or one rasterized image / mockup? Read capture-layout.mjs + build-flow.mjs (where does it rasterize a region/row vs emit per-element leaves? the mockup-raster path, the image-leaf path). DIRECTIVE: ensure logo rows / icon rows / any multi-element region decompose into individual element leaves (each logo = its own captured <img> src or icon), never a row-screenshot; identify exactly where chunking happens + how to force per-element.' },
  { key: 'overlap-and-other', brief: 'OVERLAPPING TEXT + OTHER NON-1:1. The 4 feature cards (Database / Authentication / Edge Functions / Storage) render with DOUBLED, OVERLAPPING, garbled text (e.g. "Authentication" over "Authentication", body text overlapping itself). INSPECT the clone feature-card section: why is text duplicated/overlapping (two text nodes at the same position? an abs overlay + a flow copy? a heading + its duplicate)? Read build-flow.mjs (overlay emission #16, the card grid, any duplicate-emit). ALSO enumerate the TOP 3-5 OTHER non-1:1 / non-responsive issues visible at 1440 + 390 (spacing, missing section backgrounds, etc.). DIRECTIVE: root-cause the text overlap precisely + the fix; list the other top issues.' },
  { key: 'grader-gap', brief: 'GRADER INFLATION. The grader scored this clone ~0.67 (perElement + responsive + struct + edit) yet a human immediately sees: not full-width, nav-as-content, chunked logos, OVERLAPPING garbled text. So the grader is INFLATING — missing these defects. INSPECT grade-sections.mjs + perelement-score.mjs + grade-responsive.mjs: why do these defects NOT cost score? Specifically: (a) is there ANY text-COLLISION / overlap detector (two text nodes occupying the same box -> should be a hard penalty)? (b) does anything check full-width vs centered-column layout MODE? (c) does the grader credit a chunk-screenshot the same as per-element content (element-granularity)? (d) does it check the nav is a real nav vs flat content? DIRECTIVE: the precise grader additions (self-test=1.0-safe, reversible) so these human-obvious defects DROP the score — the grader must SEE what the user sees. This is grader-honesty in the INFLATION direction (numbers should DROP, which is correct).' },
]

phase('Diagnose')
const out = await parallel(STREAMS.map((s) => () => agent([HARD_RULE,
  'Diagnose ONE ground-truth user-feedback point on the supabase flow clone. Work in ' + GRADER + '. You MUST end by calling StructuredOutput. Be concrete + verify against the LIVE clone + source.',
  'POINT: ' + s.brief,
  'Resolve the clone page_id (GET wp/v2/pages?search=flow-native-clone). Inspect the LIVE clone (https://georges232.sg-host.com/?page_id=<id> or the slug) vs source (https://supabase.com) with isolated Playwright at 1440 + 390. Read the relevant builder/grader code to ROOT-CAUSE (cite file + approx line/function). Then write a PRECISE targetedFixDirective (the specific change + which file) + what the GRADER should detect to catch this + an effort estimate + confidence.',
  'Return {point, currentBehavior, rootCause, builderFileAndLoc, targetedFixDirective, graderShouldDetect, effort, confidence}.',
].join('\n'), { label: 'fb:' + s.key, phase: 'Diagnose', schema: SCHEMA }))).then((rs) => rs.filter(Boolean))

for (const r of out) log('FEEDBACK ' + r.point + ': ' + String(r.rootCause).slice(0, 90) + ' | fix: ' + String(r.targetedFixDirective).slice(0, 80))
return { diagnostics: out }

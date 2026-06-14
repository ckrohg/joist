export const meta = {
  name: 'discovery-completeness-critic',
  description: 'Phase 5: READ-ONLY multi-lens completeness critic. Structural auto-targeting plateaued; this systematically finds the BIGGEST remaining gaps across ALL metrics (color/bg, typography, spacing+position-drift, image/asset fidelity, structural-detection gaps, editability quality) by comparing source vs clone across the corpus, ranks them by impact, and writes a prioritized fix backlog to overnight-state.json + a report. Drives the next rounds toward 1:1 across metrics not yet explicitly targeted. Does NOT edit cloner code.',
  phases: [
    { title: 'Lenses', detail: 'one read-only critic per dimension over the corpus' },
    { title: 'Rank', detail: 'synthesize + rank gaps by impact; write the fix backlog' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const MANIFEST = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/overnight-state.json'
const REPORT = '/Users/ckrohg/Documents/Claude/tenet-elementor/knowledge/DISCOVERY_GAP_MAP.md'
const SITES = [
  { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146 },
  { name: 'supabase', url: 'https://supabase.com', page: 2986 },
  { name: 'resend', url: 'https://resend.com', page: 2988 },
  { name: 'framer', url: 'https://www.framer.com', page: 2990 },
  { name: 'linear', url: 'https://linear.app', page: 4297 },
  { name: 'vercel', url: 'https://vercel.com', page: 4296 },
  { name: 'reactdev', url: 'https://react.dev', page: 4771 },
]
const cloneUrl = (p) => '' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/?page_id=' + p
const corpusList = SITES.map((s) => '- ' + s.name + ': source ' + s.url + ' | clone ' + cloneUrl(s.page) + ' | grade /tmp/evg-' + s.name + '/sections.json').join('\n')
const PRIOR = 'WAVE 6 UPDATE (2026-06-07, RE-GROUND on this): the grader gained 3 SHADOW honesty metrics now present in the report JSON — gdaGroupCount (structural race-group count: exposes JS-card-grid UNDER-CAPTURE the area-coverage denominator masks, e.g. linear coverage 0.97 but GDA 0.56), rdaQuadrant (3x3 position rail: exposes gross cross-quadrant mis-placement, react.dev smooth-position 0.91 but RDA 0.60), and grade-motion (hover/reveal/marquee/parallax). USE these truer signals to find the real gaps. KEPT since wave 5: abs-height-lock-media-leaves (struct +0.026). REJECTED since wave 5 (do NOT re-propose): img-alt-threading (no composite gain), recursive-nested-band-bg (framer -0.042), video-poster-recovery (frame-mismatch regresses supabase -0.073), clamp-fonts (already recipe #22 fluid-fonts). MOTION is fully handled (CSS-tier built + GSAP-tier in the plugin) — do NOT propose motion. The score-CLOSING work for the #1 wall (structural floor / dynamic JS-rendered content; reactdev code blocks color 0.17) is largely SUPERVISED: a native Code-Highlight widget + the abs-vs-flow builder-unification are queued for the user. SO: hunt for any remaining genuinely AUTONOMOUS-SAFE capture/build lever targeting the GDA/RDA-revealed gaps; and if the top gaps are genuinely SUPERVISED (new builder path / grader-objective change / architecture), HONESTLY say so + tag them supervised — do NOT manufacture low-value autonomous diagnostics just to have a backlog. \\n\\nDISCOVERY WAVE 4 — 7-site corpus (tailwind/supabase/resend/framer/linear/vercel/reactdev), FLIPPED objective: visual = 0.5*SSIM + 0.5*perElement where perElement = 0.35*color[CIEDE2000] + 0.25*typo + 0.20*position + 0.20*text, EACH x symmetric area-coverage; composite = 0.4*visual + 0.3*editability + 0.3*structural. Honest mean ~0.768, 12 recipes kept. \\n\\nMAJOR CONTEXT CHANGE since wave 3: the objective was FLIPPED (round 40) from SSIM-only to this per-element metric. The OLD wave-3 stance VISUAL-IS-SATURATED / do-not-propose-color-or-typography is OBSOLETE AND INVERTED — color became the PRODUCTIVE axis: the color-container vein KEPT 3x (r41 foreground-glyph inline-stamp, r44 solid-bg color-container w/ probe child, r45 gradient-bg verbatim). \\n\\nBUT the BUILD-SIDE color vein is now EXHAUSTED (r46 audit proved collectBg already emits bg color for EVERY container incl. nested cards). So do NOT propose more build-absolute color/bg/gradient fixes. \\n\\nVERIFIED RESEARCH (Design2Code human-correlation, 435 prefs): POSITION (corr 0.76) and BLOCK-MATCH/areaCoverage (0.74) DOMINATE human looks-the-same judgment; COLOR moderate (0.35); TEXT is a NEGATIVE predictor (-0.35). So FAVOR fixes that raise per-element POSITION accuracy and areaCoverage; do NOT chase text fidelity. \\n\\nThe remaining per-element loss is, per the r46 audit, either (a) CAPTURE-SIDE bg.color/paint accuracy (how faithfully we SEE source colors/positions) or (b) GRADER matching / areaCoverage symmetry. The deep-text-leaf COVERAGE wall (linear/vercel/reactdev reproduce only ~35-50% of source nodes; capture stats.coverage as low as 0.06-0.19) is being handled by the SUPERVISED container-inference flow builder — do NOT propose cramming more ABSOLUTE nodes (r42 proved it regresses via overlap/clutter). \\n\\nKEPT recipes (do NOT re-propose): list, video-landing, capture-stability, framer-uncollapse, mockup-text-rescue, video-detection, nav-landing, flatten-list-detect, tab-synthesis, color-foreground(r41), color-bg(r44), color-gradient(r45). \\n\\nDO propose, ranked by FLIPPED-objective lift, and TAG each fix layer {build-absolute=autonomous | capture=autonomous | grader=SUPERVISED self-test=1.0}: (1) CAPTURE-SIDE color/paint/position accuracy + THIN-CAPTURE detection (capture coverage 0.06-0.19 on some sites multiplies into every per-element sub-score — the single biggest upstream ceiling); (2) per-element POSITION accuracy on the absolute builder (the #1 human-correlated metric); (3) areaCoverage symmetry / grader block-matching refinements (3-file grader-extension, self-test=1.0); (4) any STRUCTURAL block still flattened by the MAXD depth-cap (accordion/table/form/carousel/select at depth>cap). \\n\\nBE SKEPTICAL on impact (waves 1-3 were ~2/6, 2/3, mixed) — only propose fixes whose MECHANISM demonstrably moves the FLIPPED objective. '
const RO = 'STRICT READ-ONLY: you may capture/screenshot/fetch source+clone and READ files (especially /tmp/evg-<site>/sections.json from the latest grades, and ' + GRADER + '/capture-layout.mjs + build-absolute.mjs to understand current behavior), but you MUST NOT edit/build/PUT/grade or modify ANY file. Return a markdown analysis only. Auth: source /tmp/joist-auth.env if you need to fetch the clone.'

const LENSES = [
  { key: 'color-bg', title: 'Color & background fidelity', focus: 'Section/hero/card BACKGROUND colors + gradients + the overall palette. Are source background colors/gradients reproduced on the clone, or are sections rendering on default/white where the source had color? Look at the perimeter-bg operator usage. This is high-leverage for SSIM (large areas).' },
  { key: 'typography', title: 'Typography fidelity', focus: 'Font FAMILY (does the clone use the right typeface or fall back to Inter/Georgia?), size, weight, line-height, letter-spacing, heading scale. Are real fonts registered/loaded? Mismatched font family is a pervasive visual + feel gap.' },
  { key: 'spacing-drift', title: 'Spacing & position drift', focus: 'Padding/margins/gaps/section heights and absolute-position accuracy. Where do clone element positions DRIFT from source (vertical rhythm, section bands, overlap)? The builder is absolute-positioned desktop-pixel — quantify drift and the worst-drifting sections.' },
  { key: 'image-asset', title: 'Image & asset fidelity', focus: 'Are the RIGHT images present, in the right place/size, not rastered-over-text? Missing/placeholder images, wrong aspect, logo walls. Check the rebuild-honesty (no screenshotting text). Note any sections still rastered that have real text.' },
  { key: 'struct-detection', title: 'Structural-detection gaps', focus: 'Blocks the GRADER counts in source but capture does not DETECT as a structural node (so they never get the right widget). E.g. framer lists are div-based not <ul>; bg/css videos; nav/tabs that built but did NOT land (kses?). Compare blocksSource vs blocksClone in the grade JSON. Name the specific detection/landing gaps + the likely fix layer (capture detect vs build emit vs kses).' },
  { key: 'editability', title: 'Editability quality', focus: 'Is rebuilt TEXT actually correct + complete (not truncated, not duplicated, not garbled)? Are headings/paragraphs native + selectable? Where is editability lowest and why (look at the grade editability sub-score + the clone DOM text vs source text)?' },
]

phase('Lenses')
const lensReports = await parallel(LENSES.map((L) => () => agent([
  'You are the "' + L.title + '" lens of a website-cloner completeness critic. Corpus (4 cloned sites):',
  corpusList,
  'FOCUS: ' + L.focus,
  PRIOR,
  RO,
  'Do this: (1) read each /tmp/evg-<site>/sections.json for the relevant sub-scores (visualMean, editabilityMean, structuralFidelity, blocksSource/blocksClone, perSection why-arrays); (2) for the 1-2 sites where your dimension is WORST, look closer (fetch/screenshot the clone vs source if helpful) to find the concrete cause; (3) read the relevant cloner code (capture-layout.mjs / build-absolute.mjs) to identify WHERE the fix would go.',
  'Return a tight markdown section titled "## ' + L.title + '" with: **Score** (your honest 0-1 estimate of how well this dimension is reproduced corpus-wide), **Worst offenders** (2-3 specific site+section examples), **Root cause** (what in capture/build causes it), **Proposed fix** (ONE concrete, surgical change: which file, what logic, expected metric lift, and risk), **Confidence** (high/med/low). Be specific and grounded in the actual data/code — this drives real fix rounds.',
].join('\n'), { label: 'lens:' + L.key, phase: 'Lenses' }).catch((e) => '## ' + L.title + '\n(lens failed: ' + (e && e.message) + ')')))

phase('Rank')
const synth = await agent([
  'You are the synthesis step of a website-cloner completeness critic (DISCOVERY WAVE 4, FLIPPED per-element objective). Below are ' + LENSES.length + ' lens reports, each proposing fixes to push the clone toward 1:1 across its dimension. Current honest corpus mean ~0.768 (composite = 0.4*visual + 0.3*editability + 0.3*structural; visual = 0.5*SSIM + 0.5*perElement).',
  PRIOR,
  'CRITICAL: do NOT include any wave-1-rejected fix in the backlog. Rank SKEPTICALLY — wave 1 was only 2/6 kept, so down-weight speculative impact claims and favor fixes with a verifiable mechanism. If a strong lead is a GRADER refinement (e.g. strengthen the under-weighted height/layout penalty), include it but flag it as a 3-file grader-extension round requiring self-test=1.0 re-validation.',
  'TASKS:',
  '1) Read the lens reports (below). De-dupe overlapping fixes. RANK every proposed fix by (expected corpus-composite lift × confidence × low-regression-risk).',
  '2) WRITE a markdown report to ' + REPORT + ' titled "# Discovery Gap Map" with: a one-paragraph honest summary of where the clone stands per dimension; a RANKED table of the top fixes (rank | dimension | fix | file | expected lift | confidence | risk); and a short "recommended next rounds" list (which 3-4 to run first).',
  '3) Return ONLY a compact JSON array (no prose) of the TOP 6 ranked fixes, each: {"rank":N,"dimension":"...","fix":"one-line concrete change","file":"capture-layout.mjs|build-absolute.mjs|grade-sections.mjs","expectedLift":"...","confidence":"high|med|low"}. This array will be parsed into the driver backlog.',
  'Be ruthless about impact — favor large-area visual fixes (backgrounds, fonts, spacing) and high-frequency gaps over rare ones. Here are the lens reports:',
  '<<<LENSES>>>',
  ...lensReports.filter(Boolean),
  '<<<END>>>',
].join('\n'), { label: 'synthesize:gap-map', phase: 'Rank' }).catch((e) => 'synthesis failed: ' + (e && e.message))

log('DISCOVERY complete — gap map written to ' + REPORT)
return { reportPath: REPORT, synthesis: synth, lensCount: lensReports.filter(Boolean).length }

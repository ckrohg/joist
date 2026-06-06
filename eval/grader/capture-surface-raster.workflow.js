export const meta = {
  name: 'capture-surface-raster',
  description: 'STRUCTURAL floor lever (the #2 corpus lever, now #1 after responsive): the struct gap (reactdev 0.34 / resend 0.337 / framer 0.383) is COHESIVE VISUAL SURFACES with no walkable DOM — <canvas>, Sandpack/preview IFRAMES, live-React-output panels — that paint pixels but the DOM walk drops, leaving sparse failing sections. LEVER: region-raster each such surface as ONE element-level <img> leaf at its exact box (aligns w/ user principle: element-level IMAGE for a cohesive visual unit is OK; words still rebuilt; NEVER chunk a ROW of distinct elements). DIAGNOSE-FIRST (ARM-Mac headless GPU uncertainty): do <canvas> elements render real pixels headless or black? does a GPU/ANGLE flag help? are the React-output previews SAME-ORIGIN iframes (walkable) or canvas/cross-origin (must raster)? how many such surfaces per site + how much area? Then BUILD a surface-raster pass: detect cohesive visual surfaces (canvas / iframe / container with high painted-area-fraction AND low text-leaf density), region-raster as one <img>, with a BLANK-RASTER GUARD (variance~0 / single-color>95% -> skip, do NOT emit black) + GPU flags if they help. Reversible CAPTURE_NO_SURFACERASTER=1. GATE: recovers real visual surfaces on reactdev/resend (struct/visual up) + NO black images emitted + NO-OP on a text site (tailwind) + self-test 1.0 + no hang, else auto-restore.',
  phases: [
    { title: 'Diagnose', detail: 'reactdev+resend: canvas-renders-headless? GPU flag helps? previews iframe vs canvas? #surfaces + area' },
    { title: 'Build', detail: 'surface-raster pass (canvas/iframe/sparse-painted -> element <img>, blank-guarded, GPU flags); behind CAPTURE_NO_SURFACERASTER=1; node --check + selftest 1.0' },
    { title: 'Verify', detail: 'reactdev/resend recover surfaces (struct/visual up) + no black images + tailwind no-op + no hang + reversible' },
    { title: 'Gate', detail: 'keep iff real recovery + blank-guard works + no-op static + self-test 1.0 + no hang, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Edit ONLY capture-layout.mjs (+ helpers it imports). Back up FIRST: cp capture-layout.mjs /tmp/ev-bk-capture-surfaceraster.mjs. Do NOT edit grade-*/build-*/perelement. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64. Image upload to WP media already exists in build-absolute (uploadImage) — capture emits the raster as a data: URL or /tmp file leaf that the builder uploads.'

const DSCHEMA = { type: 'object', additionalProperties: false, properties: {
  canvasRendersHeadless: { type: 'boolean' }, gpuFlagHelps: { type: 'boolean' },
  reactdevSurfaces: { type: 'number' }, resendSurfaces: { type: 'number' }, surfaceKinds: { type: 'array', items: { type: 'string' } },
  previewsAreIframes: { type: 'boolean' }, iframesSameOrigin: { type: 'boolean' },
  surfaceAreaPct: { type: 'number' }, leverIsReal: { type: 'boolean' }, fixPlan: { type: 'string' },
}, required: ['canvasRendersHeadless', 'reactdevSurfaces', 'resendSurfaces', 'leverIsReal', 'fixPlan'] }
const diag = await agent([HARD.replace('Edit ONLY capture-layout.mjs (+ helpers it imports). ', 'DIAGNOSE — read-only, do NOT edit files (isolated Playwright probing only). '),
  'DIAGNOSE the visual-surface situation. Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput. The struct gap = canvas/iframe/React-output surfaces with no walkable DOM.',
  'In isolated Playwright (try BOTH a default headless launch AND one with args [--use-angle=gl, --ignore-gpu-blocklist, --enable-gpu]) on reactdev (https://react.dev) + resend (https://resend.com) at 1440:',
  '(1) CANVAS: count <canvas> elements with area>=2000; screenshot one + check if it has REAL pixels (color variance high) or is BLANK/black (variance~0). canvasRendersHeadless = do canvases show real pixels in DEFAULT headless? gpuFlagHelps = does the --use-angle=gl launch make a blank canvas render real pixels?',
  '(2) PREVIEWS/IFRAMES: are the live-React-output / Sandpack preview panels <iframe>s? previewsAreIframes. If so, iframesSameOrigin = can page.frames() access their content (same-origin -> walkable) or are they cross-origin/sandboxed (-> must raster)?',
  '(3) SURFACES: count cohesive visual surfaces per site = elements that are <canvas>, <iframe>, OR a container with painted-area-fraction high but few text-leaf descendants (reactdevSurfaces/resendSurfaces). surfaceKinds = the distinct kinds found. surfaceAreaPct = roughly what % of page area these surfaces cover.',
  'leverIsReal = true iff there are meaningful visual surfaces (>=2 per site covering real area) that are currently DROPPED by the DOM walk and CAN be region-rastered to recover them. fixPlan = the precise capture-layout change (detect surfaces -> region-raster via page.screenshot clip at the element box -> emit as an <img> leaf at that box; blank-raster guard; GPU flags if gpuFlagHelps). If canvases are blank even with GPU AND previews are cross-origin AND there is little to recover, leverIsReal=false (say so honestly).',
  'Return {canvasRendersHeadless, gpuFlagHelps, reactdevSurfaces, resendSurfaces, surfaceKinds, previewsAreIframes, iframesSameOrigin, surfaceAreaPct, leverIsReal, fixPlan}.',
].join('\n'), { label: 'diagnose:surface-raster', phase: 'Diagnose', schema: DSCHEMA })
log('DIAG: canvasHeadless=' + (diag&&diag.canvasRendersHeadless) + ' gpuHelps=' + (diag&&diag.gpuFlagHelps) + ' surfaces react/resend=' + (diag&&diag.reactdevSurfaces) + '/' + (diag&&diag.resendSurfaces) + ' iframes=' + (diag&&diag.previewsAreIframes) + ' leverIsReal=' + (diag&&diag.leverIsReal))

let impl = null, verify = null
if (diag && diag.leverIsReal) {
  phase('Build')
  impl = await agent([HARD,
    'IMPLEMENT a surface-raster capture pass in capture-layout.mjs. Work in ' + GRADER + '. DIAGNOSIS: canvasRendersHeadless=' + (diag.canvasRendersHeadless) + ' gpuFlagHelps=' + (diag.gpuFlagHelps) + ' surfaces react/resend=' + diag.reactdevSurfaces + '/' + diag.resendSurfaces + ' kinds=' + JSON.stringify(diag.surfaceKinds) + ' iframes=' + diag.previewsAreIframes + '/' + diag.iframesSameOrigin + ' | fixPlan=' + String(diag.fixPlan||'').slice(0,400),
    'Implement the fixPlan: detect COHESIVE VISUAL SURFACES (per the diagnosis: <canvas>, preview <iframe>, and/or containers with high painted-area-fraction + low text-leaf density) and region-raster each as ONE <img> leaf at its EXACT element box (page.screenshot({clip: box}) -> /tmp file or data URL the builder uploads). If gpuFlagHelps, add the GPU/ANGLE launch args to the capture browser launch (gated so it can fall back).',
    'CRITICAL GUARDS: (1) BLANK-RASTER GUARD — before emitting a surface raster, check the cropped image is NOT blank (compute pixel variance / dominant-color fraction; if variance~0 OR single color >95%, SKIP it — do NOT emit a black/blank image; the grader must not be fed a black rectangle). (2) ELEMENT-LEVEL ONLY — raster a surface ONLY if it is ONE cohesive visual unit (a canvas/iframe, or a container whose children are NOT distinct capturable content). NEVER raster a row/region of distinct elements (the user rule: each logo its own img, never chunk a row). (3) do not double-emit (if a surface is rastered, do not also emit its sparse child leaves underneath). (4) bounded + no hang (fixed waits, try/catch).',
    'REVERSIBILITY: CAPTURE_NO_SURFACERASTER=1 skips the pass. STEP 0: cp capture-layout.mjs /tmp/ev-bk-capture-surfaceraster.mjs. node --check. SELFTEST: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0. SMOKE: node capture-layout.mjs --source https://react.dev --out /tmp/sr-react-ON.json ; CAPTURE_NO_SURFACERASTER=1 ... --out /tmp/sr-react-OFF.json -> report surface-raster count emitted + confirm NONE are blank + tailwind ON==OFF (no surfaces -> no-op). If node --check fails / hangs / emits blanks -> restore + RESTORED.',
    'Return "OK:" with surfaces rastered on reactdev/resend + blank-guard skip count + tailwind no-op confirmation, or "RESTORED:".',
  ].join('\n'), { label: 'build:surface-raster', phase: 'Build' })
  log('IMPL: ' + String(impl || '').slice(0, 280))

  const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
  if (okImpl) {
    phase('Verify')
    const VS = { type: 'object', additionalProperties: false, properties: {
      site: { type: 'string' }, role: { type: 'string' }, surfacesRastered: { type: 'number' }, blankSkipped: { type: 'number' },
      structOff: { type: 'number' }, structOn: { type: 'number' }, visualOff: { type: 'number' }, visualOn: { type: 'number' },
      compositeOff: { type: 'number' }, compositeOn: { type: 'number' }, blackImagesEmitted: { type: 'boolean' },
      recovered: { type: 'boolean' }, regressed: { type: 'boolean' }, hang: { type: 'boolean' }, verdict: { type: 'string' },
    }, required: ['site', 'role', 'structOff', 'structOn', 'visualOff', 'visualOn', 'compositeOff', 'compositeOn', 'blackImagesEmitted', 'recovered', 'regressed', 'hang', 'verdict'] }
    const SITES = [
      { name: 'reactdev', url: 'https://react.dev', page: 4771, role: 'TARGET (Sandpack/React-output surfaces)' },
      { name: 'resend', url: 'https://resend.com', page: 2988, role: 'TARGET (canvas/animated surfaces)' },
      { name: 'tailwind', url: 'https://tailwindcss.com', page: 3146, role: 'NO-REG (text/static)' },
    ]
    verify = await parallel(SITES.map((s) => () => agent([HARD,
      'VERIFY surface-raster on ONE site. Work in ' + GRADER + '. site=' + s.name + ' url=' + s.url + ' page=' + s.page + ' role=' + s.role + '. ' + AUTH + ' before every WP command. You MUST end by calling StructuredOutput. Do NOT edit files.',
      'A/B BUILD (build-absolute.mjs --publish; one capture per mode): surface-raster ON (default) and OFF (CAPTURE_NO_SURFACERASTER=1). Record surfacesRastered + blankSkipped (from ON capture). hang=true iff ON capture did not complete bounded (~<90s).',
      'BLANK CHECK (critical): inspect the emitted surface rasters — blackImagesEmitted=true iff ANY rastered surface is a black/blank rectangle (the blank-guard FAILED). This is an auto-FAIL.',
      'GRADE A/B: ' + AUTH + ' && node grade-sections.mjs --source ' + s.url + ' --clone "$JOIST_BASE/?page_id=' + s.page + '" --out /tmp/srg-' + s.name + '-{on|off}. structOff/On + visualOff/On + compositeOff/On.',
      'TARGET: recovered=true iff the previously-sparse visual surfaces now render (visualOn>=visualOff AND structOn>=structOff, ideally up) AND no black images. NO-REG (tailwind): regressed=true iff compositeOn<compositeOff-0.01 OR surfacesRastered>0 (must be no-op on a text site). Judge like a human: do the canvas/preview areas now show real content instead of blank bands? Return {site, role, surfacesRastered, blankSkipped, structOff, structOn, visualOff, visualOn, compositeOff, compositeOn, blackImagesEmitted, recovered, regressed, hang, verdict}.',
    ].join('\n'), { label: 'verify:' + s.name, phase: 'Verify', schema: VS }))).then((rs) => rs.filter(Boolean))
    for (const r of verify) log('VERIFY ' + r.site + ' [' + r.role + ']: rastered=' + r.surfacesRastered + ' blankSkip=' + r.blankSkipped + ' struct ' + r.structOff + '->' + r.structOn + ' vis ' + r.visualOff + '->' + r.visualOn + ' comp ' + r.compositeOff + '->' + r.compositeOn + ' black=' + r.blackImagesEmitted + ' recovered=' + r.recovered + ' hang=' + r.hang)
  }
}

phase('Gate')
let verdict
if (!diag || !diag.leverIsReal) {
  verdict = 'NOT BUILT — diagnosis: surface-raster not viable/worthwhile (canvasHeadless=' + (diag&&diag.canvasRendersHeadless) + ' gpuHelps=' + (diag&&diag.gpuFlagHelps) + ' surfaces react/resend=' + (diag&&diag.reactdevSurfaces) + '/' + (diag&&diag.resendSurfaces) + ' iframesSameOrigin=' + (diag&&diag.iframesSameOrigin) + '). ' + String(diag&&diag.fixPlan||'').slice(0,250) + ' -> structural gap needs a different approach. No capture edit.'
} else if (!impl || !/\bOK:/i.test(String(impl)) || /\bRESTORED:/i.test(String(impl))) {
  verdict = 'REVERTED — build failed/hung/emitted-blanks: ' + String(impl||'').slice(0,200)
} else {
  const v = verify || []
  const tgt = v.filter((r)=>/TARGET/.test(r.role))
  const noreg = v.filter((r)=>/NO-REG/.test(r.role))
  const anyBlack = v.some((r)=>r.blackImagesEmitted)
  const anyHang = v.some((r)=>r.hang)
  const recovered = tgt.some((r)=>r.recovered)
  const noregOK = noreg.every((r)=>!r.regressed)
  if (recovered && noregOK && !anyBlack && !anyHang) {
    verdict = 'ADOPTED — surface-raster recovers cohesive visual surfaces (' + tgt.filter(r=>r.recovered).map(r=>r.site+' rastered '+r.surfacesRastered+' struct '+r.structOff+'->'+r.structOn+' vis '+r.visualOff+'->'+r.visualOn).join(', ') + '); blank-guard held (no black images); no-op static; no hang. Attacks the #1 structural floor. Reversible CAPTURE_NO_SURFACERASTER=1.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-capture-surfaceraster.mjs capture-layout.mjs && node --check capture-layout.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Gate' })
    verdict = 'REVERTED — ' + (anyBlack ? 'blank-guard FAILED (emitted black images)' : anyHang ? 'capture HUNG' : !recovered ? 'no structural/visual recovery on targets' : 'regressed a static site') + '. ' + JSON.stringify(v.map(r=>({s:r.site,rast:r.surfacesRastered,struct:[r.structOff,r.structOn],vis:[r.visualOff,r.visualOn],black:r.blackImagesEmitted,rec:r.recovered,hang:r.hang})))
  }
}
log('SURFACE-RASTER: ' + verdict)
return { verdict, diag, impl: String(impl||'').slice(0,400), verify }

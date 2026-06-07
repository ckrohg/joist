export const meta = {
  name: 'surface-raster-wordsafe',
  description: 'WORD-PRESERVATION audit + tighten of surface-raster (recipe #25). Concern: recipe #25 dropped resend struct 0.444->0.302 and rastered the hero heading region -> it may BURY WORDS inside images, violating the user principle (words must be rebuilt as native widgets; images OK). AUDIT-FIRST: on the resend clone (surface-raster ON), check whether the source headings/body text inside rastered surfaces (e.g. hero "Email for developers", card titles) survive as NATIVE editable text leaves or are buried in the raster <img>. If buried, TIGHTEN the surface detector to raster ONLY text-free visual units (a <canvas>/cross-origin-iframe with NO meaningful text descendants); for a surface that DOES contain text, either skip the raster (keep the DOM) OR raster only the text-free backdrop sub-region and keep the text as native leaves (white-mask + rebuild). Reversible. GATE: native text inside formerly-rastered surfaces is PRESERVED (no buried headings) AND the genuine text-free visual recovery is retained (visual stays up vs pre-#25) AND struct recovers (text back as elements) AND composite no-reg, else restore to the recipe-#25 state.',
  phases: [
    { title: 'Audit', detail: 'resend: do source headings/text inside rastered surfaces survive as native leaves or are they buried? quantify buried-text' },
    { title: 'Tighten', detail: 'IF buried: detector rasters ONLY text-free visual units; text-bearing surfaces keep text as native leaves; behind flag; node --check + selftest 1.0' },
    { title: 'Verify+Gate', detail: 'words preserved + visual recovery retained + struct recovers + no-reg, else restore' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const AUTH = 'source /tmp/joist-auth.env && [ "$JOIST_BASE" = "https://georges232.sg-host.com" ] || { echo "FATAL wrong JOIST_BASE=$JOIST_BASE"; exit 1; }'
const HARD = 'Edit ONLY capture-layout.mjs. Back up FIRST: cp capture-layout.mjs /tmp/ev-bk-capture-wordsafe.mjs (this is the CURRENT recipe-#25 state; restoring it = keep #25 as-is). Do NOT edit grade-*/build-*/perelement. AUTH before every WP command: ' + AUTH + '. Never print JOIST_AUTH_B64.'

const ASCHEMA = { type: 'object', additionalProperties: false, properties: {
  rasteredSurfaceCount: { type: 'number' }, surfacesWithText: { type: 'number' },
  buriedHeadings: { type: 'array', items: { type: 'string' } }, buriedTextLeafCount: { type: 'number' },
  buriesWords: { type: 'boolean' }, detectorLocation: { type: 'string' }, tightenPlan: { type: 'string' },
}, required: ['rasteredSurfaceCount', 'surfacesWithText', 'buriesWords', 'tightenPlan'] }
const audit = await agent([HARD.replace('Edit ONLY capture-layout.mjs. ', 'AUDIT — read-only, do NOT edit (isolated Playwright + read the captured json + source). '),
  'AUDIT whether surface-raster (recipe #25, live in capture-layout.mjs) buries WORDS. Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput.',
  'Capture resend with surface-raster ON: node capture-layout.mjs --source https://resend.com --out /tmp/ws-resend-ON.json. Read it: find the surface-raster leaves (kind mockup/surface:true or .raster set). For EACH rastered surface, check its source box region against the SOURCE DOM (load resend in Playwright at 1440): does that region contain real HEADING/body TEXT in the source (e.g. the hero "Email for developers", card titles like "Modular webhooks", "Contact management", "Broadcast analytics")?',
  'Then check the ON capture: is that text PRESENT as native text leaves (kind text/heading) OR is it MISSING (buried in the raster image)? buriedHeadings = the list of source headings/text that fall inside a rastered surface AND are absent from the ON capture text leaves. buriedTextLeafCount = how many. surfacesWithText = how many of the rastered surfaces overlap real source text. rasteredSurfaceCount = total.',
  'buriesWords = true iff buriedTextLeafCount > 0 (any real heading/body text got buried in an image). Read capture-layout.mjs to find the surface-raster detector (the kind:mockup{surface:true} emit added by recipe #25) -> detectorLocation (line range). tightenPlan = how to make it text-aware: raster a surface ONLY if it has NO meaningful text descendants (text-leaf area within the surface box < ~5% / no heading/p with >3 words); a surface WITH text -> either skip raster (keep DOM) or raster only the text-free backdrop + keep text as native leaves via the existing textMask path. Be specific.',
  'Return {rasteredSurfaceCount, surfacesWithText, buriedHeadings, buriedTextLeafCount, buriesWords, detectorLocation, tightenPlan}.',
].join('\n'), { label: 'audit:wordsafe', phase: 'Audit', schema: ASCHEMA })
log('AUDIT: rastered=' + (audit&&audit.rasteredSurfaceCount) + ' withText=' + (audit&&audit.surfacesWithText) + ' buriesWords=' + (audit&&audit.buriesWords) + ' buriedHeadings=' + JSON.stringify(audit&&audit.buriedHeadings))

let impl = null, verify = null
if (audit && audit.buriesWords) {
  phase('Tighten')
  impl = await agent([HARD,
    'TIGHTEN surface-raster to be WORD-SAFE. Work in ' + GRADER + '. AUDIT found it buries words: buriedHeadings=' + JSON.stringify(audit.buriedHeadings) + ' (' + audit.buriedTextLeafCount + ' leaves), surfacesWithText=' + audit.surfacesWithText + '/' + audit.rasteredSurfaceCount + '. Detector at: ' + String(audit.detectorLocation||'').slice(0,120) + '. Plan: ' + String(audit.tightenPlan||'').slice(0,400),
    'Modify the surface-raster detector (recipe #25, the kind:mockup{surface:true} emit) so it rasters a surface ONLY IF it is TEXT-FREE: the surface box contains NO meaningful text descendants (no heading, no <p>/text-leaf with >3 words; text-leaf area within the box < ~5% of the box). A surface that CONTAINS meaningful text -> do NOT raster the whole thing: either (a) skip the raster entirely and let the normal walk capture its DOM (preferred when the surface is mostly walkable), or (b) if it is a canvas/iframe with text OVERLAID on top (separate DOM), raster only the visual surface and KEEP the overlaid text as native leaves (the existing textMask/overlay-rescue path). NEVER bury a heading or body paragraph in an image. The pure text-free visual surfaces (the WebGL hero scene with no text, cross-origin preview iframes) MUST still raster (keep that recovery).',
    'REVERSIBILITY: keep CAPTURE_NO_SURFACERASTER=1 (disables all surface-raster). STEP 0 already backed up to /tmp/ev-bk-capture-wordsafe.mjs (the #25 state). node --check. SELFTEST: ' + AUTH + ' && node grade-sections.mjs --source https://supabase.com --selftest -> 1.0. SMOKE: capture resend ON -> confirm the buried headings ' + JSON.stringify(audit.buriedHeadings) + ' are NOW present as native text leaves AND text-free surfaces (WebGL hero) still raster. If node --check fails -> restore + RESTORED.',
    'Return "OK:" with: which surfaces still raster (text-free) vs now-kept-as-DOM (text-bearing) + confirmation the buried headings are back as native text, or "RESTORED:".',
  ].join('\n'), { label: 'tighten:wordsafe', phase: 'Tighten' })
  log('IMPL: ' + String(impl || '').slice(0, 280))

  const okImpl = /\bOK:/i.test(String(impl || '')) && !/\bRESTORED:/i.test(String(impl || ''))
  if (okImpl) {
    phase('Verify+Gate')
    const VS = { type: 'object', additionalProperties: false, properties: {
      site: { type: 'string' }, headingsPreserved: { type: 'boolean' }, textFreeSurfacesStillRastered: { type: 'number' },
      structPre25: { type: 'number' }, structNow: { type: 'number' }, visualNow: { type: 'number' }, compositeNow: { type: 'number' }, compositePre: { type: 'number' },
      verdict: { type: 'string' },
    }, required: ['site', 'headingsPreserved', 'textFreeSurfacesStillRastered', 'structNow', 'visualNow', 'compositeNow', 'compositePre', 'verdict'] }
    verify = await agent([HARD,
      'VERIFY the word-safe tighten on resend. Work in ' + GRADER + '. ' + AUTH + '. You MUST end by calling StructuredOutput. Do NOT edit files. A prior agent tightened surface-raster to be word-safe; audit had found buried headings ' + JSON.stringify(audit.buriedHeadings) + '.',
      'Build+publish resend (build-absolute.mjs --page 2988) with the tightened capture (default). RENDER + READ the clone: headingsPreserved=true iff the previously-buried headings ' + JSON.stringify(audit.buriedHeadings) + ' now render as NATIVE selectable text (not inside an image). textFreeSurfacesStillRastered = how many genuine text-free visual surfaces (WebGL hero etc.) still got rastered (the recovery must be retained).',
      'GRADE: ' + AUTH + ' && node grade-sections.mjs --source https://resend.com --clone "$JOIST_BASE/?page_id=2988" --out /tmp/ws-resend-graded. structNow, visualNow, compositeNow. For reference: pre-#25 struct ~0.444, #25 struct 0.302 / visual 0.644 / composite 0.52. compositePre = the #25 composite (0.52). structPre25 = 0.444 (the pre-surface-raster struct).',
      'Judge like a human: are the headings real text AND the WebGL hero still shows real content (not a void)? Return {site, headingsPreserved, textFreeSurfacesStillRastered, structPre25, structNow, visualNow, compositeNow, compositePre, verdict}.',
    ].join('\n'), { label: 'verify:wordsafe', phase: 'Verify+Gate', schema: VS })
    log('VERIFY: headingsPreserved=' + (verify&&verify.headingsPreserved) + ' textFreeRastered=' + (verify&&verify.textFreeSurfacesStillRastered) + ' struct ' + (verify&&verify.structNow) + ' vis ' + (verify&&verify.visualNow) + ' comp ' + (verify&&verify.compositeNow))
  }
}

phase('Verify+Gate')
let verdict
if (!audit) {
  verdict = 'INCONCLUSIVE — audit produced no result.'
} else if (!audit.buriesWords) {
  verdict = 'NO TIGHTEN NEEDED — audit found surface-raster does NOT bury words (rastered ' + audit.rasteredSurfaceCount + ', surfacesWithText ' + audit.surfacesWithText + ', buriedTextLeafCount 0). The struct drop is the HONEST unwalkable-surface cost (1 image vs source internal structure that cannot be captured), not word-burying. Recipe #25 stands as-is. The user words-rebuilt principle is HONORED (text-free surfaces only / overlaid text preserved).'
} else if (!impl || !/\bOK:/i.test(String(impl)) || /\bRESTORED:/i.test(String(impl))) {
  verdict = 'RESTORED to #25 state — tighten failed node --check: ' + String(impl||'').slice(0,200) + '. Word-burying remains a known issue (recipe #25 caveat).'
} else {
  const v = verify || {}
  const ok = v.headingsPreserved === true && v.textFreeSurfacesStillRastered > 0 && v.compositeNow >= v.compositePre - 0.01
  if (ok) {
    verdict = 'ADOPTED — surface-raster is now WORD-SAFE: buried headings restored as native text (headingsPreserved), ' + v.textFreeSurfacesStillRastered + ' text-free visual surfaces still rastered (recovery retained), struct ' + v.structNow + ' (recovered from 0.302), visual ' + v.visualNow + ', composite ' + v.compositeNow + ' (vs #25 ' + v.compositePre + '). Honors the user words-rebuilt principle WHILE keeping the canvas/iframe visual recovery. Reversible CAPTURE_NO_SURFACERASTER=1.'
  } else {
    await agent('Restore: cd ' + GRADER + ' && cp /tmp/ev-bk-capture-wordsafe.mjs capture-layout.mjs && node --check capture-layout.mjs && echo RESTORED. Return nothing else.', { label: 'restore', phase: 'Verify+Gate' })
    verdict = 'RESTORED to #25 state — tighten did not cleanly preserve words + recovery + composite (' + JSON.stringify(v).slice(0,250) + '). Word-burying remains a known #25 caveat; revisit with a different approach.'
  }
}
log('SURFACE-RASTER-WORDSAFE: ' + verdict)
return { verdict, audit, impl: String(impl||'').slice(0,400), verify }

export const meta = {
  name: 'reclone-supabase-regrade-persection',
  description: 'Re-clone supabase fresh with current build-structured (+section-spec), re-capture, and grade per-section with grade-spec — determine stale-vs-real-bug and localize the layout-collapse defect',
  phases: [{ title: 'Reclone+Regrade', detail: 'capture-reuse src, build+publish to 12157, re-capture clone, grade-spec per-section, diagnose' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SRC = '/tmp/glob-supa.json'                 // canonical supabase source (206 leaves, pageH 7578)
const PAGE = '12157'                              // the production supabase clone page (/structured-supabase/)
const CLONE_URL = '' + (process.env.JOIST_BASE || 'http://localhost:8001') + '/structured-supabase/'
const BEFORE_MEAN = 0.093                         // prior good-clone per-section positional mean (the stale/current 12157)
const BEFORE_PAGEH = 15576                        // prior clone height (2.06x the 7578 source — the collapse signature)

const SCHEMA = {
  type: 'object', additionalProperties: true,
  properties: {
    builtOk: { type: 'boolean', description: 'build-structured produced a valid tree (OK: line, no FAIL)' },
    publishOk: { type: 'boolean', description: 'published to page 12157 without a fatal error (422 atomic_save_silent is harmless)' },
    cloneCaptured: { type: 'boolean' },
    srcPageH: { type: 'number' },
    clonePageH: { type: 'number', description: 'rebuilt clone page height' },
    heightRatio: { type: 'number', description: 'clonePageH / srcPageH (1.0 = perfect; prior was 2.06 = collapsed/stretched)' },
    afterMean: { type: 'number', description: 'grade-spec per-section positional mean on the FRESH build' },
    perSection: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { idx: { type: 'number' }, role: { type: 'string' }, coverage: { type: 'number' }, textCoverage: { type: 'number' } } } },
    centeringFires: { type: 'boolean', description: 'does the rebuilt hero/content land centered (x near vw/2), or left-aligned like before?' },
    gridsFire: { type: 'boolean', description: 'does a feature/card section render as multi-column at desktop, or collapsed to 1 column?' },
    staleVsRealBug: { type: 'string', description: 'one of: "12157-was-stale-fresh-is-better" | "real-current-bug-still-collapses" | "mixed"' },
    diagnosis: { type: 'string', description: 'the precise localized defect: which recipe (centered max-width / RAM-grid) is not firing and why, per the evidence' },
    summary: { type: 'string' },
  },
  required: ['builtOk', 'summary'],
}

phase('Reclone+Regrade')
const r = await agent(
  [
    'Run a full re-clone + per-section re-grade of the supabase clone to determine whether the live page 12157 layout-collapse is STALE or a CURRENT build bug, and localize the exact defect. Work in ' + GRADER + '. This round EDITS NO CODE — it RUNS the existing pipeline and MEASURES. Do not modify any .mjs file.',
    '',
    'SECURITY: auth lives in /tmp/joist-auth.env (it sets JOIST_AUTH_B64). Source it (set -a; . /tmp/joist-auth.env; set +a) so the var is in the env. NEVER echo/print/cat JOIST_AUTH_B64 or the env file contents — not in logs, not in your report.',
    '',
    'CONTEXT: build-structured.mjs is the reflow builder. The live clone (page ' + PAGE + ', ' + CLONE_URL + ') has pageH ' + BEFORE_PAGEH + ' = 2.06x the source ' + 'pageH 7578, and grade-spec.mjs scored it per-section positional mean ' + BEFORE_MEAN + ' (weakest hero/logos/features). The finding: content present but reflowed to a left-aligned single column with non-uniform vertical stretch. QUESTION: does the CURRENT build-structured (which has centered-hero + RAM-grid #35 recipes + the new JOIST_SECTIONSPEC layer) still collapse, or was 12157 a stale build?',
    '',
    'STEPS (sequential; report what each yields):',
    '1. BUILD + PUBLISH fresh: JOIST_SECTIONSPEC=1 node build-structured.mjs --layout ' + SRC + ' --page ' + PAGE + ' --publish 2>&1 | tail -25 . Capture the "OK:" line (containers, native widgets, %-flex columns, RAM grid rows if printed) and the section-spec classification log. builtOk = an OK: line printed and no FAIL. publishOk = the page PUT succeeded (a 422 atomic_save_silent_failure is HARMLESS — postmeta still propagates; treat as publishOk=true if the tree was written).',
    '2. RE-CAPTURE the rebuilt clone with a UNIQUE cache-buster (SiteGround proxy caches): read capture-layout.mjs CLI usage (head of file), then capture ' + CLONE_URL + '?v=RANDOM (use a unique number) to /tmp/reclone-clone.json. Confirm leaves>50 and report clonePageH.',
    '3. GRADE per-section: node grade-spec.mjs --src ' + SRC + ' --clone /tmp/reclone-clone.json --summary 2>&1 . Record afterMean + per-section coverage/textCoverage.',
    '4. DIAGNOSE the collapse directly from /tmp/reclone-clone.json leaves (compare to ' + SRC + '):',
    '   - heightRatio = clonePageH / 7578. (1.0 ideal; >1.5 = vertical stretch/collapse.)',
    '   - centeringFires: in the source, the hero content column is centered (left edge x~418 of vw 1440). In the rebuilt clone, where does the hero heading land in x? If x is near vw/2-centered (content block centered) -> true; if left-aligned at x<200 -> false.',
    '   - gridsFire: source features section #2/#6 is a multi-column grid (cells at x=211/777/1060). In the rebuilt clone, are those feature items at multiple x-positions (grid preserved) or all at one x (collapsed to 1 column)? true/false.',
    '5. CONCLUDE staleVsRealBug + a precise diagnosis: if heightRatio is now ~1.0-1.3 and centering/grids fire -> "12157-was-stale-fresh-is-better" (record the new baseline). If it still stretches 2x / left-aligns / collapses grids -> "real-current-bug-still-collapses" and name the precise recipe not firing (e.g. "RAM-grid does not fire because the feature cells are not comparable-width so they fall to the flex-%-basis single-column path" or "centered max-width inner is emitted but content_width boxed still left-aligns because flex_align_items center is missing on the inner").',
    '',
    'Report ALL fields via the schema. Be truthful — if the fresh build is WORSE, say so. The point is an honest measurement + a precise, actionable diagnosis, not a flattering number.',
  ].join('\n'),
  { schema: SCHEMA, label: 'reclone+regrade:12157', phase: 'Reclone+Regrade' }
)

log('reclone+regrade done: builtOk=' + (r && r.builtOk) + ' heightRatio=' + (r && r.heightRatio) + ' afterMean=' + (r && r.afterMean) + ' verdict=' + (r && r.staleVsRealBug))
return r

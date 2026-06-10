export const meta = {
  name: 'bento-cssgrid-feasibility-diagnose',
  description: 'DIAGNOSE (read-mostly) whether the dominant residual — BENTO/overlap sections (supabase #2/#8, vercel #2) — can be modeled as a CSS GRID with spanning/overlapping grid-areas that packs them compactly AND reflows AND keeps NO horizontal scroll (unlike absolute positioning, which reintroduces h-scroll). Determine: tractable CSS-grid-bento recipe vs genuinely needs the user reflow-vs-positional call. TEXT-return; NO code change (diagnosis).',
  phases: [{ title: 'Diagnose' }],
}

const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const SUPA = '/tmp/glob-supa.json'

phase('Diagnose')
const r = await agent(
  [
    'DIAGNOSE (read-mostly, NO code change) whether the BENTO/overlap sections — the dominant residual defect — can be faithfully modeled as a CSS GRID with spanning/overlapping grid-areas. Work in ' + GRADER + '. Return PLAIN TEXT.',
    '',
    'CONTEXT: the #1 remaining clone defect is bento/overlap sections (supabase #2 features hRatio 3.08 +2182px = 42% of the page overage; #8 3.38; vercel #2). The source packs large images/cards DENSELY (sum of child heights >> the band height) via OVERLAP / absolute / negative-margin layout. build-structured (flex) stacks them -> 3x too tall. ABSOLUTE positioning would pack them but REINTRODUCES horizontal scroll (the user\'s explicit hard-NO) + breaks reflow. KEY IDEA TO TEST: CSS GRID can place items in SPANNING and even OVERLAPPING grid-areas (two items in the same grid cell, or grid-row/column spans) WITHOUT absolute positioning AND while staying responsive (the grid reflows) AND with no horizontal scroll (the track minmax caps width). So a bento MIGHT be modelable as a CSS grid template with per-item grid-area placement derived from the captured boxes.',
    '',
    'INVESTIGATE on supabase section #2 (the dominant bento) using ' + SUPA + ' (segment it; section idx 2; inspect its member boxes — the headings/text/images/mockups + their x,y,w,h):',
    '1. STRUCTURE: are the #2 members on a REGULAR-ish grid (snap their x-edges + y-edges to a small set of column/row lines -> an N-column x M-row grid where items span cells)? Or are they TRULY irregular/overlapping (boxes overlap each other in BOTH x and y, no clean line-snapping)? Quantify: how many distinct column-lines + row-lines do the member x/y edges snap to (within a tolerance)? Do member boxes OVERLAP each other (area intersection > 0)?',
    '2. PACKING: is the section TALL in the clone because members STACK (each on its own row) when they SHOULD share rows (sit side-by-side)? I.e., could a grid with the inferred column-lines place the members side-by-side (multiple per row) and recover the compact height? Estimate the grid height if members were placed on the inferred row-lines (vs the current stacked sum).',
    '3. OVERLAP NECESSITY: do any members GENUINELY overlap (a caption over an image, layered cards) such that NO non-overlapping grid can represent them — requiring grid-area overlap (same cell) or z-index? Or is it just side-by-side packing (no true overlap) that a normal grid handles?',
    '4. FEASIBILITY VERDICT: is a CSS-grid-bento recipe TRACTABLE (the members snap to a clean-enough column/row grid + side-by-side packing recovers the height + minmal/no true overlap -> a derivable grid-template-columns/rows + per-item grid-area, kses-safe, no-h-scroll, reflows) — OR does it need true overlap/z-index (harder but still grid-doable) — OR is it genuinely irregular enough that it needs the user reflow-vs-positional architectural decision?',
    '',
    'END with one line: "VERDICT: GRID-TRACTABLE" (a CSS-grid-bento recipe is feasible — describe the derivation) or "VERDICT: GRID-OVERLAP-NEEDED" (doable via grid-area overlap/z-index, harder) or "VERDICT: NEEDS-USER-ARCH" (genuinely irregular -> the reflow-vs-positional call), preceded by the structural measurements (column/row line counts, overlap stats, estimated packed height vs current).',
  ].join('\n'),
  { label: 'diagnose:bento-grid', phase: 'Diagnose' }
)

log('bento-grid feasibility: ' + String(r || '').slice(-200))
return { kept: false, report: String(r || '').slice(0, 2500) }

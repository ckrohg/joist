#!/usr/bin/env node
// @purpose assemble-judging.mjs — P3 falsifier judging-package assembler (EMBODIMENT_APPROACH §P3).
// Deterministic: seeded PRNG (mulberry32, seed 20260612) assigns left/right per pair, so the sealed
// answer key in /tmp/p3-judging/answer-key.json is REPRODUCIBLE from this script alone if /tmp is
// lost. Inputs: /tmp/p3-judging/render-{with,without}-XX.png (render-exemplar.mjs output, local
// chromium, pre-transpile). Outputs: pair-XX-{left,right}.png + manifest.json (judge-facing, no arm
// identity) + answer-key.json (orchestrator-only). Run from /tmp/p3-judging.
// THE JUDGE MUST NOT READ answer-key.json, this file, or falsifier HTML comments before verdicts.
import fs from 'fs';
function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
const rng = mulberry32(20260612);
const SECTIONS = [
  { id:'01', site:'clerk.com',       source:'source-01.png', width:1216, desc:'b2b-saas section header (eyebrow/h2/copy/link)' },
  { id:'02', site:'clerk.com',       source:'source-02.png', width:1216, desc:'organizations 3-column feature cards' },
  { id:'03', site:'clerk.com',       source:'source-03.png', width:1280, desc:'billing split: text col + pricing app mock' },
  { id:'04', site:'clerk.com',       source:'source-04.png', width:1280, desc:'dark dual feature (frameworks/integrations) + icon grids' },
  { id:'05', site:'clerk.com',       source:'source-05.png', width:1280, desc:'testimonial wall (intro + quote card columns)' },
  { id:'06', site:'clerk.com',       source:'source-06.png', width:1440, desc:'footer (brand + 5 link columns + legal row)' },
  { id:'07', site:'tailwindcss.com', source:'source-07.png', width:1000, desc:'sponsors band (headline/CTA + hairline logo wall)' },
  { id:'08', site:'tailwindcss.com', source:'source-08.png', width:1000, desc:'built-for-the-modern-web band (logos tail + heading + responsive-design card)' },
  { id:'09', site:'tailwindcss.com', source:'source-09.png', width:1000, desc:'feature bento 2x2 (filters/dark-mode/css-variables/cascade-layers)' },
  { id:'10', site:'tailwindcss.com', source:'source-10.png', width:1000, desc:'transitions band (easing panel + logical-props/container-queries + code panel)' },
];
const key = { seed:20260612, note:'SEALED — orchestrator opens AFTER verdicts.', pairs:{} };
for (const s of SECTIONS) {
  const withLeft = rng() < 0.5;
  key.pairs[s.id] = { left: withLeft ? 'with' : 'without', right: withLeft ? 'without' : 'with' };
}
console.log(JSON.stringify(key, null, 2));

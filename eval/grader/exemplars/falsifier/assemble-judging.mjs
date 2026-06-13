#!/usr/bin/env node
// @purpose assemble-judging.mjs — P3 falsifier judging-package assembler (EMBODIMENT_APPROACH §P3).
// Deterministic: seeded PRNG (mulberry32) assigns left/right per pair, so the sealed answer key is
// REPRODUCIBLE from this script + the seed recorded inside answer-key.json. Seed comes from --seed <int>
// (default 20260612, the original P3 key). 2026-06-12 FIX: --seed used to be SILENTLY IGNORED (the seed was
// hardcoded), so "re-assembly with a fresh seed" reproduced the SAME mapping — and the key was printed to
// STDOUT, which is judge-visible transcript. Now: --seed is honored, and the key (and the seed, which
// regenerates it) are written ONLY to answer-key.json — NEVER stdout.
// Inputs:  <dir>/render-{with,without}-XX.png  (render-exemplar.mjs output, local chromium, pre-transpile)
// Outputs: <dir>/pair-XX-{left,right}.png + manifest.json (judge-facing, no arm identity, no seed)
//          <dir>/answer-key.json (orchestrator-only, sealed)
// CLI: node assemble-judging.mjs [--seed <int>] [--out <dir>]   (default dir '.', run from /tmp/p3-judging)
// THE JUDGE MUST NOT READ answer-key.json, this file, or falsifier HTML comments before verdicts.
// Selftest: _assemble-judging-selftest.mjs (seed honored + reproducible; key/seed never on stdout).
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}

export const SECTIONS = [
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

// pure: seed -> sealed key (exported for the selftest; NO file or stdout side effects)
export function buildKey(seed) {
  const s = seed >>> 0;
  const rng = mulberry32(s);
  const key = { seed: s, note: 'SEALED — orchestrator opens AFTER verdicts.', pairs: {} };
  for (const sec of SECTIONS) {
    const withLeft = rng() < 0.5;
    key.pairs[sec.id] = { left: withLeft ? 'with' : 'without', right: withLeft ? 'without' : 'with' };
  }
  return key;
}

const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (IS_MAIN) {
  const argOf = (k) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : undefined; };
  const seedRaw = argOf('seed');
  const seed = seedRaw === undefined ? 20260612 : Number(seedRaw);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) { console.error('--seed must be an integer in [0, 2^32)'); process.exit(2); }
  const DIR = argOf('out') || '.';
  fs.mkdirSync(DIR, { recursive: true });

  const key = buildKey(seed);
  const manifest = {
    note: 'Judge-facing: which side (left|right) is which arm is sealed in the orchestrator-only answer key.',
    pairs: [],
  };
  let copied = 0, missing = 0;
  for (const sec of SECTIONS) {
    const m = key.pairs[sec.id];
    const entry = { pair: sec.id, site: sec.site, section: sec.desc, width: sec.width, source: sec.source, left: `pair-${sec.id}-left.png`, right: `pair-${sec.id}-right.png` };
    for (const side of ['left', 'right']) {
      const src = path.join(DIR, `render-${m[side]}-${sec.id}.png`);
      const dst = path.join(DIR, `pair-${sec.id}-${side}.png`);
      if (fs.existsSync(src)) { fs.copyFileSync(src, dst); copied++; }
      else { entry.missingRenders = true; missing++; }
    }
    manifest.pairs.push(entry);
  }
  fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(DIR, 'answer-key.json'), JSON.stringify(key, null, 2));
  // SECURITY: nothing key-deriving on stdout — no mapping, no seed (seed + this script = the key).
  console.log(`assembled ${manifest.pairs.length} pairs (${copied} renders copied, ${missing} missing) -> ${path.join(DIR, 'manifest.json')}; key sealed -> ${path.join(DIR, 'answer-key.json')} (orchestrator-only)`);
}

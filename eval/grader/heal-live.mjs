#!/usr/bin/env node
/**
 * @purpose heal-live.mjs — WS2 Arm E: the LIVE closed-loop. Provides the real scoreFn the self-heal controller needs
 * (render heal HTML → re-capture box-tree → correspondSection vs the source section) and a smoke that degrades a
 * known-good section's HTML, runs healSection, and asserts correspondence strictly improves end-to-end on the sandbox.
 * This is the human-free proof the loop works (Arm D's core is already hermetically gated). Heavy: each scoreFn call =
 * transpile + render + capture (~1-2 min). Smoke defaults to 1 degradation / K=1 / 1 round; scale up for the full sweep.
 *
 * Usage (sandbox up at :8001, auth sourced):
 *   source /tmp/joist-auth-1.env && node heal-live.mjs --good /tmp/heal-good.html --degrade recolor [--k 1] [--rounds 1] [--page 806]
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { flatten, correspondSection } from './correspondence-reward.mjs';
import { healSection, regenPatch } from './heal-loop.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const HEROBAND = 950, SEC = { x: 0, y: 0, w: 1440, h: HEROBAND, bg: 'rgb(8,8,8)' };
const CTX = { srcPageBg: 'rgb(8,8,8)', clonePageBg: 'rgb(8,8,8)', textOnly: true };
const BASE = 'http://localhost:8001';

// LIVE scoreFn: html → { corr, cloneLeaves }. transpile → render(page) → capture → correspondSection vs source.
export function makeScoreFn({ sourceLeaves, page, heroBand = HEROBAND, sec = SEC, ctx = CTX, width = 1440 }) {
  return async function scoreFn(html) {
    const tmp = `/tmp/heal-cur-${page}.html`;
    fs.writeFileSync(tmp, html);
    execFileSync('node', ['transpile-html.mjs', '--html', tmp, '--width', String(width), '--dry-run', '--no-site-parts', '--out', `/tmp/heal-tr-${page}`], { cwd: path.dirname(new URL(import.meta.url).pathname), stdio: 'pipe' });
    execFileSync('node', ['../../sandbox/render.mjs', '--tree', `/tmp/heal-tr-${page}/tree.json`, '--page', String(page), '--no-shot'], { cwd: path.dirname(new URL(import.meta.url).pathname), stdio: 'pipe' });
    execFileSync('node', ['capture-layout.mjs', '--source', `${BASE}/?page_id=${page}`, '--out', `/tmp/heal-cap-${page}.json`], { cwd: path.dirname(new URL(import.meta.url).pathname), stdio: 'pipe', timeout: 180000 });
    const cloneLeaves = flatten(JSON.parse(fs.readFileSync(`/tmp/heal-cap-${page}.json`, 'utf8'))).filter((n) => n.box && n.box.y < heroBand);
    const corr = correspondSection(sourceLeaves, cloneLeaves, sec, sec, ctx);
    return { corr, cloneLeaves };
  };
}

// HTML-level degradations (the loop heals HTML, so degrade the HTML — distinct from Arm C's box-tree mutators).
const DEGRADE = {
  recolor: (h) => h.replace(/(class="heal-headline"[^>]*style="[^"]*?color:\s*)#?[0-9a-fA-Frgba(),. ]+/i, '$1#777777')
                   .replace(/(\.heal-headline\s*\{[^}]*?color:\s*)[^;]+/i, '$1#777777'),
  dropcta: (h) => h.replace(/<[^>]*class="heal-cta2"[\s\S]*?<\/[a-z]+>/i, ''),
  dropsub: (h) => h.replace(/<p class="heal-sub"[\s\S]*?<\/p>/i, ''), // drop a big block → clean existence-heal (no wrong-block ambiguity)
  mutate:  (h) => h.replace(/Email for developers/i, 'Email for everyone'),
};

const IS_MAIN = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (IS_MAIN) (async () => {
  const goodPath = arg('good', new URL('./_heal-good-hero.html', import.meta.url).pathname); const degradeName = arg('degrade', 'recolor');
  const page = +arg('page', 806), k = +arg('k', 1), rounds = +arg('rounds', 1);
  const sourceLeaves = flatten(JSON.parse(fs.readFileSync('/tmp/resend-layout.json', 'utf8'))).filter((n) => n.box && n.box.y < HEROBAND);
  const good = fs.readFileSync(goodPath, 'utf8');
  const degraded = (DEGRADE[degradeName] || DEGRADE.recolor)(good);
  if (degraded === good) { console.error(`degradation '${degradeName}' was a no-op — check the heal- class hooks in ${goodPath}`); process.exit(2); }
  const scoreFn = makeScoreFn({ sourceLeaves, page });

  console.log(`=== Arm E live smoke: degrade='${degradeName}' k=${k} rounds=${rounds} page=${page} ===`);
  const goodState = await scoreFn(good); console.log(`good HTML        → correspondence ${goodState.corr.score}  (color axis ${goodState.corr.axes.color})`);
  const before = await scoreFn(degraded); console.log(`degraded HTML    → correspondence ${before.corr.score}  (color axis ${before.corr.axes.color})`);
  const detectable = (goodState.corr.score - before.corr.score) > 3;
  console.log(`degradation detectable (drop > 3): ${detectable ? 'YES' : 'NO'}  (Δ ${(goodState.corr.score - before.corr.score).toFixed(2)})`);

  const res = await healSection({ currentHtml: degraded, scoreFn, regenFn: regenPatch, sourceImagePath: '/tmp/srchero-820.png', target: goodState.corr.score - 1, maxRounds: rounds, k, model: 'sonnet', log: (m) => console.log('  [heal]', m) });
  console.log(`\nhealed: before ${res.before} → after ${res.after}  (rounds ${res.rounds}, cost $${res.cost})`);
  const improved = res.after > res.before + 1;
  console.log(`${improved ? 'PASS' : 'FAIL'} — self-heal improved the degraded section live (${res.before} → ${res.after})`);
  process.exit(improved ? 0 : 1);
})().catch((e) => { console.error('heal-live FAILED:', e && e.stack || e); process.exit(1); });

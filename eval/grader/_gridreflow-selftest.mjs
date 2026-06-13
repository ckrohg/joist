#!/usr/bin/env node
/**
 * @purpose SELF-FALSIFIER for the grade-responsive-rail.mjs grid-reflow dimension. Asserts the
 * dim DISCRIMINATES the native-grid fix: GREEN (post-fix, page 83 / clerk-fullpage, the @768
 * B2B/auth bento grid reflows 4-up→2-up) must score the grid dim ~1.0, while RED (pre-fix,
 * RESPONSIVE_NO_NATIVE_GRID=1 — the grid stays 4-up-but-squished at 768) must score clearly lower.
 *
 * WHY THIS EXISTS: the OLD probe collapsed grid to a binary multiColRows (cols>=2) tally, which read
 * IDENTICALLY for both (both are "multi-col"), so grid was excluded from the score. The new probe
 * profiles equal-width card rows and measures (a) shedding of narrow-multi-up rows and (b) card-
 * width-fraction growth as the viewport narrows — the true reflow signature. This test pins that
 * contract so a future probe change can't silently re-break discrimination.
 *
 * PREREQS (set up by the orchestrator/grader engineer, NOT by this test):
 *   - GREEN = live page 83 (post-fix) on the LOCAL sandbox (http://localhost:8001/?page_id=83)
 *   - RED   = a SCRATCH page rendered from a pre-fix transpile
 *             (RESPONSIVE_NO_NATIVE_FONTSIZE=1 RESPONSIVE_NO_NATIVE_GRID=1 RESPONSIVE_NO_MOBILE_FULLWIDTH=1)
 * Pass the two URLs via --green / --red (defaults: 83 and 128). RAILS: read-only; LOCAL only.
 *
 * Usage: node _gridreflow-selftest.mjs [--green <url>] [--red <url>]
 * Exit 0 = discrimination holds; exit 1 = FAILED (grid dim no longer discriminates).
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const GREEN = arg('green', 'http://localhost:8001/?page_id=83');
const RED = arg('red', 'http://localhost:8001/?page_id=128');

// The dim must (1) be applicable on both, (2) credit GREEN's grid >= this, (3) score RED's grid
// at least this much LOWER than GREEN, and (4) the per-768 retain must order GREEN < RED.
const GREEN_GRID_MIN = 0.95;
const MIN_GRID_MARGIN = 0.20; // GREEN.gridScore - RED.gridScore must exceed this

function railJson(url) {
  const out = execFileSync('node', [join(__dirname, 'grade-responsive-rail.mjs'), '--url', url, '--json'], { cwd: __dirname, encoding: 'utf8', timeout: 110000 });
  return JSON.parse(out.trim().split('\n').pop());
}

const g = railJson(GREEN);
const r = railJson(RED);
const gGrid = g.gridReflow, rGrid = r.gridReflow;
const fails = [];

if (!gGrid.applicable) fails.push('GREEN grid dim ABSTAINED (expected applicable — has a narrow-multi-up grid)');
if (!rGrid.applicable) fails.push('RED grid dim ABSTAINED (expected applicable — same tree, same grid at 1440)');
if (gGrid.applicable && gGrid.score < GREEN_GRID_MIN) fails.push(`GREEN gridScore ${gGrid.score} < ${GREEN_GRID_MIN} (post-fix grid should fully reflow)`);
if (gGrid.applicable && rGrid.applicable && (gGrid.score - rGrid.score) < MIN_GRID_MARGIN) {
  fails.push(`grid-dim margin too small: GREEN ${gGrid.score} - RED ${rGrid.score} = ${(gGrid.score - rGrid.score).toFixed(3)} < ${MIN_GRID_MARGIN}`);
}
// 768 keystone: GREEN must retain FEWER narrow-multi-up rows than RED (more reflow).
const g768 = (gGrid.reflow || []).find((x) => x.w === 768);
const r768 = (rGrid.reflow || []).find((x) => x.w === 768);
if (g768 && r768 && !(g768.retain < r768.retain)) {
  fails.push(`@768 retain not ordered: GREEN ${g768.retain} should be < RED ${r768.retain} (GREEN reflows more)`);
}

console.log('=== grid-reflow self-falsifier ===');
console.log(`  GREEN ${GREEN}`);
console.log(`    applicable=${gGrid.applicable} gridScore=${gGrid.score} @768 retain=${g768 ? g768.retain : 'n/a'} (narrow3up ${gGrid.wideNarrow}→${g768 ? Math.round(g768.retain * gGrid.wideNarrow) : '?'})`);
console.log(`  RED   ${RED}`);
console.log(`    applicable=${rGrid.applicable} gridScore=${rGrid.score} @768 retain=${r768 ? r768.retain : 'n/a'} (narrow3up ${rGrid.wideNarrow}→${r768 ? Math.round(r768.retain * rGrid.wideNarrow) : '?'})`);
console.log(`  overall SCORE: GREEN ${g.score} (pass=${g.pass}) vs RED ${r.score} (pass=${r.pass})`);
if (fails.length) {
  console.log('  RESULT: FAIL');
  for (const f of fails) console.log('    - ' + f);
  process.exit(1);
}
console.log('  RESULT: PASS — grid dim discriminates GREEN(reflowed) vs RED(stuck-dense).');

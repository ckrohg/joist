#!/usr/bin/env node
/**
 * @purpose SELF-FALSIFIER for grade-responsive-rail.mjs — asserts the rail DISCRIMINATES a
 * post-fix responsive clone (GREEN) from a pre-fix one (RED), via the FALSIFIER-PROVEN dims
 * (horizontal-overflow + typography-scaling + height-sanity). Self-contained: it builds RED itself
 * (re-transpile clerk.html with the responsive fixes disabled → inject to a scratch page → grade →
 * teardown), so the contract reliably reproduces.
 *
 * HISTORY / HONEST LIMIT: an earlier version asserted the GRID-REFLOW dim discriminates. It does
 * NOT reproduce: freshly-injected scratch RED pages do not paint the card-grid IMAGES in time, so
 * RED's grid dim ABSTAINS (applicable=false) at every width — the grid "discrimination" was a
 * scratch-render artifact, not a real signal. Grid is therefore EXCLUDED from the rail score
 * (GRID_W=0) and computed best-effort only. The rail's real, reproducible discrimination rests on
 * overflow (RED: +69px gutter @390) and typography-stuck (RED: hero 64px across all widths). This
 * test pins THAT contract. Re-enable grid scoring + a grid-specific assertion once the scratch-RED
 * render reliably settles lazy-loaded card images.
 *
 * RAILS: LOCAL sandbox only (localhost:8001). GREEN = live page 83 (never written). RED = a scratch
 * page id, deleted at the end. Never mutates page 83.
 *
 * Usage: node _gridreflow-selftest.mjs [--green <url>]
 * Exit 0 = rail discriminates (GREEN pass, RED fail via the proven dims); exit 1 = FAILED.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const GREEN = arg('green', 'http://localhost:8001/?page_id=83');
const ASSETS = '/tmp/clerk-enriched-manifest.json';

function railJson(url) {
  const out = execFileSync('node', [join(__dirname, 'grade-responsive-rail.mjs'), '--url', url, '--json'], { cwd: __dirname, encoding: 'utf8', timeout: 110000 });
  return JSON.parse(out.trim().split('\n').pop());
}
function wpcli(script) {
  return execFileSync('docker', ['compose', 'run', '--rm', '-T', 'wpcli-1', '-c', script], { cwd: join(REPO, 'sandbox'), encoding: 'utf8', timeout: 100000 });
}

// 1. Build RED (pre-fix: all three responsive fixes disabled).
const redOut = '/tmp/red-selftest-build';
execFileSync('node', [join(__dirname, 'transpile-html.mjs'), '--html', join(__dirname, 'local-fidelity', 'clerk.html'),
  '--width', '1440', '--assets', ASSETS, '--out', redOut, '--no-site-parts', '--dry-run'],
  { cwd: __dirname, encoding: 'utf8', timeout: 110000, env: { ...process.env, RESPONSIVE_NO_NATIVE_FONTSIZE: '1', RESPONSIVE_NO_NATIVE_GRID: '1', RESPONSIVE_NO_MOBILE_FULLWIDTH: '1' } });

// 2. Inject RED to a scratch page via render.mjs (auto-assigns an id).
const injectSrc = `import { readFileSync } from 'node:fs';
import { render } from '${join(REPO, 'sandbox', 'render.mjs')}';
const tree = JSON.parse(readFileSync('${redOut}/tree.json','utf8'));
const res = await render(tree, { slug: 'resprail-red-selftest', title: 'RAIL RED selftest', width: 1440, noShot: true });
console.log('REDPAGE=' + res.pageId);`;
const injectFile = '/tmp/_resprail-red-inject.mjs';
execFileSync('node', ['-e', `require('fs').writeFileSync('${injectFile}', ${JSON.stringify(injectSrc)})`]);
const redOutLog = execFileSync('node', [injectFile], { encoding: 'utf8', timeout: 110000 });
const redId = (redOutLog.match(/REDPAGE=(\d+)/) || [])[1];
const RED = `http://localhost:8001/?page_id=${redId}`;

let g, r, fails = [];
try {
  g = railJson(GREEN);
  r = railJson(RED);

  // CONTRACT (validated, reproducible — dims 1-3, NOT grid):
  if (!(g.pass === true)) fails.push(`GREEN should PASS, got pass=${g.pass} score=${g.score}`);
  if (!(g.score >= 0.80)) fails.push(`GREEN score ${g.score} < 0.80`);
  if (!(r.pass === false)) fails.push(`RED should FAIL, got pass=${r.pass} score=${r.score}`);
  if (!(g.score - r.score >= 0.20)) fails.push(`discriminate margin ${(g.score - r.score).toFixed(3)} < 0.20 (GREEN ${g.score} vs RED ${r.score})`);
  // RED must fail via a PROVEN dim: a hard overflow somewhere OR typography stuck.
  const redOverflow = (r.byWidth ? Object.values(r.byWidth) : (r.widths || []).map((w) => (r.byWidth || {})[w] || {}))
    .some((b) => b && (b.fails || []).some((f) => String(f).includes('overflow')));
  const redTypoStuck = r.typography && r.typography.stuck === true;
  if (!(redOverflow || redTypoStuck)) fails.push('RED did not fail via a proven dim (expected overflow or typo-stuck)');
} finally {
  // 3. Teardown the scratch RED page — never leave it around.
  if (redId) try { wpcli(`wp post delete ${redId} --force >/dev/null 2>&1; echo done`); } catch { /* best-effort */ }
}

console.log('=== responsive-rail discrimination self-falsifier ===');
console.log(`  GREEN ${GREEN}: score=${g && g.score} pass=${g && g.pass} | typoStuck=${g && g.typography && g.typography.stuck} gridApplicable=${g && g.gridReflow && g.gridReflow.applicable}`);
console.log(`  RED   ${RED}: score=${r && r.score} pass=${r && r.pass} | typoStuck=${r && r.typography && r.typography.stuck} gridApplicable=${r && r.gridReflow && r.gridReflow.applicable} (grid abstain on scratch RED is EXPECTED)`);
if (fails.length) {
  console.log('  RESULT: FAIL');
  for (const f of fails) console.log('    - ' + f);
  process.exit(1);
}
console.log('  RESULT: PASS — rail discriminates GREEN(pass) vs RED(fail) via the proven overflow+typography dims.');

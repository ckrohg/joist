#!/usr/bin/env node
/**
 * @purpose correspondence-responsive.mjs — WS5 (PATH_TO_TRUE_1TO1_V2): per-breakpoint responsive correspondence. The
 * responsive gap is TRANSPILER-EMISSION, not source/blowup: the clone reflows containers but routes font-size + off-grid
 * breakpoints through a `custom_css @media` channel that Hello+free STRIPS, so mobile typography/layout doesn't reflow.
 * This MEASURES that gap — grade correspondence at 1440 / 768 / 390 — so the desktop-high / mobile-low spread quantifies
 * it and becomes the GATE for the native-`_tablet`/`_mobile`-controls emission fix (the follow-on that closes it).
 *
 *   responsiveCorrespondence({ srcTrees, cloneTrees, widths }) → { perBp:[{w,score,axes}], desktop, mobileMin, gap }
 *   captures via capture-layout at each width when given URLs (CLI), or accepts pre-captured trees (lib).
 *
 * CLI: node correspondence-responsive.mjs --source <url> --clone <url> [--widths 1440,768,390] [--cache prefix]
 *   --cache <prefix>: reuse /tmp/<prefix>-src-<w>.json / -cln-<w>.json if present (skip re-capture; cheaper).
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { flatten, gradeCorrespondence } from './correspondence-reward.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const captureAt = (url, width, out) => { execFileSync('node', ['capture-layout.mjs', '--source', url, '--width', String(width), '--out', out], { cwd: HERE, stdio: 'pipe', timeout: 220000 }); return JSON.parse(fs.readFileSync(out, 'utf8')); };

// per-breakpoint correspondence over pre-captured trees keyed by width. Pure (no IO).
export function responsiveCorrespondence({ srcTrees, cloneTrees, widths = [1440, 768, 390], opts = { textOnly: true } }) {
  const perBp = widths.map((w) => { const s = srcTrees[w], c = cloneTrees[w]; if (!s || !c) return { w, score: null }; const r = gradeCorrespondence(s, c, opts); return { w, score: r.score, axes: r.axes, matchedSections: r.matchedSections, nSections: r.nSections }; });
  const scored = perBp.filter((b) => b.score != null);
  const desktop = perBp.find((b) => b.w === Math.max(...widths))?.score ?? null;
  const mobileMin = scored.length ? Math.min(...scored.map((b) => b.score)) : null;
  return { perBp, desktop, mobileMin, gap: desktop != null && mobileMin != null ? +(desktop - mobileMin).toFixed(2) : null };
}

const IS_MAIN = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (IS_MAIN) (async () => {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
  const srcUrl = arg('source'), clnUrl = arg('clone'); const widths = (arg('widths', '1440,768,390')).split(',').map(Number);
  const cache = arg('cache'); if (!srcUrl || !clnUrl) { console.error('usage: --source <url> --clone <url> [--widths 1440,768,390] [--cache prefix]'); process.exit(2); }
  const srcTrees = {}, cloneTrees = {};
  for (const w of widths) {
    const sp = cache ? `/tmp/${cache}-src-${w}.json` : `/tmp/resp-src-${w}.json`, cp = cache ? `/tmp/${cache}-cln-${w}.json` : `/tmp/resp-cln-${w}.json`;
    srcTrees[w] = (cache && fs.existsSync(sp)) ? JSON.parse(fs.readFileSync(sp, 'utf8')) : (console.error(`capture source @${w}…`), captureAt(srcUrl, w, sp));
    cloneTrees[w] = (cache && fs.existsSync(cp)) ? JSON.parse(fs.readFileSync(cp, 'utf8')) : (console.error(`capture clone @${w}…`), captureAt(clnUrl, w, cp));
  }
  const r = responsiveCorrespondence({ srcTrees, cloneTrees, widths });
  console.log('=== responsive correspondence (per breakpoint) ===');
  for (const b of r.perBp) console.log(`  ${String(b.w).padStart(5)}px → ${b.score == null ? 'n/a' : b.score}${b.axes ? '  (position ' + b.axes.position + ', text ' + b.axes.text + ')' : ''}`);
  console.log(`\ndesktop ${r.desktop} · mobile-min ${r.mobileMin} · RESPONSIVE GAP ${r.gap}  (large gap = the @media-stripped emission problem)`);
})().catch((e) => { console.error('FAILED:', e && e.stack || e); process.exit(1); });

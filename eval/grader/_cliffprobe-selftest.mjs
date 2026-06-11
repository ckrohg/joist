#!/usr/bin/env node
/**
 * @purpose Game-test selftest for the HARDENED cliff probe (grade-structure.mjs, 2026-06-10 — multi-boundary
 * samples + source-baselined cumulative excess). Complements _midwidth-selftest.mjs (which covers the original
 * T1-T5 incl. GRADER_NO_MIDWIDTH reversibility); THIS file pins the dodge cases the grader-truth critic raised:
 *   A1 1023-UNPIN DODGE — clone cliffs at <=1023 (not 1024): the adjacent 1024/1025 pair reads ~1.0 (dodged)
 *      but the 900/768 samples catch the persisting blowup → cliffExcess>1.3 → cap 0.35.
 *   A2 CUSTOM-BP DODGE — clone cliffs at <=800: only the 768 sample lands below it → still caught.
 *   B  SCALE-TRANSFORM DODGE — uniform shrink of a 1440 canvas (no reflow): heights flat + content inside the
 *      viewport ⇒ NO deterministic cap fires (decided + documented in grade-structure.mjs — capping on font
 *      size alone would hit innocent fluid-typography pages); the heroFsVisRatio768 diagnostic must flag it
 *      (scaleShrinkSuspect=true) and the vision-judge is the scoring backstop. This test pins exactly that.
 *   C1 INNOCENT SOURCE SELF-PAIR — composite stays ~0.96, zero caps. + C1b: cached-source path (no
 *      --refresh-source) still produces the source baseline (midwidthSrc cache read).
 *   C2 HONEST-REFLOW — clone stacks its grid at Elementor's 1024 while the source stacks the SAME grid at 768
 *      (both reasonable heights): the clone's own adjacent jump IS >1.3 (legacy raw veto would have capped
 *      honest responsive behavior) but cliffExcess ≈ 1 → NOT capped. The core value of fix #2.
 *   C3 CLIFFY SOURCE SELF-PAIR — a source that legitimately jumps >1.3 at 1024 graded against itself: a
 *      PERFECT clone of a cliffy source must NOT be capped (srcCliffRatio>1.3, caps empty).
 * Exit 0 = ALL PASS.
 */
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const base = (extraHead, body) => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;font-family:Arial}${extraHead}</style></head><body>
<h1 style="color:#111;font-size:48px;margin:24px">Hero Headline For The Probe</h1>
<p style="color:#333;font-size:18px;margin:24px;max-width:880px">A paragraph of perfectly ordinary visible content so the capture pipeline has text runs to work with at every width.</p>
${body}
</body></html>`;

const innocentBody = `<div style="max-width:900px;margin:0 auto">${Array.from({ length: 12 }, (_, i) => `<p style="color:#222;font-size:16px">Fluid responsive content block number ${i + 1} that reflows cleanly at any viewport width.</p>`).join('')}</div>`;
const cliffBody = `<div id="pad"></div><div style="height:3600px"><p style="color:#222;font-size:16px">tall content body for a stable base height</p></div>`;

// honest-reflow grid: SAME 9 cards in both fixtures; only the stacking breakpoint differs (1024 vs 768).
const gridCards = Array.from({ length: 9 }, (_, i) => `<div style="height:180px;background:#f3f4f6;border:1px solid #ddd;padding:12px;box-sizing:border-box"><h3 style="color:#111;font-size:20px;margin:0 0 8px">Feature card number ${i + 1}</h3><p style="color:#444;font-size:14px;margin:0">A short supporting sentence for feature card ${i + 1} in the grid.</p></div>`).join('');
const gridPage = (bp) => base(`#grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px} @media (max-width:${bp}px){#grid{grid-template-columns:1fr}}`, `<div id="grid">${gridCards}</div>`);

// scale-transform dodge: 1440-designed canvas uniformly shrunk to the viewport — no reflow ever.
const scaledPage = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;font-family:Arial}</style></head><body>
<div id="cv" style="width:1440px;transform-origin:0 0">
<h1 style="color:#111;font-size:48px;margin:24px">Hero Headline For The Probe</h1>
<p style="color:#333;font-size:18px;margin:24px;max-width:880px">A paragraph of perfectly ordinary visible content so the capture pipeline has text runs to work with at every width.</p>
${Array.from({ length: 10 }, (_, i) => `<p style="color:#222;font-size:16px;margin:24px">Frozen canvas content row ${i + 1} designed strictly for one thousand four hundred and forty pixels.</p>`).join('')}
<p style="position:absolute;left:1280px;top:120px;color:#222;font-size:15px;width:140px">right edge content</p>
</div>
<script>const fit=()=>{document.getElementById('cv').style.transform='scale('+(window.innerWidth/1440)+')';};fit();window.addEventListener('resize',fit);</script>
</body></html>`;

const pages = {
  '/innocent': base('', innocentBody),
  '/cliff1023': base('#pad{display:none} @media (max-width:1023px){#pad{display:block;height:8000px}}', cliffBody),
  '/cliff800': base('#pad{display:none} @media (max-width:800px){#pad{display:block;height:8000px}}', cliffBody),
  '/scaled': scaledPage,
  '/grid768': gridPage(768),
  '/grid1024': gridPage(1024),
};

const srv = http.createServer((req, res) => {
  const html = pages[req.url.split('?')[0]];
  if (!html) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(html);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

// async spawn (NOT spawnSync — it would block this process's event loop and starve the in-process HTTP server)
function grade(srcP, clnP, { env = {}, tag = '', refresh = true } = {}) {
  const out = `/tmp/cliffprobe-st${clnP.replace(/\//g, '-')}${tag}`;
  return new Promise((resolve, reject) => {
    const args = [path.join(__dirname, 'grade-structure.mjs'), '--source', `http://127.0.0.1:${port}${srcP}`, '--clone', `http://127.0.0.1:${port}${clnP}`, '--out', out];
    if (refresh) args.push('--refresh-source');
    const c = spawn(process.execPath, args, { env: { ...process.env, ...env } });
    let err = ''; c.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => c.kill('SIGKILL'), 240000);
    c.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(`grade-structure exited ${code}: ${err.slice(-800)}`));
      resolve(JSON.parse(fs.readFileSync(`${out}/report.json`, 'utf8')));
    });
  });
}

let fail = 0;
const check = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!cond) fail++; };
const mw = (r) => r.midwidth || {};

const a1 = await grade('/innocent', '/cliff1023');
check('A1 1023-unpin dodge: adjacent pair reads clean (dodge confirmed)', mw(a1).cliffRatio != null && mw(a1).cliffRatio < 1.05, `cliffRatio ${mw(a1).cliffRatio}`);
check('A1 1023-unpin dodge: 900/768 samples still catch it → cap 0.35', mw(a1).cliffExcess > 1.3 && [900, 768].includes(mw(a1).cliffWidth) && mw(a1).caps.some((c) => c.startsWith('cliff')) && a1.composite <= 0.35, `cliffExcess ${mw(a1).cliffExcess}@${mw(a1).cliffWidth} composite ${a1.composite} caps ${JSON.stringify(mw(a1).caps)}`);
const a2 = await grade('/innocent', '/cliff800');
check('A2 custom-bp (800) dodge: 768 sample catches it → cap 0.35', mw(a2).cliffExcess > 1.3 && mw(a2).cliffWidth === 768 && a2.composite <= 0.35, `cliffExcess ${mw(a2).cliffExcess}@${mw(a2).cliffWidth} composite ${a2.composite}`);
const b = await grade('/innocent', '/scaled');
check('B scale-transform dodge: NO deterministic cap (documented decision)', mw(b).caps && mw(b).caps.length === 0 && (mw(b).cliffExcess == null || mw(b).cliffExcess <= 1.3) && (mw(b).clippedExcess == null || mw(b).clippedExcess <= 10), `cliffExcess ${mw(b).cliffExcess} clippedExcess ${mw(b).clippedExcess} caps ${JSON.stringify(mw(b).caps)}`);
check('B scale-transform dodge: heroFsVisRatio768 diagnostic flags it', mw(b).scaleShrinkSuspect === true && mw(b).heroFsVisRatio768 < 0.75, `heroFsVisRatio768 ${mw(b).heroFsVisRatio768} scaleShrinkSuspect ${mw(b).scaleShrinkSuspect}`);
const c1 = await grade('/innocent', '/innocent');
check('C1 innocent source self-pair: zero caps, composite ~0.96', mw(c1).caps.length === 0 && c1.composite > 0.9, `composite ${c1.composite} cliffExcess ${mw(c1).cliffExcess} caps ${JSON.stringify(mw(c1).caps)}`);
const c1b = await grade('/innocent', '/innocent', { tag: '-cached', refresh: false });
check('C1b cached-source path: baseline from midwidthSrc cache, still clean', mw(c1b).srcHeights != null && mw(c1b).cliffExcess != null && mw(c1b).caps.length === 0, `srcHeights ${JSON.stringify(mw(c1b).srcHeights)} cliffExcess ${mw(c1b).cliffExcess}`);
const c2 = await grade('/grid768', '/grid1024');
check('C2 honest-reflow: clone\'s own adjacent jump >1.3 (legacy WOULD have capped)', mw(c2).cliffRatio != null && mw(c2).cliffRatio > 1.3, `cliffRatio ${mw(c2).cliffRatio}`);
check('C2 honest-reflow: source-baselined excess ≈1 → NOT capped', mw(c2).cliffExcess != null && mw(c2).cliffExcess <= 1.3 && mw(c2).caps.length === 0 && c2.composite > 0.6, `cliffExcess ${mw(c2).cliffExcess} srcFullGrowth ${mw(c2).srcFullGrowth} composite ${c2.composite}`);
const c3 = await grade('/grid1024', '/grid1024');
check('C3 cliffy SOURCE self-pair: perfect clone of a >1.3-jump source NOT capped', mw(c3).srcCliffRatio != null && mw(c3).srcCliffRatio > 1.3 && mw(c3).caps.length === 0 && c3.composite > 0.6, `srcCliffRatio ${mw(c3).srcCliffRatio} cliffExcess ${mw(c3).cliffExcess} composite ${c3.composite}`);

srv.close();
console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);

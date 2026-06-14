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
 * CLIFF-PROBE FINAL round (2026-06-10, fresh-critic dodges /tmp/critic-dodge-test.mjs → pinned here):
 *   D1 BETWEEN-SAMPLES WINDOW DODGE — blowup confined to a ±8px window around a HASH-DERIVED sample width
 *      (replicated from grade-structure.mjs; window contains NO fixed sample) → the F2 hash sample catches it
 *      → cap 0.35 with cliffWidth ∉ {1200,1025,1024,900,768}.
 *   D2 THRESHOLD-SKATE — +~24% height at <=1024 (under the 1.3 veto): NOT capped, but the F3 graded
 *      sub-threshold cost fires (subThresholdPenalty>0, responsive term reduced) — skating costs something.
 *   D3 ANCHOR-POISONING — spacer shown only @1100-1299 inflates cloneH(1200) so a FULL blowup at <=1024 reads
 *      growth≈1 (judge-blind). F1 guard: growth<0.85 at 1025 → anchor poisoned → re-anchor at min height →
 *      excess>1.3 → cap 0.35 (anchorPoisoned=true).
 *   D3-CTL SAME full blowup WITHOUT the anchor spacer → capped via the NORMAL path (anchorPoisoned=false).
 *   D3b SOURCE-SIDE POISONING SYMMETRY — the anchordodge page graded against ITSELF: the source side re-anchors
 *      its own baseline (srcAnchorPoisoned=true) → faithful clone stays at excess≈1 → zero caps (self-pair clean).
 * D4 round (MOBILE-HEIGHT EXCESS 2026-06-11 — closes the last judge-blind width window, <768px):
 *   D4 MOBILE-ONLY BLOWUP — 8000px spacer under max-width:767px (clone ~3.1x@390, byte-identical >=768; lab
 *      repro /tmp/critic-dodge-test.mjs '/mobiledodge'): every cliff sample reads clean (cliffExcess≈1, the
 *      blindness confirmed) but mobileHExcess>1.3 → veto-cap 0.35 with a mobileH cap string.
 *   D4-CTL HONEST MOBILE STACKER — source grid stacks at ≤480, clone at ≤520: BOTH 1-col at 390 (source's own
 *      growth ~2.4x > 1.3 — non-vacuous control) → excess ≈ 1 → NOT capped, no graded cost.
 *   D4b MOBILE-TALL SOURCE SELF-PAIR — mobiledodge graded against ITSELF: the source legitimately reaches
 *      ~3.1x@390 (> the cliff's 2.5 clamp — pins the mobile clamp at 3.5) → excess ≈ 1 → clean self-pair.
 *   D4-legacy REVERSIBILITY — GRADER_NO_MOBILEH=1 on the D4 dodge: no mobileH fields, no mobileH cap.
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

// ---- D-round (CLIFF-PROBE FINAL) fixtures ----
// F2 width derivation — MUST mirror grade-structure.mjs exactly (drift here = loud test failure, by design).
// Canonicalization strips protocol AND port, so the widths are computable before the random test port is known.
const MW_FIXED = [1200, 1025, 1024, 900, 768];
const mwCanon = (u) => String(u).replace(/^https?:\/\//, '').replace(/:\d+/, '').replace(/\/+$/, '').toLowerCase();
const mwFnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
const hashWidths = (u) => {
  const h = mwFnv(mwCanon(u));
  let wA = 770 + (h % 215), wB = 985 + ((h >>> 8) % 214);
  while (MW_FIXED.includes(wA)) wA++;
  while (MW_FIXED.includes(wB) || wB === wA) wB++;
  return [wA, wB];
};
const [dwA, dwB] = hashWidths('http://127.0.0.1/flatsrc'); // source for all D-cases
// dodge window center: a hash width whose ±8 window contains NO fixed sample (so the catch is provably F2's)
const dPick = [dwA, dwB].find((w) => MW_FIXED.every((f) => Math.abs(f - w) > 8)) ?? dwA;
const flatBody = `<div style="height:3600px"><p style="color:#222;font-size:16px;margin:24px">tall fixed content body for a stable base height</p></div>`;

const pages = {
  '/innocent': base('', innocentBody),
  '/cliff1023': base('#pad{display:none} @media (max-width:1023px){#pad{display:block;height:8000px}}', cliffBody),
  '/cliff800': base('#pad{display:none} @media (max-width:800px){#pad{display:block;height:8000px}}', cliffBody),
  '/scaled': scaledPage,
  '/grid768': gridPage(768),
  '/grid1024': gridPage(1024),
  '/flatsrc': base('', `<div id="pad"></div>${flatBody}`),
  '/winddodge': base(`#pad{display:none} @media (min-width:${dPick - 8}px) and (max-width:${dPick + 8}px){#pad{display:block;height:6000px}}`, `<div id="pad"></div>${flatBody}`),
  '/partialunpin': base('#pad{display:none} @media (max-width:1024px){#pad{display:block;height:900px}}', `<div id="pad"></div>${flatBody}`),
  '/anchordodge': base('#pad,#anchor{display:none} @media (max-width:1024px){#pad{display:block;height:4000px}} @media (min-width:1100px) and (max-width:1299px){#anchor{display:block;height:4000px}}', `<div id="pad"></div><div id="anchor"></div>${flatBody}`),
  '/unpinctl': base('#pad{display:none} @media (max-width:1024px){#pad{display:block;height:4000px}}', `<div id="pad"></div>${flatBody}`),
  // D4 fixtures: mobile-only blowup (spacer strictly under the cliff probe's narrowest 768 sample) + honest
  // mobile stackers (the SAME 9-card grid, stacking at ≤480 vs ≤520 — both 1-col at 390, flat at every cliff width)
  '/mobiledodge': base('#pad{display:none} @media (max-width:767px){#pad{display:block;height:8000px}}', `<div id="pad"></div>${flatBody}`),
  '/mstack480': gridPage(480),
  '/mstack520': gridPage(520),
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
const isHashW = (w) => w != null && !MW_FIXED.includes(w); // D1: the catch must come from an F2 hash sample

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

// ---- D-round (CLIFF-PROBE FINAL 2026-06-10) ----
console.log(`   [D] hash widths for 127.0.0.1/flatsrc: wA=${dwA} wB=${dwB} → dodge window ${dPick - 8}-${dPick + 8}`);
const d1 = await grade('/flatsrc', '/winddodge');
check('D1 between-samples window dodge: hash sample catches it → cap 0.35', mw(d1).cliffExcess > 1.3 && isHashW(mw(d1).cliffWidth) && mw(d1).caps.some((c) => c.startsWith('cliff')) && d1.composite <= 0.35, `cliffExcess ${mw(d1).cliffExcess}@${mw(d1).cliffWidth} composite ${d1.composite} caps ${JSON.stringify(mw(d1).caps)}`);
const d2 = await grade('/flatsrc', '/partialunpin');
check('D2 threshold-skate: NOT capped but graded cost fires', mw(d2).caps.length === 0 && mw(d2).cliffExcess > 1.1 && mw(d2).cliffExcess <= 1.3 && mw(d2).subThresholdPenalty > 0.1 && d2.composite > 0.35, `cliffExcess ${mw(d2).cliffExcess} subThresholdPenalty ${mw(d2).subThresholdPenalty} composite ${d2.composite}`);
check('D2 threshold-skate: responsive term reduced (skating costs something)', d2.responsive != null && d2.responsive <= 0.9, `responsive ${d2.responsive} (detail ${JSON.stringify(d2.responsiveDetail)})`);
const d3 = await grade('/flatsrc', '/anchordodge');
check('D3 anchor-poisoning: guard re-anchors → blowup caught → cap 0.35', mw(d3).anchorPoisoned === true && mw(d3).cliffExcess > 1.3 && mw(d3).caps.some((c) => c.startsWith('cliff')) && d3.composite <= 0.35, `anchorPoisoned ${mw(d3).anchorPoisoned} anchorH ${mw(d3).anchorH} cliffExcess ${mw(d3).cliffExcess}@${mw(d3).cliffWidth} composite ${d3.composite}`);
const dc = await grade('/flatsrc', '/unpinctl');
check('D3-CTL same blowup, no spacer: capped via the NORMAL path (guard inert)', mw(dc).anchorPoisoned === false && mw(dc).cliffExcess > 1.3 && dc.composite <= 0.35, `anchorPoisoned ${mw(dc).anchorPoisoned} cliffExcess ${mw(dc).cliffExcess} composite ${dc.composite}`);
const d3b = await grade('/anchordodge', '/anchordodge');
check('D3b source-side poisoning symmetry: self-pair stays CLEAN', mw(d3b).srcAnchorPoisoned === true && mw(d3b).anchorPoisoned === true && mw(d3b).caps.length === 0 && (mw(d3b).cliffExcess == null || mw(d3b).cliffExcess <= 1.1) && d3b.composite > 0.8, `srcAnchorPoisoned ${mw(d3b).srcAnchorPoisoned} cliffExcess ${mw(d3b).cliffExcess} composite ${d3b.composite} caps ${JSON.stringify(mw(d3b).caps)}`);

// ---- D4 round (MOBILE-HEIGHT EXCESS 2026-06-11) ----
const d4 = await grade('/flatsrc', '/mobiledodge');
check('D4 mobile-only blowup: every cliff sample reads clean (blindness confirmed)', mw(d4).cliffExcess != null && mw(d4).cliffExcess <= 1.1 && !mw(d4).caps.some((c) => c.startsWith('cliff')), `cliffExcess ${mw(d4).cliffExcess} heights ${JSON.stringify(mw(d4).heights)}`);
check('D4 mobile-height excess catches it → cap 0.35', mw(d4).mobileHExcess > 1.3 && mw(d4).caps.some((c) => c.startsWith('mobileH')) && d4.composite <= 0.35, `mobileHExcess ${mw(d4).mobileHExcess} (C390 ${mw(d4).mobileGrowthClone} / S_m ${mw(d4).srcMobileFull}) h390 ${mw(d4).h390} srcH390 ${mw(d4).srcH390} composite ${d4.composite} caps ${JSON.stringify(mw(d4).caps)}`);
const d4c = await grade('/mstack480', '/mstack520');
check('D4-CTL honest mobile stacker: source grows >1.3 at 390 (non-vacuous control)', mw(d4c).mobileGrowthSrc != null && mw(d4c).mobileGrowthSrc > 1.3, `mobileGrowthSrc ${mw(d4c).mobileGrowthSrc}`);
check('D4-CTL honest mobile stacker: clone matches → NOT capped, no graded cost', mw(d4c).mobileHExcess != null && mw(d4c).mobileHExcess <= 1.1 && mw(d4c).caps.length === 0 && mw(d4c).mobileSubThresholdPenalty === undefined && d4c.composite > 0.6, `mobileHExcess ${mw(d4c).mobileHExcess} caps ${JSON.stringify(mw(d4c).caps)} composite ${d4c.composite}`);
const d4b = await grade('/mobiledodge', '/mobiledodge');
check('D4b mobile-tall source self-pair: ~3.1x@390 legit (>2.5 — pins the 3.5 clamp) → CLEAN', mw(d4b).mobileGrowthSrc > 2.5 && mw(d4b).mobileHExcess != null && mw(d4b).mobileHExcess <= 1.1 && mw(d4b).caps.length === 0 && d4b.composite > 0.8, `mobileGrowthSrc ${mw(d4b).mobileGrowthSrc} srcMobileFull ${mw(d4b).srcMobileFull} mobileHExcess ${mw(d4b).mobileHExcess} composite ${d4b.composite} caps ${JSON.stringify(mw(d4b).caps)}`);
const d4l = await grade('/flatsrc', '/mobiledodge', { env: { GRADER_NO_MOBILEH: '1' }, tag: '-legacy' });
check('D4-legacy reversibility: GRADER_NO_MOBILEH=1 → no mobileH fields, no mobileH cap', mw(d4l).mobileHExcess === undefined && mw(d4l).h390 === undefined && !mw(d4l).caps.some((c) => c.startsWith('mobileH')) && d4l.composite > 0.35, `mobileHExcess ${mw(d4l).mobileHExcess} composite ${d4l.composite} caps ${JSON.stringify(mw(d4l).caps)}`);

srv.close();
console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);

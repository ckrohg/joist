#!/usr/bin/env node
/**
 * @purpose DYNAMIC layer of the canonical grader (CANONICAL_GRADER.md). The static grader is
 * blind to motion — this judges everything that MOVES or reacts: scroll-triggered reveals /
 * parallax / sticky, looping motion (animated gradients incl. WebGL waves, marquees, auto-
 * carousels, count-up tickers), and hover/focus states. Produces dimension scores + a
 * deterministic motion-presence GATE + committee MONTAGES (so vision reviewers judge dynamics).
 *
 * Usage: node dynamic-grade.mjs --source <url> --clone <url> [--out dir]
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pmModule from 'pixelmatch';
const pixelmatch = pmModule.default || pmModule;
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const source = arg('source'), clone = arg('clone'), out = arg('out', './dynamic-out');
if (!has('validate') && (!source || !clone)) { console.error('need --source --clone (or --validate)'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const W = 1440, VH = 900;
const diffRatio = (a, b) => { const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height); const d = new PNG({ width: w, height: h }); const m = pixelmatch(crop(a, w, h).data, crop(b, w, h).data, d.data, w, h, { threshold: 0.1 }); return m / (w * h); };
function crop(s, w, h) { const o = new PNG({ width: w, height: h }); for (let y = 0; y < h; y++) s.data.copy(o.data, (y * w) * 4, (y * s.width) * 4, (y * s.width) * 4 + w * 4); return o; }
function strip(imgs, p) { const w = Math.max(...imgs.map((i) => i.width)), gap = 6; const h = imgs.reduce((a, i) => a + i.height + gap, 0); const o = new PNG({ width: w, height: h }); o.data.fill(230); let y = 0; for (const im of imgs) { for (let r = 0; r < im.height; r++) for (let x = 0; x < im.width; x++) { const si = (r * im.width + x) * 4, di = ((y + r) * w + x) * 4; o.data[di] = im.data[si]; o.data[di + 1] = im.data[si + 1]; o.data[di + 2] = im.data[si + 2]; o.data[di + 3] = 255; } y += im.height + gap; } fs.writeFileSync(p, PNG.sync.write(o)); return p; }
function pair(a, b, p) { const g = 12, h = Math.max(a.height, b.height); const o = new PNG({ width: a.width + b.width + g, height: h }); o.data.fill(240); const blit = (s, ox) => { for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) { const si = (y * s.width + x) * 4, di = (y * o.width + x + ox) * 4; o.data[di] = s.data[si]; o.data[di + 1] = s.data[si + 1]; o.data[di + 2] = s.data[si + 2]; o.data[di + 3] = 255; } }; blit(a, 0); blit(b, a.width + g); fs.writeFileSync(p, PNG.sync.write(o)); return p; }

async function captureDynamic(ctx, url) {
  const p = await ctx.newPage(); await p.setViewportSize({ width: W, height: VH });
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  try { await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(url, { waitUntil: 'load', timeout: 30000 }); } catch {} }
  await p.waitForTimeout(1500);
  // deterministic motion descriptors (whole document, position-independent)
  const motion = await p.evaluate(() => { let anims = 0; try { anims = document.getAnimations().length; } catch {} let declared = 0, infinite = 0; for (const el of document.querySelectorAll('*')) { const cs = getComputedStyle(el); if (cs.animationName && cs.animationName !== 'none') { declared++; if (cs.animationIterationCount === 'infinite') infinite++; } } return { anims, declared, infinite }; });
  // SCROLL-STATES + TIME-LAPSE FOLDED IN: at EACH depth grab two frames ~360ms apart and diff them,
  // so looping motion ANYWHERE on the page (footer marquee, mid-page carousel) is sampled, not just
  // the hero. motionMag = MAX inter-frame diff across all depths. scrollShots = the first frame/depth.
  const H = await p.evaluate(() => document.documentElement.scrollHeight); const depths = [0, 0.25, 0.5, 0.75].map((f) => Math.round(f * Math.max(0, H - VH)));
  const scrollShots = []; let motionMag = 0;
  for (const y of depths) { await p.evaluate((yy) => window.scrollTo(0, yy), y); await p.waitForTimeout(500); const a = PNG.sync.read(await p.screenshot({ clip: { x: 0, y: 0, width: W, height: VH } })); await p.waitForTimeout(360); const b = PNG.sync.read(await p.screenshot({ clip: { x: 0, y: 0, width: W, height: VH } })); motionMag = Math.max(motionMag, diffRatio(a, b)); scrollShots.push(a); }
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
  // 4) HOVER states — top interactive elements
  const hovers = []; const targets = await p.evaluate(() => [...document.querySelectorAll('a,button')].filter((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.top < 800 && r.width > 30 && r.height > 16; }).slice(0, 4).map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }));
  for (const t of targets) { try { const clip = { x: Math.max(0, t.x - 6), y: Math.max(0, t.y - 6), width: Math.min(W - t.x, t.w + 12), height: t.h + 12 }; const before = PNG.sync.read(await p.screenshot({ clip })); await p.mouse.move(t.x + t.w / 2, t.y + t.h / 2); await p.waitForTimeout(450); const after = PNG.sync.read(await p.screenshot({ clip })); hovers.push({ before, after, delta: diffRatio(before, after) }); await p.mouse.move(2, 2); await p.waitForTimeout(150); } catch {} }
  await p.close();
  return { motionMag, motion, scrollShots, hovers, pageH: H };
}

function gradeDynamic(s, c, out) {
  const D = {}; const fails = []; const defects = [];
  // MOTION-PRESENCE GATE: source moves (looping motion or declared animations) but clone is dead
  const srcMoves = s.motionMag > 0.002 || s.motion.declared >= 2 || s.motion.infinite >= 1;
  const clnMoves = c.motionMag > 0.002 || c.motion.declared >= 2 || c.motion.infinite >= 1;
  D.motion = +Math.min(1, srcMoves ? (clnMoves ? Math.min(1, (c.motionMag + 0.001) / (s.motionMag + 0.001)) : 0) : 1).toFixed(3);
  if (srcMoves && !clnMoves) { fails.push('motion-missing'); defects.push(`source has motion (timelapse Δ${s.motionMag.toFixed(4)}, ${s.motion.declared} CSS-anim, ${s.motion.infinite} looping, ${s.motion.anims} live) but clone is static (Δ${c.motionMag.toFixed(4)}, ${c.motion.declared} anim)`); }
  // SCROLL-STATE fidelity (per-depth perceptual, MIN)
  const scrollScores = []; const scrollPairs = [];
  for (let i = 0; i < Math.min(s.scrollShots.length, c.scrollShots.length); i++) { const r = 1 - diffRatio(s.scrollShots[i], c.scrollShots[i]); scrollScores.push(r); scrollPairs.push(pair(s.scrollShots[i], c.scrollShots[i], path.join(out, `scroll-${i}.png`))); }
  D.scroll = scrollScores.length ? +Math.min(...scrollScores).toFixed(3) : 1;
  if (D.scroll < 0.4) { fails.push('scroll-state'); defects.push(`scroll-state mismatch (worst depth diff ${(1 - D.scroll).toFixed(2)}) — reveals/parallax/sticky differ`); }
  // HOVER fidelity: does the clone react to hover where the source does?
  const srcHoverReacts = s.hovers.filter((h) => h.delta > 0.02).length; const clnHoverReacts = c.hovers.filter((h) => h.delta > 0.02).length;
  D.hover = +Math.min(1, srcHoverReacts ? (clnHoverReacts / srcHoverReacts) : 1).toFixed(3);
  if (srcHoverReacts >= 2 && clnHoverReacts < srcHoverReacts * 0.5) { fails.push('hover-missing'); defects.push(`source has ${srcHoverReacts} hover-reacting elements, clone ${clnHoverReacts}`); }
  // montages for the committee — hover before/after, source row over clone row
  const hoverMontages = []; for (let i = 0; i < Math.min(s.hovers.length, c.hovers.length); i++) { const srcBA = pair(s.hovers[i].before, s.hovers[i].after, path.join(out, `_hs${i}.png`)); const clnBA = pair(c.hovers[i].before, c.hovers[i].after, path.join(out, `_hc${i}.png`)); hoverMontages.push(strip([PNG.sync.read(fs.readFileSync(srcBA)), PNG.sync.read(fs.readFileSync(clnBA))], path.join(out, `hover-${i}.png`))); }

  const dynOverall = Math.round(Math.min(D.motion, D.scroll, D.hover) * 100);
  const report = { overall_pct: dynOverall, dims: D, hard_fails: fails, defects, source_motion: s.motion, source_motionMag: +s.motionMag.toFixed(4), clone_motion: c.motion, clone_motionMag: +c.motionMag.toFixed(4), srcHoverReacts, clnHoverReacts, srcMoves, clnMoves, montages: { scroll: scrollPairs, hover: hoverMontages }, note: 'DYNAMIC layer — feed scroll-*.png to the committee for element-by-element motion/scroll review' };
  fs.writeFileSync(path.join(out, 'dynamic-report.json'), JSON.stringify(report, null, 2));
  return report;
}

// ---------- validation basket: deliberately MOVING vs deliberately DEAD ----------
// Mirrors grader-v2's --validate philosophy: a grader you can't self-test is a grader you can't trust.
const MOVER = `<!doctype html><meta charset=utf8><style>
*{margin:0;box-sizing:border-box;font-family:Arial,sans-serif}
@keyframes slide{0%{background-position:0 0}100%{background-position:200% 0}}
@keyframes march{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
@keyframes spin{to{transform:rotate(360deg)}}
body{width:1440px}
.hero{height:520px;background:linear-gradient(90deg,#635bff,#00d4ff,#635bff);background-size:200% 100%;animation:slide 1s linear infinite;color:#fff;padding:80px}
.hero h1{font-size:56px}
.spacer{height:600px;padding:40px}
.bar{overflow:hidden;white-space:nowrap;height:80px;background:#0a2540}
.bar .track{display:inline-block;animation:march 1.2s linear infinite;color:#fff;font-size:40px;padding-top:18px}
.dot{width:60px;height:60px;border-radius:50%;border:8px solid #635bff;border-top-color:transparent;animation:spin .8s linear infinite;margin:40px 80px}
a.btn{display:inline-block;margin-top:30px;padding:14px 28px;background:#fff;color:#635bff;border-radius:24px;text-decoration:none;transition:background .2s}
a.btn:hover{background:#ffd400}
</style><body>
<div class="hero"><h1>Motion everywhere</h1><a class="btn" href="#">Get started</a></div>
<div class="spacer"><div class="dot"></div><p>Mid-page content sits here between the hero and the footer marquee.</p></div>
<div class="bar"><span class="track">Scrolling ticker • breaking news • scrolling ticker • breaking news •</span></div>
</body>`;
const stripMotion = (h) => h.replace(/animation:[^;]+;/g, 'animation:none;').replace('a.btn:hover{background:#ffd400}', 'a.btn:hover{}'); // motion + hover stripped
// HOVER fixtures — ≥2 buttons whose :hover changes paint (arms the hover-missing gate, which needs srcHoverReacts≥2)
const HOVER = `<!doctype html><meta charset=utf8><style>*{margin:0;font-family:Arial,sans-serif}body{width:1440px;padding:80px}a.b{display:inline-block;margin:24px;padding:22px 44px;background:#635bff;color:#fff;font-size:26px;text-decoration:none;transition:background .12s}a.b:hover{background:#ff0066}</style><body><a class="b" href="#">One</a><a class="b" href="#">Two</a><a class="b" href="#">Three</a></body>`;
const NOHOVER = HOVER.replace('a.b:hover{background:#ff0066}', 'a.b:hover{}'); // same buttons, hover does nothing
// SCROLL fixtures — tall pages with distinct per-depth content; TALL_B differs at every depth → scroll-state fires
const TALL_A = `<!doctype html><meta charset=utf8><style>*{margin:0;font-family:Arial}body{width:1440px}.s{height:760px;font-size:64px;color:#fff;padding:64px;box-sizing:border-box}</style><body><div class="s" style="background:#e11">Red section</div><div class="s" style="background:#1a1">Green section</div><div class="s" style="background:#11e">Blue section</div><div class="s" style="background:#222">Dark section</div></body>`;
const TALL_B = `<!doctype html><meta charset=utf8><style>*{margin:0;font-family:Arial}body{width:1440px}.s{height:760px;font-size:64px;color:#000;padding:64px;box-sizing:border-box}</style><body><div class="s" style="background:#fff">White section</div><div class="s" style="background:#fa0">Orange section</div><div class="s" style="background:#0ff">Cyan section</div><div class="s" style="background:#fd0">Yellow section</div></body>`;
// each case isolates ONE gate; negative controls (same-vs-same) prove no false-fire
const DYN_EXPECT = { 'motion-good': 'PASS', 'motion-dead': 'FAIL', 'motion-static': 'PASS', 'hover-good': 'PASS', 'hover-missing': 'FAIL', 'scroll-good': 'PASS', 'scroll-broken': 'FAIL' };

(async () => {
  const browser = await chromium.launch();
  if (has('validate')) {
    const dir = './dynamic-validate'; fs.mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext({ deviceScaleFactor: 1 });
    const write = (n, h) => { const f = path.join(dir, n); fs.writeFileSync(f, h); return 'file://' + path.resolve(f); };
    const cap = async (n, h) => captureDynamic(ctx, write(n, h));
    const mover = await cap('mover.html', MOVER), dead = await cap('dead.html', stripMotion(MOVER));
    const hover = await cap('hover.html', HOVER), nohover = await cap('nohover.html', NOHOVER);
    const tallA = await cap('tallA.html', TALL_A), tallB = await cap('tallB.html', TALL_B);
    const cases = { 'motion-good': [mover, mover], 'motion-dead': [mover, dead], 'motion-static': [dead, dead], 'hover-good': [hover, hover], 'hover-missing': [hover, nohover], 'scroll-good': [tallA, tallA], 'scroll-broken': [tallA, tallB] };
    console.log('DYNAMIC GRADER VALIDATION (motion/scroll/hover gates must match the known label):\n');
    let allOk = true;
    for (const [name, [s, c]] of Object.entries(cases)) { const o = path.join(dir, 'out-' + name); fs.mkdirSync(o, { recursive: true }); const r = gradeDynamic(s, c, o); const verdict = (r.hard_fails.length > 0 || r.overall_pct < 60) ? 'FAIL' : 'PASS'; const ok = verdict === DYN_EXPECT[name]; allOk = allOk && ok; console.log(`  ${ok ? '✓' : '✗ WRONG'}  ${name.padEnd(14)} → ${verdict} (${r.overall_pct}%) expected ${DYN_EXPECT[name]}  | dims ${JSON.stringify(r.dims)} hover s${r.srcHoverReacts}/c${r.clnHoverReacts} ${r.hard_fails.length ? '| fails ' + r.hard_fails.join(',') : ''}`); }
    console.log(`\n${allOk ? '✅ DYNAMIC GRADER IS TRUSTWORTHY — motion/scroll/hover gates classify all known cases correctly' : '❌ NOT TRUSTWORTHY — fix the ✗ cases above'}`);
    await browser.close(); process.exit(allOk ? 0 : 1);
  }
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const s = await captureDynamic(ctx, source), c = await captureDynamic(ctx, clone);
  await browser.close();
  const r = gradeDynamic(s, c, out);
  console.log(JSON.stringify({ dynamic_overall: r.overall_pct, dims: r.dims, hard_fails: r.hard_fails, defects: r.defects, src_moves: r.srcMoves, cln_moves: r.clnMoves, src_motionMag: r.source_motionMag, cln_motionMag: r.clone_motionMag }, null, 2));
})();

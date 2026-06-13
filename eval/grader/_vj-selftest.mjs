#!/usr/bin/env node
/**
 * @purpose _vj-selftest.mjs — STANDING identical-pair selftest for vision-judge (V1b mustfix #5).
 * Composes a side-by-side tile whose LEFT and RIGHT are the SAME pixels (one capture, blitted twice) and
 * judges it. A pixel-identical src|src pair MUST score >=95 with NO sev>=2 defects — the measured
 * CLONE-label bias is ~-3pts, so this bar guards judge/rubric drift (a judge that starts inventing defects
 * on identical content, or sev-inflating, fails here before it poisons calibration).
 * Doubles as the session-isolation leak check (V1b mustfix #2): runs the judge call in a FRESH out dir and
 * asserts no .claude/.tenet/.mcp.json scaffold appears there.
 *
 * Usage: node _vj-selftest.mjs [--out dir] [--model sonnet] [--source <url>] [--runs 1] [--min 95]
 *   Default source is a hermetic local HTML fixture (file://, no network) with realistic page furniture
 *   (nav+logo, hero, styled CTAs, card grid, inline code, footer). --source overrides with a live page.
 * Exit 0 = PASS, 1 = FAIL, 2 = infra error. Prints one JSON result object on stdout.
 */
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { captureFull, composeTile, claudeOnce, RUBRIC } from './vision-judge.mjs';
import { crop } from './grade-vision-tiles.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const OUT = arg('out', `/tmp/vj-selftest-${Date.now()}`);
const MODEL = arg('model', 'sonnet');
const SRC = arg('source', null);
const RUNS = Math.max(1, +arg('runs', 1) || 1);
const MIN_SCORE = +arg('min', 95);
const WIDTH = 1440, TILE_H = 900;

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box;font-family:-apple-system,Helvetica,Arial,sans-serif}
  body{background:#0b0f19;color:#e6e9f0}
  nav{display:flex;align-items:center;gap:28px;padding:18px 56px;border-bottom:1px solid #232a3d}
  .logo{font-weight:800;font-size:20px;color:#9ae600;letter-spacing:.5px}
  nav a{color:#aab3c5;text-decoration:none;font-size:14px}
  .hero{padding:90px 56px 70px;max-width:980px}
  h1{font-size:54px;line-height:1.08;letter-spacing:-1px}
  .hero p{margin-top:18px;font-size:18px;color:#aab3c5;max-width:640px}
  .ctas{margin-top:30px;display:flex;gap:14px}
  .btn{padding:12px 26px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none}
  .btn.primary{background:#9ae600;color:#0b0f19}
  .btn.ghost{border:1px solid #3a4358;color:#e6e9f0}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;padding:30px 56px 80px}
  .card{background:#141a2a;border:1px solid #232a3d;border-radius:12px;padding:26px}
  .card h3{font-size:18px;margin-bottom:10px}
  .card p{font-size:14px;color:#aab3c5;line-height:1.5}
  code{background:#1d2435;color:#ffb86c;padding:2px 7px;border-radius:5px;font-family:Menlo,monospace;font-size:13px}
  footer{padding:26px 56px;border-top:1px solid #232a3d;color:#6b7488;font-size:13px}
</style></head><body>
  <nav><span class="logo">JOIST</span><a href="#">Product</a><a href="#">Docs</a><a href="#">Pricing</a><a href="#">Blog</a></nav>
  <div class="hero"><h1>Build Elementor sites with an agent that respects round-trips</h1>
    <p>Joist authors native, editable widget trees — not rastered screenshots. Run <code>joist clone</code> and keep every heading selectable.</p>
    <div class="ctas"><a class="btn primary" href="#">Get started</a><a class="btn ghost" href="#">View demo</a></div></div>
  <div class="grid">
    <div class="card"><h3>Native widgets</h3><p>Headings, buttons and images map to real Elementor controls, so editors can change anything later.</p></div>
    <div class="card"><h3>Vision graded</h3><p>Every clone is sliced into side-by-side tiles and scored by a strict pixel-fidelity judge.</p></div>
    <div class="card"><h3>Veto combined</h3><p>Deterministic checks cap the vision score — a full-page raster can never win the headline.</p></div>
  </div>
  <footer>© 2026 Joist — selftest fixture (hermetic, no network)</footer>
</body></html>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let url = SRC;
  if (!url) {
    const fx = path.join(OUT, 'fixture.html');
    fs.writeFileSync(fx, FIXTURE);
    url = 'file://' + fx;
  }

  console.error(`[selftest] capturing ${url} @${WIDTH}px ...`);
  const shot = await captureFull(url, WIDTH);
  const h = Math.min(TILE_H, shot.height);
  const band = crop(shot, 0, 0, shot.width, h);
  const band2 = crop(shot, 0, 0, shot.width, h); // same pixels, fresh buffer
  const comp = composeTile(band, band2, WIDTH, 0);
  const tilePath = path.join(OUT, 'identical-pair.png');
  fs.writeFileSync(tilePath, PNG.sync.write(comp));

  const before = new Set(fs.readdirSync(OUT));
  const runs = [];
  let cost = 0;
  for (let r = 0; r < RUNS; r++) {
    let res = await claudeOnce(RUBRIC(tilePath, WIDTH, 0, h), 240000, { model: MODEL, cwd: OUT });
    cost += res.cost || 0;
    if (!res.ok) { // one strict retry, same as the judge proper
      res = await claudeOnce(RUBRIC(tilePath, WIDTH, 0, h) + '\nYour previous output was not valid JSON. Output ONLY the raw JSON object — nothing else.', 240000, { model: MODEL, cwd: OUT });
      cost += res.cost || 0;
    }
    if (!res.ok) { console.error(`[selftest] judge call failed: ${res.error}`); console.log(JSON.stringify({ pass: false, infra: res.error })); process.exit(2); }
    runs.push(res.verdict);
    console.error(`[selftest] run ${r + 1}/${RUNS}: score=${res.verdict.score} defects=${res.verdict.defects.length}`);
  }
  const sorted = runs.map((v) => v.score).sort((a, b) => a - b);
  const score = sorted[Math.floor((sorted.length - 1) / 2)];
  const verdict = runs.find((v) => v.score === score) || runs[0];
  const sev2plus = runs.flatMap((v) => v.defects).filter((d) => d.severity >= 2);

  // isolation leak check (mustfix #2): the nested session must leave NO scaffold in the fresh out dir
  const after = fs.readdirSync(OUT).filter((f) => !before.has(f));
  const scaffoldLeak = after.filter((f) => ['.claude', '.tenet', '.mcp.json', '.claude.json'].includes(f));

  const pass = score >= MIN_SCORE && sev2plus.length === 0 && scaffoldLeak.length === 0;
  console.log(JSON.stringify({
    pass, score, minScore: MIN_SCORE, runs: sorted, sev2plusDefects: sev2plus, defectsMedianRun: verdict.defects,
    scaffoldLeak, newFilesInOut: after, costUsd: +cost.toFixed(3), tile: tilePath, source: url, model: MODEL,
  }, null, 2));
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('SELFTEST INFRA FAIL:', e && e.message || e); console.log(JSON.stringify({ pass: false, infra: String(e && e.message || e) })); process.exit(2); });

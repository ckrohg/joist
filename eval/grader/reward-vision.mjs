#!/usr/bin/env node
/**
 * @purpose reward-vision.mjs — LEVER A, STAGE 0: the cheap LLM-judge reward. A callable, programmatic version of the
 * blind vision panel that proved trustworthy where block-SSIM misranked (see knowledge/LEVER_A_REWARD_SCOPE.md +
 * memory bestofN_reward_is_bottleneck). judgeRender(source, render) → 0-100 visual-fidelity score via `claude -p`
 * (default model: haiku, cheap), reusing region-judge's proven invocation. This is the reward best-of-N / RL selects on.
 *
 * reward = 0.6*visual/100 + 0.4*editability   (editability = native-widget coverage when a --tree is supplied; the
 * anti-raster term from the flywheel objective). Visual-only when no tree. A panel of N calls (default 1; >1 averages,
 * for stability/validation). This is the TEACHER wrapper; Stage 2 distills it into a local features model.
 *
 * CLI:
 *   node reward-vision.mjs --source <srcPng> --render <candPng> [--tree tree.json] [--model haiku] [--panel 1] [--json]
 *   node reward-vision.mjs --source <srcPng> --candidates a.png,b.png,...  [--panel 1]     # score+rank a pool (best-of-N)
 * Env: same `claude` CLI as region-judge (no MCP). Renders NOTHING; reads PNGs only.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

const RUBRIC = (srcAbs, candAbs) => `You are a STRICT visual-fidelity judge for a website-cloning system.
Read these two images with the Read tool:
  TARGET   (the original we are reproducing): ${srcAbs}
  CANDIDATE (a reconstruction to score):      ${candAbs}

Score 0-100 how faithfully the CANDIDATE reproduces the TARGET. Weigh:
- Completeness: are all elements present (logo/wordmark, full nav, any badge/eyebrow, headline, sub-text, every CTA/button)?
- Correctness: is text correct and correctly wrapped? is the nav a single clean horizontal row (not wrapped/stacked/mis-colored)?
- Broken-artifact penalties (heavy): broken/wrapped/orange nav; missing or wrong logo; clipped/duplicated/garbled text;
  an INVISIBLE button (white-on-white or same-as-bg); an element at the wrong size (a small badge rendered as a full-width bar).
- Layout / typography / color / spacing match.
Anchors: pixel-perfect = 100; faithful with minor flaws = 65-85; recognizable but clearly broken (e.g. broken nav + missing
logo + clipped headline) = 15-40; unrecognizable/blank = 0. Be discriminating; do not bunch scores near the middle.
Do NOT speculate about how the candidate was produced. Judge only what you see.

Output ONLY this JSON (no prose): {"score": <integer 0-100>, "notes": "<one short line>"}`;

function extractJson(s) { if (!s) return null; const m = String(s).match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } }

// one `claude -p` scoring call — flags byte-aligned with region-judge.inspectOnce.
function scoreOnce(srcAbs, candAbs, { model = 'haiku', timeoutMs = 180000 } = {}) {
  const hardMs = timeoutMs + 30000;
  return new Promise((resolve) => {
    let child = null;
    const hard = setTimeout(() => { try { if (child) child.kill('SIGKILL'); } catch {} resolve({ ok: false, error: 'hard-timeout' }); }, hardMs);
    hard.unref();
    child = execFile('claude',
      ['-p', RUBRIC(srcAbs, candAbs), '--model', model, '--output-format', 'json', '--allowedTools', 'Read',
        '--max-budget-usd', '0.20', '--strict-mcp-config', '--setting-sources', ''],
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, cwd: '/tmp' },
      (err, stdout) => {
        clearTimeout(hard);
        if (err && !stdout) return resolve({ ok: false, error: String(err && err.message || err) });
        let outer = null; try { outer = JSON.parse(stdout); } catch {}
        if (!outer) return resolve({ ok: false, error: 'outer JSON parse failed' });
        const cost = +outer.total_cost_usd || 0;
        const obj = extractJson(outer.result);
        if (!obj || typeof obj.score !== 'number') return resolve({ ok: false, error: 'score JSON invalid', cost, raw: String(outer.result || '').slice(0, 300) });
        resolve({ ok: true, score: Math.max(0, Math.min(100, obj.score)), notes: obj.notes || '', cost });
      });
    child.on('error', () => { clearTimeout(hard); resolve({ ok: false, error: 'spawn failed' }); });
  });
}

// native-widget editability coverage from a transpiled/built Elementor tree (anti-raster term).
function editability(treePath, target = 15) {
  try { const t = JSON.parse(fs.readFileSync(treePath, 'utf8')); const n = Array.isArray(t) ? t : [t]; let w = 0;
    (function c(a) { a.forEach((x) => { if (x.elType === 'widget') w++; if (x.elements) c(x.elements); }); })(n);
    return { widgets: w, edit: Math.min(1, w / target) };
  } catch { return { widgets: null, edit: null }; }
}

// MAIN reward: judgeRender → {visual (0-100), editability, reward (0-1), cost}. panel>1 averages visual.
export async function judgeRender({ sourcePng, renderPng, tree = null, model = 'haiku', panel = 1, editTarget = 15 }) {
  const srcAbs = path.resolve(sourcePng), candAbs = path.resolve(renderPng);
  const runs = [];
  for (let i = 0; i < panel; i++) runs.push(await scoreOnce(srcAbs, candAbs, { model }));
  const ok = runs.filter((r) => r.ok);
  const cost = runs.reduce((s, r) => s + (r.cost || 0), 0);
  if (!ok.length) return { ok: false, error: runs[0]?.error || 'all calls failed', cost, visual: null, reward: null };
  const visual = +(ok.reduce((s, r) => s + r.score, 0) / ok.length).toFixed(1);
  const ed = tree ? editability(tree, editTarget) : { widgets: null, edit: null };
  const reward = ed.edit == null ? +(visual / 100).toFixed(4) : +(0.6 * (visual / 100) + 0.4 * ed.edit).toFixed(4);
  return { ok: true, visual, scores: ok.map((r) => r.score), editability: ed.edit, widgets: ed.widgets, reward, cost: +cost.toFixed(4), notes: ok[0].notes };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace('file://', ''));
if (IS_MAIN) (async () => {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
  const has = (k) => process.argv.includes('--' + k);
  const SRC = arg('source'); const model = arg('model', 'haiku'); const panel = +arg('panel', 1);
  if (!SRC) { console.error('usage: reward-vision.mjs --source <png> (--render <png> [--tree t.json] | --candidates a.png,b.png,...) [--model haiku] [--panel 1] [--json]'); process.exit(2); }
  if (arg('candidates')) {
    const cands = arg('candidates').split(',').map((s) => s.trim()).filter(Boolean);
    const rows = [];
    for (const c of cands) { const r = await judgeRender({ sourcePng: SRC, renderPng: c, model, panel }); rows.push({ cand: c, ...r }); console.error(`  ${path.basename(c)}: visual=${r.visual} (${r.scores?.join('/')}) cost=$${r.cost}`); }
    rows.sort((a, b) => (b.visual ?? -1) - (a.visual ?? -1));
    console.log(JSON.stringify({ model, panel, ranked: rows.map((r) => ({ cand: path.basename(r.cand), visual: r.visual, reward: r.reward, notes: r.notes })), totalCost: +rows.reduce((s, r) => s + (r.cost || 0), 0).toFixed(4) }, null, 2));
    return;
  }
  const r = await judgeRender({ sourcePng: SRC, renderPng: arg('render'), tree: arg('tree'), model, panel });
  console.log(JSON.stringify(r, null, 2));
})().catch((e) => { console.error('reward-vision FAILED:', e && e.stack || e); process.exit(1); });

#!/usr/bin/env node
/**
 * @purpose reward-rubric.mjs — WS4 (PATH_TO_TRUE_1TO1_V2): the ELHSR-analog for the ABSOLUTE progress number. A prior
 * LEARNED reward on cheap PIXEL features overfit cross-site (LOO Spearman 0.20 / -0.9). ELHSR's insight: a tiny linear
 * head generalizes from a FEW samples IF its features are SEMANTIC + site-invariant. We can't read claude's hidden
 * states via the CLI, so the realizable analog is a linear head on the JUDGE's structured RUBRIC vector — "a 4 on
 * color" means the same on any site, unlike a site-idiosyncratic pixel statistic.
 *
 *   judgeRubric({sourcePng, renderPng, model}) → { rubric:{layout,color,completeness,hierarchy,polish}, overall, cost }
 *   fitHead(samples) → { w }   // ridge least-squares; samples = [{ rubric, label(0-100) }]
 *   applyHead(w, rubric) → 0-100
 *
 * The rubric judge is the only NEW model call; the linear head is the only fitted component, and it fits on a FEW
 * human-anchored pairs (the 18 blind calibration pairs) — NOT on cheap pixel features. Until those are scored, the head
 * is fit on the degradation ladders (known order) as a proxy; the gate is order-recovery on a held-out site.
 *
 * NOTE on CLIP (the other WS4 term): a quantized CLIP-ViT cosine between source/clone renders is a deferred OPTIONAL —
 * no torch/onnx/transformers.js is installed (npm can reach the registry; `npm i onnxruntime-node` + a ~300MB CLIP onnx
 * model would enable it). Its marginal value is LOW now that correspondence-reward fixed SSIM's dark/sparse flatness
 * (cross-validated ρ=0.714 + ranks broken LAST). Wire it as an extra term only if the absolute number needs it.
 */
import { execFile } from 'child_process';
import path from 'path';

const RUBRIC_KEYS = ['layout', 'color', 'completeness', 'hierarchy', 'polish'];
const RUBRIC_PROMPT = (srcAbs, candAbs) => `You are a website-clone fidelity judge. Read the TARGET image ${srcAbs} (the original) and the CANDIDATE image ${candAbs} (a reconstruction). Rate the CANDIDATE's faithfulness to the TARGET on each axis, 0-10 (0=absent/broken, 10=indistinguishable):
- layout: are blocks in the right positions / structure / spacing?
- color: do foreground/background/accent colors match?
- completeness: is all the target's content present (no missing/extra blocks)?
- hierarchy: is the visual hierarchy (headline dominance, grouping, emphasis) right?
- polish: overall gestalt — does it look like the same page, free of broken/garbled/invisible elements?
Be discriminating; a broken clone (missing logo / wrong nav / clipped headline) scores low on the relevant axes.
Output ONLY JSON: {"layout":N,"color":N,"completeness":N,"hierarchy":N,"polish":N}`;

function extractJson(s) { if (!s) return null; const m = String(s).match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } }

export function judgeRubric({ sourcePng, renderPng, model = 'haiku', timeoutMs = 180000 }) {
  const srcAbs = path.resolve(sourcePng), candAbs = path.resolve(renderPng);
  return new Promise((resolve) => {
    let child = null; const hard = setTimeout(() => { try { if (child) child.kill('SIGKILL'); } catch {} resolve({ ok: false, error: 'hard-timeout' }); }, timeoutMs + 30000); hard.unref();
    child = execFile('claude', ['-p', RUBRIC_PROMPT(srcAbs, candAbs), '--model', model, '--output-format', 'json', '--allowedTools', 'Read', '--max-budget-usd', '0.20', '--strict-mcp-config', '--setting-sources', ''],
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, cwd: '/tmp' }, (err, stdout) => {
        clearTimeout(hard); if (err && !stdout) return resolve({ ok: false, error: String(err && err.message || err) });
        let outer = null; try { outer = JSON.parse(stdout); } catch {} if (!outer) return resolve({ ok: false, error: 'outer parse' });
        const obj = extractJson(outer.result); if (!obj || RUBRIC_KEYS.some((k) => typeof obj[k] !== 'number')) return resolve({ ok: false, error: 'rubric JSON invalid', cost: +outer.total_cost_usd || 0 });
        const rubric = {}; for (const k of RUBRIC_KEYS) rubric[k] = Math.max(0, Math.min(10, obj[k]));
        resolve({ ok: true, rubric, overall: +(RUBRIC_KEYS.reduce((a, k) => a + rubric[k], 0) / RUBRIC_KEYS.length * 10).toFixed(1), cost: +outer.total_cost_usd || 0 });
      });
    child.on('error', () => resolve({ ok: false, error: 'spawn' }));
  });
}

// ── linear head: ridge least-squares (rubric vector + bias → 0-100). The ONLY fitted component; fits on a few
// human-anchored pairs (semantic features → generalizes; pixel features → did not). ──────────────────────────────
const vecOf = (rubric) => [1, ...RUBRIC_KEYS.map((k) => rubric[k] ?? 0)];
export function fitHead(samples, lambda = 1.0) {
  const X = samples.map((s) => vecOf(s.rubric)), y = samples.map((s) => s.label);
  const p = X[0].length, A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  for (let i = 0; i < X.length; i++) for (let a = 0; a < p; a++) { b[a] += X[i][a] * y[i]; for (let c = 0; c < p; c++) A[a][c] += X[i][a] * X[i][c]; }
  for (let a = 1; a < p; a++) A[a][a] += lambda;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < p; c++) { let pv = c; for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[pv][c])) pv = r;[M[c], M[pv]] = [M[pv], M[c]]; const d = M[c][c] || 1e-9; for (let r = 0; r < p; r++) if (r !== c) { const f = M[r][c] / d; for (let k = c; k <= p; k++) M[r][k] -= f * M[c][k]; } }
  return { w: M.map((r, i) => r[p] / (r[i] || 1e-9)) };
}
export function applyHead(head, rubric) { const v = vecOf(rubric); return +Math.max(0, Math.min(100, v.reduce((s, x, i) => s + x * head.w[i], 0))).toFixed(1); }

const IS_MAIN = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (IS_MAIN) (async () => {
  const arg = (k) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : null; };
  if (arg('source') && arg('render')) { const r = await judgeRubric({ sourcePng: arg('source'), renderPng: arg('render'), model: arg('model') || 'haiku' }); console.log(JSON.stringify(r, null, 2)); }
  else console.log('reward-rubric.mjs — judgeRubric / fitHead / applyHead. Hermetic gate: _reward-rubric-selftest.mjs.');
})();

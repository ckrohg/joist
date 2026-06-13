#!/usr/bin/env node
/**
 * @purpose refine-vision.mjs — the SEE→CRITIQUE→FIX inner loop (topic-1): per page band, a vision LLM LOOKS at
 * a side-by-side [source | clone] tile, enumerates CONSTRUCTIVE defects (each names what to change), an agentic
 * FIX step turns the defect list + the band's widget subtree + the operator vocabulary into either a named
 * operator invocation or a surgical JSON patch, the candidate renders on SCRATCH via sectionVisual, and a KEEP
 * needs BOTH (a) the hardened deterministic anti-deletion gates (refine-sections keepGate — C5c feed) AND (b) a
 * PAIRWISE vision verdict: incumbent vs candidate side-by-side with the source band attached, A/B order
 * RANDOMIZED, "which is closer to source" — keep only on candidate-wins. Research basis
 * (knowledge/RESEARCH_STEALS_2026H1.md §3): pairwise beats absolute (absolute visual noise measured ±0.08 /
 * up to 20pts per tile), ~3 refine cycles is the plateau, and visual pressure degrades structure unless a
 * deterministic structure axis holds the line — which is exactly what the keepGate AND-clause is.
 *
 * DESIGN DECISIONS:
 *  1. SAME-PIXEL CHANNEL — the critique/pairwise tiles are composed from the FROZEN src cache crop (the exact
 *     bytes the deterministic gates' source side uses) and the very sectionVisual scratch render the gates
 *     scored (report.shots.band). The judge and the gates always see the SAME pixels — no parallel capture
 *     path to diverge (vision-judge's captureFull stays for full-page judging; per-band the render-in-place
 *     scratch channel is the truth).
 *  2. claudeJson is the vision-judge claudeOnce PATTERN with its full hardening (soft execFile timeout with
 *     killSignal SIGKILL + unref'd hard-timeout race, --strict-mcp-config + --setting-sources "" isolation,
 *     non-haiku modelUsage attribution, per-call --max-budget-usd) but a GENERIC validator: claudeOnce's
 *     validator is vision-judge-shape-specific (it STRIPS unknown defect fields — the constructive `fix` field
 *     would be silently dropped) and cannot express the fix step's {action,...} contract.
 *  3. KEEP RULE = keepGate(baseline, candidate) AND pairwise candidate-wins. Gates first (deterministic, free);
 *     pairwise runs for EVERY rendered gradable candidate (not only gate-passers) so the report carries
 *     gate/judge agreement telemetry and a proposal-mode run always shows the full chain. A 'tie' is a reject
 *     (monotonic accept — ReLook discipline). Order is randomized per call and the verdict is un-flipped by
 *     the harness; the selftest forces both orders on a known-degraded candidate to prove the mapping honest.
 *  4. FIX STEP CONTRACT — the model reads ONE context file (defects + band widget subtree + operator vocabulary
 *     + prior rejected attempts) and answers {"action":"patch"|"operator"|"none"}. Patches are a 5-op vocabulary
 *     (set/remove/insertBefore/insertAfter/replace) applied by applyPatch() under hard validation: target ids
 *     MUST be band element ids (band-local mutation only — the gates are band-local), set-paths MUST be under
 *     settings., inserted elements are shape-sanitized. Deletion is allowed — the anti-deletion gates exist
 *     precisely to price it. Long string settings are TRUNCATED in the context file (never in the tree).
 *  5. COST GUARD — per band: ≤ iters×3 + 1 claude calls (critique + fix + pairwise per iter, +1 final
 *     after-critique when something was kept), re-critique ONLY after a keep (rejects reuse the standing defect
 *     list + feed the rejection back via priorAttempts), global --budget USD cap checked before every call,
 *     per-call --max-budget-usd. Per-band $ is reported.
 *  6. --apply reuses refine-sections' applyUnion VERBATIM: ONE union CAS PUT with prestate saved FIRST,
 *     full-page re-grade, auto-revert on composite drop. Without --apply: PURE PROPOSAL — graded pages get GETs
 *     only (hash-verified before/after), every render on a tag-swept scratch page via scratch-harness.
 *  7. NO chrome pkill anywhere (parallel rounds share the host; every browser here is an ephemeral per-run
 *     launch) and NO sweep --all (a sibling round's LIVE scratch page must survive); only age-gated sweep.
 *
 * RAILS: JOIST_AUTH_B64 read silently by the imported api() (env or /tmp/joist-auth.env), never printed.
 * Selftest: _refine-vision-selftest.mjs — (a) identical band → zero sev>=3 defects + loop converges with zero
 * keeps; (b) a deliberately-degraded candidate LOSES the pairwise under BOTH forced orders (un-flip honest);
 * (c) SIGKILL mid-loop leaves no scratch debris (surgical cleanup, no sweep-all) + graded page untouched.
 *
 * CLI:
 *   node refine-vision.mjs --page <id> --source <url> [--bands 1,2 | y0-y1,…] [--iters 3] [--apply]
 *        [--sections /tmp/gsec/sections.json] [--out /tmp/refine-vision/<page>] [--model sonnet]
 *        [--budget 10] [--keep]
 *   exit codes: 0 ok · 2 usage · 3 infra
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { W, loadSrcCache } from './grade-sections.mjs';
import { crop } from './grade-vision-tiles.mjs';
import { drawLabel, extractJson } from './vision-judge.mjs';
import { sectionVisual, prepare, liveHash, extractBand } from './sectionvisual.mjs';
import { createScratch, deletePage, sweep } from './scratch-harness.mjs';
import { keepGate, OPERATORS, resolveBands, applyUnion } from './refine-sections.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_MAIN = process.argv[1] && process.argv[1].endsWith('refine-vision.mjs');

export const MIN_FIX_SEV = 3;        // defects below this are recorded but never drive a fix call (nitpick floor)
export const DEFAULT_ITERS = 3;      // research-backed plateau (~3 cycles; RESEARCH_STEALS_2026H1 §3)
export const DEFAULT_BUDGET = 10;    // global USD cap across all claude calls in one run
export const MAX_COMPOSITE_W = 3000; // composites wider than this are box-downscaled 2x before judging
const DIVIDER = 14;                  // px magenta divider (same as vision-judge)
const TRUNCATE_STR = 2000;           // long string settings cut to this in the FIX context file (file only)

const clone = (x) => JSON.parse(JSON.stringify(x));
const newElId = () => Math.random().toString(16).slice(2, 9).padEnd(7, '0');
class InfraError extends Error {}

// ── compose: N panels side-by-side on a dark-gray canvas, magenta dividers, burned labels ────────────────────
export function composePanels(panels) {
  const h = Math.max(...panels.map((p) => p.img.height));
  const w = panels.reduce((s, p) => s + p.img.width, 0) + DIVIDER * (panels.length - 1);
  const out = new PNG({ width: w, height: h });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 24; out.data[i + 1] = 24; out.data[i + 2] = 24; out.data[i + 3] = 255; }
  let ox = 0;
  for (let pi = 0; pi < panels.length; pi++) {
    const img = panels[pi].img;
    for (let r = 0; r < img.height; r++) { const sRow = (r * img.width) << 2; img.data.copy(out.data, ((r * w + ox) << 2), sRow, sRow + (img.width << 2)); }
    drawLabel(out, ox + 6, 6, panels[pi].label);
    ox += img.width;
    if (pi < panels.length - 1) {
      for (let r = 0; r < h; r++) for (let c = ox + 2; c < ox + DIVIDER - 2; c++) { const i = (r * w + c) << 2; out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 220; out.data[i + 3] = 255; }
      ox += DIVIDER;
    }
  }
  return out;
}

// 2x box-filter downscale (keeps very wide [SRC|A|B] composites within the judge's useful resolution)
export function downscale2(png) {
  const w = png.width >> 1, h = png.height >> 1;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const di = (y * w + x) << 2;
    for (let ch = 0; ch < 3; ch++) {
      const a = (((2 * y) * png.width + 2 * x) << 2) + ch, b = (((2 * y) * png.width + 2 * x + 1) << 2) + ch;
      const c = (((2 * y + 1) * png.width + 2 * x) << 2) + ch, d = (((2 * y + 1) * png.width + 2 * x + 1) << 2) + ch;
      out.data[di + ch] = (png.data[a] + png.data[b] + png.data[c] + png.data[d]) >> 2;
    }
    out.data[di + 3] = 255;
  }
  return out;
}

export const cropBand = (shot, y0, y1) => crop(shot, 0, Math.max(0, Math.round(y0)), shot.width, Math.max(1, Math.round(Math.min(y1, shot.height) - Math.max(0, y0))));

function writeComposite(panels, outPath) {
  let comp = composePanels(panels);
  if (comp.width > MAX_COMPOSITE_W) comp = downscale2(comp);
  fs.writeFileSync(outPath, PNG.sync.write(comp));
  return outPath;
}

// ── claudeJson — claudeOnce pattern + hardening, generic validator (design decision §2) ──────────────────────
export function claudeJson(prompt, { model = 'sonnet', cwd = '/tmp', timeoutMs = 240000, hardMs = null, maxBudgetUsd = 0.6, validate = null } = {}) {
  const hm = hardMs || timeoutMs + 30000;
  return new Promise((resolve) => {
    let child = null;
    const hard = setTimeout(() => { try { if (child) child.kill('SIGKILL'); } catch {} resolve({ ok: false, error: 'hard-timeout', cost: 0 }); }, hm);
    hard.unref();
    child = execFile('claude',
      ['-p', prompt, '--model', model, '--output-format', 'json', '--allowedTools', 'Read',
       '--max-budget-usd', String(maxBudgetUsd), '--strict-mcp-config', '--setting-sources', ''],
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, cwd },
      (err, stdout) => {
        clearTimeout(hard);
        if (err && !stdout) return resolve({ ok: false, error: String(err && err.message || err), cost: 0 });
        let outer = null; try { outer = JSON.parse(stdout); } catch {}
        if (!outer) return resolve({ ok: false, error: 'outer JSON parse failed', cost: 0, raw: String(stdout).slice(0, 400) });
        const cost = +outer.total_cost_usd || 0;
        // modelUsage lists the haiku CLI helper alongside the judge model — record the NON-helper one (the
        // vision-judge critic mustFix: first-key misattributed every judgment to haiku).
        const usedModel = outer.modelUsage ? (Object.keys(outer.modelUsage).find((k) => !/haiku/.test(k)) || Object.keys(outer.modelUsage)[0]) : model;
        const json = extractJson(outer.result);
        if (!json) return resolve({ ok: false, error: 'result JSON parse failed', cost, model: usedModel, raw: String(outer.result).slice(0, 400) });
        if (validate) { const v = validate(json); if (v !== true) return resolve({ ok: false, error: `invalid shape: ${v}`, cost, model: usedModel, raw: JSON.stringify(json).slice(0, 400) }); }
        resolve({ ok: true, json, cost, model: usedModel });
      });
    child.on('error', () => { clearTimeout(hard); resolve({ ok: false, error: 'spawn failed', cost: 0 }); });
  });
}
const RETRY_SUFFIX = '\nYour previous output was not the required JSON. Output ONLY the raw JSON object — no prose, no markdown fences.';
async function claudeJsonRetry(prompt, opts) {
  let res = await claudeJson(prompt, opts);
  let cost = res.cost || 0;
  if (!res.ok && res.error !== 'hard-timeout' && res.error !== 'spawn failed') {
    res = await claudeJson(prompt + RETRY_SUFFIX, opts);
    cost += res.cost || 0;
  }
  return { ...res, cost };
}

// ── STEP 1: VISION CRITIQUE — constructive: every defect names what to change ────────────────────────────────
const SEVERITY_ANCHORS = `Severity anchors — calibrate strictly to these examples:
- 5 = RUINS the band: whole section missing or blank, layout collapsed into an unreadable pile, band dominated by junk text. A missing two-word sub-heading is NOT a 5.
- 4 = major: brand logo missing or wrong, primary CTA unstyled/invisible, hero image missing, dead UI mockup (no window dots/tabs/syntax colors).
- 3 = clearly noticeable: wrong font/color on a prominent heading, misaligned card grid, a secondary image missing.
- 2 = minor: small spacing/weight/radius differences, a short sub-heading or caption missing.
- 1 = trivial nitpick visible only side-by-side.`;
const CRITIQUE_RUBRIC = (tilePath, width, y0, y1) => `You are a pixel-fidelity QA critic. Read the image file ${tilePath} now.
It is a side-by-side composite: LEFT of the vertical magenta divider is the ORIGINAL website band (viewport width ${width}px, page rows y=${y0}-${y1}); RIGHT is a REBUILD of the same band. Corner labels are burned in by the harness — ignore them. Dark-gray padding on one side only reflects a height mismatch — judge the painted content.
Enumerate EVERY visible defect of the RIGHT side relative to the LEFT. Each defect is:
{"desc": "<specific — names the element and what is wrong>", "severity": 1-5, "category": "missing-content"|"wrong-style"|"layout-broken"|"text-junk"|"imagery-missing"|"chrome-missing", "fix": "<CONSTRUCTIVE — one concrete sentence naming WHAT to change: the element, the property, and the target value or content, actionable by an editor that can set widget settings, insert/remove widgets, or repaint backgrounds>"}
${SEVERITY_ANCHORS}
Be strict: missing logos/icons/images, unstyled buttons or pills, text rendered as junk/stacked fragments, flattened inline code, dead UI mockups, wrong background colors, overflowing or misaligned layout ALL count.
If the two sides are visually identical (or differ only by compression/antialias noise), output zero defects.
Output ONLY this JSON, no prose, no markdown fences: {"defects": [{"desc": "...", "severity": <1-5>, "category": "...", "fix": "..."}]}`;

export async function critiqueBand({ srcCrop, clnCrop, width = W, y0, y1, outPath, model = 'sonnet', cwd = '/tmp' }) {
  writeComposite([{ img: srcCrop, label: `SRC Y${Math.round(y0)}` }, { img: clnCrop, label: 'CLONE' }], outPath);
  const validate = (j) => Array.isArray(j.defects) ? true : 'defects[] missing';
  const res = await claudeJsonRetry(CRITIQUE_RUBRIC(outPath, width, Math.round(y0), Math.round(y1)), { model, cwd, validate });
  if (!res.ok) return { ok: false, error: res.error, cost: res.cost, tilePath: outPath };
  const defects = res.json.defects
    .filter((d) => d && d.desc)
    .map((d) => ({ desc: String(d.desc).slice(0, 300), severity: Math.max(1, Math.min(5, +d.severity || 1)), category: String(d.category || 'wrong-style'), fix: String(d.fix || '').slice(0, 300) }));
  return { ok: true, defects, cost: res.cost, model: res.model, tilePath: outPath };
}

// ── STEP 2: AGENTIC FIX — defects + band subtree + operator vocabulary → operator | patch | none ─────────────
export const PATCH_SPEC = [
  '{"op":"set","id":"<elementId>","path":"settings.<key>[.<subkey>...]","value":<any JSON>} — set ONE settings value on an existing element',
  '{"op":"remove","id":"<elementId>"} — remove an element (anti-deletion gates will reject any visible-text loss)',
  '{"op":"insertBefore","id":"<anchorElementId>","element":{"elType":"widget","widgetType":"heading"|"html"|...,"settings":{...}}} — insert a new element before the anchor',
  '{"op":"insertAfter","id":"<anchorElementId>","element":{...}} — insert after the anchor',
  '{"op":"replace","id":"<elementId>","element":{...}} — replace an element wholesale (its id is preserved)',
];
const OPERATOR_DESCRIPTIONS = {
  'split-bg': 'whole-band operator: finds an in-band node painting ONE solid background whose rows span a vertical background discontinuity in the SOURCE (e.g. a flat dark panel that should be two colors) and splits that paint in two source-sampled rectangles at the discontinuity row. Use when a band background is one flat color but the source shows two stacked background regions.',
};
function truncateStrings(v) {
  if (typeof v === 'string') return v.length > TRUNCATE_STR ? v.slice(0, TRUNCATE_STR) + '…[truncated]' : v;
  if (Array.isArray(v)) return v.map(truncateStrings);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = truncateStrings(v[k]); return o; }
  return v;
}
const FIX_PROMPT = (ctxPath, band) => `You are an expert Elementor V3 page surgeon fixing ONE page band (document rows y=${band.y0}-${band.y1}, page width ${W}px, all coordinates absolute page pixels).
Read the JSON context file ${ctxPath} now. It contains:
- defects: a vision critique of this band's rebuild vs the original site — each defect has a suggested fix;
- bandTree: the band's CURRENT Elementor widget subtree (string values over ${TRUNCATE_STR} chars are truncated with "…[truncated]" — never echo a truncated value back, write fresh complete values);
- bandElementIds: the ONLY element ids you may target;
- operators: named whole-band operators you may invoke instead of patching;
- priorAttempts: earlier proposals for this band and why they were REJECTED — do NOT repeat them;
- patchOps: the exact patch vocabulary.
Choose exactly ONE action that best addresses the highest-severity defects:
1. {"action":"patch","ops":[<1-8 patch ops>],"rationale":"<short>"}
2. {"action":"operator","name":"<operator name>","rationale":"<short>"}
3. {"action":"none","reason":"<why nothing here is fixable by these means>"}
HARD RULES:
- Target ONLY ids listed in bandElementIds (inserts anchor on a band element).
- NEVER delete, hide, shrink, fade or move out visible TEXT that matches the original — deterministic anti-deletion gates reject any candidate that loses source text, drops editability, or rasterizes text. Fix styling/backgrounds/imagery/layout instead.
- Prefer the SMALLEST edit that fixes the worst defect. Do not restyle things the critique did not flag.
- Widget settings must be valid Elementor V3. Common advanced keys are underscore-prefixed: _position "absolute", _offset_orientation_h/_v "start", _offset_x/_offset_y {"unit":"px","size":<n>}, _element_width "initial" with _element_custom_width {"unit":"px","size":<n>}, _z_index "<n>". html widgets carry markup in settings.html with inline styles.
- Use HEX colors everywhere (the server sanitizer strips rgb()/rgba() color values inside html strings).
Output ONLY the raw JSON object for your chosen action — no prose, no markdown fences.`;

export async function proposeFix({ defects, bandTree, bandIds, band, priorAttempts = [], ctxPath, model = 'sonnet', cwd = '/tmp' }) {
  const operators = Object.keys(OPERATORS).filter((n) => n !== 'noop')
    .map((name) => ({ name, description: OPERATOR_DESCRIPTIONS[name] || 'registered whole-band tree operator' }));
  const ctx = {
    band: { y0: band.y0, y1: band.y1 }, width: W,
    defects, operators, priorAttempts, patchOps: PATCH_SPEC,
    bandElementIds: [...bandIds],
    bandTree: truncateStrings(bandTree),
  };
  fs.writeFileSync(ctxPath, JSON.stringify(ctx, null, 1));
  const validate = (j) => {
    if (!j || typeof j.action !== 'string') return 'action missing';
    if (j.action === 'patch') return Array.isArray(j.ops) && j.ops.length ? true : 'patch needs ops[]';
    if (j.action === 'operator') return typeof j.name === 'string' && j.name ? true : 'operator needs name';
    if (j.action === 'none') return true;
    return `unknown action '${j.action}'`;
  };
  const res = await claudeJsonRetry(FIX_PROMPT(ctxPath, band), { model, cwd, timeoutMs: 300000, maxBudgetUsd: 0.8, validate });
  if (!res.ok) return { ok: false, error: res.error, cost: res.cost, ctxPath };
  return { ok: true, proposal: res.json, cost: res.cost, model: res.model, ctxPath };
}

// ── patch application (pure; hard validation — design decision §4) ───────────────────────────────────────────
function sanitizeElement(el) {
  if (!el || typeof el !== 'object' || Array.isArray(el)) return null;
  if (el.elType !== 'widget' && el.elType !== 'container') return null;
  if (el.elType === 'widget' && (typeof el.widgetType !== 'string' || !el.widgetType)) return null;
  const out = clone(el);
  if (typeof out.id !== 'string' || !/^[0-9a-f]{7,8}$/i.test(out.id)) out.id = newElId();
  if (!out.settings || typeof out.settings !== 'object' || Array.isArray(out.settings)) out.settings = {};
  if (!Array.isArray(out.elements)) out.elements = [];
  if (typeof out.isInner !== 'boolean') out.isInner = false;
  return out;
}
export function applyPatch(tree, ops, bandIds) {
  if (!Array.isArray(ops) || !ops.length) return { tree: null, applied: 0, errors: ['no ops'] };
  const work = clone(tree);
  const errors = []; let applied = 0;
  const findById = (nodes, id) => {
    for (let i = 0; i < (nodes || []).length; i++) {
      const n = nodes[i];
      if (n && n.id === id) return { n, arr: nodes, i };
      const r = findById(n && n.elements, id);
      if (r) return r;
    }
    return null;
  };
  for (const op of ops) {
    if (!op || typeof op !== 'object') { errors.push('malformed op'); continue; }
    const id = String(op.id || '');
    if (!bandIds.has(id)) { errors.push(`${op.op || '?'} ${id}: not a band element id`); continue; }
    const hit = findById(work, id);
    if (!hit) { errors.push(`${op.op} ${id}: id not found in working tree`); continue; }
    if (op.op === 'set') {
      const p = String(op.path || '');
      if (!/^settings(\.[A-Za-z0-9_:-]+)+$/.test(p)) { errors.push(`set ${id}: bad path '${p}' (must be settings.<key>…)`); continue; }
      const keys = p.split('.');
      let cur = hit.n;
      for (let k = 0; k < keys.length - 1; k++) { if (cur[keys[k]] == null || typeof cur[keys[k]] !== 'object' || Array.isArray(cur[keys[k]])) cur[keys[k]] = {}; cur = cur[keys[k]]; }
      cur[keys[keys.length - 1]] = op.value;
      applied++;
    } else if (op.op === 'remove') {
      hit.arr.splice(hit.i, 1); applied++;
    } else if (op.op === 'insertBefore' || op.op === 'insertAfter') {
      const el = sanitizeElement(op.element);
      if (!el) { errors.push(`${op.op} ${id}: element fails shape sanitation`); continue; }
      hit.arr.splice(hit.i + (op.op === 'insertAfter' ? 1 : 0), 0, el); applied++;
    } else if (op.op === 'replace') {
      const el = sanitizeElement(op.element);
      if (!el) { errors.push(`replace ${id}: element fails shape sanitation`); continue; }
      el.id = hit.n.id; // id preserved: extents/idMap lookups stay coherent
      hit.arr[hit.i] = el; applied++;
    } else errors.push(`unknown op '${op.op}'`);
  }
  return { tree: applied ? work : null, applied, errors };
}

// ── STEP 5b: PAIRWISE VERDICT — [SOURCE | A | B], randomized order, un-flipped by the harness ────────────────
const PAIRWISE_RUBRIC = (tilePath, y0) => `You are a pixel-fidelity arbiter. Read the image file ${tilePath} now.
It shows THREE panels separated by vertical magenta dividers: the LEFT panel labeled SOURCE is the original website band (page rows from y=${Math.round(y0)}); the MIDDLE panel labeled A and the RIGHT panel labeled B are two different rebuilds of that band. Corner labels are burned in by the harness — ignore them. Dark-gray padding reflects height mismatches — judge the painted content.
Decide which rebuild — A or B — is CLOSER to SOURCE overall: layout, text presence and styling, imagery, backgrounds, alignment. Weigh ruinous differences (missing sections, broken layout, missing/unreadable text) far above minor styling drift.
If and only if A and B are genuinely indistinguishable in closeness, answer "tie".
Output ONLY this JSON, no prose, no markdown fences: {"winner": "A"|"B"|"tie", "reason": "<max 200 chars>"}`;

export async function pairwiseVerdict({ srcCrop, incumbentCrop, candidateCrop, y0, outPath, flip = null, model = 'sonnet', cwd = '/tmp' }) {
  const fl = flip === null ? Math.random() < 0.5 : !!flip; // flip=true → A is the CANDIDATE
  const A = fl ? candidateCrop : incumbentCrop, B = fl ? incumbentCrop : candidateCrop;
  writeComposite([{ img: srcCrop, label: `SOURCE Y${Math.round(y0)}` }, { img: A, label: 'A' }, { img: B, label: 'B' }], outPath);
  const validate = (j) => (j && (j.winner === 'A' || j.winner === 'B' || j.winner === 'tie')) ? true : 'winner must be A|B|tie';
  const res = await claudeJsonRetry(PAIRWISE_RUBRIC(outPath, y0), { model, cwd, validate });
  if (!res.ok) return { ok: false, error: res.error, cost: res.cost, flip: fl, tilePath: outPath };
  const winner = res.json.winner;
  const winnerRole = winner === 'tie' ? 'tie' : ((winner === 'A') === fl ? 'candidate' : 'incumbent');
  return { ok: true, winner, winnerRole, reason: String(res.json.reason || '').slice(0, 220), flip: fl, cost: res.cost, model: res.model, tilePath: outPath };
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────
const summarize = (r) => ({
  visual: r.visual, ssim: r.ssim, exact: r.exact, matchedTexts: r.matchedTexts, srcTextCount: r.srcTextCount,
  editability: r.editability, contentVoid: r.contentVoid, rasteredText: r.rasteredText, gradable: r.gradable,
});
const collectIds = (nodes, into = new Set()) => { for (const n of nodes || []) { if (n && n.id) into.add(String(n.id)); collectIds(n && n.elements, into); } return into; };
const sevCounts = (defects) => { const c = {}; for (const d of defects || []) c['sev' + d.severity] = (c['sev' + d.severity] || 0) + 1; return c; };

// ── THE LOOP ─────────────────────────────────────────────────────────────────────────────────────────────────
// hooks = {critique, fix, pairwise} — injectable (selftest crash/convergence paths); defaults are the real
// claude-backed steps above. Every hook returns {ok, cost, ...}.
export async function refineVision(opts) {
  const {
    source, pageId, bands, iters = DEFAULT_ITERS, apply = false,
    outDir = `/tmp/refine-vision/${opts.pageId}`, model = 'sonnet', budgetUsd = DEFAULT_BUDGET,
    sectionsPath = null, secReport = null, ctx = null, keepScratch = false, hooks = null,
  } = opts;
  if (!source || !pageId || !Array.isArray(bands) || !bands.length) throw new Error('refineVision: need source, pageId, bands[]');
  const H = hooks || {};
  const critique = H.critique || critiqueBand, fix = H.fix || proposeFix, pairwise = H.pairwise || pairwiseVerdict;
  fs.mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  const spend = { usd: 0, calls: 0 };
  const charge = (res) => { spend.usd += res.cost || 0; spend.calls++; return res; };
  const budgetLeft = () => spend.usd < budgetUsd;

  let myBrowser = null, useCtx = ctx, scratch = null;
  const report = {
    source, page: Number(pageId), mode: apply ? 'apply' : 'proposal', model, iters, budgetUsd,
    minFixSev: MIN_FIX_SEV, bands, perBand: [], keeps: [], totalCandidates: 0, totalKept: 0,
    gradedHashBefore: null, gradedHashAfter: null, gradedUntouchedPreApply: null, apply: null,
    costUsd: 0, claudeCalls: 0,
  };
  try {
    if (!useCtx) {
      myBrowser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
      useCtx = await myBrowser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
      await useCtx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    }
    report.gradedHashBefore = await liveHash(pageId);
    const prep = await prepare({ source, pageId, ctx: useCtx });
    const captureData = { srcShot: prep.srcCache.shot, srcTexts: prep.srcCache.texts, boxIndex: prep.boxIndex, W, pageSettings: prep.pageSettings };
    const made = await createScratch({ title: `refine-vision ${pageId}`, elements: [], pageSettings: prep.pageSettings, template: 'elementor_canvas', srcId: Number(pageId) });
    scratch = { pageId: made.pageId, url: made.url };
    report.scratchId = made.pageId;

    let workingTree = clone(prep.tree); // kept mutations accumulate here = the union (ONE CAS PUT on --apply)

    for (const band of bands) {
      const tag = `b${band.idx != null ? band.idx : `${band.y0}-${band.y1}`}`;
      const bandDir = path.join(outDir, tag);
      fs.mkdirSync(bandDir, { recursive: true });
      const callCap = iters * 3 + 1; // critique+fix+pairwise per iter, +1 final after-critique (design §5)
      let bandCalls = 0, bandUsd0 = spend.usd;
      const bandRec = { band, baseline: null, defectsBefore: null, defectsAfter: null, iterations: [], kept: 0, finishedReason: null, calls: { critique: 0, fix: 0, pairwise: 0 }, costUsd: 0 };
      const canCall = () => bandCalls < callCap && budgetLeft();
      const call = async (kind, fn) => { bandCalls++; bandRec.calls[kind]++; return charge(await fn()); };

      // SEE round 0: same-channel baseline render of the working tree (the incumbent)
      let baseline;
      try {
        baseline = await sectionVisual({ source, pageId: Number(pageId), band, prep: { ...prep, tree: workingTree, treeMode: 'working' }, scratch, ctx: useCtx, outDir: path.join(bandDir, 'baseline') });
      } catch (e) { bandRec.finishedReason = 'baseline-render-failed: ' + String(e && e.message || e).slice(0, 200); report.perBand.push(bandRec); continue; }
      bandRec.baseline = summarize(baseline);
      if (!baseline.gradable || !baseline.shots) { bandRec.finishedReason = 'baseline-not-gradable'; report.perBand.push(bandRec); console.log(`[rvis] ${tag}: SKIP (not gradable)`); continue; }
      const srcCrop = cropBand(prep.srcCache.shot, band.y0, baseline.gy1);
      let incumbentCrop = PNG.sync.read(fs.readFileSync(baseline.shots.band));
      console.log(`[rvis] ${tag} y${band.y0}-${band.y1}: baseline visual ${baseline.visual} matched ${baseline.matchedTexts}/${baseline.srcTextCount} edit ${baseline.editability}`);

      let standingCritique = null, incumbentChanged = true, rejectedCount = 0, last = null;
      const priorAttempts = [];
      for (let iter = 1; iter <= iters; iter++) {
        // CRITIQUE — only when the incumbent changed (iter 1, or after a keep); rejects reuse the standing list
        if (incumbentChanged) {
          if (!canCall()) { bandRec.finishedReason = budgetLeft() ? 'call-cap' : 'budget-exhausted'; break; }
          const c = await call('critique', () => critique({ srcCrop, clnCrop: incumbentCrop, width: W, y0: band.y0, y1: band.y1, outPath: path.join(bandDir, `critique-i${iter}.png`), model, cwd: bandDir }));
          if (!c.ok) { bandRec.iterations.push({ iter, stage: 'critique', error: c.error }); bandRec.finishedReason = 'critique-failed'; break; }
          standingCritique = c; incumbentChanged = false;
          if (!bandRec.defectsBefore) bandRec.defectsBefore = c.defects;
          console.log(`[rvis] ${tag} iter ${iter}: critique → ${c.defects.length} defects ${JSON.stringify(sevCounts(c.defects))} ($${spend.usd.toFixed(2)})`);
        }
        const actionable = standingCritique.defects.filter((d) => d.severity >= MIN_FIX_SEV);
        if (!actionable.length) { bandRec.finishedReason = 'converged'; console.log(`[rvis] ${tag} iter ${iter}: zero sev>=${MIN_FIX_SEV} defects → CONVERGED`); break; }
        const itRec = { iter, defectsActionable: actionable.length, critiqueTile: standingCritique.tilePath };

        // FIX — agentic proposal over the defect list + band subtree + operator vocabulary
        if (!canCall()) { bandRec.finishedReason = budgetLeft() ? 'call-cap' : 'budget-exhausted'; bandRec.iterations.push(itRec); break; }
        const { bandRoot } = extractBand({ tree: workingTree, band, boxIndex: prep.boxIndex, idMap: prep.idMap });
        const bandIds = collectIds(bandRoot.elements);
        const f = await call('fix', () => fix({ defects: actionable, bandTree: bandRoot.elements, bandIds, band, priorAttempts, ctxPath: path.join(bandDir, `fixctx-i${iter}.json`), model, cwd: bandDir }));
        if (!f.ok) { itRec.fix = { error: f.error }; itRec.decision = 'rejected'; itRec.reason = 'fix-failed'; bandRec.iterations.push(itRec); continue; }
        itRec.fix = { action: f.proposal.action, name: f.proposal.name, ops: f.proposal.ops ? f.proposal.ops.length : 0, rationale: String(f.proposal.rationale || f.proposal.reason || '').slice(0, 240), ctxPath: f.ctxPath };
        console.log(`[rvis] ${tag} iter ${iter}: fix → ${f.proposal.action}${f.proposal.name ? ':' + f.proposal.name : ''}${f.proposal.ops ? ` (${f.proposal.ops.length} ops)` : ''}`);
        if (f.proposal.action === 'none') { itRec.decision = 'none'; bandRec.iterations.push(itRec); bandRec.finishedReason = 'fix-declined'; break; }

        // BUILD candidate tree
        let candArr = null, buildErr = null;
        if (f.proposal.action === 'operator') {
          const op = OPERATORS[f.proposal.name];
          if (!op) buildErr = `unknown operator '${f.proposal.name}'`;
          else {
            const t = op(clone(workingTree), band, null, captureData, { iteration: iter, baseline, last, rejected: rejectedCount });
            if (!t) buildErr = 'operator-exhausted (returned null)';
            else candArr = Array.isArray(t) ? t : [t];
          }
        } else {
          const p = applyPatch(workingTree, f.proposal.ops, bandIds);
          itRec.patch = { applied: p.applied, errors: p.errors };
          if (!p.tree) buildErr = `patch applied 0 ops [${p.errors.join('; ')}]`;
          else candArr = p.tree;
        }
        if (!candArr) {
          itRec.decision = 'rejected'; itRec.reason = buildErr;
          priorAttempts.push({ iter, proposal: itRec.fix, outcome: `rejected: ${buildErr}` });
          bandRec.iterations.push(itRec); continue;
        }
        if (JSON.stringify(candArr) === JSON.stringify(workingTree)) {
          itRec.decision = 'rejected'; itRec.reason = 'identity-no-op';
          priorAttempts.push({ iter, proposal: itRec.fix, outcome: 'rejected: identity no-op (changed nothing)' });
          bandRec.iterations.push(itRec); continue;
        }
        const candFile = path.join(bandDir, `cand-i${iter}.json`);
        fs.writeFileSync(candFile, JSON.stringify(candArr));
        itRec.candFile = candFile;

        // RENDER candidate on scratch (same channel as baseline)
        let candReport;
        try {
          candReport = await sectionVisual({ source, pageId: Number(pageId), band, prep: { ...prep, tree: candArr, treeMode: 'candidate' }, scratch, ctx: useCtx, outDir: path.join(bandDir, `cand-i${iter}`) });
        } catch (e) {
          itRec.decision = 'rejected'; itRec.reason = 'render-failed: ' + String(e && e.message || e).slice(0, 200);
          priorAttempts.push({ iter, proposal: itRec.fix, outcome: 'rejected: candidate failed to render (likely schema-invalid settings)' });
          bandRec.iterations.push(itRec); continue;
        }
        report.totalCandidates++;
        itRec.candidate = summarize(candReport);

        // GATES — hardened deterministic anti-deletion gates (refine-sections keepGate, C5c feed)
        const g = keepGate(baseline, candReport);
        itRec.gates = { keep: g.keep, failed: g.failed, deltas: g.deltas };
        console.log(`[rvis] ${tag} iter ${iter}: gates → ${g.keep ? 'PASS' : 'FAIL [' + g.failed.join(',') + ']'} (Δvisual ${g.deltas.visual} Δmatched ${g.deltas.matchedTexts} Δedit ${g.deltas.editability})`);

        // PAIRWISE — runs for every rendered gradable candidate (chain telemetry, design §3)
        let pw = null;
        if (candReport.gradable && candReport.shots && canCall()) {
          const candCrop = PNG.sync.read(fs.readFileSync(candReport.shots.band));
          pw = await call('pairwise', () => pairwise({ srcCrop, incumbentCrop, candidateCrop: candCrop, y0: band.y0, outPath: path.join(bandDir, `pairwise-i${iter}.png`), model, cwd: bandDir }));
          itRec.pairwise = pw.ok ? { winner: pw.winner, winnerRole: pw.winnerRole, flip: pw.flip, reason: pw.reason, tilePath: pw.tilePath } : { error: pw.error };
          if (pw.ok) console.log(`[rvis] ${tag} iter ${iter}: pairwise → ${pw.winnerRole.toUpperCase()} (winner ${pw.winner}, flip ${pw.flip}) — "${pw.reason}"`);
        }
        last = { report: candReport, decision: itRec };

        // KEEP RULE: deterministic gates AND pairwise candidate-wins (design §3)
        const pairwiseWin = !!(pw && pw.ok && pw.winnerRole === 'candidate');
        if (g.keep && pairwiseWin) {
          itRec.decision = 'kept';
          workingTree = candArr; baseline = candReport;
          incumbentCrop = PNG.sync.read(fs.readFileSync(candReport.shots.band));
          incumbentChanged = true; rejectedCount = 0;
          bandRec.kept++; report.totalKept++;
          report.keeps.push({ band, iter, candFile, fix: itRec.fix });
          console.log(`[rvis] ${tag} iter ${iter}: KEEP (gates + pairwise agree)`);
        } else {
          itRec.decision = 'rejected';
          itRec.reason = !g.keep ? `gates [${g.failed.join(',')}]` + (pw && pw.ok ? `; pairwise said ${pw.winnerRole}` : '') : (pw && pw.ok ? `pairwise-${pw.winnerRole}` : 'pairwise-unavailable');
          rejectedCount++;
          priorAttempts.push({ iter, proposal: itRec.fix, outcome: `rejected: ${itRec.reason} (Δvisual ${g.deltas.visual}, Δmatched ${g.deltas.matchedTexts}, Δedit ${g.deltas.editability})` });
          console.log(`[rvis] ${tag} iter ${iter}: REJECT — ${itRec.reason}`);
        }
        bandRec.iterations.push(itRec);
        if (iter === iters && !bandRec.finishedReason) bandRec.finishedReason = 'iters-exhausted';
      }
      if (!bandRec.finishedReason) bandRec.finishedReason = 'iters-exhausted';

      // AFTER-CRITIQUE: only when something was kept (incumbent changed) — gives an honest before/after list
      if (bandRec.kept > 0 && canCall()) {
        const c2 = await call('critique', () => critique({ srcCrop, clnCrop: incumbentCrop, width: W, y0: band.y0, y1: band.y1, outPath: path.join(bandDir, 'critique-after.png'), model, cwd: bandDir }));
        bandRec.defectsAfter = c2.ok ? c2.defects : null;
        if (c2.ok) console.log(`[rvis] ${tag}: after-critique → ${c2.defects.length} defects ${JSON.stringify(sevCounts(c2.defects))}`);
      } else if (bandRec.kept === 0) bandRec.defectsAfter = bandRec.defectsBefore; // incumbent unchanged → identical by construction
      bandRec.costUsd = +(spend.usd - bandUsd0).toFixed(3);
      console.log(`[rvis] ${tag}: done (${bandRec.finishedReason}) — kept ${bandRec.kept}, $${bandRec.costUsd} (${bandRec.calls.critique}c/${bandRec.calls.fix}f/${bandRec.calls.pairwise}p)`);
      report.perBand.push(bandRec);
    }

    report.gradedHashAfter = await liveHash(pageId);
    report.gradedUntouchedPreApply = report.gradedHashBefore === report.gradedHashAfter;
    report.wouldApply = !apply && report.totalKept > 0;
    if (apply && report.totalKept > 0) {
      report.apply = await applyUnion({ pageId: Number(pageId), source, workingTree, prep, secReport, sectionsPath, outDir });
    } else if (apply) report.apply = { applied: false, reason: 'zero keeps — nothing to apply' };
    report.unionTreeFile = path.join(outDir, 'union-tree.json');
    fs.writeFileSync(report.unionTreeFile, JSON.stringify(workingTree));
  } finally {
    if (scratch) { try { keepScratch ? console.error(`[rvis] scratch ${scratch.pageId} KEPT (debug)`) : await deletePage(scratch.pageId, Number(pageId)); } catch (e) { console.error('[rvis] scratch release failed (sweep will catch it):', String(e).slice(0, 160)); } }
    if (myBrowser) await myBrowser.close();
  }
  report.costUsd = +spend.usd.toFixed(3);
  report.claudeCalls = spend.calls;
  report.totalMs = Date.now() - t0;
  fs.writeFileSync(path.join(outDir, `refine-vision-${pageId}.json`), JSON.stringify(report, null, 2));
  return report;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN) (async () => {
  const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
  const has = (n) => process.argv.includes('--' + n);
  const source = arg('source'), pageId = arg('page');
  if (!source || !pageId) {
    console.error('usage: node refine-vision.mjs --page <id> --source <url> [--bands 1,2|y0-y1,…] [--iters 3] [--apply] [--sections sections.json] [--out dir] [--model sonnet] [--budget 10] [--keep]');
    process.exit(2);
  }
  const sectionsPath = arg('sections', '/tmp/gsec/sections.json');
  let secReport = null;
  try { secReport = JSON.parse(fs.readFileSync(sectionsPath, 'utf8')); } catch {}
  // band resolution: sections.json (resolveBands) → frozen-src-cache section bounds fallback for index tokens
  let bands = null;
  try { if (secReport) bands = resolveBands({ bandsArg: arg('bands'), sectionsPath, secReport }); } catch {}
  if (!bands || !bands.length) {
    const sc = loadSrcCache(source);
    if (!sc) { console.error(`no sections.json AND no frozen src cache for ${source} — run grade-sections once first`); process.exit(2); }
    const bounds = [...sc.sections.filter((y) => y < sc.pageH), sc.pageH];
    const all = [];
    for (let i = 0; i < bounds.length - 1; i++) if (bounds[i + 1] - bounds[i] >= 20) all.push({ idx: i, y0: bounds[i], y1: bounds[i + 1] });
    const tok = arg('bands');
    if (tok) {
      bands = String(tok).split(',').map((t) => {
        t = t.trim();
        if (/^\d+-\d+$/.test(t)) { const [a, b] = t.split('-').map(Number); return { idx: null, y0: a, y1: b }; }
        const hit = all.find((x) => x.idx === Number(t));
        if (!hit) { console.error(`--bands ${t}: not a src-cache section idx (have 0-${all.length - 1})`); process.exit(2); }
        return hit;
      });
    } else bands = all.slice(0, 3);
  }
  if (!bands.length) { console.error('no bands to refine'); process.exit(2); }
  // NO chrome pkill (parallel rounds running — design §7); age-gated sweep only (never --all).
  try { const sw = await sweep({ maxAgeMin: 60 }); if (sw.deleted.length) console.error(`[rvis] swept ${sw.deleted.length} stale scratch page(s)`); } catch {}
  try {
    const report = await refineVision({
      source, pageId: Number(pageId), bands, iters: Number(arg('iters', DEFAULT_ITERS)), apply: has('apply'),
      sectionsPath, secReport, outDir: arg('out', `/tmp/refine-vision/${pageId}`), model: arg('model', 'sonnet'),
      budgetUsd: Number(arg('budget', DEFAULT_BUDGET)), keepScratch: has('keep'),
    });
    console.log(`\n[rvis] ${report.mode.toUpperCase()} — kept ${report.totalKept}/${report.totalCandidates} candidates over ${bands.length} band(s); $${report.costUsd} across ${report.claudeCalls} claude calls; graded page ${report.gradedUntouchedPreApply ? 'UNTOUCHED pre-apply' : 'HASH CHANGED (!)'}${report.apply ? `; apply: ${JSON.stringify({ reverted: report.apply.reverted, compositeBefore: report.apply.compositeBefore, compositeAfter: report.apply.compositeAfter })}` : ''}`);
    console.log(JSON.stringify(report));
    process.exit(0);
  } catch (e) {
    console.error(String(e && e.stack || e));
    process.exit(e instanceof InfraError ? 3 : 1);
  }
})();

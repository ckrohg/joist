#!/usr/bin/env node
/**
 * @purpose heal-loop.mjs — WS2 Arm D: the SELF-HEAL LOOP. Replaces the manual "human reads a failure, hand-codes a
 * fix" loop (the proven root bottleneck) with an automated diagnose → patch-regen → re-score → keep-if-improved loop.
 * Design pressure-tested via /fusion (CONVERGENT). Spine: whole-section PATCH-mode regen seeded with the current HTML +
 * a per-block fix_manifest that LOCKS the already-good blocks and targets only the bad axes; accept only on a GUARDED
 * improvement (composite up AND targeted axis moved AND no axis regressed AND locked blocks intact AND exact-text-once).
 *
 *   diagnose(corr, cloneLeaves) → fix_manifest {locked, targets, targetAxis, touchesText}
 *   accept(prev, next, manifest) → bool        (prev/next = { corr, cloneLeaves })
 *   regenPatch({currentHtml, sourceImagePath, manifest, k, model}) → [htmlCandidate]   (claude -p, K parallel)
 *   healSection({currentHtml, sourceLeaves, sourceSec, sourceImagePath, page, ...}) → {healedHtml, before, after, rounds}
 *
 * The deterministic core (diagnose + accept) is hermetically gated by _heal-loop-selftest.mjs (no network). The live
 * controller (regen→transpile→render→capture→score) is exercised by Arm E's closed-loop validation against the sandbox.
 * v1 scope: desktop, section-local. Lane-A (deterministic native-control patch for pure color/typo/text) is a documented
 * follow-up; v1 routes every fix through the LLM patch.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { textSim } from './correspondence-reward.mjs';

const AXES = ['existence', 'text', 'position', 'color', 'typography'];

// ── DIAGNOSE: correspondence breakdown → fix_manifest (lock good blocks, target ≤3 bad ones) ─────────────────────
// locked = matched clone blocks scoring well (frozen + verified frozen by accept). targets = the worst matched blocks
// (wrong color/position/text/typo) + unmatched source blocks (missing content), capped at 3 — attacking all five axes
// at once destroys what works. Each target carries a precise directive (verbatim text / source hex / structural intent).
export function diagnose(corr, cloneLeaves, { lockComposite = 0.85, lockAxisMin = 0.75, maxTargets = 3 } = {}) {
  const healOf = (cloneIdx) => (cloneLeaves && cloneLeaves[cloneIdx] && cloneLeaves[cloneIdx].healId) || null;
  const locked = [];
  for (const m of corr.matches || []) {
    const minAx = Math.min(m.axes.position ?? 1, m.axes.color ?? 1, m.axes.typography ?? 1, m.textSim ?? 1);
    if ((m.pairScore ?? 0) >= lockComposite && minAx >= lockAxisMin) { const id = healOf(m.cloneIdx); if (id) locked.push({ healId: id, text: m.srcText }); }
  }
  // candidate targets: low-scoring matched pairs + unmatched source blocks.
  const cands = [];
  for (const m of corr.matches || []) {
    if ((m.pairScore ?? 1) >= lockComposite) continue;
    const ax = { text: m.textSim ?? 1, position: m.axes.position ?? 1, color: m.axes.color ?? 1, typography: m.axes.typography ?? 1 };
    const worst = Object.entries(ax).sort((a, b) => a[1] - b[1])[0]; // [axisName, score]
    cands.push({ issue: worst[0] === 'text' ? 'wrong-text' : 'wrong-' + worst[0], axis: worst[0], severity: (1 - worst[1]) * Math.sqrt(Math.max(1, (m.srcBox?.w || 50) * (m.srcBox?.h || 20))), srcText: m.srcText, box: m.srcBox, currentHealId: healOf(m.cloneIdx), directive: null });
  }
  // WRONG-CONTENT-IN-PLACE: pair each unmatched SOURCE block with the unmatched CLONE block of HIGHEST text-similarity
  // (the present-but-wrong version of the SAME block — "Email for developers" ↔ "Email for everyone" sim≈0.6, vs
  // "Documentation" sim≈0.1 — within a loose band). Fix it IN PLACE by referencing the wrong TEXT (heal-ids land on the
  // Elementor widget wrapper, not the captured text leaf, so they're unreliable here). Leftover source = truly missing.
  const uClonePool = [...(corr.unmatchedClone || [])];
  for (const u of corr.unmatchedSource || []) {
    const sev = 2 * Math.sqrt(Math.max(1, (u.box?.w || 50) * (u.box?.h || 20)));
    let bi = -1, bestSim = 0.30; // require similar-but-wrong (>0.30) within a loose band (clone reflow shifts ny)
    for (let ci = 0; ci < uClonePool.length; ci++) { const c = uClonePool[ci]; if (Math.abs((u.ny ?? 0) - (c.ny ?? 0)) > 0.30) continue; const s = textSim(u.text, c.text || ''); if (s > bestSim) { bestSim = s; bi = ci; } }
    if (bi >= 0) { const c = uClonePool.splice(bi, 1)[0]; cands.push({ issue: 'wrong-text', axis: 'text', severity: sev, srcText: u.text, box: u.box, currentHealId: c.healId, cloneText: c.text, directive: null }); }
    else cands.push({ issue: 'missing', axis: 'existence', severity: sev, srcText: u.text, box: u.box, fg: u.fg, typo: u.typo, directive: null });
  }
  cands.sort((a, b) => b.severity - a.severity);
  const targets = cands.slice(0, maxTargets).map((t) => ({ ...t, directive: directiveFor(t) }));
  // the dominant low axis (for accept's "targeted axis moved" check) + whether any target touches text/existence.
  const axisVotes = {}; for (const t of targets) axisVotes[t.axis] = (axisVotes[t.axis] || 0) + t.severity;
  const targetAxis = Object.entries(axisVotes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'existence';
  const touchesText = targets.some((t) => t.issue === 'missing' || t.issue === 'wrong-text');
  return { locked, targets, targetAxis, touchesText };
}

function directiveFor(t) {
  const bb = t.box ? `bbox≈{${Math.round(t.box.x)},${Math.round(t.box.y)},${Math.round(t.box.w)},${Math.round(t.box.h)}}` : '';
  switch (t.issue) {
    case 'missing': return `[EXISTENCE] Add the text "${t.srcText}" exactly once, ${bb}${t.fg ? ' color=' + t.fg : ''}${t.typo ? ' typo=' + (t.typo.size || '') + '/' + (t.typo.weight || '') : ''}. Match approximate position/role/color/typography; do not invent other copy.`;
    case 'wrong-text': return `[TEXT] Find the block currently showing "${(t.cloneText || '').slice(0, 50)}"${t.currentHealId ? ' (class heal-' + t.currentHealId + ')' : ''} and change its text to exactly "${t.srcText}". Replace THAT text only — do NOT add a new element, move it, restyle, or paraphrase.`;
    case 'wrong-color': return `[COLOR] Recolor block heal-${t.currentHealId} ("${(t.srcText || '').slice(0, 24)}") toward the source color. Change foreground/background only; geometry and text frozen.`;
    case 'wrong-position': return `[POSITION] Reposition block heal-${t.currentHealId} ("${(t.srcText || '').slice(0, 24)}") to ${bb} via parent layout/spacing (display/gap/padding/margin/width/align). Keep its text, color, typography unchanged.`;
    case 'wrong-typography': return `[TYPOGRAPHY] Fix typography of block heal-${t.currentHealId} ("${(t.srcText || '').slice(0, 24)}")${t.typo ? ' to ' + (t.typo.size || '') + 'px/' + (t.typo.weight || '') : ''}. Change font props only; do not move or rewrite.`;
    default: return `[FIX] ${t.srcText}`;
  }
}

// ── ACCEPT: guarded improvement (the anti-Goodhart gate). prev/next = { corr, cloneLeaves }. ─────────────────────
// composite must rise AND the targeted axis must actually move AND no axis regressed AND locked blocks verified intact
// AND (if text was targeted) the exact source text appears once. A color-only target accepting a color-only gain is
// CORRECT — gaming is blocked structurally (no-regress + locked-intact + the reward's own visibility pre-filter).
export function accept(prev, next, manifest, { minGain = 2, minAxisMove = 0.05, maxAxisRegress = 0.06 } = {}) { // regress tol 0.06: render-pipeline isn't pixel-deterministic, so a genuine fix mustn't be rejected by position wobble (fusion: start loose, tighten)
  const pc = prev.corr, nc = next.corr;
  if ((nc.score - pc.score) < minGain) return { ok: false, why: 'no composite gain' };
  const moved = (nc.axes[manifest.targetAxis] - pc.axes[manifest.targetAxis]) >= minAxisMove || recoveredBlocks(prev, next) >= 1;
  if (!moved) return { ok: false, why: 'targeted axis did not move' };
  for (const ax of AXES) if ((pc.axes[ax] - nc.axes[ax]) > maxAxisRegress) return { ok: false, why: `axis ${ax} regressed` };
  if ((pc.R_text - nc.R_text) > 0.001) return { ok: false, why: 'text recall dropped' };
  if (!lockedIntact(prev.cloneLeaves, next.cloneLeaves, manifest.locked)) return { ok: false, why: 'a locked block drifted' };
  if (manifest.touchesText) { const t = (manifest.targets.find((x) => x.issue === 'missing' || x.issue === 'wrong-text') || {}).srcText; if (t && countText(next.cloneLeaves, t) !== 1) return { ok: false, why: 'targeted text not present exactly once' }; }
  return { ok: true, gain: +(nc.score - pc.score).toFixed(2) };
}
function recoveredBlocks(prev, next) { const had = new Set((prev.corr.unmatchedSource || []).map((u) => u.text)); const still = new Set((next.corr.unmatchedSource || []).map((u) => u.text)); let r = 0; for (const t of had) if (!still.has(t)) r++; return r; }
function leafById(leaves, id) { return (leaves || []).find((n) => n.healId === id); }
function lockedIntact(prevLeaves, nextLeaves, locked) {
  for (const lk of locked || []) {
    const a = leafById(prevLeaves, lk.healId), b = leafById(nextLeaves, lk.healId);
    if (!b) return false; if (!a) continue;
    if ((a.text || '') !== (b.text || '')) return false;
    if (a.box && b.box) { const dx = Math.abs(a.box.x - b.box.x), dy = Math.abs(a.box.y - b.box.y); if (dx > Math.max(6, a.box.w * 0.03) || dy > Math.max(6, a.box.h * 0.03)) return false; }
  }
  return true;
}
function countText(leaves, text) { const norm = (t) => (t || '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' '); const n = norm(text); return (leaves || []).filter((l) => norm(l.text) === n).length; }

// ── REGEN (patch mode): claude -p authors K patched section HTMLs, frozen-locked + targeted directives ───────────
const PATCH_PROMPT = (sourceImagePath, currentHtml, manifest) => `You are repairing an existing Elementor-compatible HTML/CSS section. MODE: PATCH ONLY — return ONE complete, valid <section> (HTML + inline <style>), no prose, no markdown fence.

Read the TARGET section image (the ground truth): ${sourceImagePath}

CURRENT section HTML (each source-derived block carries a class heal-<id> — KEEP these classes):
${currentHtml}

LOCKED blocks — DO NOT change their text, position, color, or typography (keep the heal-<id> class):
${manifest.locked.map((l) => `  - heal-${l.healId}: "${(l.text || '').slice(0, 40)}"`).join('\n') || '  (none)'}

CHANGE ONLY these (leave everything else byte-identical):
${manifest.targets.map((t) => '  ' + t.directive).join('\n')}

RULES: keep all locked text verbatim; do not invent marketing copy; do not remove matched source content; prefer CSS/layout edits over structural rewrites; every block keeps its heal-<id> class. Output ONLY the <section>...</section>.`;

function extractHtml(s) { if (!s) return null; const m = String(s).match(/<section[\s\S]*<\/section>/i) || String(s).match(/<html[\s\S]*<\/html>/i) || String(s).match(/<body[\s\S]*<\/body>/i); return m ? m[0] : (String(s).includes('<') ? String(s) : null); }
function authorOnce(sourceImagePath, currentHtml, manifest, { model = 'sonnet', timeoutMs = 180000 } = {}) {
  return new Promise((resolve) => {
    let child = null; const hard = setTimeout(() => { try { if (child) child.kill('SIGKILL'); } catch {} resolve({ ok: false, error: 'hard-timeout' }); }, timeoutMs + 30000); hard.unref();
    child = execFile('claude', ['-p', PATCH_PROMPT(path.resolve(sourceImagePath), currentHtml, manifest), '--model', model, '--output-format', 'json', '--allowedTools', 'Read', '--max-budget-usd', '0.40', '--strict-mcp-config', '--setting-sources', ''],
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, cwd: '/tmp' }, (err, stdout) => {
        clearTimeout(hard); if (err && !stdout) return resolve({ ok: false, error: 'exec:' + String(err && err.message || err).slice(0, 60) });
        let outer = null; try { outer = JSON.parse(stdout); } catch {} if (!outer) return resolve({ ok: false, error: 'outer-parse' });
        const html = extractHtml(outer.result); resolve(html ? { ok: true, html, cost: +outer.total_cost_usd || 0 } : { ok: false, error: 'no-html-in-result' });
      });
    child.on('error', () => resolve({ ok: false, error: 'spawn' }));
  });
}
export async function regenPatch({ currentHtml, sourceImagePath, manifest, k = 3, model = 'sonnet' }) {
  const runs = await Promise.all(Array.from({ length: k }, () => authorOnce(sourceImagePath, currentHtml, manifest, { model })));
  const ok = runs.filter((r) => r.ok);
  if (!ok.length) console.error(`[regen] 0/${k} candidates (model=${model}) — reasons: ${runs.map((r) => r.error || 'ok').join(', ')}`); // diagnostic: why no candidates
  return ok.map((r) => ({ html: r.html, cost: r.cost || 0 }));
}

// ── CONTROLLER: render→capture→score the current HTML, loop diagnose→regen→accept (≤maxRounds) ───────────────────
// scoreFn(html) → { corr, cloneLeaves } is INJECTED (the live impl renders+captures+scores; the selftest stubs it) so
// the controller is testable without the sandbox. Returns the best HTML and the before/after correspondence.
export async function healSection({ currentHtml, scoreFn, regenFn = regenPatch, target = 86, maxRounds = 2, k = 3, model = 'sonnet', sourceImagePath, log = () => {} }) {
  let cur = await scoreFn(currentHtml); const before = cur.corr.score; let rounds = 0, cost = 0;
  while (rounds < maxRounds && cur.corr.score < target) {
    rounds++;
    const manifest = diagnose(cur.corr, cur.cloneLeaves);
    if (!manifest.targets.length) { log(`round ${rounds}: nothing to target`); break; }
    log(`round ${rounds}: target ${manifest.targetAxis} (${manifest.targets.length} blocks), score ${cur.corr.score}`);
    const cands = await regenFn({ currentHtml, sourceImagePath, manifest, k, model });
    cost += cands.reduce((a, c) => a + (c.cost || 0), 0);
    let best = null;
    for (const c of cands) { let nx; try { nx = await scoreFn(c.html); } catch (e) { log(`  cand: scoreFn error (${e.message})`); continue; } const a = accept(cur, nx, manifest); log(`  cand: ${cur.corr.score}→${nx.corr.score} accept=${a.ok ? 'YES +' + a.gain : 'no (' + a.why + ')'}`); if (a.ok && (!best || nx.corr.score > best.nx.corr.score)) best = { html: c.html, nx, gain: a.gain }; }
    if (!best) { log(`round ${rounds}: no candidate passed the accept gate → stop`); break; }
    log(`round ${rounds}: accepted +${best.gain} → ${best.nx.corr.score}`);
    currentHtml = best.html; cur = best.nx;
  }
  return { healedHtml: currentHtml, before: +before.toFixed(2), after: +cur.corr.score.toFixed(2), rounds, cost: +cost.toFixed(4), improved: cur.corr.score > before + 0.001 };
}

const IS_MAIN = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (IS_MAIN) console.log('heal-loop.mjs — library (diagnose/accept/regenPatch/healSection). Hermetic gate: _heal-loop-selftest.mjs; live loop: Arm E.');

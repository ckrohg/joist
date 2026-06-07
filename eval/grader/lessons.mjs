#!/usr/bin/env node
/**
 * @purpose The defect->lesson FLYWHEEL (the mechanism that shrinks build cycles). Two modes:
 *
 *   --audit   : run every lesson's automated GUARD against the build artifacts (capture / IR /
 *               --dry tree) BEFORE deploy. A guard asserts a fixed defect class can't regress.
 *               This is the key lever: known issues are caught for FREE pre-deploy, so you don't
 *               spend a deploy+grade cycle rediscovering a defect you already solved.
 *
 *   --classify: map a fresh grade's defect strings (grader-v2 report.json / dynamic-report.json /
 *               committee verdicts.json) to the ledger. Each defect is a RECURRENCE (matches a
 *               'fixed' lesson -> regression! apply the known rule) or NEW (no lesson -> candidate).
 *
 * Usage:
 *   node lessons.mjs --audit [--capture capfx.json] [--ir ir.json] [--tree ir-build-tree.json]
 *   node lessons.mjs --classify report1.json report2.json ...
 */
import fs from 'fs';
const here = new URL('.', import.meta.url).pathname;
const ledger = JSON.parse(fs.readFileSync(here + 'lessons.json', 'utf8'));
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const load = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const l1 = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const rgbOf = (s) => { const m = (s || '').match(/(\d+)\D+(\d+)\D+(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
const walk = (e, fn) => { if (!e) return; fn(e); (e.elements || []).forEach((c) => walk(c, fn)); };

// ---- GUARD EVALUATORS: return {ok, detail} or {skip:reason} when inputs are missing ----
const GUARDS = {
  'no-text-color-near': (g, A) => {
    if (!A.capture) return { skip: 'no --capture' };
    const bad = (A.capture.els || []).filter((e) => e.paint && e.paint.kind === 'solid' && e.text && rgbOf(e.paint.value) && l1(rgbOf(e.paint.value), g.rgb) <= (g.l1 || 60));
    return { ok: bad.length === 0, detail: bad.length ? `${bad.length} text els still near rgb(${g.rgb}) e.g. "${(bad[0].text || '').slice(0, 28)}"` : `0 text els near the fallback color` };
  },
  'pills-emitted': (g, A) => {
    if (!A.capture || !A.tree) return { skip: 'needs --capture + --tree' };
    const op = (c) => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent' && !/,\s*0\)\s*$/.test(c);
    const captured = (A.capture.els || []).filter((e) => e.type === 'button' && op(e.bg)).length;
    let emitted = 0; walk(A.tree, (e) => { if (e.widgetType === 'button' && e.settings && e.settings.background_color) emitted++; });
    const ratio = captured ? emitted / captured : 1;
    return { ok: ratio >= (g.minRatio || 0.8), detail: `${emitted} pill widgets emitted / ${captured} captured pills (ratio ${ratio.toFixed(2)})` };
  },
  'no-fullbleed-image-widget': (g, A) => {
    if (!A.capture || !A.tree) return { skip: 'needs --capture + --tree' };
    const vw = A.capture.vw || 1440; const fb = (A.capture.els || []).filter((e) => e.type === 'image' && e.box && e.box.w >= vw * (g.vwFrac || 0.7)).length;
    let bgC = 0; walk(A.tree, (e) => { if (e.settings && e.settings.background_image) bgC++; });
    return { ok: fb === 0 ? true : bgC >= Math.ceil(fb * 0.7), detail: `${fb} full-bleed images captured -> ${bgC} background-image containers in tree` };
  },
  'gradient-text-preserved': (g, A) => {
    if (!A.ir) return { skip: 'no --ir' };
    const grad = (A.ir.styleClasses || []).filter((s) => s.paint && s.paint.kind === 'gradient-text').length;
    return { ok: true, detail: `${grad} gradient-text style-classes preserved as gradients (info)` };
  },
  'hover-keys-present': (g, A) => {
    if (!A.tree) return { skip: 'no --tree' };
    let hov = 0; walk(A.tree, (e) => { if (e.settings && Object.keys(e.settings).some((k) => /hover/i.test(k))) hov++; });
    return { ok: hov > 0, detail: `${hov} elements carry hover keys` };
  },
  'perf-budget': (g, A) => {
    if (!A.perf) return { skip: 'no --perf report' };
    const c = A.perf.clone || {}; const errs = (c.consoleErrors || 0) + (c.pageErrors || 0);
    if (g.maxConsoleErrors != null) return { ok: errs <= g.maxConsoleErrors, detail: `clone console+JS errors ${errs} (budget ${g.maxConsoleErrors})` };
    if (g.maxLcpMs != null) return { ok: (c.lcp || 0) <= g.maxLcpMs, detail: `clone LCP ${c.lcp}ms (budget ${g.maxLcpMs}ms)` };
    return { skip: 'perf-budget: no threshold' };
  },
  'a11y-budget': (g, A) => {
    if (!A.a11y) return { skip: 'no --a11y report' }; const c = A.a11y.clone || {};
    if (g.maxNoAltRatio != null) { const ratio = c.images ? c.noAlt / c.images : 0; return { ok: ratio <= g.maxNoAltRatio, detail: `${c.noAlt}/${c.images} images missing alt (budget ${g.maxNoAltRatio})` }; }
    if (g.minLandmarks != null) return { ok: (c.landmarks || 0) >= g.minLandmarks, detail: `${c.landmarks} semantic landmarks (need ${g.minLandmarks})` };
    return { skip: 'a11y-budget: no threshold' };
  },
  'interaction-presence': (g, A) => {
    if (!A.interaction) return { skip: 'no --interaction report' }; const s = A.interaction.source || {}, c = A.interaction.clone || {};
    if ((s.reactive || 0) < 2) return { ok: true, detail: 'source has <2 reactive triggers (n/a)' };
    return { ok: (c.reactive || 0) >= (s.reactive || 0) * 0.5, detail: `clone ${c.reactive} reactive / source ${s.reactive}` };
  },
  'responsive-clean': (g, A) => {
    if (!A.responsive) return { skip: 'no --responsive report' };
    return { ok: (A.responsive.hard_fails || []).length === 0, detail: `${A.responsive.clean_widths}/${A.responsive.total_widths} widths clean` };
  },
  'seo-budget': (g, A) => {
    if (!A.seo) return { skip: 'no --seo report' }; const d = A.seo.dims || {};
    return { ok: (A.seo.hard_fails || []).length === 0, detail: `meta ${d.meta} social ${d.social} structured ${d.structured}` };
  },
  'fidelity-budget': (g, A) => {
    if (!A.fidelity) return { skip: 'no --fidelity report' }; const v = (A.fidelity.dims || {})[g.dim];
    return { ok: v == null ? true : v >= (g.min || 0.5), detail: `${g.dim} ${v} (min ${g.min})` };
  },
  'manual': () => ({ skip: 'manual lesson (no auto-guard)' }),
};

if (has('tips')) { // surface the Elementor build-it-right-first-time knowledge (optionally --topic <t>)
  const t = arg('topic', null); const tips = (ledger.elementor_tips || []).filter((x) => !t || x.topic === t);
  console.log(`ELEMENTOR BUILD TIPS${t ? ' [' + t + ']' : ''} (${tips.length}):\n`);
  tips.forEach((x) => console.log(`  [${x.topic}] ${x.tip}`));
  process.exit(0);
}

const A = { capture: load(arg('capture', '/tmp/capfx-final.json')), ir: load(arg('ir', '/tmp/ir-final.json')), tree: load(arg('tree', '/tmp/ir-build-tree.json')), perf: load(arg('perf', '/tmp/perf/perf-report.json')), a11y: load(arg('a11y', '/tmp/a11y/a11y-report.json')), responsive: load(arg('responsive', '/tmp/resp/responsive-report.json')), interaction: load(arg('interaction', '/tmp/inter/interaction-report.json')), seo: load(arg('seo', '/tmp/seo/seo-report.json')), fidelity: load(arg('fidelity', '/tmp/fid/fidelity-report.json')) };

// helper used by classify + learn
const ALL = () => [...ledger.lessons, ...ledger.candidates];
const matchLesson = (d) => ALL().find((L) => (L.defect_match || []).some((m) => { try { return new RegExp(m, 'i').test(d); } catch { return d.toLowerCase().includes(m.toLowerCase()); } }));
const collectDefects = (paths) => { const out = []; for (const p of paths) { const j = load(p); if (!j) continue; for (const k of ['defects', 'confirmed_defects', 'all_defects']) if (Array.isArray(j[k])) out.push(...j[k]); } return out; };

// ---- --learn: SELF-UPDATING ledger (autonomy core). Auto-files unseen defects as candidate
// lessons, tracks lifecycle (seen/recurred/first_seen/last_seen), and auto-escalates a 'fixed'
// lesson back to 'regressed' when its defect reappears. Persists the ledger back to disk. ----
if (has('learn')) {
  const reports = process.argv.slice(process.argv.indexOf('--learn') + 1).filter((p) => !p.startsWith('--'));
  const defects = collectDefects(reports);
  if (!defects.length) { console.error('no defects in', reports.join(', ')); process.exit(2); }
  const now = arg('now', new Date().toISOString().slice(0, 10));
  const STOP = new Set(['clone', 'source', 'text', 'element', 'elements', 'where', 'with', 'that', 'this', 'have', 'than', 'from', 'into', 'about', 'their', 'still', 'likely', 'e.g.', 'page']);
  const sig = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 5 && !STOP.has(w));
  const touch = (L) => { L.seen = (L.seen || 0) + 1; L.first_seen = L.first_seen || now; L.last_seen = now; };
  let regressions = 0, recurOpen = 0, staleDeploy = 0; const filed = []; const byNew = {}; const seenFixed = new Set();
  for (const d of defects) {
    const L = matchLesson(d);
    if (L) {
      touch(L);
      if (L.status === 'fixed') {
        if (seenFixed.has(L.id)) continue; seenFixed.add(L.id);
        // TRUE regression only if the build-artifact guard ALSO fails (builder reproduces it).
        // Guard passes/skips but live grade shows it → STALE DEPLOY (page not rebuilt), not a code regression.
        const g = L.guard || { type: 'manual' }; const gr = (GUARDS[g.type] || GUARDS.manual)(g, A);
        if (gr.ok === false) { L.status = 'regressed'; L.recurred = (L.recurred || 0) + 1; regressions++; }
        else staleDeploy++;
      } else recurOpen++;
    }
    else {
      const words = sig(d); const sg = words.slice(0, 3).join('-') || 'misc';
      if (byNew[sg]) { byNew[sg].seen++; continue; }
      const cand = { id: 'AUTO-' + sg.slice(0, 24), title: 'AUTO-FILED: ' + d.slice(0, 60), defect_match: words.slice(0, 3), root_cause: 'AUTO-FILED — needs diagnosis', builder_rule: 'TBD', guard: { type: 'manual' }, status: 'open', seen: 1, first_seen: now, last_seen: now, example: d.slice(0, 140) };
      byNew[sg] = cand; ledger.candidates.push(cand); filed.push(cand);
    }
  }
  fs.writeFileSync(here + 'lessons.json', JSON.stringify(ledger, null, 2));
  console.log(`LEARN: ingested ${defects.length} defects from ${reports.length} report(s).`);
  console.log(`  ${regressions} REGRESSION(s) (fixed lesson + guard now fails), ${staleDeploy} stale-deploy (fixed in builder, live page not rebuilt), ${recurOpen} known-open recurrence(s), ${filed.length} NEW candidate(s) auto-filed.`);
  if (filed.length) filed.forEach((c) => console.log(`    + ${c.id}: ${c.example}`));
  // prioritized worklist: regressed first, then open by frequency
  const work = ALL().filter((L) => L.status === 'regressed' || L.status === 'open').sort((a, b) => (b.status === 'regressed') - (a.status === 'regressed') || (b.recurred || 0) - (a.recurred || 0) || (b.seen || 0) - (a.seen || 0));
  console.log('\nWORKLIST (what to fix next, highest priority first):');
  work.slice(0, 12).forEach((L) => console.log(`  [${(L.status || 'open').toUpperCase()}${L.recurred ? ' x' + L.recurred : ''}${L.seen ? ' seen' + L.seen : ''}] ${L.id} — ${L.builder_rule}`));
  process.exit(0);
}

if (has('audit')) {
  console.log('LESSON GUARD AUDIT (pre-deploy regression check) — inputs:',
    ['capture', 'ir', 'tree', 'perf'].filter((k) => A[k]).join(', ') || 'NONE');
  let pass = 0, regress = 0, openGap = 0, skip = 0; const byId = {};
  for (const L of [...ledger.lessons, ...ledger.candidates]) {
    const g = L.guard || { type: 'manual' }; const r = (GUARDS[g.type] || GUARDS.manual)(g, A); const fixed = L.status === 'fixed';
    let state; if (r.skip) { skip++; state = 'skip'; } else if (r.ok) { pass++; state = 'pass'; } else if (fixed) { regress++; state = 'regression'; } else { openGap++; state = 'open-gap'; }
    byId[L.id] = { state, detail: r.detail || r.skip };
    if (!has('json')) { const icon = { skip: '·', pass: '✓', regression: '✗', 'open-gap': '⚠' }[state]; console.log(`  ${icon}  ${L.id.padEnd(28)} ${state.toUpperCase().padEnd(11)} ${r.detail || r.skip || ''}${state === 'regression' ? '\n       rule: ' + L.builder_rule : ''}`); }
  }
  if (has('json')) { console.log(JSON.stringify({ pass, regress, openGap, skip, byId }, null, 2)); process.exit(regress ? 1 : 0); }
  console.log(`\n${regress ? '❌' : '✅'} ${pass} pass, ${regress} REGRESSION(s), ${openGap} open gap(s), ${skip} skipped.`);
  if (regress) console.log('REGRESSION = a defect class you already solved came back. Fix BEFORE deploying — no cycle should be spent rediscovering it.');
  else console.log('No regressions. Open gaps are expected work, not failures.');
  process.exit(regress ? 1 : 0); // gate fails ONLY on regressions of fixed lessons
}

if (has('classify')) {
  const reports = process.argv.slice(process.argv.indexOf('--classify') + 1).filter((p) => !p.startsWith('--'));
  const defects = [];
  for (const p of reports) { const j = load(p); if (!j) continue; if (Array.isArray(j.defects)) defects.push(...j.defects); if (Array.isArray(j.confirmed_defects)) defects.push(...j.confirmed_defects); if (Array.isArray(j.all_defects)) defects.push(...j.all_defects); }
  if (!defects.length) { console.error('no defects found in', reports.join(', ')); process.exit(2); }
  const all = [...ledger.lessons, ...ledger.candidates];
  const match = (d) => all.find((L) => (L.defect_match || []).some((m) => { try { return new RegExp(m, 'i').test(d); } catch { return d.toLowerCase().includes(m.toLowerCase()); } }));
  const recur = [], fresh = [];
  for (const d of defects) { const L = match(d); if (L) recur.push({ d, L }); else fresh.push(d); }
  console.log(`DEFECT CLASSIFICATION (${defects.length} defects across ${reports.length} reports):\n`);
  const byLesson = {}; recur.forEach(({ d, L }) => (byLesson[L.id] = byLesson[L.id] || { L, ds: [] }).ds.push(d));
  console.log('— RECURRENCES (known lesson; apply its rule — should NOT need a fresh diagnosis):');
  for (const { L, ds } of Object.values(byLesson)) console.log(`  [${L.status === 'fixed' ? 'REGRESSION' : 'open'}] ${L.id}: ${ds.length} defect(s)\n     rule: ${L.builder_rule}`);
  if (!Object.keys(byLesson).length) console.log('  (none)');
  console.log('\n— NEW (no lesson yet; candidate lessons to add after root-causing):');
  fresh.slice(0, 15).forEach((d) => console.log('  •', d.slice(0, 100)));
  if (!fresh.length) console.log('  (none — every defect maps to a known lesson)');
  console.log(`\nsummary: ${recur.length} recurrences, ${fresh.length} new. New defects are where the next learning is.`);
  process.exit(0);
}

console.error('usage: node lessons.mjs --audit [--capture --ir --tree] | --classify <report.json...>');
process.exit(2);

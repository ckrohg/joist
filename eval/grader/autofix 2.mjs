#!/usr/bin/env node
/**
 * @purpose L5 auto-fix DRIVER (FLYWHEEL_AUTONOMY.md). Closes the loop: it selects the next
 * actionable lesson from the prioritized worklist, presents the agent everything needed to make
 * the fix (root cause, builder rule, target file, verify command), and — after the fix — VERIFIES
 * via the lesson's guard and flips the lesson to 'fixed'. The agent writes the code; this driver
 * sequences and verifies deterministically. (Full no-human auto-fix = the driver invoking codegen,
 * the frontier above this.)
 *
 *   --next                      pick + present the next actionable fix task
 *   --resolve <id> [--file f]   re-run the lesson's guard; if it passes, mark fixed (record file)
 *   --list                      show the full actionable worklist
 *
 * Verification shells `node lessons.mjs --audit --json` so it uses the SAME guards as the gate.
 */
import fs from 'fs';
import { execFileSync } from 'child_process';
const here = new URL('.', import.meta.url).pathname;
const LP = here + 'lessons.json';
const ledger = JSON.parse(fs.readFileSync(LP, 'utf8'));
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const ALL = () => [...ledger.lessons, ...ledger.candidates];
const concrete = (L) => L.builder_rule && !/^TBD/i.test(L.builder_rule.trim());
const pendingVerify = () => ALL().filter((L) => L.status === 'implemented'); // code done, awaiting live regrade
const actionable = () => ALL().filter((L) => (L.status === 'open' || L.status === 'regressed') && concrete(L) && !L.resolves_with)
  .sort((a, b) => (b.status === 'regressed') - (a.status === 'regressed') || (b.recurred || 0) - (a.recurred || 0) || (b.seen || 0) - (a.seen || 0));
const audit = () => { try { const o = execFileSync('node', [here + 'lessons.mjs', '--audit', '--json'], { encoding: 'utf8' }); return JSON.parse(o); } catch (e) { try { return JSON.parse((e.stdout || '').toString()); } catch { return null; } } };

if (has('list')) {
  const w = actionable();
  console.log(`ACTIONABLE WORKLIST (${w.length} lessons with a concrete rule):\n`);
  w.forEach((L, i) => console.log(`  ${i + 1}. [${(L.status || 'open').toUpperCase()}${L.recurred ? ' x' + L.recurred : ''}${L.seen ? ' seen' + L.seen : ''}] ${L.id} — ${L.title}`));
  const blocked = ALL().filter((L) => (L.status === 'open' || L.status === 'regressed') && !concrete(L));
  if (blocked.length) { console.log(`\nBLOCKED (need diagnosis first — rule is TBD): ${blocked.map((b) => b.id).join(', ')}`); }
  const pend = pendingVerify();
  if (pend.length) { console.log(`\nPENDING LIVE VERIFY (code done, confirm on next redeploy+grade): ${pend.map((b) => b.id).join(', ')}`); }
  process.exit(0);
}

if (has('resolve')) {
  const id = arg('resolve'); const file = arg('file', null);
  const L = ALL().find((x) => x.id === id); if (!L) { console.error('no lesson', id); process.exit(2); }
  const res = audit(); const st = res && res.byId[id];
  if (!st) { console.error('could not audit', id); process.exit(2); }
  if (st.state === 'pass') {
    L.status = 'fixed'; if (file) L.fixed_in = file; L.last_seen = arg('now', new Date().toISOString().slice(0, 10));
    fs.writeFileSync(LP, JSON.stringify(ledger, null, 2));
    console.log(`✓ ${id} VERIFIED FIXED (guard passes: ${st.detail})${file ? ' — fixed_in ' + file : ''}. Ledger updated.`);
    process.exit(0);
  }
  if (st.state === 'skip') { console.log(`· ${id}: guard can't verify (${st.detail}). Need the relevant report (rebuild+grade) or it's a manual lesson. NOT marked fixed.`); process.exit(1); }
  console.log(`✗ ${id} NOT fixed yet — guard still fails: ${st.detail}\n   rule: ${L.builder_rule}`); process.exit(1);
}

// default: --next
const w = actionable();
if (!w.length) { console.log('No actionable lessons (worklist empty or all remaining are TBD/manual). Run eval-all to learn more, or diagnose a TBD lesson.'); process.exit(0); }
const L = w[0];
const res = audit(); const st = res && res.byId[L.id];
console.log('═══════════════ NEXT FIX TASK ═══════════════');
console.log(`lesson:     ${L.id}  [${(L.status || 'open').toUpperCase()}${L.recurred ? ' regressed x' + L.recurred : ''}${L.seen ? ', seen ' + L.seen + 'x' : ''}]`);
console.log(`defect:     ${L.title}`);
console.log(`root cause: ${L.root_cause}`);
console.log(`FIX (rule): ${L.builder_rule}`);
console.log(`target:     ${L.fixed_in || '(unknown — search the builder: build-ir-elementor.mjs / capture-fx.mjs / build-ir.mjs)'}`);
console.log(`guard:      ${L.guard && L.guard.type !== 'manual' ? L.guard.type + (st ? '  [currently: ' + st.state + (st.detail ? ' — ' + st.detail : '') + ']' : '') : 'manual (no auto-verify — confirm by re-grading)'}`);
console.log(`verify:     node autofix.mjs --resolve ${L.id} --file <edited-file>   (re-runs the guard; flips to fixed on pass)`);
console.log('──────────────────────────────────────────────');
console.log(`${w.length} actionable lessons remain (node autofix.mjs --list). Fix this one → verify → re-run --next.`);

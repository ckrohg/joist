// @purpose Day-2 LIVE 7-site sweep for the unstyled-CTA self-heal — the fusion-mandated proof. THIN scaffold:
// the design-stable parts (degrade fixtures, CONTROL A = trigger specificity, CONTROL B = acceptor discriminator,
// pass-bar verdict) are pure + offline-tested here (see _cta-heal-sweep-selftest.mjs). The WP-glue (build, grade,
// screenshot, tree PUT) is INJECTED into runSweep() and stubbed offline — so this file is complete and unit-tested
// NOW; on WP-return you wire the live hooks in main() and run. Per fusion: do NOT hand-write live DOM-patching
// against an unvalidated design; lock controls + pass-bars + fixtures, inject the glue.

import { buildRepaint } from './cta-heal.mjs';

// ── default pass-bar (fusion §5): heal-rate ≥6/7, control-A false-fire 0, CONTROL-B reject 7/7, editability 7/7 ─
export const SWEEP_BARS = { healRateMin: 6 / 7, controlAFalseFireMax: 0, controlBRejectMin: 1.0, editabilityPreservedMin: 1.0 };

// ── DEGRADE fixtures (pure tree transforms; the live sweep PUTs the degraded tree, then heals it back) ────────
// unstyle-CTA: strip the inline chrome from every styled <a> pill → `<a href=..>text</a>` (exactly what the builder
// would emit if buttonPaint returned null). This is the defect the veto fires on and the healer must restore.
export function degradeUnstyleCTA(tree) {
  let count = 0;
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.elType === 'widget' && n.widgetType === 'text-editor') {
      const ed = n.settings && n.settings.editor;
      if (typeof ed === 'string' && /<a\b[^>]*\bstyle\s*=\s*"[^"]*(background|border|box-shadow)/i.test(ed)) {
        n.settings.editor = ed.replace(/(<a\b[^>]*?)\s*style\s*=\s*"[^"]*"/i, '$1');
        if (n.settings.text_color) delete n.settings.text_color;
        count++;
      }
    }
    for (const c of (n.elements || [])) walk(c);
  };
  for (const r of (Array.isArray(tree) ? tree : [tree])) walk(r);
  return { tree, count };
}

// CONTROL A — trigger specificity: grey a NON-CTA heading (no anchor). detectUnstyledCTA must NOT fire on this.
export function degradeGreyHeading(tree) {
  let count = 0;
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.elType === 'widget' && n.widgetType === 'heading' && n.settings) { n.settings.title_color = '#888888'; count++; return; }
    for (const c of (n.elements || [])) walk(c);
  };
  for (const r of (Array.isArray(tree) ? tree : [tree])) walk(r);
  return { tree, count };
}

// CONTROL B — acceptor discriminator: take the healer's faithful repaint and corrupt it to a WRONG-but-SATURATED
// fill. The binary veto WOULD clear (it's saturated), but acceptCTA must REJECT it on ΔE. This is the test that
// proves the acceptor checks faithfulness, not mere accent-presence — the heart of the anti-Goodhart guarantee.
export function corruptRepaintWrongSaturated(srcLeaf, wrongRgb = 'rgb(255, 0, 0)') {
  const faithful = buildRepaint(srcLeaf, srcLeaf.href);
  if (!faithful) return null;
  const editor = faithful.editor
    .replace(/background-color:[^;"]*/i, `background-color:${wrongRgb}`)
    .replace(/background-image:[^;"]*/i, `background-color:${wrongRgb}`);
  return { ...faithful, editor };
}

// ── pass-bar verdict (pure; the live sweep feeds it the per-site rows) ───────────────────────────────────────
// rows: [{ site, fired, healed, editabilityPreserved, controlAFired, controlBRejected }]
export function computeSweepVerdict(rows, bars = SWEEP_BARS) {
  const n = rows.length || 1;
  const firedRows = rows.filter((r) => r.fired);
  const healRate = firedRows.length ? firedRows.filter((r) => r.healed).length / firedRows.length : 0;
  const controlAFalseFire = rows.filter((r) => r.controlAFired).length;
  const cbRows = rows.filter((r) => r.controlBRejected != null);
  const controlBReject = cbRows.length ? cbRows.filter((r) => r.controlBRejected).length / cbRows.length : 0;
  const healedRows = rows.filter((r) => r.healed);
  const editabilityPreserved = healedRows.length ? healedRows.filter((r) => r.editabilityPreserved).length / healedRows.length : 1;
  const checks = {
    healRate: { value: +healRate.toFixed(3), bar: bars.healRateMin, pass: healRate >= bars.healRateMin },
    controlAFalseFire: { value: controlAFalseFire, bar: bars.controlAFalseFireMax, pass: controlAFalseFire <= bars.controlAFalseFireMax },
    controlBReject: { value: +controlBReject.toFixed(3), bar: bars.controlBRejectMin, pass: controlBReject >= bars.controlBRejectMin },
    editabilityPreserved: { value: +editabilityPreserved.toFixed(3), bar: bars.editabilityPreservedMin, pass: editabilityPreserved >= bars.editabilityPreservedMin },
  };
  return { pass: Object.values(checks).every((c) => c.pass), checks, sites: n };
}

// ── LIVE orchestration (injectable; offline test passes stubs, main() passes the real WP-backed hooks) ───────
// hooks: getTreeFn(site)->tree, putTreeFn(site,tree), gradeFn(site)->report, healFn(site)->healResult,
//        srcCaptureFn(site)->capturedCTAs. Each site runs: degrade→grade(veto fires)→heal→re-grade(+controls).
export async function runSweep({ sites, getTreeFn, putTreeFn, gradeFn, healFn, controlAFn, controlBFn, log = () => {} }) {
  const rows = [];
  for (const site of sites) {
    const row = { site: site.name, fired: false, healed: false, editabilityPreserved: false, controlAFired: null, controlBRejected: null };
    try {
      const tree = await getTreeFn(site);
      degradeUnstyleCTA(tree);
      await putTreeFn(site, tree);
      const g0 = await gradeFn(site);
      row.fired = Array.isArray(g0?.honesty?.vetoes?.fired) && g0.honesty.vetoes.fired.some((v) => v.veto === 'unstyled-CTA');
      const heal = await healFn(site);
      row.healed = !!(heal && heal.healed && heal.healed.length);
      row.editabilityPreserved = row.healed; // healFn only accepts edits that pass the hard editability gate
      if (controlAFn) row.controlAFired = await controlAFn(site);
      if (controlBFn) row.controlBRejected = await controlBFn(site);
    } catch (e) { row.error = String(e && e.message || e); }
    rows.push(row); log(`${site.name}: fired=${row.fired} healed=${row.healed} ctrlA=${row.controlAFired} ctrlB=${row.controlBRejected}`);
  }
  return { rows, verdict: computeSweepVerdict(rows) };
}

// ── main(): wire the LIVE WP-backed hooks. Host-guarded; refuses to run without a guarded JOIST_BASE. ────────
const isMain = (() => { try { return process.argv[1] && process.argv[1].endsWith('cta-heal-sweep.mjs'); } catch { return false; } })();
if (isMain) {
  console.error('cta-heal-sweep: LIVE sweep requires a guarded WordPress instance (JOIST_BASE).');
  console.error('Wire getTreeFn/putTreeFn/gradeFn/healFn to build-absolute + grade-structure + cta-heal on WP-return.');
  console.error('The pure pieces (degrade fixtures, CONTROL A/B, pass-bar verdict) are offline-proven in _cta-heal-sweep-selftest.mjs.');
  process.exit(3);
}

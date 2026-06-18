#!/usr/bin/env node
/**
 * @purpose ALWAYS-WORKS FLOOR metrics (motor-cortex reframe, ratified 2026-06-16). Pure aggregation over the
 * corpus's per-site grade reports that surfaces the WORST CASE as first-class numbers alongside corpus-run's
 * existing means: the corpus MINIMUM (composite + per-dim), the VETO-RATE (fraction of sites the grader
 * HARD-CAPPED), and a per-cap breakdown. Optimizing the minimum + veto-rate (not the mean ~0.705) makes a
 * reliable substrate the objective — a 70%-but-always-valid clone beats a 90%-mean-but-1-in-5-broken one
 * (the "build robots that always work" half of the Agility/Paxton post; see memory motor-cortex-floor-lens).
 * roundtripSurvival is RESERVED here (null = not-yet-measured, never faked) for the live-editor
 * open->edit->save->reopen gate (motor-cortex move (1)). Pure (no IO/navigation) so it is unit-testable:
 * _floor-metrics-selftest.mjs.
 */

// Cap CATEGORIES a single grade report tripped, derived from the grader's structured fields
// (grade-structure.mjs report shape: honesty.vetoes.fired / honesty.frozenCoverageCap / midwidth.caps).
// [] = the page tripped no hard cap (it "always works" at the floor level).
export function capCategories(r) {
  const cats = [];
  for (const f of (r?.honesty?.vetoes?.fired || [])) cats.push(f.veto);          // wrong-logo | invisible-heading | broken-hero | unstyled-CTA
  if (r?.honesty?.frozenCoverageCap?.capped) cats.push('frozen-coverage');        // preserve-dominated clone -> capped
  for (const c of (r?.midwidth?.caps || [])) cats.push(String(c).split('(')[0]);  // cliff | amputation | mobileH (responsive breakage)
  return cats;
}

const round3 = (n) => (Number.isFinite(n) ? +n.toFixed(3) : null);
const minOf = (rows, f) => { const v = rows.map(f).filter((x) => Number.isFinite(x)); return v.length ? round3(Math.min(...v)) : null; };

// okRows = graded sites only (composite != null); each row = the parsed report.json merged with { name }.
// Mirrors how corpus-run.mjs builds `ok`. Returns the alwaysWorksFloor sub-report.
export function computeFloor(okRows) {
  const ok = Array.isArray(okRows) ? okRows : [];
  const respOk = ok.filter((r) => r.responsive != null);
  const worst = ok.length ? ok.reduce((w, r) => (r.composite < w.composite ? r : w)) : null;
  // Were veto detectors actually RUN this grade? (honesty present + not disabled.) If not, veto-rate is
  // null (UNKNOWN), never 0 — silently reporting 0 when GRADER_NO_VETOES=1 would be a dishonest floor.
  const vetoesMeasured = ok.some((r) => r.honesty && r.honesty.vetoes && !r.honesty.vetoes.disabled);
  const vetoed = ok.filter((r) => capCategories(r).length);
  const tally = {};
  for (const r of ok) for (const c of capCategories(r)) tally[c] = (tally[c] || 0) + 1;
  const vetoBreakdown = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([veto, sites]) => ({ veto, sites }));
  return {
    graded: ok.length,
    min: {
      composite: minOf(ok, (r) => r.composite), worst: worst ? worst.name : null,
      visual: minOf(ok, (r) => r.visual), editability: minOf(ok, (r) => r.editability), responsive: minOf(respOk, (r) => r.responsive),
    },
    vetoRate: vetoesMeasured && ok.length ? round3(vetoed.length / ok.length) : null,
    vetoesMeasured,
    vetoedSites: vetoed.map((r) => r.name),
    vetoBreakdown,
    roundtripSurvival: null, // PENDING the live-editor round-trip gate (motor-cortex move (1)); null = not measured, NEVER faked.
  };
}

// Human-readable console lines (array of strings) — keeps corpus-run's floor formatting in one place.
export function formatFloor(floor) {
  if (!floor || !floor.graded) return [];
  const L = [];
  L.push('----- ALWAYS-WORKS FLOOR (worst-case — the motor-cortex number, not the mean) -----');
  L.push(`MIN composite ${floor.min.composite ?? 'ERR'}${floor.min.worst ? ` (worst: ${floor.min.worst})` : ''} | min visual ${floor.min.visual ?? '-'}  edit ${floor.min.editability ?? '-'}  resp ${floor.min.responsive ?? '-'}`);
  if (floor.vetoRate == null) L.push('VETO-RATE n/a (veto detectors not run this grade — GRADER_NO_VETOES / GRADER_NO_HONESTYGATE)');
  else {
    L.push(`VETO-RATE ${floor.vetoRate} (${floor.vetoedSites.length}/${floor.graded} sites hard-capped)${floor.vetoedSites.length ? ' → ' + floor.vetoedSites.join(', ') : ''}`);
    if (floor.vetoBreakdown.length) L.push('  by cap: ' + floor.vetoBreakdown.map((v) => `${v.veto}×${v.sites}`).join('  '));
  }
  L.push('ROUNDTRIP-SURVIVAL n/a — pending the live-editor round-trip gate (motor-cortex move (1))');
  return L;
}

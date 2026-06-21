// @purpose The PRE-PREVIEW GATE — Direction-A's spine (Emergent-style "gate-before-preview QA"). It is the outer
// routing layer that turns isolated self-heal loops into a DEPLOYABLE control: run the catastrophic-static
// detectors, route each fired defect to its registered healer, re-check, and decide PUBLISH vs HOLD. Nothing is
// surfaced to a user until the gate says publish (or heal-attempts are exhausted → explicit hold).
//
// DESIGN (fusion-locked, CONVERGENT 2026-06-20): the gate is BINARY and THRESHOLD-FREE. It owns ZERO acceptor
// thresholds (CIEDE2000 / IoU / crop-SSIM live inside each loop's own accept predicate, which already reverts on
// reject). The gate consumes only (a) the binary fired-veto list from runVetoes and (b) each loop's explicit
// {accepted, healed, unresolved} verdict, and its sole bar is the calibration-INDEPENDENT veto-floor: ZERO
// catastrophic-static vetoes fired after heal. This is exactly why the gate is invariant to the still-pending
// live threshold calibration. The continuous corpus-min bar is a flagged TODO (corpusMinBar) that DEFAULTS to the
// binary floor and is wired only after the hash-bound Block-Match reward (C3) lands. `liveValidated` rides on every
// decision as METADATA (not a third outcome — decisions stay publish/hold) and forbids CLAIMING a floor lift until
// the 7-site live sweep passes. Pure + offline-testable on synthetic reports (see _gate-selftest.mjs).

// ── read the binary fired-veto list off a grade-structure report (the only detector signal the gate consumes) ─
export function firedVetoes(report) {
  const fired = report && report.honesty && report.honesty.vetoes && report.honesty.vetoes.fired;
  return Array.isArray(fired) ? fired : [];
}

// ── plugin contract (derived from what cta-heal.healUnstyledCTA actually RETURNS, not a speculated API) ───────
// A plugin = { veto, liveValidated, async heal(ctx) -> { healed:[], accepted:bool, unresolved:[] } }.
// Adapter for the CTA loop: healUnstyledCTA returns { healed, rejected, refused, unmatched, nullPaint };
// `accepted` = at least one CTA was healed; `unresolved` = everything it could not safely fix (rejected/refused/
// null-paint/unmatched). The gate never inspects thresholds — it trusts the loop's own accept/revert verdict and
// lets the authoritative re-check decide whether the binary veto actually cleared.
export function ctaHealPlugin(healFn, { liveValidated = false } = {}) {
  return {
    veto: 'unstyled-CTA', liveValidated,
    async heal(ctx) {
      const r = await healFn(ctx);
      const unresolved = [...(r.rejected || []), ...(r.refused || []), ...(r.nullPaint || []), ...(r.unmatched || [])];
      return { healed: r.healed || [], accepted: (r.healed || []).length > 0, unresolved, raw: r };
    },
  };
}

function decision(kind, actions, report, registry, extra = {}) {
  // liveValidated = every registered plugin is live-validated (none are until the WP sweep passes) → metadata only.
  const plugins = registry ? Object.values(registry) : [];
  const liveValidated = plugins.length > 0 && plugins.every((p) => p.liveValidated === true);
  return { decision: kind, actions, liveValidated, fired: firedVetoes(report).map((v) => v.veto), ...extra };
}

// ── the gate. hooks: { healCtx, recheck } — recheck() re-grades AFTER heals and is AUTHORITATIVE for "did the veto
// clear" (and catches any NEW catastrophic-static veto the heal introduced = post-heal collateral). Both injected;
// offline tests stub them, the live run wires recheck → grade-structure and healCtx → the real WP page handle. ──
export async function gate(report, registry = {}, hooks = {}) {
  const { healCtx = {}, recheck = null, corpusMinBar = null, correspondence = null, enforceCorpusBar = false } = hooks;
  const fired = firedVetoes(report);

  // 1. clean → publish immediately.
  if (!fired.length) return decision('publish', [], report, registry);

  // 2. any fired veto with NO registered healer → cannot address → HOLD (never publish a known defect).
  const unhandled = fired.filter((v) => !registry[v.veto]);
  if (unhandled.length) {
    return decision('hold', unhandled.map((v) => ({ veto: v.veto, action: 'no-healer' })), report, registry,
      { reason: `no healer for: ${unhandled.map((v) => v.veto).join(', ')}` });
  }

  // 3. route each fired defect to its healer (independently). A healer that THROWS → HOLD (never publish on crash).
  const actions = [];
  for (const v of fired) {
    const plugin = registry[v.veto];
    let res;
    try { res = await plugin.heal(healCtx); }
    catch (e) { return decision('hold', actions.concat([{ veto: v.veto, action: 'heal-threw', error: String((e && e.message) || e) }]), report, registry, { reason: 'a healer crashed' }); }
    actions.push({ veto: v.veto, action: res.accepted ? 'healed' : 'no-accept', healed: res.healed, unresolved: res.unresolved });
  }

  // 4. AUTHORITATIVE re-check: re-grade after heals. The floor bar is binary + calibration-independent — PUBLISH
  //    iff ZERO catastrophic-static vetoes fire on the fresh report (this also catches post-heal collateral that
  //    manifests as a new/different fired veto). No re-check available → conservative HOLD (cannot confirm clear).
  if (!recheck) return decision('hold', actions, report, registry, { reason: 'no recheck → cannot confirm veto cleared' });
  const after = await recheck();
  const stillFired = firedVetoes(after);
  if (stillFired.length) {
    return decision('hold', actions.concat(stillFired.map((v) => ({ veto: v.veto, action: 'still-fired-after-heal' }))), after, registry,
      { reason: `post-heal vetoes remain: ${stillFired.map((v) => v.veto).join(', ')}` });
  }

  // 5. binary veto-floor cleared. The CONTINUOUS correspondence bar is INERT BY DEFAULT (metadata only). M1 plumbing,
  //    fusion-locked 2026-06-20: `correspondence` (a number or async fn → the gradeCorrespondence score of the
  //    after-state) is attached for observability on EVERY decision, but it ENFORCES a hold ONLY when
  //    `enforceCorpusBar` is explicitly ON. Per G5 it consumes the CORRESPONDENCE score — NOT grade-structure's
  //    composite (that stays the headline/ceiling metric), so the gate never creates two competing publish signals.
  //    The enforce flip waits on M2: the offline archetype gate-readiness battery PASSES (_correspondence-xval-corpus.mjs,
  //    4 archetypes, catastrophic-last) but the multi-SITE pooled-Spearman-vs-vision correlation is still WP/data-gated —
  //    do NOT set enforceCorpusBar=true until that lands, else a hard publish decision leans on single-site evidence.
  let extra = {};
  if (correspondence != null) {
    const score = typeof correspondence === 'function' ? await correspondence(after) : correspondence;
    extra.corpusBar = { score, bar: corpusMinBar, enforced: !!enforceCorpusBar };
    if (enforceCorpusBar && corpusMinBar != null && typeof score === 'number' && score < corpusMinBar) {
      return decision('hold', actions, after, registry, { reason: `corpusBar ${score} < ${corpusMinBar} (correspondence)`, ...extra });
    }
  }
  return decision('publish', actions, after, registry, extra);
}

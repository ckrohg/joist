#!/usr/bin/env node
// @purpose Hermetic offline gate for gate.mjs (the pre-preview Direction-A spine). Synthetic detector reports +
// stubbed heal/recheck hooks — no WordPress. Exercises every fusion-named routing case and proves the gate is
// BINARY + THRESHOLD-FREE (it never inspects an acceptor threshold; it routes on fired-vetoes + loop verdicts +
// the authoritative re-check). Run: node _gate-selftest.mjs  (exit 0 = all pass).

import { gate, firedVetoes, ctaHealPlugin } from './gate.mjs';

let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; fails.push(name); console.error(`  ✗ ${name} ${extra}`); } };

// synthetic grade reports
const clean = { composite: 0.82, honesty: { vetoes: { fired: [] } } };
const ctaFired = { composite: 0.40, honesty: { vetoes: { fired: [{ veto: 'unstyled-CTA', severity: 0.6 }] } } };
const logoFired = { composite: 0.40, honesty: { vetoes: { fired: [{ veto: 'wrong-logo', severity: 0.7 }] } } };
const twoFired = { composite: 0.35, honesty: { vetoes: { fired: [{ veto: 'unstyled-CTA', severity: 0.6 }, { veto: 'invisible-heading', severity: 0.7 }] } } };

// stub healers (the gate trusts these verdicts; thresholds live inside the real loops, never here)
const healOK = async () => ({ healed: [{ id: 'cta1', text: 'Get started' }], rejected: [], refused: [], unmatched: [], nullPaint: [] });
const healRejected = async () => ({ healed: [], rejected: [{ id: 'cta1', why: 'paint[bgΔE]' }], refused: [], unmatched: [], nullPaint: [] });
const healThrows = async () => { throw new Error('patch exhausted CAS retries'); };
const registryCTA = { 'unstyled-CTA': ctaHealPlugin(healOK) };

(async () => {
  // 0. firedVetoes reader
  ok('firedVetoes: empty on clean', firedVetoes(clean).length === 0);
  ok('firedVetoes: reads fired list', firedVetoes(ctaFired).length === 1 && firedVetoes(ctaFired)[0].veto === 'unstyled-CTA');

  // 1. clean report → publish (no heal needed)
  const r1 = await gate(clean, registryCTA, { recheck: async () => clean });
  ok('clean → publish', r1.decision === 'publish' && r1.actions.length === 0);

  // 2. CTA fired + heal succeeds + recheck clears → publish
  const r2 = await gate(ctaFired, registryCTA, { recheck: async () => clean });
  ok('CTA fired + healed + recheck-clear → publish', r2.decision === 'publish' && r2.actions[0].action === 'healed');

  // 3. CTA fired + heal accepted BUT recheck still shows the veto → hold (recheck is authoritative)
  const r3 = await gate(ctaFired, registryCTA, { recheck: async () => ctaFired });
  ok('CTA healed but veto persists on recheck → hold', r3.decision === 'hold' && /still-fired-after-heal/.test(JSON.stringify(r3.actions)));

  // 4. CTA fired + heal REJECTED (loop reverted) + recheck still fired → hold
  const r4 = await gate(ctaFired, { 'unstyled-CTA': ctaHealPlugin(healRejected) }, { recheck: async () => ctaFired });
  ok('CTA heal rejected → hold', r4.decision === 'hold' && r4.actions[0].action === 'no-accept');

  // 5. a fired veto with NO registered healer → hold (cannot address), and heals are not even attempted
  const r5 = await gate(logoFired, registryCTA, { recheck: async () => clean });
  ok('unhandled veto (no healer) → hold', r5.decision === 'hold' && r5.actions[0].action === 'no-healer' && /wrong-logo/.test(r5.reason));

  // 6. two defects fired → each routed independently; both must clear for publish
  const reg2 = { 'unstyled-CTA': ctaHealPlugin(healOK), 'invisible-heading': { veto: 'invisible-heading', liveValidated: false, heal: async () => ({ healed: [{ id: 'h1' }], accepted: true, unresolved: [] }) } };
  const r6 = await gate(twoFired, reg2, { recheck: async () => clean });
  ok('two defects routed independently + cleared → publish', r6.decision === 'publish' && r6.actions.length === 2);
  // ...but if ONE has no healer, the whole gate holds (never attempted, defect remains)
  const r6b = await gate(twoFired, registryCTA, { recheck: async () => clean });
  ok('two defects, one unhandled → hold', r6b.decision === 'hold' && /invisible-heading/.test(r6b.reason));

  // 7. a healer that THROWS → hold (never publish on crash)
  const r7 = await gate(ctaFired, { 'unstyled-CTA': ctaHealPlugin(healThrows) }, { recheck: async () => clean });
  ok('healer throws → hold (no publish on crash)', r7.decision === 'hold' && /heal-threw/.test(JSON.stringify(r7.actions)));

  // 8. post-heal COLLATERAL: heal cleared the CTA veto but introduced a NEW veto → recheck catches it → hold
  const collateral = { composite: 0.42, honesty: { vetoes: { fired: [{ veto: 'invisible-heading', severity: 0.6 }] } } };
  const r8 = await gate(ctaFired, registryCTA, { recheck: async () => collateral });
  ok('post-heal new veto (collateral) → hold', r8.decision === 'hold' && /invisible-heading/.test(r8.reason));

  // 9. no recheck hook → conservative hold (cannot confirm the veto cleared)
  const r9 = await gate(ctaFired, registryCTA, {});
  ok('no recheck → conservative hold', r9.decision === 'hold' && /cannot confirm/.test(r9.reason));

  // 10. liveValidated METADATA: false while the CTA plugin is not live-validated; never a third routing outcome
  ok('liveValidated=false rides on publish (CTA not yet live-proven)', r2.liveValidated === false && (r2.decision === 'publish' || r2.decision === 'hold'));
  const regLive = { 'unstyled-CTA': ctaHealPlugin(healOK, { liveValidated: true }) };
  const r10 = await gate(ctaFired, regLive, { recheck: async () => clean });
  ok('liveValidated=true only when all plugins live-proven', r10.liveValidated === true && r10.decision === 'publish');

  // 11. THRESHOLD-FREE guard: the gate ships no acceptor-threshold constants (CIEDE2000/IoU/SSIM live in the loops)
  const src = (await import('node:fs')).readFileSync(new URL('./gate.mjs', import.meta.url), 'utf8');
  ok('gate owns no acceptor thresholds', !/CIEDE|deltaE|IoU|\bSSIM\b|0\.68|0\.45\b/.test(src.replace(/\/\/.*$/gm, '')), 'found a threshold token in gate.mjs code');

  // 12. CONTINUOUS correspondence bar (M1 inert plumbing): INERT BY DEFAULT — correspondence score is attached as
  //     METADATA but does NOT gate unless enforceCorpusBar is explicitly ON. Consumes the correspondence score (G5),
  //     never grade-structure's composite. The enforce flip waits on the WP-gated multi-site correlation.
  const cleared = async () => ({ composite: 0.50, honesty: { vetoes: { fired: [] } } });
  const r12 = await gate(ctaFired, registryCTA, { recheck: cleared, correspondence: 55, corpusMinBar: 70 });           // enforce OFF (default)
  ok('corpusBar INERT by default → publish + score attached as metadata', r12.decision === 'publish' && r12.corpusBar && r12.corpusBar.score === 55 && r12.corpusBar.enforced === false);
  const r12b = await gate(ctaFired, registryCTA, { recheck: cleared });
  ok('no correspondence hook → no corpusBar metadata → publish', r12b.decision === 'publish' && r12b.corpusBar === undefined);
  const r12c = await gate(ctaFired, registryCTA, { recheck: cleared, correspondence: 55, corpusMinBar: 70, enforceCorpusBar: true });
  ok('corpusBar ENFORCED (opt-in) → holds a sub-bar correspondence score', r12c.decision === 'hold' && /corpusBar 55 < 70 \(correspondence\)/.test(r12c.reason));
  const r12d = await gate(ctaFired, registryCTA, { recheck: cleared, correspondence: async () => 82, corpusMinBar: 70, enforceCorpusBar: true });
  ok('corpusBar ENFORCED + score≥bar (async fn) → publish', r12d.decision === 'publish' && r12d.corpusBar.score === 82);
  // G5 guard: the bar must consume correspondence, NOT the grade-structure composite (composite 0.50 must be irrelevant)
  ok('G5: composite does NOT gate (only correspondence does)', (await gate(ctaFired, registryCTA, { recheck: cleared, correspondence: 90, corpusMinBar: 70, enforceCorpusBar: true })).decision === 'publish');

  console.log(`\ngate selftest: ${pass} passed, ${fail} failed` + (fail ? ` [${fails.join('; ')}]` : ''));
  process.exit(fail ? 1 : 0);
})();

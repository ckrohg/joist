#!/usr/bin/env node
// @purpose Offline gate for the DESIGN-STABLE parts of the live sweep (cta-heal-sweep.mjs): the degrade fixtures,
// CONTROL A / CONTROL B injectors, and the pass-bar verdict — proven with synthetic trees + stubbed hooks, no WP.
// This is what makes the live sweep a one-command run on WP-return instead of a half-day of authoring.
// Run: node _cta-heal-sweep-selftest.mjs

import { acceptCTA } from './cta-heal.mjs';
import { degradeUnstyleCTA, degradeGreyHeading, corruptRepaintWrongSaturated, computeSweepVerdict, runSweep, SWEEP_BARS } from './cta-heal-sweep.mjs';

let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; fails.push(name); console.error(`  ✗ ${name} ${extra}`); } };

const styledTree = () => [{ elType: 'container', id: 's1', elements: [
  { elType: 'widget', id: 'cta1', widgetType: 'text-editor', settings: { editor: '<a href="https://x/signup" style="display:inline-block;background-color:rgb(108, 71, 255);border-radius:8px;padding:10px 20px 10px 20px">Get started</a>', text_color: 'rgb(255, 255, 255)' } },
  { elType: 'widget', id: 'h1', widgetType: 'heading', settings: { title: 'Welcome', title_color: '#111111' } },
] }];
const srcLeaf = { kind: 'button', tag: 'a', text: 'Get started', href: 'https://x/signup', paint: { kind: 'solid', value: 'rgb(255,255,255)' }, bg: 'rgb(108, 71, 255)', bgImage: null, border: null, btnPad: ['10px', '20px', '10px', '20px'], radius: '8px', boxShadow: null, interactive: { role: 'button' }, box: { x: 1200, y: 24, w: 130, h: 44 } };

// ── 1. degradeUnstyleCTA strips inline chrome (and text_color) → bare anchor (the veto-firing defect) ─────────
const t1 = styledTree(); const d1 = degradeUnstyleCTA(t1);
const cta = t1[0].elements[0];
ok('degradeUnstyleCTA: counted 1', d1.count === 1);
ok('degradeUnstyleCTA: style stripped', !/style=/.test(cta.settings.editor) && /<a href="https:\/\/x\/signup"\s*>Get started<\/a>/.test(cta.settings.editor), cta.settings.editor);
ok('degradeUnstyleCTA: text_color removed', cta.settings.text_color === undefined);
ok('degradeUnstyleCTA: heading untouched', t1[0].elements[1].settings.title_color === '#111111');

// ── 2. CONTROL A — grey a heading, do NOT touch any CTA ──────────────────────────────────────────────────────
const t2 = styledTree(); const d2 = degradeGreyHeading(t2);
ok('degradeGreyHeading: greyed 1 heading', d2.count === 1 && t2[0].elements[1].settings.title_color === '#888888');
ok('degradeGreyHeading: CTA pill untouched', /background-color:rgb\(108, 71, 255\)/.test(t2[0].elements[0].settings.editor));

// ── 3. CONTROL B — corrupt the repaint to wrong-but-saturated; acceptCTA must REJECT it ──────────────────────
const wrong = corruptRepaintWrongSaturated(srcLeaf, 'rgb(255, 0, 0)');
ok('corruptRepaint: produced wrong saturated fill', !!wrong && /background-color:rgb\(255, 0, 0\)/.test(wrong.editor));
const wrongWidget = { id: 'cta1', widgetType: 'text-editor', settings: wrong };
const cbVerdict = acceptCTA({ srcLeaf, patchedWidget: wrongWidget, srcBox: srcLeaf.box, cloneBox: srcLeaf.box });
ok('CONTROL B: acceptor REJECTS wrong-saturated repaint', cbVerdict.ok === false && /paint/.test(cbVerdict.why), cbVerdict.why);

// ── 4. pass-bar verdict: a clean 7-site result PASSES; each individual breach FAILS the right check ──────────
const good = Array.from({ length: 7 }, (_, i) => ({ site: `s${i}`, fired: true, healed: true, editabilityPreserved: true, controlAFired: false, controlBRejected: true }));
ok('verdict: clean 7/7 passes', computeSweepVerdict(good).pass === true);
const oneFail = good.map((r, i) => i === 0 ? { ...r, healed: false } : r);  // 6/7 healed = exactly at bar
ok('verdict: 6/7 heal-rate still passes (bar=6/7)', computeSweepVerdict(oneFail).checks.healRate.pass === true);
const twoFail = good.map((r, i) => i < 2 ? { ...r, healed: false } : r);     // 5/7 < bar
ok('verdict: 5/7 heal-rate FAILS', computeSweepVerdict(twoFail).checks.healRate.pass === false && computeSweepVerdict(twoFail).pass === false);
const ctrlAbreach = good.map((r, i) => i === 0 ? { ...r, controlAFired: true } : r);
ok('verdict: any control-A false-fire FAILS', computeSweepVerdict(ctrlAbreach).checks.controlAFalseFire.pass === false);
const ctrlBbreach = good.map((r, i) => i === 0 ? { ...r, controlBRejected: false } : r);
ok('verdict: control-B not-rejected-everywhere FAILS', computeSweepVerdict(ctrlBbreach).checks.controlBReject.pass === false);
const editBreach = good.map((r, i) => i === 0 ? { ...r, editabilityPreserved: false } : r);
ok('verdict: editability not preserved FAILS', computeSweepVerdict(editBreach).checks.editabilityPreserved.pass === false);

// ── 5. runSweep end-to-end with STUBBED hooks (proves the orchestration shape; live hooks swap in on WP-return) ─
(async () => {
  const sites = [{ name: 'tailwind' }, { name: 'supabase' }, { name: 'resend' }];
  const res = await runSweep({
    sites,
    getTreeFn: async () => styledTree(),
    putTreeFn: async () => {},
    gradeFn: async () => ({ honesty: { vetoes: { fired: [{ veto: 'unstyled-CTA', severity: 0.6 }] } } }), // veto fires after degrade
    healFn: async () => ({ healed: [{ id: 'cta1', text: 'Get started' }], rejected: [] }),
    controlAFn: async () => false,         // CONTROL A: veto did NOT fire on greyed heading
    controlBFn: async () => true,          // CONTROL B: acceptor rejected the wrong paint
  });
  ok('runSweep: 3 rows produced', res.rows.length === 3);
  ok('runSweep: all fired + healed', res.rows.every((r) => r.fired && r.healed));
  ok('runSweep: stubbed verdict PASSES', res.verdict.pass === true);

  console.log(`\ncta-heal-sweep selftest: ${pass} passed, ${fail} failed` + (fail ? ` [${fails.join('; ')}]` : ''));
  process.exit(fail ? 1 : 0);
})();

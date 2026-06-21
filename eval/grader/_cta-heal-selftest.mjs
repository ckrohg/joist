#!/usr/bin/env node
// @purpose Hermetic OFFLINE gate for the step-1 unstyled-CTA self-heal (cta-heal.mjs + cta-paint.mjs).
// No WordPress, no network, no render — exercises the pure trigger/localize/repaint/accept functions with the
// three fusion-mandated fixtures: (1) degrade->trigger->heal->accept happy path, (2) CONTROL A trigger
// specificity (a styled clone CTA must NOT fire the veto), (3) CONTROL B acceptor discriminator (a wrong-but-
// SATURATED repaint must be REJECTED even though the binary veto would clear — the anti-Goodhart proof).
// Run:  node _cta-heal-selftest.mjs    (exit 0 = all pass; exit 1 = any fail).

import { runVetoes } from './veto-detectors.mjs';
import { buttonPaint } from './cta-paint.mjs';
import {
  deltaE2000, parseColor, buildRepaint, acceptCTA, triggerFired, localizeCTAs, editabilityOk, healUnstyledCTA, buildCtaPaintLedger,
} from './cta-heal.mjs';

let pass = 0, fail = 0; const fails = [];
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; fails.push(name); console.error('  ✗ ' + name); } };

// ── a representative styled source CTA leaf (purple pill, white text — the resend/supabase shape) ─────────────
const srcLeaf = {
  kind: 'button', tag: 'a', text: 'Get started', href: 'https://example.com/signup',
  paint: { kind: 'solid', value: 'rgb(255, 255, 255)' },
  typo: { family: 'Inter', size: 16, weight: 600 },
  box: { x: 1200, y: 24, w: 130, h: 44 },
  bg: 'rgb(108, 71, 255)', bgImage: null, border: null,
  btnPad: ['10px', '20px', '10px', '20px'], radius: '8px', boxShadow: null,
  interactive: { role: 'button' },
};
const repaint = buildRepaint(srcLeaf, srcLeaf.href);
const goodWidget = { id: 'cta1', widgetType: 'text-editor', settings: repaint };
const srcBox = srcLeaf.box;

// ── 0. ΔE2000 sanity (the faithfulness metric must separate right paint from wrong-but-saturated) ────────────
ok('ΔE identical = 0', deltaE2000(parseColor('#6c47ff'), parseColor('#6c47ff')) < 0.01);
ok('ΔE black/white large', deltaE2000(parseColor('#000'), parseColor('#fff')) > 50);
ok('ΔE purple/red > BG_DE(8)', deltaE2000(parseColor('rgb(108,71,255)'), parseColor('rgb(255,0,0)')) > 8);
ok('ΔE purple/near-purple < BG_DE', deltaE2000(parseColor('#6c47ff'), parseColor('#6d48ff')) < 8);

// ── 1. TRIGGER fires on the degraded clone (source styled, clone unstyled) ───────────────────────────────────
const srcCtaRuns = [{ text: 'Get started', fgSat: 0.0, bgSat: 0.62, bgLum: 0.40, hasBg: true }];
const degradedCtaRuns = [{ text: 'Get started', fgSat: 0.0, bgSat: 0.0, bgLum: 0.0, hasBg: false }];
const firedVetoes = runVetoes({ srcCtaRuns, cloneCtaRuns: degradedCtaRuns, tunables: { CEIL: 0.45 } });
ok('trigger: unstyled-CTA fires on degrade', firedVetoes.fired.some((v) => v.veto === 'unstyled-CTA'));
ok('triggerFired reads report.honesty.vetoes.fired', triggerFired({ honesty: { vetoes: { fired: firedVetoes.fired } } }) === true);

// ── 2. CONTROL A — trigger specificity: a styled clone CTA must NOT fire (greying a non-CTA leaves CTA styled) ─
const styledCtaRuns = [{ text: 'Get started', fgSat: 0.0, bgSat: 0.62, bgLum: 0.40, hasBg: true }];
const ctrlA = runVetoes({ srcCtaRuns, cloneCtaRuns: styledCtaRuns, tunables: { CEIL: 0.45 } });
ok('CONTROL A: veto does NOT fire on styled clone', !ctrlA.fired.some((v) => v.veto === 'unstyled-CTA'));
ok('CONTROL A: triggerFired false on clean report', triggerFired({ honesty: { vetoes: { fired: [] } } }) === false);

// ── 3. HAPPY PATH — the deterministic repaint is accepted (paint ΔE≈0, IoU=1, editable, no collateral) ───────
ok('repaint produced (non-null)', !!repaint && /background-color:rgb\(108, 71, 255\)/.test(repaint.editor));
ok('repaint sets native text_color', repaint.text_color === 'rgb(255, 255, 255)');
const happy = acceptCTA({ srcLeaf, patchedWidget: goodWidget, srcBox, cloneBox: srcBox });
ok('happy path ACCEPTED', happy.ok === true);

// ── 4. CONTROL B — acceptor discriminator: wrong-but-SATURATED paint REJECTED though the binary veto clears ──
const wrongWidget = {
  id: 'cta1', widgetType: 'text-editor',
  settings: { editor: '<a href="#" style="display:inline-block;background-color:rgb(255,0,0);border-radius:8px;padding:10px 20px 10px 20px">Get started</a>', text_color: 'rgb(255, 255, 255)' },
};
// the wrong paint is saturated red -> the binary veto WOULD clear (cloneStyled becomes 1):
const wrongCtaRuns = [{ text: 'Get started', fgSat: 0.0, bgSat: 0.72, bgLum: 0.30, hasBg: true }];
const vetoWouldClear = !runVetoes({ srcCtaRuns, cloneCtaRuns: wrongCtaRuns, tunables: { CEIL: 0.45 } }).fired.some((v) => v.veto === 'unstyled-CTA');
const wrongVerdict = acceptCTA({ srcLeaf, patchedWidget: wrongWidget, srcBox, cloneBox: srcBox });
ok('CONTROL B: binary veto WOULD clear on wrong-saturated paint', vetoWouldClear === true);
ok('CONTROL B: acceptor REJECTS wrong paint anyway', wrongVerdict.ok === false && /paint/.test(wrongVerdict.why));

// ── 5. CONTROL B′ — geometry discriminator: correct paint, mislocated widget REJECTED ───────────────────────
const farBox = { x: 1200, y: 2000, w: 500, h: 200 };
const geomVerdict = acceptCTA({ srcLeaf, patchedWidget: goodWidget, srcBox, cloneBox: farBox });
ok('geometry discriminator REJECTS mislocated CTA', geomVerdict.ok === false && /geometry/.test(geomVerdict.why));

// ── 6. EDITABILITY cheat-guard: a raster/embed in the editor is REJECTED (no blob can pass as a CTA) ─────────
const rasterWidget = { id: 'cta1', widgetType: 'text-editor', settings: { editor: '<a href="#" style="background-color:rgb(108,71,255)">Get started<img src="hero.png"></a>', text_color: 'rgb(255,255,255)' } };
ok('editability: forbidden embed rejected', editabilityOk(rasterWidget, 'Get started').ok === false);
ok('editability: non text-editor widget rejected', editabilityOk({ widgetType: 'image', settings: { editor: '' } }, 'Get started').ok === false);

// ── 7. LOCALIZE — single match, refuse-on-ambiguity, bbox disambiguation ─────────────────────────────────────
const mk = (id, text, box) => ({ id, widgetType: 'text-editor', settings: { editor: `<a href="#">${text}</a>` }, box });
const srcCTAs = [{ text: 'Get started', box: srcBox, leaf: srcLeaf }];
ok('localize: single text match', localizeCTAs([mk('w1', 'Get started', srcBox)], srcCTAs).matched.length === 1);
const ambig = localizeCTAs([mk('w1', 'Get started', { x: 1200, y: 24, w: 130, h: 44 }), mk('w2', 'Get started', { x: 1240, y: 30, w: 130, h: 44 })], srcCTAs);
ok('localize: refuse-on-ambiguity (2 within bbox)', ambig.refused.length === 1 && ambig.matched.length === 0);
const disambig = localizeCTAs([mk('near', 'Get started', { x: 1205, y: 26, w: 130, h: 44 }), mk('far', 'Get started', { x: 100, y: 3000, w: 130, h: 44 })], srcCTAs);
ok('localize: bbox picks nearest when others are far', disambig.matched.length === 1 && disambig.matched[0].widget.id === 'near');

// ── 8. NULL-PAINT fail-loud: a non-button-styled leaf yields no repaint (the §6 ancestor-chrome trap) ────────
const bareLeaf = { kind: 'button', tag: 'a', text: 'Learn more', bg: null, bgImage: null, border: null, boxShadow: null, btnPad: null, radius: '0px', interactive: null };
ok('null-paint: bare link yields no repaint (fail-loud)', buildRepaint(bareLeaf) === null);

// ── 9. collateral guard: a non-target band regression is rejected ────────────────────────────────────────────
const collat = acceptCTA({
  srcLeaf, patchedWidget: goodWidget, srcBox, cloneBox: srcBox,
  before: { bands: [0.9, 0.9, 0.9], textCoverage: 0.95, editability: 0.8 },
  after: { bands: [0.9, 0.6, 0.9], textCoverage: 0.95, editability: 0.8 },
  target: { bandIndex: 0 },
});
ok('collateral: non-target band regression rejected', collat.ok === false && /collateral/.test(collat.why));

// ── 10. GOLDEN PIN — lock cta-paint.buttonPaint output (the exact contract the deferred build-absolute swap
//        must reproduce; catches any future drift between the shared paint source and the builder). ───────────
const SOLID_GOLDEN = 'display:inline-block;text-decoration:none;box-sizing:border-box;background-color:rgb(108, 71, 255);border-radius:8px;padding:10px 20px 10px 20px;text-align:center;white-space:nowrap';
ok('golden: solid pill exact', buttonPaint(srcLeaf) === SOLID_GOLDEN);
const gradLeaf = { kind: 'button', tag: 'a', text: 'Get started', bg: null, bgImage: 'linear-gradient(90deg, rgb(255,0,128), rgb(128,0,255))', border: null, btnPad: ['10px', '20px', '10px', '20px'], radius: '8px', boxShadow: null, interactive: { role: 'button' } };
const gradStyle = buttonPaint(gradLeaf);
ok('golden: gradient has bg-image, no bg-color', /background-image:linear-gradient/.test(gradStyle) && !/background-color/.test(gradStyle));
const borderLeaf = { kind: 'button', tag: 'a', text: 'Learn more', bg: null, bgImage: null, border: '1px solid rgb(51, 51, 51)', btnPad: ['8px', '16px', '8px', '16px'], radius: '6px', boxShadow: null, interactive: null };
ok('golden: outlined border preserved', /border:1px solid rgb\(51, 51, 51\)/.test(buttonPaint(borderLeaf)));
const shadowLeaf = { kind: 'button', tag: 'a', text: 'Add React', bg: null, bgImage: null, border: '0px', boxShadow: 'rgba(0, 0, 0, 0.1) 0px 2px 8px 0px', btnPad: ['10px', '24px', '10px', '24px'], radius: '9999px', interactive: null };
const shadowStyle = buttonPaint(shadowLeaf);
ok('golden: shadow-pill synthesizes white + keeps shadow', /background-color:#ffffff/.test(shadowStyle) && /box-shadow:/.test(shadowStyle));

// ── 11. ORCHESTRATOR control flow (OFFLINE, injected fakes): happy / reject+revert / null-paint / refuse / CAS ─
const resp = (status, obj) => { const txt = JSON.stringify(obj); return { ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => txt }; };
function makeFakeWP(tree, { fail409Once = false } = {}) {
  let hash = 'h0'; const patchOps = []; let patchCalls = 0;
  const fetchImpl = async (url, opts) => {
    if (/\/pages\/\d+\?include=elements/.test(url)) return resp(200, { elementor: { elements: tree, hash } });
    if (/\/pages\/\d+\/patch/.test(url)) {
      patchCalls++;
      if (fail409Once && patchCalls === 1) return resp(409, { details: { current_hash: 'h1' } });
      const body = JSON.parse(opts.body); patchOps.push(...body.ops); hash = 'h' + patchCalls;
      return resp(200, { applied_ops: body.ops.length, new_hash: hash });
    }
    return resp(404, {});
  };
  return { fetchImpl, patchOps, getCalls: () => patchCalls };
}
const resolveBaseImpl = (b) => b;                                   // bypass host-guard in the offline test
const ctaTree = (extra = []) => [{ elType: 'container', id: 'sec1', elements: [
  { elType: 'widget', id: 'cta1', widgetType: 'text-editor', settings: { editor: '<a href="https://example.com/signup">Get started</a>', _offset_x: { size: 1200 }, _offset_y: { size: 24 }, _element_custom_width: { size: 130 } } },
  ...extra,
] }];
const srcCTAlist = [{ text: 'Get started', box: srcBox, leaf: srcLeaf }];
const passCrop = async () => ({ ssim: 0.9, exact: 0.6, pre: 0.2, cloneBox: { x: 1200, y: 24, w: 130, h: 44 } });
const failCrop = async () => ({ ssim: 0.2, exact: 0.05, pre: 0.2, cloneBox: { x: 1200, y: 24, w: 130, h: 44 } });

// ── 12. Task-2 sidecar ledger: records post-propagation paint; flags loud nulls (styled-source but null paint) ─
// tagOnlyLeaf: a <button>-tag leaf with no fill → buttonPaint returns null, but styledSource is true (tag) → LOUD.
// bareLeaf: a plain <a> link with no fill → null paint, styledSource false → null but NOT loud (legitimate).
const tagOnlyLeaf = { kind: 'button', tag: 'button', text: 'Submit', bg: null, bgImage: null, border: null, boxShadow: null, btnPad: ['4px', '4px', '4px', '4px'], radius: '0px', interactive: null };
const ledger = buildCtaPaintLedger([srcLeaf, tagOnlyLeaf, bareLeaf]);
ok('ledger: styled CTA records non-null paint', ledger.ctas[0].nullPaint === false && /background-color/.test(ledger.ctas[0].paint));
ok('ledger: <button>-tag no-fill → LOUD null (styledSource + nullPaint)', ledger.loudNulls.length === 1 && ledger.loudNulls[0].text === 'Submit');
ok('ledger: plain <a> link → null paint but NOT loud (not styledSource)', ledger.ctas[2].nullPaint === true && !ledger.loudNulls.some((c) => c.text === 'Learn more'));
ok('ledger: nullPaintCount counts all nulls', ledger.nullPaintCount === 2);

(async () => {
  // O1 — happy path: localize -> patch -> accept -> healed (no revert)
  let wp = makeFakeWP(ctaTree());
  let r = await healUnstyledCTA({ pageId: 1, b64: 'x', srcCTAs: srcCTAlist, renderAndCrop: passCrop, fetchImpl: wp.fetchImpl, resolveBaseImpl });
  ok('orch happy: healed 1, rejected 0', r.healed.length === 1 && r.rejected.length === 0);
  ok('orch happy: single patch, styled', wp.getCalls() === 1 && /background-color:rgb\(108, 71, 255\)/.test(wp.patchOps[0].settings.editor));

  // O2 — reject path: accept fails on crop -> revert to prior settings
  wp = makeFakeWP(ctaTree());
  r = await healUnstyledCTA({ pageId: 1, b64: 'x', srcCTAs: srcCTAlist, renderAndCrop: failCrop, fetchImpl: wp.fetchImpl, resolveBaseImpl });
  const lastOp = wp.patchOps[wp.patchOps.length - 1];
  ok('orch reject: rejected 1, healed 0', r.rejected.length === 1 && r.healed.length === 0);
  ok('orch reject: reverted to prior editor', wp.getCalls() === 2 && lastOp.settings.editor === '<a href="https://example.com/signup">Get started</a>');

  // O3 — null-paint fail-loud: a leaf that LOCALIZES (matching text) but yields no paint -> no patch issued
  const nullLeaf = { ...bareLeaf, text: 'Get started' };          // matches cta1's text, but buttonPaint() -> null
  wp = makeFakeWP(ctaTree());
  r = await healUnstyledCTA({ pageId: 1, b64: 'x', srcCTAs: [{ text: 'Get started', box: srcBox, leaf: nullLeaf }], renderAndCrop: passCrop, fetchImpl: wp.fetchImpl, resolveBaseImpl });
  ok('orch null-paint: nullPaint 1, zero patches', r.nullPaint.length === 1 && wp.getCalls() === 0);

  // O4 — refuse-on-ambiguity: two same-text CTAs within bbox -> refused, zero patches
  const ambigWidget = { elType: 'widget', id: 'cta2', widgetType: 'text-editor', settings: { editor: '<a href="https://example.com/signup">Get started</a>', _offset_x: { size: 1240 }, _offset_y: { size: 30 }, _element_custom_width: { size: 130 } } };
  wp = makeFakeWP(ctaTree([ambigWidget]));
  r = await healUnstyledCTA({ pageId: 1, b64: 'x', srcCTAs: srcCTAlist, renderAndCrop: passCrop, fetchImpl: wp.fetchImpl, resolveBaseImpl });
  ok('orch refuse: refused 1, zero patches', r.refused.length === 1 && wp.getCalls() === 0);

  // O5 — CAS-409 retry: first patch 409 -> re-read hash -> retry 200 -> still heals
  wp = makeFakeWP(ctaTree(), { fail409Once: true });
  r = await healUnstyledCTA({ pageId: 1, b64: 'x', srcCTAs: srcCTAlist, renderAndCrop: passCrop, fetchImpl: wp.fetchImpl, resolveBaseImpl });
  ok('orch CAS: heals after 409 retry (2 calls)', r.healed.length === 1 && wp.getCalls() === 2);

  console.log(`\ncta-heal selftest: ${pass} passed, ${fail} failed` + (fail ? ` [${fails.join('; ')}]` : ''));
  process.exit(fail ? 1 : 0);
})();

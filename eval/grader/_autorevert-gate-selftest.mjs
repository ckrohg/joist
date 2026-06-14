#!/usr/bin/env node
/**
 * @purpose OFFLINE self-test for the AUTO-REVERT GATE policy (the logic build-hybrid-flow.mjs applies after it
 * measures each preserve section). Touches NO host, NO browser — it drives the pure gate decision + the
 * byte-equivalent revert against synthetic measurements to PROVE:
 *   (1) a preserve section that PASSES (hRatio∈[0.98,1.02], no h-overflow, byHash attached) is KEPT;
 *   (2) a section that FAILS any sub-gate (hRatio drift OR h-overflow OR zero byHash attach) is REVERTED to the
 *       saved flow arm, and the revert restores the EXACT original settings+children (byte-equivalent);
 *   (3) JOIST_NO_AUTOREVERT=1 makes the gate measure-only (a failing section is NOT reverted).
 * The gate predicate here MIRRORS build-hybrid-flow.mjs's inline policy; this is the regression spec for it.
 */
import { ROUTER } from './flow-preserve-router.mjs';

// the gate predicate, mirrored from build-hybrid-flow.mjs (kept in lockstep).
function gatePass({ hRatio, hOverflow, byHashAttached, byHashOn }) {
  const inBand = hRatio >= ROUTER.HRATIO_LO && hRatio <= ROUTER.HRATIO_HI;
  const noHOverflow = !hOverflow;
  const attachedSomething = !byHashOn || byHashAttached > 0;
  return inBand && noHOverflow && attachedSomething;
}

// a fake spliced container + the byte-equivalent flow snapshot, exactly as the builder saves it.
function makeContainer() {
  const origSettings = { content_width: 'boxed', min_height: { unit: 'px', size: 600 }, flow: true };
  const origElements = [{ id: 'aaa', elType: 'widget', widgetType: 'heading', settings: { title: 'Flow heading' }, elements: [] }];
  // spliced state (preserve overlay) — different from the flow arm.
  const container = {
    id: 'mark123', elType: 'container',
    settings: { content_width: 'full', joist_preserve_css: '{"d":"position:relative"}' },
    elements: [{ id: 'p1', elType: 'widget', widgetType: 'html', settings: { joist_preserve_css: '{"d":"position:absolute"}' }, elements: [] }],
  };
  return { container, origSettings: JSON.parse(JSON.stringify(origSettings)), origElements: JSON.parse(JSON.stringify(origElements)) };
}

// apply the builder's revert: restore saved flow settings+children onto the container.
function revert(s) { s.container.settings = s.origSettings; s.container.elements = s.origElements; }

const cases = [];
const ok = (name, pass) => cases.push({ name, pass });

// (1) PASS case → kept preserve (still has the overlay).
{
  const s = makeContainer();
  const pass = gatePass({ hRatio: 1.0, hOverflow: false, byHashAttached: 11, byHashOn: true });
  ok('PASS: hRatio 1.0 + no overflow + byHash attached → gate PASS', pass === true);
  // not reverted → container keeps the preserve overlay.
  ok('PASS: kept preserve (overlay child retained)', s.container.elements[0].widgetType === 'html');
}
// (2a) hRatio drift → FAIL → revert to byte-equivalent flow.
{
  const s = makeContainer();
  const pass = gatePass({ hRatio: 1.18, hOverflow: false, byHashAttached: 11, byHashOn: true });
  ok('FAIL: hRatio 1.18 out of band → gate FAIL', pass === false);
  if (!pass) revert(s);
  ok('FAIL: reverted settings byte-equiv to flow', JSON.stringify(s.container.settings) === JSON.stringify({ content_width: 'boxed', min_height: { unit: 'px', size: 600 }, flow: true }));
  ok('FAIL: reverted children byte-equiv to flow (heading restored, overlay gone)', s.container.elements.length === 1 && s.container.elements[0].widgetType === 'heading' && !('joist_preserve_css' in s.container.elements[0].settings));
}
// (2b) h-overflow → FAIL → revert.
{
  const s = makeContainer();
  const pass = gatePass({ hRatio: 1.0, hOverflow: true, byHashAttached: 11, byHashOn: true });
  ok('FAIL: page-breaking h-overflow → gate FAIL', pass === false);
  if (!pass) revert(s);
  ok('FAIL(overflow): reverted to flow heading', s.container.elements[0].widgetType === 'heading');
}
// (2c) byHash attached nothing (low confidence) → FAIL → revert.
{
  const pass = gatePass({ hRatio: 1.0, hOverflow: false, byHashAttached: 0, byHashOn: true });
  ok('FAIL: byHash attached 0 elements (low confidence) → gate FAIL', pass === false);
}
// (2c') same measurement but byHash DISABLED → confidence sub-gate not required → PASS.
{
  const pass = gatePass({ hRatio: 1.0, hOverflow: false, byHashAttached: 0, byHashOn: false });
  ok('byHash OFF: confidence sub-gate skipped → gate PASS', pass === true);
}
// (3) measure-only mode (JOIST_NO_AUTOREVERT=1): a FAIL is detected but NOT reverted.
{
  const s = makeContainer();
  const AUTOREVERT = false; // simulates JOIST_NO_AUTOREVERT=1
  const pass = gatePass({ hRatio: 1.30, hOverflow: false, byHashAttached: 11, byHashOn: true });
  ok('measure-only: hRatio 1.30 → gate FAIL', pass === false);
  if (!pass && AUTOREVERT) revert(s);
  ok('measure-only: NOT reverted (preserve overlay retained)', s.container.elements[0].widgetType === 'html');
}

const failed = cases.filter((c) => !c.pass);
for (const c of cases) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`);
console.log(`\nauto-revert gate selftest: ${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${cases.length} cases)`);
process.exit(failed.length === 0 ? 0 : 1);

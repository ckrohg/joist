#!/usr/bin/env node
/**
 * @purpose _schema-noblock-selftest.mjs — the regression guard for the catalog-health gate (fusion 2026-06-21).
 *
 * A faulty/POLLUTED WidgetCatalog must NEVER hard-BLOCK a native control that Elementor itself accepts+renders.
 * The bug it guards: on a clean Elementor 3.28.4 install the live introspection returned `title_colors` (no
 * `title_color`, no `align`), so the SchemaValidator 422-rejected the projection's standard V3 controls — blocking
 * every projection render — even though page 834 proves those controls render fine. The fix demotes catalog-derived
 * unknown-control-name + enum errors to non-blocking WARNINGS while WidgetCatalog::isHealthy() is false (reversible
 * via option joist_strict_schema=1). This test asserts the standard projection vocabulary is NEVER blocked, AND that
 * structural checks stay HARD.
 *
 * This assertion holds in BOTH catalog states: unhealthy → demoted to warnings (today); healthy → title_color is a
 * real control so it validates anyway. Either way the projection's controls must never 422.
 *
 * Live test — needs JOIST_AUTH_B64 (+ optional JOIST_BASE). Run: `source /tmp/joist-auth*.env && node _schema-noblock-selftest.mjs`
 */
const BASE = process.env.JOIST_BASE || 'http://localhost:8001';
const AUTH = process.env.JOIST_AUTH_B64;
if (!AUTH) { console.error('SKIP — no JOIST_AUTH_B64 (source the auth env first)'); process.exit(0); }

async function validate(type, settings) {
  const r = await fetch(`${BASE}/wp-json/joist/v1/widgets/validate`, {
    method: 'POST',
    headers: { Authorization: `Basic ${AUTH}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, settings }),
  });
  return r.json();
}

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

// 1. The exact controls that the clerk projection PUT 422'd on — must NOT be blocked.
const h = await validate('heading', { title_color: '#ff0000', align: 'center' });
check('heading{title_color,align} is NOT blocked (valid; false-positives demoted to warnings)', h.valid === true && (h.errors || []).length === 0, `valid=${h.valid} errors=${(h.errors || []).length} warnings=${(h.warnings || []).length}`);

const b = await validate('button', { button_text_color: '#ffffff', text_color: '#fff' });
check('button{button_text_color,text_color} is NOT blocked', b.valid === true && (b.errors || []).length === 0, `valid=${b.valid}`);

const t = await validate('text-editor', { text_color: '#222', align: 'left' });
check('text-editor{text_color,align} is NOT blocked', t.valid === true && (t.errors || []).length === 0, `valid=${t.valid}`);

// 2. Feedback is preserved (warnings carry the demoted findings, not swallowed).
check('demoted findings are SURFACED as warnings (not silently dropped)', (h.warnings || []).length >= 1, `heading warnings=${(h.warnings || []).length}`);

// 3. STRUCTURAL checks stay HARD — we only softened control-NAME/enum checks, not widget-existence.
const u = await validate('joist_nonexistent_widget_zzz', { foo: 'bar' });
check('an UNREGISTERED widget type STILL hard-rejects (structural checks unchanged)', u.valid === false, `valid=${u.valid}`);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);

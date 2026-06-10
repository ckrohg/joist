#!/usr/bin/env node
/**
 * @purpose INNOCENT CONTROL for the C-round-5c glyph-rect capture (GRADER_NO_GLYPHRECTS flag, grade-sections'
 * GLYPH_RECTS block): capture the SAME static clone page twice in subprocesses — flag ON vs flag OFF — and
 * require the two JSON payloads to be DEEP-EQUAL once the new glyph fields (gx/gy/gw/gh/ga/gva/gvx/gvy/gvw/
 * gvh/gc) are stripped from the flag-on textLeaves. Proves the change is ADDITIVE-ONLY: flag-off is
 * byte-identical legacy, flag-on touches nothing but the new fields. The clone page is static WP (deterministic
 * render); a non-glyph diff is therefore either a real regression or transient render noise — rerun once before
 * concluding regression. GET-only render of the graded page (no writes anywhere).
 *
 * Usage: node _glyphrects-control.mjs [--page 3146]
 * Exit: 0 pass · 3 infra · 4 fail. Report → /tmp/glyphrects-control.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync, execSync } from 'child_process';
import { BASE } from './scratch-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argIdx = process.argv.indexOf('--page');
const PAGE = argIdx > -1 ? Number(process.argv[argIdx + 1]) : 3146;
const GLYPH_FIELDS = ['gx', 'gy', 'gw', 'gh', 'ga', 'gva', 'gvx', 'gvy', 'gvw', 'gvh', 'gc'];

function captureOnce(label, envExtra) {
  const out = `/tmp/glyphrects-control-${label}.json`;
  try { fs.unlinkSync(out); } catch {}
  const gsUrl = pathToFileURL(path.join(__dirname, 'grade-sections.mjs')).href;
  const code = `import('playwright').then(async (pw) => {
    const m = await import(${JSON.stringify(gsUrl)});
    const browser = await pw.chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
    const ctx = await browser.newContext({ viewport: { width: m.W, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const cap = await m.capture(ctx, ${JSON.stringify(`${BASE}/?page_id=${PAGE}&grctl=${Date.now().toString(36)}`)}, true);
    const { shot, ...payload } = cap;
    require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(payload));
    await browser.close();
  }).catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 300000, env: { ...process.env, ...envExtra } });
  if (!fs.existsSync(out)) throw new Error(`capture subprocess (${label}) failed: ${String(r.stderr).slice(-400)}`);
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

const stripGlyph = (payload) => ({
  ...payload,
  textLeaves: (payload.textLeaves || []).map((L) => { const c = { ...L }; for (const k of GLYPH_FIELDS) delete c[k]; return c; }),
});

(async () => {
  try { execSync("pkill -9 -f 'chrome-headless-shell' 2>/dev/null || true", { stdio: 'ignore' }); } catch {}
  const on = captureOnce('on', { GRADER_NO_GLYPHRECTS: '' });
  const off = captureOnce('off', { GRADER_NO_GLYPHRECTS: '1' });
  const glyphLeaves = (on.textLeaves || []).filter((L) => L.ga != null).length;
  const offGlyphLeaves = (off.textLeaves || []).filter((L) => GLYPH_FIELDS.some((k) => k in L)).length;
  const onStripped = JSON.stringify(stripGlyph(on));
  const offJson = JSON.stringify(off);
  const identical = onStripped === offJson;
  const report = {
    page: PAGE, leaves: (on.textLeaves || []).length, glyphLeavesOn: glyphLeaves, glyphFieldsInOff: offGlyphLeaves,
    identicalAfterStrip: identical, pass: identical && glyphLeaves > 0 && offGlyphLeaves === 0,
  };
  if (!identical) {
    // localize the first divergence for the report (field-level attribution)
    const a = stripGlyph(on), b = off;
    for (const k of Object.keys(a)) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { report.firstDivergentField = k; break; }
    }
  }
  fs.writeFileSync('/tmp/glyphrects-control.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`INNOCENT CONTROL: ${report.pass ? 'PASS — flag-on differs from flag-off ONLY by the glyph fields' : 'FAIL'}`);
  process.exit(report.pass ? 0 : 4);
})().catch((e) => { console.error(String(e && e.stack || e)); process.exit(3); });

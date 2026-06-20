#!/usr/bin/env node
/** @purpose _ws5-emission-ab.mjs — WS5 emission VALIDATION (A/B). Proves the existing MOVE-1 native responsive-typography
 * emission actually CLOSES the responsive gap live on the Hello+free stack. Captures _ws5-responsive-hero.html DIRECTLY
 * as the responsive "source" (real browser reflows via @media), then transpiles→renders→captures the SAME fixture as the
 * "clone" twice: emission ON (default) vs OFF (RESPONSIVE_NO_NATIVE_FONTSIZE=1, the stripped-custom_css baseline), grading
 * each against source at 1440/768/390. Expect: gap_ON ≪ gap_OFF (native _tablet/_mobile controls reflow it). Sandbox-only. */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { flatten, segmentSections, correspondSection } from './correspondence-reward.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const BASE = process.env.JOIST_BASE || 'http://localhost:8001';
if (!/localhost|127\.0\.0\.1/.test(BASE)) { console.error('REFUSING non-local base:', BASE); process.exit(2); }
const PAGE = +(process.argv[process.argv.indexOf('--page') + 1] || 809);
const WIDTHS = [1440, 768, 390];
const FIXTURE = `${HERE}/_ws5-responsive-hero.html`;
const run = (a, env, t = 180000) => execFileSync('node', a, { cwd: HERE, stdio: 'pipe', timeout: t, env: { ...process.env, ...env } });
const ctx = { srcPageBg: 'rgb(8,8,8)', clonePageBg: 'rgb(8,8,8)', textOnly: false };

// 1) SOURCE = capture the fixture directly (real @media reflow) at each width.
const srcTrees = {};
for (const w of WIDTHS) { const p = `/tmp/ws5ab-src-${w}.json`; console.error(`source @${w} …`); run(['capture-layout.mjs', '--source', `file://${FIXTURE}`, '--width', String(w), '--out', p]); srcTrees[w] = JSON.parse(fs.readFileSync(p, 'utf8')); }

function gradeClone(label, env) {
  console.error(`build clone [${label}] …`);
  run(['transpile-html.mjs', '--html', FIXTURE, '--width', '1440', '--dry-run', '--no-site-parts', '--out', `/tmp/ws5ab-tr-${PAGE}`], env);
  run(['../../sandbox/render.mjs', '--tree', `/tmp/ws5ab-tr-${PAGE}/tree.json`, '--page', String(PAGE), '--no-shot'], env);
  const rows = [];
  for (const w of WIDTHS) {
    run(['capture-layout.mjs', '--source', `${BASE}/?page_id=${PAGE}`, '--width', String(w), '--out', `/tmp/ws5ab-cln-${label}-${w}.json`], env);
    const sL = flatten(srcTrees[w]), cL = flatten(JSON.parse(fs.readFileSync(`/tmp/ws5ab-cln-${label}-${w}.json`, 'utf8')));
    const sPage = { x: 0, y: 0, w, h: Math.max(...sL.map((n) => n.box ? n.box.y + n.box.h : 0), 1) };
    const hero = segmentSections(sL, sPage)[0];
    const cB = (() => { const L = cL.filter((n) => n.box); const x0 = Math.min(...L.map((n) => n.box.x)), y0 = Math.min(...L.map((n) => n.box.y)), x1 = Math.max(...L.map((n) => n.box.x + n.box.w)), y1 = Math.max(...L.map((n) => n.box.y + n.box.h)); return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }; })();
    const r = correspondSection(hero.leaves, cL, hero.box, cB, ctx);
    rows.push({ w, score: r.score, typo: r.axes.typography, pos: r.axes.position });
  }
  const desk = rows.find((x) => x.w === 1440).score, mob = Math.min(...rows.map((x) => x.score));
  return { rows, desk, mob, gap: +(desk - mob).toFixed(2) };
}

const on = gradeClone('ON', {});
const off = gradeClone('OFF', { RESPONSIVE_NO_NATIVE_FONTSIZE: '1' });
const line = (r) => r.rows.map((x) => `${x.w}:${x.score}(typo ${x.typo})`).join('  ');
console.log('\n=== WS5 emission A/B (clone vs responsive source) ===');
console.log(`emission ON   ${line(on)}   → gap ${on.gap}`);
console.log(`emission OFF  ${line(off)}   → gap ${off.gap}`);
console.log(`\nΔgap (OFF−ON) = ${(off.gap - on.gap).toFixed(2)}  ·  mobile Δscore (ON−OFF @min) = ${(on.mob - off.mob).toFixed(2)}`);
console.log(off.gap - on.gap > 6 && on.mob > off.mob + 6
  ? 'PASS — native _tablet/_mobile emission CLOSES the responsive gap (OFF stays desktop-size at 390; ON reflows).'
  : 'INCONCLUSIVE — emission did not clearly close the gap here (inspect /tmp/ws5ab-* + transpile policy log).');

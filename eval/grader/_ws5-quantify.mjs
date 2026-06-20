#!/usr/bin/env node
/** @purpose _ws5-quantify.mjs — WS5 LIVE quantification: build the known-good resend hero ONCE (desktop), then capture
 * that SAME rendered WP page at 1440/768/390 and grade each against the source's hero section. The clone is built once
 * (desktop) and only the BROWSER reflows it at narrow viewports — so a desktop-high / mobile-low spread is the live
 * measure of the @media-stripped emission gap (font-size etc. that Hello+free drops). Sandbox-only (JOIST_BASE guard). */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { flatten, segmentSections, correspondSection } from './correspondence-reward.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const BASE = process.env.JOIST_BASE || 'http://localhost:8001';
if (!/localhost|127\.0\.0\.1/.test(BASE)) { console.error('REFUSING non-local base:', BASE); process.exit(2); }
const PAGE = +(process.argv[process.argv.indexOf('--page') + 1] || 808);
const WIDTHS = [1440, 768, 390];
const run = (a, t = 180000) => execFileSync('node', a, { cwd: HERE, stdio: 'pipe', timeout: t });

// 1) build the good hero ONCE (desktop transpile → render to PAGE).
console.log(`build good hero → page ${PAGE} (desktop) …`);
run(['transpile-html.mjs', '--html', `${HERE}/_heal-good-hero.html`, '--width', '1440', '--dry-run', '--no-site-parts', '--out', `/tmp/ws5-tr-${PAGE}`]);
run(['../../sandbox/render.mjs', '--tree', `/tmp/ws5-tr-${PAGE}/tree.json`, '--page', String(PAGE), '--no-shot']);

// 2) capture the SAME page at each viewport + grade vs the source hero section at that width.
const ctx = { srcPageBg: 'rgb(8,8,8)', clonePageBg: 'rgb(8,8,8)', textOnly: true };
const rows = [];
for (const w of WIDTHS) {
  const srcPath = `/tmp/ws5-src-${w}.json`;
  if (!fs.existsSync(srcPath)) { console.log(`  ${w}px → no source capture (${srcPath}) — skip`); continue; }
  console.log(`  capture clone @${w} …`);
  run(['capture-layout.mjs', '--source', `${BASE}/?page_id=${PAGE}`, '--width', String(w), '--out', `/tmp/ws5-cln-${w}.json`]);
  const srcLeaves = flatten(JSON.parse(fs.readFileSync(srcPath, 'utf8')));
  const cloneLeaves = flatten(JSON.parse(fs.readFileSync(`/tmp/ws5-cln-${w}.json`, 'utf8')));
  // source hero = first segmented section; clone is hero-only (no-site-parts) → whole captured tree.
  const srcPage = { x: 0, y: 0, w, h: Math.max(...srcLeaves.map((n) => n.box ? n.box.y + n.box.h : 0), 1) };
  const hero = segmentSections(srcLeaves, srcPage)[0];
  const cBox = (() => { const L = cloneLeaves.filter((n) => n.box); const x0 = Math.min(...L.map((n) => n.box.x)), y0 = Math.min(...L.map((n) => n.box.y)), x1 = Math.max(...L.map((n) => n.box.x + n.box.w)), y1 = Math.max(...L.map((n) => n.box.y + n.box.h)); return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }; })();
  const r = correspondSection(hero.leaves, cloneLeaves, hero.box, cBox, ctx);
  rows.push({ w, score: r.score, position: r.axes.position, typography: r.axes.typography, text: r.axes.text });
  console.log(`  ${String(w).padStart(5)}px → ${r.score}  (pos ${r.axes.position}, typo ${r.axes.typography}, text ${r.axes.text})`);
}

const desk = rows.find((x) => x.w === 1440)?.score, mob = rows.length ? Math.min(...rows.map((x) => x.score)) : null;
console.log(`\n=== WS5 live: desktop ${desk} · mobile-min ${mob} · RESPONSIVE GAP ${desk != null && mob != null ? (desk - mob).toFixed(2) : 'n/a'} ===`);
console.log(rows.length >= 2 && desk - mob > 8 ? 'GAP CONFIRMED LIVE — narrow viewports lose fidelity (the emission fix target).' : 'gap small here — clone holds across viewports on this section.');

#!/usr/bin/env node
// @purpose build-record.mjs — turn an authored exemplar HTML into a library record (EMBODIMENT_APPROACH
// §P3): lint (lint-authoring.mjs), render (local chromium, WP-free), compute the deterministic visual
// descriptor, hash, write records/<id>.json. Refuses unknown vocabulary via schema validation.
// usage: node build-record.mjs --id <id> --constructs a,b,c --sig <structuralSignature>
//        --provenance spike|re-author|verified-clone|synthetic --status judged|pixel-parity|look-only|lint-clean-rendered
//        --evidence "p1;p2" [--site x] [--crop path] [--width 1440] [--notes "..."] [--allow-dirty]
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { STORE, sha256File, describePng, validateRecord } from './lib.mjs';
import { lint } from '../atlas/lint-authoring.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const id = arg('id');
const htmlPath = path.join(STORE, 'html', `${id}.html`);
const renderPath = path.join(STORE, 'renders', `${id}.png`);
const width = parseInt(arg('width', '1440'), 10);
if (!id || !fs.existsSync(htmlPath)) { console.error(`usage: build-record.mjs --id <id> … (html/${id || '<id>'}.html must exist)`); process.exit(2); }

const report = await lint(htmlPath);
if (!report.clean && !process.argv.includes('--allow-dirty')) {
  console.error(`REFUSED: ${id} not lint-clean (${report.violations.map((v) => v.rule).join(',')}). Use --allow-dirty only for proven-provenance artifacts kept as-authored.`);
  process.exit(1);
}
execFileSync('node', [path.join(STORE, 'render-exemplar.mjs'), htmlPath, String(width), renderPath], { stdio: 'inherit' });
const desc = describePng(renderPath);

const rec = {
  id,
  constructIds: (arg('constructs', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
  visualDescriptor: { structuralSignature: arg('sig', 'block-stack'), palette: desc.palette, densityTags: desc.densityTags },
  renderPng: `renders/${id}.png`,
  renderSize: desc.size,
  authoredHtml: `html/${id}.html`,
  elementorJson: null,
  provenance: arg('provenance'),
  verification: { status: arg('status'), evidence: (arg('evidence', '') || '').split(';').map((s) => s.trim()).filter(Boolean), ...(arg('notes') ? { notes: arg('notes') } : {}) },
  lint: { clean: report.clean, violations: report.violations, warnings: report.warnings },
  source: { site: arg('site', ''), crop: arg('crop', ''), width },
  hash: sha256File(htmlPath),
};
const schema = JSON.parse(fs.readFileSync(path.join(STORE, 'schema.json'), 'utf8'));
const errs = validateRecord(rec, schema);
if (errs.length) { console.error('INVALID RECORD:', errs.join('; ')); process.exit(1); }
fs.writeFileSync(path.join(STORE, 'records', `${id}.json`), JSON.stringify(rec, null, 2) + '\n');
console.log(`RECORD ${id}: lint ${report.clean ? 'CLEAN' : 'DIRTY(' + report.violations.length + ')'} render ${desc.size.w}x${desc.size.h} palette ${desc.palette.join(',')} tags ${desc.densityTags.join(',')}`);

#!/usr/bin/env node
/**
 * @purpose Self-test for the control-edit render probe (CONTROL_EDIT_PROBE_SPEC §6 + crash injection).
 * Proves on a synthetic 3-widget page that the probe separates PASS / FAIL_INERT / FAIL_NOT_PANEL
 * with the exact spec metrics (mapped_panel_rate 2/3, probe_pass_rate 0.5, control_edit_roundtrip 1/3),
 * that the sentinel-collision precondition rotates (negative control folded in: the heading is
 * pre-painted palette[0] #FF00AA), that the source page receives ONLY GETs (hash-identical), and —
 * crash injection — that a SIGKILLed holder leaves no dirty page the sweeper can't clean.
 *
 * Run: source /tmp/joist-auth.env && node _roundtrip-selftest.mjs
 * Exit 0 = ALL PASS.
 */
import fs from 'fs';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { createScratch, deletePage, sweep, BASE, TAG } from './scratch-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++; };

let _b64 = null;
function b64() { if (_b64) return _b64; _b64 = process.env.JOIST_AUTH_B64 || (fs.readFileSync('/tmp/joist-auth.env', 'utf8').match(/JOIST_AUTH_B64=([^\s'"]+)/) || [])[1]; if (!_b64) throw new Error('JOIST_AUTH_B64 missing'); return _b64; }
async function jget(p) { const r = await fetch(`${BASE}${p}`, { headers: { Authorization: 'Basic ' + b64() } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j }; }

// §6.1 — synthetic 3-widget page. Heading pre-painted #FF00AA (= palette[0]) = the folded-in
// sentinel-collision negative control: the precondition MUST rotate the heading's sentinel.
const TREE = [{
  elType: 'container', settings: { content_width: 'full' }, elements: [
    { elType: 'widget', widgetType: 'heading', settings: { title: 'PROBE SELFTEST HEADING', header_size: 'h2', title_color: '#FF00AA' } },
    { elType: 'widget', widgetType: 'text-editor', settings: { editor: '<div style="color:#111111">PROBE SELFTEST INLINE TEXT</div>' } },
    { elType: 'widget', widgetType: 'html', settings: { html: '<div style="color:#222222;font-size:18px">PROBE SELFTEST RASTER TEXT</div>' } },
  ],
}];
// §6.2 — 3-run fixture layout (no capture dependency)
const FIXTURE = {
  url: 'selftest://probe', vw: 1440, pageH: 400,
  root: {
    kind: 'container', box: { x: 0, y: 0, w: 1440, h: 400 }, children: [
      { kind: 'heading', text: 'PROBE SELFTEST HEADING', box: { x: 0, y: 10, w: 600, h: 40 } },
      { kind: 'text', text: 'PROBE SELFTEST INLINE TEXT', box: { x: 0, y: 60, w: 600, h: 30 } },
      { kind: 'text', text: 'PROBE SELFTEST RASTER TEXT', box: { x: 0, y: 100, w: 600, h: 30 } },
    ],
  },
};

(async () => {
  console.log('=== control-edit probe self-test ===');
  // clean slate (also exercises the sweeper on whatever debris exists)
  const pre = await sweep({ all: true });
  console.log(`pre-sweep: scanned ${pre.scanned}, deleted [${pre.deleted.join(',')}]`);

  // synthetic SOURCE page (tagged → any crash of THIS test is sweep-cleanable too)
  const src = await createScratch({ title: `${TAG} selftest-src ${new Date().toISOString()}`, elements: TREE, pageSettings: {}, template: 'elementor_canvas' });
  console.log(`synthetic source page ${src.pageId} (${src.url})`);
  const hash0 = (await jget(`/wp-json/joist/v1/pages/${src.pageId}`)).json?.elementor?.hash;

  const fixturePath = '/tmp/roundtrip-selftest-layout.json';
  fs.writeFileSync(fixturePath, JSON.stringify(FIXTURE));

  try {
    // §6.3 — run the probe (child process; full duplicate lifecycle)
    const r = spawnSync('node', [path.join(here, 'probe-roundtrip.mjs'), '--page', String(src.pageId), '--layout', fixturePath, '--n', '6'], { encoding: 'utf8', timeout: 480000, env: process.env });
    process.stdout.write((r.stdout || '').split('\n').map((l) => '  | ' + l).join('\n') + '\n');
    if (r.stderr) process.stdout.write('  |err ' + r.stderr.slice(0, 500) + '\n');

    const reportPath = `/tmp/roundtrip-${src.pageId}.json`;
    const rep = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const byText = Object.fromEntries(rep.probes.map((p) => [p.run_text, p]));
    const heading = byText['PROBE SELFTEST HEADING'];
    const inline = byText['PROBE SELFTEST INLINE TEXT'];

    check('run VALID', rep.run.status === 'VALID', `status=${rep.run.status} errors=${JSON.stringify(rep.errors)}`);
    check('probe exit 0', r.status === 0, `exit=${r.status}`);
    check('heading → PASS', heading && heading.status === 'PASS', heading && `${heading.status} target_px=${heading.target_px}/${heading.target_px_required}`);
    check('inline text-editor → FAIL_INERT (inline style wins)', inline && inline.status === 'FAIL_INERT', inline && `${inline.status} target_px=${inline.target_px}`);
    check('raster html run → FAIL_NOT_PANEL (in denominator, never probed)',
      rep.denominator.mapped_html === 1 && rep.probes.length === 2,
      `mapped_html=${rep.denominator.mapped_html} probes=${rep.probes.length}`);
    check('mapped_panel_rate == 2/3', Math.abs(rep.metrics.mapped_panel_rate - 2 / 3) < 0.001, `${rep.metrics.mapped_panel_rate}`);
    check('probe_pass_rate overall == 0.5', rep.metrics.probe_pass_rate.overall === 0.5, `${rep.metrics.probe_pass_rate.overall}`);
    check('control_edit_roundtrip == 1/3', Math.abs(rep.metrics.control_edit_roundtrip - 1 / 3) < 0.001, `${rep.metrics.control_edit_roundtrip}`);
    check('per-stratum split: heading 1.0, text 0.0', rep.metrics.probe_pass_rate.heading === 1 && rep.metrics.probe_pass_rate.text === 0,
      `h=${rep.metrics.probe_pass_rate.heading} t=${rep.metrics.probe_pass_rate.text}`);
    check('negative control: sentinel rotated off #FF00AA (collision precondition)',
      heading && heading.sentinel.toUpperCase() !== '#FF00AA', heading && `sentinel=${heading.sentinel}`);
    check('data_verified on both probes', heading && inline && heading.data_verified && inline.data_verified);
    check('390 leg ran on designated heading', heading && heading.designated_390 && ['PASS', 'SKIP_390_HIDDEN'].includes(heading.status_390), heading && `status_390=${heading.status_390}`);

    // §6.3 teardown verified: scratch dup gone (404), source untouched (hash-identical: only GETs)
    const dupGone = (await jget(`/wp-json/wp/v2/pages/${rep.scratch_page}?context=edit`)).status === 404;
    check('scratch duplicate deleted + 404-verified', dupGone, `scratch_page=${rep.scratch_page}`);
    const hash1 = (await jget(`/wp-json/joist/v1/pages/${src.pageId}`)).json?.elementor?.hash;
    check('source page byte-untouched (hash identical)', hash0 && hash0 === hash1, `${hash0} vs ${hash1}`);

    // §6 crash-injection: child acquires a scratch dup, parent SIGKILLs it mid-life →
    // the orphan MUST survive as an inert tagged page that sweep() then provably deletes.
    const childSrc = path.join(here, 'scratch-harness.mjs');
    const dupIdFile = '/tmp/_roundtrip-crash-dup.json';
    try { fs.unlinkSync(dupIdFile); } catch {}
    const childCode = `
      import { acquire } from ${JSON.stringify('file://' + childSrc)};
      import fs from 'fs';
      const r = await acquire(${src.pageId});
      fs.writeFileSync(${JSON.stringify(dupIdFile)}, JSON.stringify({ pageId: r.pageId }));
      setInterval(() => {}, 1000);`;
    const child = spawn('node', ['--input-type=module', '-e', childCode], { env: process.env, stdio: 'ignore' });
    let crashDup = null;
    for (let i = 0; i < 120; i++) { await sleep(1000); if (fs.existsSync(dupIdFile)) { crashDup = JSON.parse(fs.readFileSync(dupIdFile, 'utf8')).pageId; break; } if (child.exitCode !== null) break; }
    check('crash child created a scratch dup', !!crashDup, `dup=${crashDup}`);
    if (crashDup) {
      child.kill('SIGKILL');                                                  // no teardown can run
      await sleep(1500);
      const orphanAlive = (await jget(`/wp-json/wp/v2/pages/${crashDup}?context=edit`)).status === 200;
      check('orphan survives SIGKILL as inert tagged page', orphanAlive);
      const sw = await sweep({ all: true });                                   // also removes the selftest source (tagged) — that IS the cleanup
      check('sweep deletes the orphan', sw.deleted.includes(Number(crashDup)) || sw.deleted.includes(String(crashDup)), `deleted=[${sw.deleted.join(',')}]`);
      const orphanGone = (await jget(`/wp-json/wp/v2/pages/${crashDup}?context=edit`)).status === 404;
      check('orphan 404 after sweep (no dirty page survives any crash)', orphanGone);
      const srcGone = (await jget(`/wp-json/wp/v2/pages/${src.pageId}?context=edit`)).status === 404;
      check('selftest source swept too (search returns 0 scratch pages)', srcGone);
    } else { child.kill('SIGKILL'); }
  } finally {
    // belt + braces: if anything above threw before the final sweep, clean the synthetic source now.
    try { await deletePage(src.pageId); } catch {}
    try { await sweep({ all: true }); } catch {}
  }

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();

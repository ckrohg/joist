#!/usr/bin/env node
/**
 * @purpose Selftest for G6 INVISIBLE-TEXT UNGATE (grade-structure.mjs, grader-truth round 2026-06-10).
 * The legacy detector (ratio<1.3 AND fsz>=18 AND merged-bbox lumRange<24) NEVER FIRED in production; V2 drops
 * the size gate and pixel-verifies with per-run LOCAL bg sampling (median-luma of the run's first-line strip).
 * Serves crafted pages over localhost and runs grade-structure.mjs as a subprocess (the real path, no mocks):
 *   T1 INJECTED DEFECT — white-on-white 14px run MUST now be caught (invisibleText>=1, defect>0).
 *   T2 LEGACY REVERSIBILITY — same page under GRADER_NO_INVISTEXT2=1 → invisibleText==0 (legacy size gate).
 *   T3 INNOCENT CONTROL — legit small text on contrasting bg must NOT fire (invisibleText==0).
 *   T4 GAME/FALSE-POSITIVE GUARD — gradient/background-clip:text (computed color ≈ bg, glyphs RENDER visible —
 *      the resend class the pixel check was built for) must NOT fire (invisibleText==0).
 * Exit 0 = ALL PASS.
 */
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#fff;margin:0;font-family:Arial}</style></head><body>
<h1 style="color:#111;font-size:40px">Visible Headline Anchor</h1>
<p style="color:#333;font-size:16px">Normal visible paragraph text content for the capture baseline.</p>
${body}
<div style="height:300px;background:#e8e8e8"><p style="color:#222;font-size:16px">trailing visible content block</p></div>
</body></html>`;

const pages = {
  '/defect': page(`<p style="color:#fff;font-size:14px;background:#fff;width:600px">ghost fourteen pixel run that a human sees as missing words entirely</p>`),
  '/innocent': page(`<p style="color:#222;font-size:12px;width:600px">small legible footnote text on a contrasting background</p>`),
  // the resend class: computed color (#fff on white body → ratio 1) says INVISIBLE, but -webkit-text-fill-color:
  // transparent + background-clip:text paints the glyphs with the DARK gradient → pixels render VISIBLE.
  // (Without text-fill-color:transparent the white glyphs paint OVER the clipped gradient → genuinely ~invisible —
  // verified while building this test; that variant correctly FIRES.)
  '/gradient': page(`<h2 style="font-size:36px;color:#fff;background-image:linear-gradient(90deg,#101010,#303030);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;width:900px">Gradient Clipped Heading Renders Dark Glyphs</h2>`),
};

const srv = http.createServer((req, res) => {
  const html = pages[req.url.split('?')[0]];
  if (!html) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(html);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

// NOTE: must be ASYNC spawn — spawnSync would block this process's event loop and the in-process HTTP server
// could never answer the child grader's requests (verified failure mode: child exits 1 on a never-loading page).
function grade(p, env = {}) {
  const url = `http://127.0.0.1:${port}${p}`;
  const out = `/tmp/invistext2-st${p.replace(/\//g, '-')}${env.GRADER_NO_INVISTEXT2 ? '-legacy' : ''}`;
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [path.join(__dirname, 'grade-structure.mjs'), '--source', url, '--clone', url, '--no-responsive', '--refresh-source', '--out', out], { env: { ...process.env, ...env } });
    let err = ''; c.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => c.kill('SIGKILL'), 180000);
    c.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(`grade-structure exited ${code}: ${err.slice(-800)}`));
      resolve(JSON.parse(fs.readFileSync(`${out}/report.json`, 'utf8')));
    });
  });
}

let fail = 0;
const check = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!cond) fail++; };

const d = await grade('/defect');
check('T1 injected-defect: white-on-white 14px CAUGHT', d.breakdown.invisibleText >= 1 && d.breakdown.invisibleDefect > 0, `invisibleText ${d.breakdown.invisibleText} defect ${d.breakdown.invisibleDefect}`);
const dl = await grade('/defect', { GRADER_NO_INVISTEXT2: '1' });
check('T2 legacy reversibility: GRADER_NO_INVISTEXT2=1 → legacy never-fires', dl.breakdown.invisibleText === 0 && dl.breakdown.invisibleDefect === 0 && dl.breakdown.invisDetector === undefined, `invisibleText ${dl.breakdown.invisibleText}`);
const i = await grade('/innocent');
check('T3 innocent control: legit small contrasting text NOT flagged', i.breakdown.invisibleText === 0, `invisibleText ${i.breakdown.invisibleText}`);
const g = await grade('/gradient');
check('T4 gradient-clip game/FP guard: visible gradient glyphs NOT flagged', g.breakdown.invisibleText === 0, `invisibleText ${g.breakdown.invisibleText}`);

srv.close();
console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);

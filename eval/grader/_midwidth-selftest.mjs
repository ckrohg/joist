#!/usr/bin/env node
/**
 * @purpose Selftest for G1 MULTI-WIDTH (grade-structure.mjs, grader-truth round 2026-06-10): the 1024/1025
 * CLIFF probe (abs-pin drop ⇒ veto-cap 0.35), the 1200 AMPUTATION term (rightmost-extent of CONTENT elements,
 * NOT scrollWidth; excess over source >10 ⇒ cap 0.45) and the hero-font-ratio diagnostic. Serves crafted pages
 * over localhost and runs grade-structure.mjs as a subprocess (the real path, no mocks):
 *   T1 INJECTED CLIFF — clone whose height jumps ~3x crossing 1025→1024 (@media pad) → cliffRatio>1.3, cap 0.35.
 *   T2 INJECTED AMPUTATION — 1440px-frozen clone with 16 absolutely-pinned text runs at x≈1340 → at 1200 all
 *      extend past the viewport → clippedExcess>10, cap 0.45.
 *   T3 GAME-TEST — same amputated page + body{overflow-x:hidden}: scrollWidth lies (==viewport) but the
 *      rightmost-extent check must STILL fire (this is exactly why the spec forbids scrollWidth).
 *   T4 INNOCENT CONTROL — responsive fluid clone → no cliff, no excess, caps empty, composite uncapped.
 *   T5 LEGACY REVERSIBILITY — GRADER_NO_MIDWIDTH=1 on the cliff clone → no midwidth field, no cap.
 * Exit 0 = ALL PASS.
 */
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const base = (extraHead, body) => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;font-family:Arial}${extraHead}</style></head><body>
<h1 style="color:#111;font-size:48px;margin:24px">Hero Headline For The Probe</h1>
<p style="color:#333;font-size:18px;margin:24px;max-width:880px">A paragraph of perfectly ordinary visible content so the capture pipeline has text runs to work with at every width.</p>
${body}
</body></html>`;

const innocentBody = `<div style="max-width:900px;margin:0 auto">${Array.from({ length: 12 }, (_, i) => `<p style="color:#222;font-size:16px">Fluid responsive content block number ${i + 1} that reflows cleanly at any viewport width.</p>`).join('')}</div>`;
const ampSpans = Array.from({ length: 16 }, (_, i) => `<span style="position:absolute;left:1340px;top:${120 + i * 160}px;color:#111;font-size:15px">pinned run ${i + 1}</span>`).join('');
const ampBody = `<div style="position:relative;width:1440px;height:2800px;background:#fafafa">${ampSpans}<p style="position:absolute;left:40px;top:40px;color:#222;font-size:16px">frozen 1440 canvas content</p></div>`;

const pages = {
  '/innocent': base('', innocentBody),
  '/cliff': base('#pad{display:none} @media (max-width:1024px){#pad{display:block;height:8000px}}', `<div id="pad"></div><div style="height:3600px"><p style="color:#222;font-size:16px">tall content body for a stable base height</p></div>`),
  '/amputated': base('', ampBody),
  '/amputated-hidden': base('body{overflow-x:hidden}', ampBody),
};

const srv = http.createServer((req, res) => {
  const html = pages[req.url.split('?')[0]];
  if (!html) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(html);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

// async spawn (NOT spawnSync — it would block this process's event loop and starve the in-process HTTP server)
function grade(srcP, clnP, env = {}, tag = '') {
  const out = `/tmp/midwidth-st${clnP.replace(/\//g, '-')}${tag}`;
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [path.join(__dirname, 'grade-structure.mjs'), '--source', `http://127.0.0.1:${port}${srcP}`, '--clone', `http://127.0.0.1:${port}${clnP}`, '--refresh-source', '--out', out], { env: { ...process.env, ...env } });
    let err = ''; c.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => c.kill('SIGKILL'), 240000);
    c.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(`grade-structure exited ${code}: ${err.slice(-800)}`));
      resolve(JSON.parse(fs.readFileSync(`${out}/report.json`, 'utf8')));
    });
  });
}

let fail = 0;
const check = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!cond) fail++; };

const t1 = await grade('/innocent', '/cliff');
check('T1 injected cliff: ratio>1.3 → veto-cap 0.35', t1.midwidth && t1.midwidth.cliffRatio > 1.3 && t1.midwidth.caps.some((c) => c.startsWith('cliff')) && t1.composite <= 0.35, `cliffRatio ${t1.midwidth && t1.midwidth.cliffRatio} composite ${t1.composite} caps ${JSON.stringify(t1.midwidth && t1.midwidth.caps)}`);
const t2 = await grade('/innocent', '/amputated');
check('T2 injected amputation: excess>10 → cap 0.45', t2.midwidth && t2.midwidth.clippedExcess > 10 && t2.midwidth.caps.some((c) => c.startsWith('amputation')) && t2.composite <= 0.45, `clippedExcess ${t2.midwidth && t2.midwidth.clippedExcess} composite ${t2.composite}`);
const t3 = await grade('/innocent', '/amputated-hidden');
check('T3 game-test: overflow-x:hidden does NOT mask the amputation', t3.midwidth && t3.midwidth.clippedExcess > 10 && t3.composite <= 0.45, `clippedExcess ${t3.midwidth && t3.midwidth.clippedExcess} composite ${t3.composite}`);
const t4 = await grade('/innocent', '/innocent');
check('T4 innocent control: no caps, composite uncapped', t4.midwidth && t4.midwidth.caps.length === 0 && (t4.midwidth.cliffRatio == null || t4.midwidth.cliffRatio < 1.05) && t4.midwidth.clippedExcess === 0 && t4.composite > 0.6, `cliffRatio ${t4.midwidth && t4.midwidth.cliffRatio} excess ${t4.midwidth && t4.midwidth.clippedExcess} composite ${t4.composite}`);
check('T4b hero-font-ratio diagnostic present ≈1 on identical pages', t4.midwidth && t4.midwidth.heroFontRatio != null && Math.abs(t4.midwidth.heroFontRatio - 1) < 0.05, `heroFontRatio ${t4.midwidth && t4.midwidth.heroFontRatio}`);
const t5 = await grade('/innocent', '/cliff', { GRADER_NO_MIDWIDTH: '1' }, '-legacy');
check('T5 legacy reversibility: GRADER_NO_MIDWIDTH=1 → no field, no cap', t5.midwidth === undefined && t5.composite > 0.35, `midwidth ${JSON.stringify(t5.midwidth)} composite ${t5.composite}`);

srv.close();
console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);

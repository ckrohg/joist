#!/usr/bin/env node
/**
 * @purpose Same-origin static+proxy server for the annotation tool. The tool MUST be served from the
 * SAME origin as the clone it iframes, or elementsFromPoint() / getComputedStyle() on the iframe's
 * document throw a cross-origin SecurityError (the whole tool depends on reading the clone DOM live).
 *
 * This server:
 *   • serves the annotate/ static files (annotate.html, .js, .css, guard.js, annotate-core.js, assets/)
 *     under its own origin (default http://127.0.0.1:8011);
 *   • PROXIES everything else (any path it doesn't own) to the clone host (localhost:8001) so the iframe
 *     can request /?page_id=… and all of Elementor's CSS/JS/uploads from the SAME origin as the tool.
 *
 * HARD RAIL: the proxy target is resolved through host-guard's assertAllowedBase (localhost:8001 only;
 * sg-host/georges232/the IP literal are refused). It NEVER fetches an arbitrary or external host, and it
 * strips X-Frame-Options / frame-ancestors CSP from proxied clone responses so the same-origin iframe
 * can embed the clone (the clone is local + ours; this is not a cross-site framing bypass).
 *
 * Usage:
 *   node serve.mjs [--port 8011] [--clone http://localhost:8001]
 * then open  http://127.0.0.1:8011/annotate.html
 *
 * Selftest (no clone needed): node serve.mjs --selftest  → exercises path routing + the guard refusal.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { assertAllowedBase } from '../../../sandbox/host-guard.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && i + 1 < process.argv.length && !String(process.argv[i + 1]).startsWith('--')) return process.argv[i + 1];
  if (i >= 0) return true;
  return def;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};

// The static files this server OWNS (everything else is proxied to the clone host).
const OWNED = new Set(['/', '/annotate.html', '/annotate.js', '/annotate.css', '/guard.js', '/annotate-core.js']);
function isOwned(pathname) {
  if (OWNED.has(pathname)) return true;
  if (pathname.startsWith('/assets/')) return true; // source screenshots + source-bbox.json
  return false;
}

/** Route a request to either a local static file path, or 'proxy'. Pure → unit-testable. */
export function routeRequest(rawPathname) {
  // decode percent-encoding first so an encoded traversal (%2e%2e%2f) can't slip past the checks.
  let pathname;
  try { pathname = decodeURIComponent(rawPathname); } catch { return { kind: 'forbidden' }; }
  if (pathname === '/') return { kind: 'static', file: 'annotate.html' };
  if (isOwned(pathname)) {
    // map to a file under HERE; reject ANY path that normalizes outside HERE (traversal).
    const rel = pathname.replace(/^\/+/, '');
    const abs = path.normalize(path.join(HERE, rel));
    // require the resolved path to stay strictly within HERE (separator-anchored to avoid HERE-prefix siblings)
    if (abs !== HERE && !abs.startsWith(HERE + path.sep)) return { kind: 'forbidden' };
    return { kind: 'static', file: path.relative(HERE, abs) };
  }
  return { kind: 'proxy' };
}

function serveStatic(res, file) {
  const abs = path.join(HERE, file);
  fs.readFile(abs, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + file); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(buf);
  });
}

async function proxyToClone(req, res, cloneBase) {
  // GUARD: the proxy target is host-guarded — only localhost:8001 (or an allowlisted training host).
  let base;
  try { base = assertAllowedBase(cloneBase); } catch (e) {
    res.writeHead(502, { 'content-type': 'text/plain' }); res.end('REFUSED clone base: ' + e.message); return;
  }
  const target = base.replace(/\/+$/, '') + req.url;
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { ...req.headers, host: new URL(base).host },
      redirect: 'manual',
    });
    const headers = {};
    upstream.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      // strip framing/CSP guards so the same-origin iframe can embed the LOCAL clone (ours, not cross-site).
      if (lk === 'x-frame-options' || lk === 'content-security-policy' || lk === 'content-security-policy-report-only') return;
      if (lk === 'content-encoding' || lk === 'content-length' || lk === 'transfer-encoding') return; // let node re-frame the body
      headers[k] = v;
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, headers);
    res.end(buf);
  } catch (e) {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('clone proxy error (is localhost:8001 up?): ' + e.message);
  }
}

function start(port, cloneBase) {
  // fail fast + loud if the clone base is forbidden, BEFORE binding.
  assertAllowedBase(cloneBase);
  const server = http.createServer((req, res) => {
    const pathname = url.parse(req.url).pathname;
    const route = routeRequest(pathname);
    if (route.kind === 'forbidden') { res.writeHead(403); res.end('forbidden'); return; }
    if (route.kind === 'static') return serveStatic(res, route.file);
    return proxyToClone(req, res, cloneBase);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`annotator serving http://127.0.0.1:${port}/annotate.html`);
    console.log(`proxying non-owned paths → ${cloneBase} (host-guarded)`);
  });
  return server;
}

// ── offline selftest: route table + guard refusal (no clone, no bind) ─────────────
function selftest() {
  const cases = [];
  const ok = (name, cond) => cases.push({ name, passed: !!cond });
  ok('/ → static annotate.html', routeRequest('/').file === 'annotate.html');
  ok('/annotate.js → static', routeRequest('/annotate.js').kind === 'static');
  ok('/guard.js → static', routeRequest('/guard.js').kind === 'static');
  ok('/annotate-core.js → static', routeRequest('/annotate-core.js').kind === 'static');
  ok('/assets/synthetic/source-bbox.json → static', routeRequest('/assets/synthetic/source-bbox.json').kind === 'static');
  ok('/?page_id=2551 (clone path) → proxy', routeRequest('/').kind === 'static' && routeRequest('/wp-content/x.css').kind === 'proxy');
  ok('/wp-json/... → proxy', routeRequest('/wp-json/joist/v1/pages').kind === 'proxy');
  ok('path traversal /assets/../../secret → forbidden', routeRequest('/assets/../../secret').kind === 'forbidden');
  ok('encoded traversal /assets/%2e%2e/%2e%2e/secret → forbidden', routeRequest('/assets/%2e%2e/%2e%2e/secret').kind === 'forbidden');
  // guard refuses a forbidden clone base at start()
  let threw = null; try { assertAllowedBase('https://georges232.sg-host.com'); } catch (e) { threw = e; }
  ok('start() guard refuses sg-host clone base', threw !== null);
  let threwIp = null; try { assertAllowedBase('http://35.212.46.254:8001'); } catch (e) { threwIp = e; }
  ok('start() guard refuses the IP literal', threwIp !== null);
  ok('localhost:8001 clone base allowed', (() => { try { assertAllowedBase('http://localhost:8001'); return true; } catch { return false; } })());
  for (const c of cases) console.log(`${c.passed ? 'PASS' : 'FAIL'}  ${c.name}`);
  const failed = cases.filter((c) => !c.passed);
  console.log(`\nserve selftest: ${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${cases.length} cases)`);
  return failed.length === 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) { process.exit(selftest() ? 0 : 1); }
  else {
    const port = Number(arg('port', 8011));
    const cloneBase = String(arg('clone', process.env.JOIST_BASE || 'http://localhost:8001'));
    start(port, cloneBase);
  }
}

export { start };

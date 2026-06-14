#!/usr/bin/env node
/**
 * @purpose §0 SAFETY GUARD — make it STRUCTURALLY IMPOSSIBLE for any render / grade / PUT
 * to hit a non-training WordPress host. This is the rail that exists because agents strayed
 * onto the user's PAUSED shared SiteGround host (georges232 / *.sg-host.com) and TANKED it
 * (PHP/CPU overload via parallel renders + per-post Elementor CSS regeneration), 2026-06-14.
 *
 * CONTRACT: every code path that creates/updates a page or PUTs to a WP host MUST route its
 * base URL through `assertAllowedBase()` (or `resolveBase()`) BEFORE any network call. A stray
 * base then throws LOUDLY, offline, before a single request leaves the process.
 *
 * Allow policy (allowlist, default-deny):
 *   • localhost:8001 / 127.0.0.1:8001            — the local Docker Elementor sandbox.
 *   • host of env JOIST_TRAINING_BASE            — the future provisioned training instance.
 *   • any host in env JOIST_ALLOWED_HOSTS        — comma-separated escape hatch.
 * Block policy (hard-block, wins even if somehow allowlisted):
 *   • /\.sg-host\.com$/i  and  /georges232/i     — the paused shared host. THROWS, never renders.
 *
 * Usage:
 *   import { assertAllowedBase, resolveBase, ALLOWED_HOSTS, BLOCKED_PATTERNS } from './host-guard.mjs';
 *   const base = resolveBase(arg('base'));          // explicit || JOIST_BASE || localhost:8001, guarded
 *   assertAllowedBase('http://localhost:8001');     // → returns base, or throws
 *
 * THROTTLE: the dominant overload cost is PER-RENDER Elementor CSS regeneration
 * (`wp elementor flush_css` / Document::save() regenerating per-post CSS). Two mitigations live here:
 *   1. `withRenderLock(fn)` + JOIST_RENDER_SERIAL=1 — an in-process async mutex that serializes
 *      renders so N parallel callers don't stampede one WP host with concurrent CSS regen.
 *   2. css_print_method=INTERNAL + a single batched `wp elementor flush_css` AFTER a build (rather
 *      than per-post regen) is the host-side regen-load mitigation — see the note on withRenderLock.
 *
 * Selftest (offline, touches NO host):  node sandbox/host-guard.mjs --selftest
 */

// ── Allow / block policy ─────────────────────────────────────────────────────

/** Hosts that always pass (unless a BLOCKED_PATTERN also matches — block wins). */
export const ALLOWED_HOSTS = (() => {
  const set = new Set(['localhost:8001', '127.0.0.1:8001']);
  // The future provisioned training instance.
  const trainingHost = hostOf(process.env.JOIST_TRAINING_BASE);
  if (trainingHost) set.add(trainingHost);
  // Explicit escape hatch (comma-separated host[:port] list).
  for (const h of String(process.env.JOIST_ALLOWED_HOSTS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    set.add(h);
  }
  return set;
})();

/** Hard-block patterns — these THROW even if a host somehow ended up allowlisted. */
export const BLOCKED_PATTERNS = [/\.sg-host\.com$/i, /georges232/i];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract a normalized `host[:port]` from a base URL/string. Lenient: accepts bare
 * `localhost:8001` (no scheme) by prefixing a scheme before parsing. Returns '' on garbage.
 */
export function hostOf(base) {
  if (!base) return '';
  let s = String(base).trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s; // tolerate scheme-less bases
  try { return new URL(s).host.toLowerCase(); } catch { return ''; }
}

// ── The guard ────────────────────────────────────────────────────────────────

/**
 * Assert that `base` targets an allowed training host. Throws LOUDLY otherwise.
 * Order matters: blocked patterns are checked FIRST so they win over any allowlisting.
 * @param {string} base  a base URL (e.g. 'http://localhost:8001') or 'host:port'
 * @returns {string} the same `base`, when allowed
 */
export function assertAllowedBase(base) {
  const host = hostOf(base);
  if (!host) {
    throw new Error(`REFUSED: cannot parse a host from base ${JSON.stringify(base)}; renders/PUTs only target localhost:8001 or JOIST_TRAINING_BASE.`);
  }
  // Hard-block FIRST — wins even if the host was somehow allowlisted.
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(host)) {
      throw new Error(`REFUSED: ${host} is a blocked/paused host (shared SiteGround was overloaded 2026-06-14). Renders/PUTs only target localhost:8001 or JOIST_TRAINING_BASE.`);
    }
  }
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(`REFUSED: ${host} is not an allowed training host; set JOIST_TRAINING_BASE or JOIST_ALLOWED_HOSTS`);
  }
  return base;
}

/**
 * Resolve the effective base — explicit || JOIST_BASE || localhost:8001 — then GUARD it,
 * so even the DEFAULT can never be a remote host and an env override can't stray.
 * @param {string} [explicit]  a CLI/-arg-supplied base, if any
 * @returns {string} the guarded base
 */
export function resolveBase(explicit) {
  const base = explicit || process.env.JOIST_BASE || 'http://localhost:8001';
  return assertAllowedBase(base);
}

// ── Throttle: serialize renders to spare per-render Elementor CSS regen ────────

/**
 * In-process async mutex. The dominant host-overload cost is per-render Elementor CSS
 * regeneration; N parallel renders stampede one WP host with concurrent regen. When
 * JOIST_RENDER_SERIAL=1, wrap each render through `withRenderLock` so they run one-at-a-time.
 *
 * HOST-SIDE companion mitigations (do these on the WP side to cut regen load further):
 *   • Set Elementor css_print_method = INTERNAL (Settings → Advanced) so CSS is inlined per
 *     request rather than written as a per-post file on every save → no per-post file regen.
 *   • Prefer a SINGLE batched `wp elementor flush_css` AFTER a multi-page build over a per-post
 *     flush in the inner loop — one regen pass instead of one-per-page.
 */
let _renderChain = Promise.resolve();
export const RENDER_SERIAL = process.env.JOIST_RENDER_SERIAL === '1';

export function withRenderLock(fn) {
  if (!RENDER_SERIAL) return fn();
  const run = _renderChain.then(() => fn());
  // keep the chain alive regardless of this call's success/failure
  _renderChain = run.then(() => {}, () => {});
  return run;
}

// ── Offline selftest ─────────────────────────────────────────────────────────

async function selftest() {
  const { spawnSync } = await import('node:child_process');
  const cases = [];
  const ok = (name, fn, expectPass) => {
    let threw = null;
    try { fn(); } catch (e) { threw = e; }
    const passed = expectPass ? threw === null : threw !== null;
    cases.push({ name, passed, threw: threw && threw.message });
  };
  // localhost PASSES
  ok("assertAllowedBase('http://localhost:8001') PASSES", () => assertAllowedBase('http://localhost:8001'), true);
  // the exact paused shared host THROWS
  ok("assertAllowedBase('https://georges232.sg-host.com') THROWS", () => assertAllowedBase('https://georges232.sg-host.com'), false);
  // ANY *.sg-host.com THROWS
  ok("assertAllowedBase('https://foo.sg-host.com') THROWS", () => assertAllowedBase('https://foo.sg-host.com'), false);
  // a random non-allowlisted host THROWS
  ok("assertAllowedBase('https://random-host.com') THROWS", () => assertAllowedBase('https://random-host.com'), false);
  // 127.0.0.1:8001 PASSES (localhost variant)
  ok("assertAllowedBase('http://127.0.0.1:8001') PASSES", () => assertAllowedBase('http://127.0.0.1:8001'), true);

  // a configured training base PASSES — exercise the REAL assertAllowedBase against the REAL
  // env-driven ALLOWED_HOSTS by re-importing this module in a child with JOIST_TRAINING_BASE set
  // (ALLOWED_HOSTS is computed at import time, so the env must be present BEFORE import).
  const childOut = (() => {
    const r = spawnSync(process.execPath, [
      '--input-type=module', '-e',
      `import { assertAllowedBase } from ${JSON.stringify(import.meta.url)};` +
      `assertAllowedBase('https://train.example.com/x');` +
      `console.log('TRAIN_OK');`,
    ], { env: { ...process.env, JOIST_TRAINING_BASE: 'https://train.example.com' }, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  })();
  cases.push({
    name: "JOIST_TRAINING_BASE set → assertAllowedBase('https://train.example.com/x') PASSES",
    passed: childOut.code === 0 && /TRAIN_OK/.test(childOut.out),
    threw: childOut.code === 0 ? null : childOut.out.trim().split('\n').pop(),
  });

  const failed = cases.filter((c) => !c.passed);
  for (const c of cases) {
    console.log(`${c.passed ? 'PASS' : 'FAIL'}  ${c.name}${c.threw && c.passed ? '  (threw: ' + c.threw.slice(0, 60) + ')' : ''}${!c.passed && c.threw ? '  threw: ' + c.threw : ''}${!c.passed && !c.threw ? '  (did not throw)' : ''}`);
  }
  console.log(`\nhost-guard selftest: ${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${cases.length} cases)`);
  return failed.length === 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) {
    selftest().then((pass) => process.exit(pass ? 0 : 1));
  } else {
    console.log('ALLOWED_HOSTS:', [...ALLOWED_HOSTS].join(', '));
    console.log('BLOCKED_PATTERNS:', BLOCKED_PATTERNS.map((r) => r.toString()).join(', '));
    console.log('RENDER_SERIAL:', RENDER_SERIAL);
    console.log('Run with --selftest to verify the guard offline.');
  }
}

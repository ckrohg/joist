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
 *   • /^35\.212\.46\.254(:\d+)?$/                — its resolved IP literal, so an operator can't
 *                                                  re-add it to JOIST_ALLOWED_HOSTS via the raw IP.
 *
 * Usage:
 *   import { assertAllowedBase, resolveBase, guardedFetch, ALLOWED_HOSTS, BLOCKED_PATTERNS } from './host-guard.mjs';
 *   const base = resolveBase(arg('base'));          // explicit || JOIST_BASE || localhost:8001, guarded
 *   assertAllowedBase('http://localhost:8001');     // → returns base, or throws
 *   await guardedFetch(`${base}/wp-json/...`);       // fetch that re-guards on any cross-host redirect
 *   // CLI gate for shell/workflow strings:  node sandbox/host-guard.mjs <url>  (exit 0 = allowed)
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
export const BLOCKED_PATTERNS = [/\.sg-host\.com$/i, /georges232/i, /^35\.212\.46\.254(:\d+)?$/];

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
 * Assert that `url`'s host is not on the HARD-BLOCK list — WITHOUT the allowlist default-deny.
 *
 * For READ-ONLY captures of arbitrary EXTERNAL *source* sites (clerk.com, stripe.com, linear.app…):
 * the source is legitimately NOT on the training allowlist, but it must never be the paused shared
 * host. So this blocks sg-host / georges232 / the resolved IP and ALLOWS any other parseable host.
 *
 * Use for the `--source` arg and external-probe `--url` (read-only screenshots). Do NOT use for
 * render / PUT / page-save targets — those mutate a WP host and MUST go through `assertAllowedBase`
 * (allowlist), since per-render CSS regen is the overload vector that paused the shared host.
 * @param {string} url  a source URL or 'host:port'
 * @returns {string} the same `url`, when not blocked
 */
export function assertNotBlocked(url) {
  const host = hostOf(url);
  if (!host) {
    throw new Error(`REFUSED: cannot parse a host from source ${JSON.stringify(url)}.`);
  }
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(host)) {
      throw new Error(`REFUSED: ${host} is a blocked/paused host (shared SiteGround was overloaded 2026-06-14); it must never be captured even as a read-only source.`);
    }
  }
  return url;
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

/**
 * Guarded `fetch`. Closes the cross-host REDIRECT hole: a request to an allowed host could be
 * 3xx-redirected to the paused host and the default `fetch` (redirect:'follow') would chase it
 * un-revalidated, straight onto the blocked box. This helper:
 *   1. asserts the REQUEST url is allowed BEFORE any network call;
 *   2. forces `redirect:'manual'` so the runtime never auto-follows;
 *   3. on a 3xx, re-asserts the `Location` header is allowed before following it once (manually).
 * A redirect to a blocked/un-allowlisted Location THROWS rather than being followed.
 * @param {string|URL} url   the request URL (must resolve to an allowed host)
 * @param {RequestInit} [opts]  passed through to fetch; `redirect` is forced to 'manual'
 * @returns {Promise<Response>}
 */
export async function guardedFetch(url, opts = {}) {
  assertAllowedBase(String(url));
  const res = await fetch(url, { ...opts, redirect: 'manual' });
  // 3xx with a Location → re-validate the target host before following.
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (loc) {
      // Resolve relative redirects against the original URL so we guard the real target host.
      const target = new URL(loc, String(url)).toString();
      assertAllowedBase(target); // THROWS if the redirect points at a blocked/un-allowlisted host
      return guardedFetch(target, opts); // follow once, re-guarded (and re-manual)
    }
  }
  return res;
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

  // assertNotBlocked (SOURCE-side): ALLOWS arbitrary external sources (not allowlist default-deny)…
  ok("assertNotBlocked('https://clerk.com') PASSES (external source allowed)", () => assertNotBlocked('https://clerk.com'), true);
  ok("assertNotBlocked('https://random-host.com/x') PASSES (external source allowed)", () => assertNotBlocked('https://random-host.com/x'), true);
  // …but STILL blocks the paused shared host + its IP even as a read-only source.
  ok("assertNotBlocked('https://georges232.sg-host.com') THROWS", () => assertNotBlocked('https://georges232.sg-host.com'), false);
  ok("assertNotBlocked('http://35.212.46.254/x') THROWS", () => assertNotBlocked('http://35.212.46.254/x'), false);

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

  // (1) IP-LITERAL block wins over allowlist: even with the shared host's IP in JOIST_ALLOWED_HOSTS,
  // assertAllowedBase('https://35.212.46.254/x') must THROW. ALLOWED_HOSTS is import-time, so set the
  // env BEFORE import via a child process; we EXPECT a non-zero exit (the assert threw).
  const ipBlockChild = (() => {
    const r = spawnSync(process.execPath, [
      '--input-type=module', '-e',
      `import { assertAllowedBase } from ${JSON.stringify(import.meta.url)};` +
      `assertAllowedBase('https://35.212.46.254/x');` +
      `console.log('IP_NOT_BLOCKED');`,
    ], { env: { ...process.env, JOIST_ALLOWED_HOSTS: '35.212.46.254' }, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  })();
  cases.push({
    name: "JOIST_ALLOWED_HOSTS=35.212.46.254 → assertAllowedBase('https://35.212.46.254/x') THROWS (block wins)",
    passed: ipBlockChild.code !== 0 && !/IP_NOT_BLOCKED/.test(ipBlockChild.out) && /REFUSED/.test(ipBlockChild.out),
    threw: (ipBlockChild.out.match(/REFUSED:[^\n]*/) || [null])[0],
  });
  // also block the bare IP with a port
  ok("assertAllowedBase('http://35.212.46.254:8001') THROWS", () => assertAllowedBase('http://35.212.46.254:8001'), false);

  // (2) CLI branch exits non-zero on a blocked host (shell/workflow self-gating).
  const cliBlocked = spawnSync(process.execPath, [process.argv[1], 'https://georges232.sg-host.com'], { encoding: 'utf8' });
  cases.push({
    name: "CLI `node host-guard.mjs https://georges232.sg-host.com` exits NON-ZERO",
    passed: cliBlocked.status !== 0 && /REFUSED/.test((cliBlocked.stdout || '') + (cliBlocked.stderr || '')),
    threw: cliBlocked.status !== 0 ? null : `exit ${cliBlocked.status} (expected non-zero)`,
  });
  // CLI exits 0 on an allowed host
  const cliAllowed = spawnSync(process.execPath, [process.argv[1], 'http://localhost:8001'], { encoding: 'utf8' });
  cases.push({
    name: "CLI `node host-guard.mjs http://localhost:8001` exits 0",
    passed: cliAllowed.status === 0 && /ALLOWED/.test(cliAllowed.stdout || ''),
    threw: cliAllowed.status === 0 ? null : `exit ${cliAllowed.status} (expected 0)`,
  });

  // (3) guardedFetch rejects a manual-redirect whose Location points at a blocked host. We mock the
  // global fetch with a stub that returns a 302 → blocked Location, then assert guardedFetch THROWS
  // before following it. (Pure in-process; no real network.)
  {
    const realFetch = globalThis.fetch;
    let followedBlocked = false;
    globalThis.fetch = async (u, _o) => {
      const s = String(u);
      if (/georges232\.sg-host\.com/.test(s)) { followedBlocked = true; return { status: 200, headers: { get: () => null } }; }
      // first hop (allowed host) → 302 to the paused shared host
      return { status: 302, headers: { get: (h) => (h.toLowerCase() === 'location' ? 'https://georges232.sg-host.com/evil' : null) } };
    };
    let threw = null;
    try { await guardedFetch('http://localhost:8001/redir'); } catch (e) { threw = e; }
    globalThis.fetch = realFetch;
    cases.push({
      name: 'guardedFetch THROWS on a 302 → blocked Location (and does NOT follow it)',
      passed: threw !== null && !followedBlocked && /REFUSED/.test(threw.message || ''),
      threw: threw && !followedBlocked ? null : (followedBlocked ? 'FOLLOWED the blocked redirect' : 'did not throw'),
    });
  }
  // guardedFetch FOLLOWS a redirect to an allowed host (positive control — don't over-block).
  {
    const realFetch = globalThis.fetch;
    let hops = 0;
    globalThis.fetch = async (u, o) => {
      hops++;
      // force-manual must be honored on every hop
      if (o && o.redirect !== 'manual') throw new Error('redirect not forced to manual');
      if (hops === 1) return { status: 302, headers: { get: (h) => (h.toLowerCase() === 'location' ? 'http://127.0.0.1:8001/final' : null) } };
      return { status: 200, headers: { get: () => null } };
    };
    let res = null, threw = null;
    try { res = await guardedFetch('http://localhost:8001/start'); } catch (e) { threw = e; }
    globalThis.fetch = realFetch;
    cases.push({
      name: 'guardedFetch FOLLOWS a 302 → allowed Location (200, manual honored each hop)',
      passed: threw === null && res && res.status === 200 && hops === 2,
      threw: threw ? threw.message : (res && res.status === 200 ? null : `unexpected (hops=${hops})`),
    });
  }

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
    // CLI gate: `node sandbox/host-guard.mjs <url>` → exit 0 if allowed, non-zero (with the
    // REFUSED message on stderr) if blocked, so shell/workflow strings can gate themselves, e.g.
    //   node sandbox/host-guard.mjs "$BASE" && curl "$BASE/..."   # curl only runs if allowed
    const urlArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
    if (urlArg) {
      try {
        assertAllowedBase(urlArg);
        console.log(`ALLOWED: ${urlArg}`);
        process.exit(0);
      } catch (e) {
        console.error(e.message);
        process.exit(2);
      }
    } else {
      console.log('ALLOWED_HOSTS:', [...ALLOWED_HOSTS].join(', '));
      console.log('BLOCKED_PATTERNS:', BLOCKED_PATTERNS.map((r) => r.toString()).join(', '));
      console.log('RENDER_SERIAL:', RENDER_SERIAL);
      console.log('Usage: node sandbox/host-guard.mjs <url>   # exit 0 = allowed, non-zero = blocked');
      console.log('Run with --selftest to verify the guard offline.');
    }
  }
}

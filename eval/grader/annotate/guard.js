/**
 * @purpose Browser-side §0 SAFETY GUARD for the sticky-note annotation tool. A faithful
 * MIRROR of sandbox/host-guard.mjs's allow/block policy, written as a plain ES module so it
 * runs unbundled in the page (and in node for the offline selftest). The tool must NEVER point
 * its clone iframe / overlay at anything but the local Docker sandbox; in particular it must
 * refuse the paused shared SiteGround host (georges232 / *.sg-host.com / its IP literal) that
 * was overloaded 2026-06-14.
 *
 * The annotation tool is READ-ONLY on the clone (it never PUTs / saves / renders a page), but it
 * DOES navigate an iframe to the clone and inject an overlay — so a stray base would (a) leak the
 * tool onto a forbidden host and (b) break same-origin (elementsFromPoint / getComputedStyle need
 * same-origin). Gating the iframe.src through assertCloneBase() makes both structurally impossible.
 *
 * Policy (kept in lockstep with host-guard.mjs — see that file's block comment for the why):
 *   ALLOW (default-deny allowlist):
 *     • localhost:8001 / 127.0.0.1:8001            — the local Docker Elementor sandbox (the ONE target).
 *     • host of CLONE_ALLOWED_HOSTS (build-time)   — optional comma-separated escape hatch (e.g. a
 *                                                    provisioned training instance). Mirrors JOIST_ALLOWED_HOSTS.
 *   BLOCK (hard-block, wins over allowlist):
 *     • /\.sg-host\.com$/i, /georges232/i, /^35\.212\.46\.254(:\d+)?$/  — the paused shared host + its IP.
 *
 * Unlike the server guard, the DEFAULT here is localhost:8001 ONLY (no JOIST_TRAINING_BASE auto-add) —
 * the tool's single legitimate target is the local sandbox; a training instance must be opted in
 * explicitly via CLONE_ALLOWED_HOSTS so the in-page default can never silently widen.
 */

// Optional build-time escape hatch (a comma-separated host[:port] list). In the browser this is
// undefined unless serve.mjs injects window.CLONE_ALLOWED_HOSTS; in node it reads the env var.
function extraAllowed() {
  let raw = '';
  if (typeof globalThis !== 'undefined' && typeof globalThis.CLONE_ALLOWED_HOSTS === 'string') {
    raw = globalThis.CLONE_ALLOWED_HOSTS;
  } else if (typeof process !== 'undefined' && process.env && process.env.CLONE_ALLOWED_HOSTS) {
    raw = process.env.CLONE_ALLOWED_HOSTS;
  }
  return String(raw || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function allowedHosts() {
  const set = new Set(['localhost:8001', '127.0.0.1:8001']);
  for (const h of extraAllowed()) set.add(h);
  return set;
}

/** Hard-block patterns — these refuse even if a host somehow ended up allowlisted. */
export const BLOCKED_PATTERNS = [/\.sg-host\.com$/i, /georges232/i, /^35\.212\.46\.254(:\d+)?$/];

/** Extract a normalized host[:port] from a base URL/string. Lenient about a missing scheme. */
export function hostOf(base) {
  if (!base) return '';
  let s = String(base).trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
  try { return new URL(s).host.toLowerCase(); } catch { return ''; }
}

/**
 * Assert that `base` targets the allowed clone sandbox. Throws LOUDLY otherwise.
 * Order matters: blocked patterns checked FIRST so they win over any allowlisting.
 * @returns {string} the same base, when allowed.
 */
export function assertCloneBase(base) {
  const host = hostOf(base);
  if (!host) {
    throw new Error(`REFUSED: cannot parse a host from clone base ${JSON.stringify(base)}; the annotator only targets localhost:8001.`);
  }
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(host)) {
      throw new Error(`REFUSED: ${host} is a blocked/paused host (shared SiteGround was overloaded 2026-06-14). The annotator only targets localhost:8001.`);
    }
  }
  if (!allowedHosts().has(host)) {
    throw new Error(`REFUSED: ${host} is not an allowed clone host; the annotator only targets localhost:8001 (or CLONE_ALLOWED_HOSTS).`);
  }
  return base;
}

/**
 * Resolve the effective clone base: explicit || CLONE_BASE (build-time) || localhost:8001, then GUARD it,
 * so even the DEFAULT can never be a remote host and an override can't stray.
 */
export function resolveCloneBase(explicit) {
  let envBase = '';
  if (typeof globalThis !== 'undefined' && typeof globalThis.CLONE_BASE === 'string') envBase = globalThis.CLONE_BASE;
  else if (typeof process !== 'undefined' && process.env && process.env.CLONE_BASE) envBase = process.env.CLONE_BASE;
  const base = explicit || envBase || 'http://localhost:8001';
  return assertCloneBase(base);
}

/**
 * Build the clone page URL, host-guarded. `target` is either:
 *   • a numeric page id  → `<base>/?page_id=<id>`  (works when pretty permalinks are off), OR
 *   • a permalink slug/path (e.g. "holdout-supabase-collisionfix" or "/holdout-…/") → `<base>/<slug>/`.
 * IMPORTANT: the PUBLISHED permalink render is what carries the Elementor widget tree (and the
 * --joist-src stamps) on this sandbox; the ?preview= query needs an auth nonce and returns empty
 * unauthenticated — so prefer the permalink slug for a published clone. The base is host-guarded so it
 * can only ever resolve to localhost:8001.
 */
export function cloneUrlForPage(target, explicitBase) {
  const base = resolveCloneBase(explicitBase).replace(/\/+$/, '');
  const t = String(target == null ? '' : target).trim();
  if (!t) throw new Error('REFUSED: empty clone target (page id or permalink slug required).');
  if (/^\d+$/.test(t)) return `${base}/?page_id=${t}`;
  // a slug / permalink path: strip a full URL down to its path, block any host swap, normalize slashes.
  let pathPart = t;
  if (/^https?:\/\//i.test(t)) { assertCloneBase(t); pathPart = new URL(t).pathname; }
  pathPart = '/' + pathPart.replace(/^\/+/, '').replace(/\/+$/, '');
  if (/[?#]/.test(pathPart) || pathPart.includes('..')) throw new Error(`REFUSED: unsafe permalink ${JSON.stringify(t)}.`);
  return `${base}${pathPart === '/' ? '/' : pathPart + '/'}`;
}

// Offline selftest hook for _annotate-selftest.mjs (and `node guard.js --selftest`).
export function _guardSelftest() {
  const cases = [];
  const ok = (name, fn, expectPass) => {
    let threw = null;
    try { fn(); } catch (e) { threw = e; }
    cases.push({ name, passed: expectPass ? threw === null : threw !== null, threw: threw && threw.message });
  };
  ok("assertCloneBase('http://localhost:8001') PASSES", () => assertCloneBase('http://localhost:8001'), true);
  ok("assertCloneBase('http://127.0.0.1:8001') PASSES", () => assertCloneBase('http://127.0.0.1:8001'), true);
  ok("assertCloneBase('https://georges232.sg-host.com') THROWS", () => assertCloneBase('https://georges232.sg-host.com'), false);
  ok("assertCloneBase('https://foo.sg-host.com') THROWS", () => assertCloneBase('https://foo.sg-host.com'), false);
  ok("assertCloneBase('http://35.212.46.254:8001') THROWS", () => assertCloneBase('http://35.212.46.254:8001'), false);
  ok("assertCloneBase('https://random-host.com') THROWS (not allowlisted)", () => assertCloneBase('https://random-host.com'), false);
  ok("assertCloneBase('http://localhost:8080') THROWS (wrong port)", () => assertCloneBase('http://localhost:8080'), false);
  ok("cloneUrlForPage(2551) builds a localhost page_id URL", () => {
    const u = cloneUrlForPage(2551);
    if (u !== 'http://localhost:8001/?page_id=2551') throw new Error('bad url ' + u);
  }, true);
  ok("cloneUrlForPage('holdout-supabase') builds a localhost permalink URL", () => {
    const u = cloneUrlForPage('holdout-supabase');
    if (u !== 'http://localhost:8001/holdout-supabase/') throw new Error('bad url ' + u);
  }, true);
  ok("cloneUrlForPage strips a full clone URL to its path", () => {
    const u = cloneUrlForPage('http://localhost:8001/holdout-supabase/');
    if (u !== 'http://localhost:8001/holdout-supabase/') throw new Error('bad url ' + u);
  }, true);
  ok("cloneUrlForPage rejects a sg-host base", () => cloneUrlForPage(2551, 'https://georges232.sg-host.com'), false);
  ok("cloneUrlForPage rejects a full URL pointing at a blocked host", () => cloneUrlForPage('https://georges232.sg-host.com/x/'), false);
  ok("cloneUrlForPage rejects a permalink with traversal", () => cloneUrlForPage('../../etc/passwd'), false);
  return cases;
}

// `node guard.js --selftest` CLI for ad-hoc checks (the canonical run is _annotate-selftest.mjs).
if (typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--selftest')) {
  const cases = _guardSelftest();
  for (const c of cases) console.log(`${c.passed ? 'PASS' : 'FAIL'}  ${c.name}`);
  const failed = cases.filter((c) => !c.passed);
  console.log(`\nguard selftest: ${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${cases.length} cases)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

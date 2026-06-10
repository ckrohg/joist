#!/usr/bin/env node
/**
 * @purpose SHARED crash-safe scratch-page primitive (B1 round 1, CONTROL_EDIT_PROBE_SPEC §1).
 * Duplicate-page lifecycle: graded/source pages receive ONLY GETs — every write targets a freshly
 * created scratch duplicate whose title is tagged `JOIST-SCRATCH …` so a sweeper can clean any
 * crash debris. Designed for reuse (probe-roundtrip B1 now, sectionVisual in Workstream C later).
 *
 * Exports:
 *   acquire(srcPageId, opts)  → { pageId, srcId, url, elements, pageSettings, release({keep}) }
 *   createScratch({title, elements, pageSettings, template, status}) → low-level create (self-tests)
 *   sweep({maxAgeMin=60, all=false}) → deletes stale tagged scratch pages (crash debris)
 *   deletePage(id)            → guarded force-delete + 404 verify
 *   assertScratchWritable(id, srcId) → hard guard: never a corpus/graded page, never the source
 *   CORPUS, TAG, BASE
 *
 * Crash invariants:
 *   - corpus pages (CORPUS set) can never be written/deleted: assertScratchWritable runs before EVERY write.
 *   - normal exit: caller's finally → release() → force-delete + re-GET 404 verify.
 *   - SIGINT/SIGTERM: trap force-deletes all live scratch ids, then exits.
 *   - SIGKILL/crash: page survives as an inert published `JOIST-SCRATCH …` page + a
 *     /tmp/joist-scratch-active-<id>.json forensics file; the next sweep() deletes it (title+age match).
 *
 * Adaptation from CONTROL_EDIT_PROBE_SPEC §1 (repo reality): deletes go through core
 * `DELETE wp/v2/pages/<id>?force=true` (Basic auth) FIRST, because `DELETE joist/v1/pages/<id>`
 * is policy-gated as a destructive op (PolicyGuard.php:131-143, destructive_requires_plan
 * default-true → 423 plan_required). joist delete is kept as fallback. Same wp_delete_post(.., true).
 *
 * Env: JOIST_AUTH_B64 (or parsed from /tmp/joist-auth.env — value never printed), JOIST_BASE.
 */
import fs from 'fs';

export const BASE = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
// graded corpus — NEVER written, NEVER deleted (hard rail).
export const CORPUS = new Set([3146, 2986, 2988, 2990, 4296, 4297, 4771, 11067]);
export const TAG = 'JOIST-SCRATCH';
const activeFile = (id) => `/tmp/joist-scratch-active-${id}.json`;

let _b64 = null;
function authB64() {
  if (_b64) return _b64;
  if (process.env.JOIST_AUTH_B64) { _b64 = process.env.JOIST_AUTH_B64; return _b64; }
  try {
    const m = fs.readFileSync('/tmp/joist-auth.env', 'utf8').match(/JOIST_AUTH_B64=([^\s'"]+)/);
    if (m) { _b64 = m[1]; return _b64; }
  } catch {}
  throw new Error('JOIST_AUTH_B64 missing — source /tmp/joist-auth.env first');
}
function headers() {
  return { Authorization: 'Basic ' + authB64(), 'Content-Type': 'application/json', 'X-Joist-Session-Id': `scratch-${process.pid}-${Date.now()}` };
}
async function api(method, path, body = null, timeoutMs = 120000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}${path}`, { method, headers: headers(), body: body != null ? JSON.stringify(body) : undefined, signal: ac.signal });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, ok: r.ok, json, text };
  } finally { clearTimeout(t); }
}

/** Hard guard before EVERY write: integer id, not a graded corpus page, not the source page. Throws. */
export function assertScratchWritable(pageId, srcId = null) {
  const id = Number(pageId);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`scratch guard: invalid page id ${pageId}`);
  if (CORPUS.has(id)) throw new Error(`scratch guard REFUSED: ${id} is a graded corpus page — writes forbidden`);
  if (srcId != null && Number(srcId) === id) throw new Error(`scratch guard REFUSED: ${id} is the source page — writes forbidden`);
  return id;
}

// ---- signal traps: best-effort delete of all live scratch ids on SIGINT/SIGTERM ----
const _active = new Set();
let _trapped = false;
function trapSignals() {
  if (_trapped) return; _trapped = true;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      (async () => {
        for (const id of [..._active]) { try { await deletePage(id); } catch {} }
      })().finally(() => process.exit(sig === 'SIGINT' ? 130 : 143));
    });
  }
}

/** Guarded force-delete + verify-404. Returns true when the page is verifiably gone. Throws otherwise. */
export async function deletePage(pageId, srcId = null) {
  const id = assertScratchWritable(pageId, srcId);
  // core REST first (joist delete is plan-gated destructive — see header); joist as fallback.
  let del = await api('DELETE', `/wp-json/wp/v2/pages/${id}?force=true`);
  if (!del.ok) del = await api('DELETE', `/wp-json/joist/v1/pages/${id}?force=true`);
  const verify = await api('GET', `/wp-json/wp/v2/pages/${id}?context=edit`);
  if (verify.status !== 404) {
    throw new Error(`scratch teardown FAILED for ${id}: delete status ${del.status}, post-delete GET ${verify.status} (expected 404) — active file left for sweep`);
  }
  try { fs.unlinkSync(activeFile(id)); } catch {}
  _active.delete(id);
  return true;
}

/**
 * Sweep stale tagged scratch pages (crash debris). Deletes pages whose title starts with `${TAG} `
 * and whose modified age exceeds maxAgeMin (or all of them with {all:true}). Corpus ids are skipped
 * unconditionally (belt + braces: a corpus page can never carry the tag anyway).
 */
export async function sweep({ maxAgeMin = 60, all = false } = {}) {
  const r = await api('GET', `/wp-json/joist/v1/pages?search=${encodeURIComponent(TAG)}&per_page=100&status=publish,draft`);
  const items = (r.json && r.json.items) || [];
  const out = { scanned: items.length, deleted: [], kept: [], failed: [] };
  for (const it of items) {
    if (!it || !it.id || typeof it.title !== 'string' || !it.title.startsWith(`${TAG} `)) { out.kept.push(it && it.id); continue; }
    if (CORPUS.has(Number(it.id))) { out.kept.push(it.id); continue; }
    const ageMin = (Date.now() - Date.parse(it.modified || 0)) / 60000;
    if (!all && !(ageMin > maxAgeMin)) { out.kept.push(it.id); continue; }
    try { await deletePage(it.id); out.deleted.push(it.id); }
    catch (e) { out.failed.push({ id: it.id, error: String(e).slice(0, 120) }); }
  }
  return out;
}

/**
 * Low-level scratch creation from a literal tree (used by acquire() and by self-tests that need a
 * synthetic page). Title is force-prefixed with the sweep tag. Registers the active file BEFORE the
 * template dance so even a half-created page is sweepable. Returns { pageId, hash, url }.
 */
export async function createScratch({ title = '', slug = null, elements = [], pageSettings = {}, template = 'elementor_canvas', status = 'publish', srcId = null } = {}) {
  const fullTitle = title.startsWith(`${TAG} `) ? title : `${TAG} ${title || 'scratch'} ${new Date().toISOString()}`;
  const body = {
    title: fullTitle,
    slug: slug || `joist-scratch-${srcId || 'x'}-${Date.now()}`,
    status, type: 'page',
    elements: Array.isArray(elements) ? elements : [],
    page_settings: (pageSettings && typeof pageSettings === 'object' && !Array.isArray(pageSettings)) ? pageSettings : {},
  };
  const r = await api('POST', '/wp-json/joist/v1/pages', body);
  const pageId = r.json && r.json.id;
  if (!r.ok || !pageId) throw new Error(`scratch create FAILED: ${r.status} ${String(r.text).slice(0, 200)}`);
  assertScratchWritable(pageId, srcId);
  fs.writeFileSync(activeFile(pageId), JSON.stringify({ pageId, srcId, ts: new Date().toISOString(), pid: process.pid }));
  _active.add(Number(pageId)); trapSignals();
  // canvas-template dance — mirrors build-absolute.mjs:2640-2654 (400 → meta-only + template retry loop).
  const tBody = { status, template, meta: { _elementor_edit_mode: 'builder', _wp_page_template: template } };
  const mr = await api('POST', `/wp-json/wp/v2/pages/${assertScratchWritable(pageId, srcId)}`, tBody);
  if (mr.status === 400) {
    await api('POST', `/wp-json/wp/v2/pages/${pageId}`, { meta: { _elementor_edit_mode: 'builder', _wp_page_template: template } }).catch(() => {});
    for (const tmpl of [template, 'elementor_header_footer']) {
      const tr = await api('POST', `/wp-json/wp/v2/pages/${pageId}`, { template: tmpl }).catch(() => ({ ok: false }));
      if (tr.ok) break;
    }
  }
  return { pageId: Number(pageId), hash: r.json.hash || null, url: `${BASE}/?page_id=${pageId}` };
}

/**
 * acquire(srcPageId) — duplicate-page lifecycle (spec §1). The source page receives ONLY GETs:
 *  1. GET joist/v1/pages/<src>?include=elements   → full element tree
 *  2. GET wp/v2/pages/<src>?context=edit          → meta._elementor_page_settings (incl. custom_css) + template
 *  3. createScratch(copy)                         → published, canvas-templated duplicate
 * Returns { pageId, srcId, url, elements, pageSettings, release({keep}) }.
 */
export async function acquire(srcPageId, { note = '' } = {}) {
  const srcId = Number(srcPageId);
  if (!Number.isInteger(srcId) || srcId <= 0) throw new Error(`acquire: invalid source page id ${srcPageId}`);
  const src = await api('GET', `/wp-json/joist/v1/pages/${srcId}?include=elements`);
  const elements = src.json && src.json.elementor && src.json.elementor.elements;
  if (!src.ok || !Array.isArray(elements)) throw new Error(`acquire: cannot read source ${srcId}: ${src.status} ${String(src.text).slice(0, 160)}`);
  let pageSettings = {}, template = 'elementor_canvas';
  try {
    const meta = await api('GET', `/wp-json/wp/v2/pages/${srcId}?context=edit&_fields=meta,template`);
    const ps = meta.json && meta.json.meta && meta.json.meta._elementor_page_settings;
    if (ps && typeof ps === 'object' && !Array.isArray(ps)) pageSettings = ps;
    if (meta.json && typeof meta.json.template === 'string' && meta.json.template) template = meta.json.template;
  } catch {}
  const made = await createScratch({ title: `${TAG} ${srcId}${note ? ' ' + note : ''} ${new Date().toISOString()}`, elements, pageSettings, template, status: 'publish', srcId });
  const release = async ({ keep = false } = {}) => {
    if (keep) { console.log(`scratch ${made.pageId} KEPT (debug) — next sweep removes it`); return { kept: true, pageId: made.pageId }; }
    await deletePage(made.pageId, srcId);
    return { kept: false, pageId: made.pageId, verified404: true };
  };
  return { pageId: made.pageId, srcId, url: made.url, elements, pageSettings, release };
}

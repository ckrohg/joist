// @purpose CEK Track A — surgical refine/edit loop. Locate ONE widget by type/text,
// read it, and patch JUST that band via /pages/{id}/patch update_settings — never a full
// rebuild. The payoff of the W2.2 id-map + find/get_element primitives: prompt-to-edit a
// landed clone ("change the hero headline") and grader-directed band fixes both reduce to
// locate → read → patch → verify.
//
// Agent-facing path: joist_find_element → joist_get_element → joist_create_plan(update_settings).
// This is the client-side equivalent for the eval harness, using only already-deployed REST
// (GET /pages/{id}?include=elements + POST /pages/{id}/patch through the validated DocumentWriter).
//
// Usage:
//   JOIST_AUTH_B64=<base64 user:pass> node surgical-edit.mjs --page <id> \
//     --find-type heading --find-text "old headline" --set-title "new headline"
//   ...or --set '{"title_color":"#A7F432"}' for an arbitrary settings merge. Add --dry to preview.

import process from 'node:process';
// §0 SAFETY GUARD: default flipped from the PAUSED shared host georges232.sg-host.com → local sandbox;
// resolveBase() throws LOUDLY before any fetch/PUT if JOIST_BASE points to a non-training host.
import { resolveBase } from '../../sandbox/host-guard.mjs';

// existence check (not truthiness) so an empty value like --set-title "" is honored (blank a heading).
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes('--' + n);

const base = resolveBase((process.env.JOIST_BASE || 'http://localhost:8001').replace(/\/$/, ''));
const b64 = process.env.JOIST_AUTH_B64;
const pageId = arg('page');
const findType = (arg('find-type') || '').toLowerCase();
const findText = (arg('find-text') || '').toLowerCase();
const setTitle = arg('set-title');
const setJson = arg('set');
const dry = flag('dry');

if (!b64 || !pageId || (!findType && !findText)) {
  console.error('need JOIST_AUTH_B64 + --page <id> + at least one of --find-type/--find-text, plus --set-title or --set <json>');
  process.exit(2);
}
let patch = setTitle != null ? { title: setTitle } : null;
if (setJson) { try { patch = JSON.parse(setJson); } catch (e) { console.error('--set must be valid JSON:', e.message); process.exit(2); } }
if (!patch && !dry) { console.error('need --set-title "<text>" or --set \'<json>\' (or --dry to just locate)'); process.exit(2); }

const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'surgical-' + pageId };

const elementText = (el) => {
  const s = (el && el.settings) || {};
  for (const k of ['title', 'text', 'editor', 'caption', 'shortcode']) {
    if (typeof s[k] === 'string' && s[k]) return s[k].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return '';
};

// Depth-first: first widget matching type AND text (whichever was supplied).
function locate(nodes, path = []) {
  for (const n of (nodes || [])) {
    if (!n || typeof n !== 'object') continue;
    const cur = [...path, n.id];
    if ((n.elType) === 'widget') {
      const wt = String(n.widgetType || '').toLowerCase();
      const txt = elementText(n);
      const typeOk = !findType || wt === findType;
      const textOk = !findText || txt.toLowerCase().includes(findText);
      if (typeOk && textOk) return { el: n, path: cur, snippet: txt };
    }
    if (Array.isArray(n.elements)) { const r = locate(n.elements, cur); if (r) return r; }
  }
  return null;
}

(async () => {
  // 1. Read tree + current page hash (the CAS token).
  const g = await fetch(`${base}/wp-json/joist/v1/pages/${pageId}?include=elements`, { headers });
  if (!g.ok) { console.error('GET tree failed', g.status, (await g.text()).slice(0, 160)); process.exit(1); }
  const payload = await g.json();
  const tree = (payload.elementor && payload.elementor.elements) || [];
  let expected = payload.elementor && payload.elementor.hash;

  // 2. Locate the target widget.
  const hit = locate(tree);
  if (!hit) { console.error(`no widget matched type='${findType}' text='${findText}' on page ${pageId}`); process.exit(1); }
  console.log(`located ${hit.el.widgetType} ${hit.el.id} — "${hit.snippet.slice(0, 80)}"  path=${hit.path.join('>')}`);
  if (dry) { console.log('--dry: located only, no write'); return; }

  // 3. Patch JUST that element (update_settings merges over existing settings; no rebuild).
  const op = { op: 'update_settings', element_id: hit.el.id, settings: patch };
  let r, txt;
  for (let a = 0; a < 5; a++) {
    r = await fetch(`${base}/wp-json/joist/v1/pages/${pageId}/patch`, {
      method: 'POST', headers,
      body: JSON.stringify({ ops: [op], expected_hash: expected, intent: `surgical edit ${hit.el.widgetType} ${hit.el.id}` }),
    });
    txt = await r.text();
    if (r.status !== 409) break;
    try { expected = JSON.parse(txt).details.current_hash; } catch {}      // CAS stale → re-read hash + retry
    await new Promise((res) => setTimeout(res, 300));
  }
  if (!r.ok) { console.error('PATCH failed', r.status, txt.slice(0, 200)); process.exit(1); }
  const j = JSON.parse(txt);
  console.log(`PATCH ${r.status} — applied ${j.applied_ops} op to ${hit.el.id}; new_hash ${String(j.new_hash).slice(0, 22)}…`);
  console.log(`patched settings: ${JSON.stringify(patch)}`);
})();

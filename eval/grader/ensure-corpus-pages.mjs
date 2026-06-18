#!/usr/bin/env node
/**
 * @purpose Idempotently ensure each corpus site has a real, writable Elementor page on the CURRENT sandbox
 * instance, and emit the name→pageId map consumed by corpus-run.mjs (default /tmp/joist-corpus-pages.json).
 * WHY: page IDs are INSTANCE-SPECIFIC — a re-provisioned local docker renumbers every page, so corpus-run's
 * hardcoded IDs go stale and each build's PUT fails (404 page → no hash → 400 expected_hash_required). Run
 * once after (re)provisioning:  source /tmp/joist-auth-1.env && node ensure-corpus-pages.mjs
 * Pages are seeded with empty _elementor_data ('[]') so the joist hash-handshake has a base hash to CAS
 * against (verified: a blank-but-seeded page accepts the build write; a 404/unseeded page does not).
 * Reuses an existing mapped page if it still resolves (200); else creates a fresh one. Host-guarded (JOIST_BASE).
 */
import fs from 'fs';
import { resolveBase } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: never write to a non-training host

const BASE = resolveBase(process.env.JOIST_BASE || 'http://localhost:8001');
const AUTH = process.env.JOIST_AUTH_B64;
if (!AUTH) { console.error('JOIST_AUTH_B64 unset — `source /tmp/joist-auth-1.env` first.'); process.exit(2); }
const OUT = process.env.JOIST_CORPUS_PAGES || '/tmp/joist-corpus-pages.json';
const SITES = ['tailwind', 'supabase', 'resend', 'framer', 'reactdev', 'linear', 'notion']; // MUST match corpus-run.mjs CORPUS names
const H = { Authorization: 'Basic ' + AUTH, 'Content-Type': 'application/json' };

(async () => {
  let map = {};
  try { map = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
  for (const name of SITES) {
    if (map[name] != null) {
      const g = await fetch(`${BASE}/wp-json/wp/v2/pages/${map[name]}`, { headers: H }).catch(() => null);
      if (g && g.status === 200) { console.log(`  ${name.padEnd(9)} reuse  ${map[name]}`); continue; }
    }
    const r = await fetch(`${BASE}/wp-json/wp/v2/pages`, { method: 'POST', headers: H, body: JSON.stringify({
      title: 'joist-corpus-' + name, status: 'publish', template: 'elementor_canvas',
      meta: { _elementor_edit_mode: 'builder', _elementor_data: '[]', _wp_page_template: 'elementor_canvas' },
    }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!j.id) { console.error(`  ${name.padEnd(9)} CREATE FAILED (http ${r ? r.status : 'no-response'})`); continue; }
    map[name] = j.id; console.log(`  ${name.padEnd(9)} create ${j.id}`);
  }
  fs.writeFileSync(OUT, JSON.stringify(map, null, 2));
  console.log(`\nwrote ${OUT}:\n${JSON.stringify(map, null, 2)}`);
})();

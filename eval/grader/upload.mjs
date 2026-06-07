#!/usr/bin/env node
/**
 * Upload captured assets to WP Media via REST (app-password Basic auth), so
 * clones can reference real hosted URLs instead of placeholders/flat fills.
 * Reads JOIST_AUTH_B64 + JOIST_BASE from env (see /tmp/joist-auth.env).
 * Usage: node upload.mjs <file.png> [...] ; writes uploaded.json {file:{id,url}}
 */
import fs from 'fs';
const base = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
const b64 = process.env.JOIST_AUTH_B64;
if (!b64) { console.error('missing JOIST_AUTH_B64'); process.exit(2); }
const auth = 'Basic ' + b64;
const files = process.argv.slice(2);
const out = {};
for (const f of files) {
  const buf = fs.readFileSync(f);
  const name = f.split('/').pop();
  const r = await fetch(base + '/wp-json/wp/v2/media', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="${name}"` },
    body: buf,
  });
  let j = {}; try { j = await r.json(); } catch {}
  console.log(name, '->', r.status, j.source_url || j.code || j.message || '');
  if (j.source_url) out[name] = { id: j.id, url: j.source_url, w: j.media_details?.width, h: j.media_details?.height };
}
fs.writeFileSync('uploaded.json', JSON.stringify(out, null, 2));
console.log('\n✓ wrote uploaded.json');

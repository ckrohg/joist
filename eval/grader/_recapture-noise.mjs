#!/usr/bin/env node
/**
 * @purpose _recapture-noise.mjs — RECAPTURE the SAME external source N times (read-only) to harvest the
 * recapture-jitter NOISE corpus (path (a) of the axisdelta-floor noise model: scroll jitter / lazy-load
 * timing / anti-aliasing). It captures each source URL N times via the EXACT compare-capture.capturePage
 * pipeline the real source side uses (so the noise is faithful, not synthetic), idx-corresponds the runs
 * to themselves (a recapture maps element _idx→_idx — perfect correspondence by construction), and writes
 * the captured record sets to a scratch json the floor builder reads. NO defect labels ever touched.
 *
 * SAFETY: external sources are assertNotBlocked read-only (compare-capture enforces it); no host write,
 * no builder, no git. Slow by nature (network + lazy-settle); run with a long timeout / in background.
 *
 *   node _recapture-noise.mjs --n 2 --out /tmp/recapture-noise.json [--widths 1440,390]
 */
import fs from 'fs';
import { capturePage } from './compare-capture.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const N = Math.max(2, +arg('n', 2));
const OUT = arg('out', '/tmp/recapture-noise.json');
const WIDTHS = arg('widths', '1440,390').split(',').map(Number).filter(Boolean);

const SOURCES = [
  { key: 'overreacted', url: 'https://overreacted.io/a-complete-guide-to-useeffect/', archetype: 'blog' },
  { key: 'tailwind', url: 'https://tailwindcss.com/docs', archetype: 'marketing' },
];

async function main() {
  const out = { _purpose: 'recapture-jitter noise (same source N times)', widths: WIDTHS, n: N, sources: {}, generated_at: new Date().toISOString() };
  for (const s of SOURCES) {
    out.sources[s.key] = { url: s.url, archetype: s.archetype, runs: [] };
    for (let i = 0; i < N; i++) {
      const t0 = Date.now();
      try {
        const cap = await capturePage(s.url, { widths: WIDTHS, scrollY: 800, label: `${s.key}#${i}`, isSource: true });
        out.sources[s.key].runs.push({ run: i, records: cap.records, pageHeightByVw: cap.pageHeightByVw, ms: Date.now() - t0 });
        console.error(`[recapture] ${s.key} run ${i}: ${cap.records.length} records in ${Date.now() - t0}ms`);
      } catch (e) {
        console.error(`[recapture] ${s.key} run ${i} FAILED: ${e.message}`);
        out.sources[s.key].runs.push({ run: i, error: e.message, ms: Date.now() - t0 });
      }
      fs.writeFileSync(OUT, JSON.stringify(out)); // incremental save so a partial result survives a timeout
    }
  }
  console.error(`[recapture] wrote ${OUT}`);
}
main().catch((e) => { console.error('[recapture] FATAL', e && e.stack || e); process.exit(1); });

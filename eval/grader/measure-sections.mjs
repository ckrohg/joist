#!/usr/bin/env node
/**
 * @purpose The AUTO-REVERT GATE's measurement half. Open a RENDERED LOCAL page (the hybrid build) and, for each
 * spliced PRESERVE section — located by the stable Elementor element id stamped on its splice container
 * (`.elementor-element-<id>`) — measure the section's RENDERED band height and whether it introduces HORIZONTAL
 * overflow. The router's post-render gate ((2) hRatio∈[0.98,1.02] vs the SOURCE band, (3) zero h-overflow) is
 * enforced by the BUILDER using these measurements: a preserve section whose rendered band drifts off the pin or
 * pushes the page wider than the viewport is REVERTED to its byte-equivalent native flow arm. This module only
 * MEASURES (no policy) so the gate logic stays in one place (build-hybrid-flow.mjs).
 *
 * SAFETY: only ever opens a LOCAL rendered URL (the caller passes hybRes.url = localhost:8001/?page_id=…). It
 * makes NO write and hits NO remote host. (host-guard governs the WRITE path; this is a read-only screenshot.)
 *
 * USAGE (library — the builder calls this):
 *   import { measureSections } from './measure-sections.mjs';
 *   const m = await measureSections(url, [{ id, srcBandH }], width);
 *   // m.byId[id] = { found, renderedH, top, hOverflow, pageScrollW, viewportW }
 *
 * USAGE (CLI smoke):
 *   node measure-sections.mjs --url 'http://localhost:8001/?page_id=257' --ids id1,id2 [--width 1440]
 */
import { chromium } from 'playwright';

/**
 * Measure rendered band height + horizontal overflow for a set of spliced containers on a rendered page.
 * @param {string} url      a RENDERED page URL (LOCAL only — caller is responsible for the host rail).
 * @param {Array<{id:string, srcBandH:number}>} targets  the spliced container ids to measure.
 * @param {number} width    the desktop viewport width the band is pinned for (default 1440).
 * @returns {Promise<{byId:Object, pageScrollW:number, viewportW:number, pageHasHOverflow:boolean}>}
 */
export async function measureSections(url, targets, width = 1440) {
  const ids = targets.map((t) => t.id);
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  try {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    // settle lazy content + fonts so the measured band height is the painted height, not a pre-load skeleton.
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 600));
      window.scrollTo(0, 0);
      if (document.fonts?.ready) { try { await document.fonts.ready; } catch {} }
      await new Promise((r) => setTimeout(r, 250));
    });
    const out = await page.evaluate(({ ids, W }) => {
      const docEl = document.documentElement;
      const pageScrollW = Math.max(docEl.scrollWidth, document.body.scrollWidth);
      const viewportW = window.innerWidth || W;
      const byId = {};
      for (const id of ids) {
        // the splice container renders as `.elementor-element-<id>` (Elementor's per-element wrapper class).
        const el = document.querySelector('.elementor-element-' + id) || document.getElementById('e-' + id) || null;
        if (!el) { byId[id] = { found: false }; continue; }
        const r = el.getBoundingClientRect();
        const renderedH = Math.round(r.height);
        const top = Math.round(r.y + window.scrollY);
        // does THIS band introduce overflow that BREAKS THE PAGE (router gate (3): "does not push the page wider
        // than the viewport")? The honest signal is page-level horizontal scroll ATTRIBUTABLE to the band:
        //   (a) the band's OWN box extends past the viewport's right edge (it visibly overflows), OR
        //   (b) a descendant whose right edge exceeds the viewport AND is NOT clipped by an overflow:hidden
        //       ancestor inside the band (a clipped child is contained — not a page-breaking overflow).
        // A clipped child (the preserve container pins overflow:hidden) must NOT count: it's bounded by design.
        let hOverflow = Math.round(r.right) > viewportW + 4;
        if (!hOverflow) {
          for (const d of el.querySelectorAll('*')) {
            const dr = d.getBoundingClientRect();
            if (dr.width < 2 || dr.height < 2) continue;
            if (Math.round(dr.right) <= viewportW + 6) continue;
            // is this overflowing descendant CLIPPED by an overflow:hidden/clip ancestor within the band?
            let clipped = false;
            for (let a = d.parentElement; a && a !== el.parentElement; a = a.parentElement) {
              const ox = getComputedStyle(a).overflowX;
              if (/(hidden|clip|scroll|auto)/.test(ox)) { clipped = true; break; }
              if (a === el) break;
            }
            if (!clipped) { hOverflow = true; break; }
          }
        }
        byId[id] = { found: true, renderedH, top, hOverflow };
      }
      return { byId, pageScrollW, viewportW, pageHasHOverflow: pageScrollW > viewportW + 4 };
    }, { ids, W: width });
    return out;
  } finally {
    await browser.close();
  }
}

// ── CLI smoke ────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
  const url = arg('url');
  const ids = String(arg('ids', '')).split(',').map((s) => s.trim()).filter(Boolean);
  const width = +arg('width', 1440);
  if (!url || !ids.length) { console.error('usage: node measure-sections.mjs --url <rendered-url> --ids id1,id2 [--width 1440]'); process.exit(2); }
  const m = await measureSections(url, ids.map((id) => ({ id, srcBandH: 0 })), width);
  console.log(JSON.stringify(m, null, 2));
}

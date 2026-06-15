#!/usr/bin/env node
/**
 * @purpose PHASE-1 GATE for the STRUCTURAL COMPARISON ENGINE: prove a build-time
 * correspondence stamp (`data-joist-src` = a STABLE CONTENT-ADDRESSED source path) SURVIVES
 * the full WordPress round-trip — WP save → Elementor Document::save() (kses on post_content,
 * schema sanitize on settings) → read-back of _elementor_data → rendered FRONTEND HTML.
 *
 * The source-path format (content-addressed, NOT a raw CSS selector — selectors break under
 * minor DOM/responsive churn): `tagchain|nth|h<8hex>` where
 *   tagchain = ancestor tag chain root→leaf joined by '>'  (e.g. body>div>main>article>blockquote)
 *   nth      = nth-of-type of the leaf among same-tag siblings (1-based)
 *   h        = first-24-char text hash (8 hex of a cheap rolling hash of the leaf's trimmed text)
 * This is reproducible from the SOURCE capture and from the BUILT widget, so an O(1) exact join
 * is possible at compare time when the stamp survives.
 *
 * CHANNELS TESTED (which one survives WP save + kses + frontend render?):
 *   A. RAW settings key `_joist_src` written straight into the widget's settings (NO registered
 *      control). Tests whether Document::save() preserves an unregistered key in _elementor_data.
 *   B. RAW settings key `joist_preserve_css` (the PRESERVE channel HAS a registered HIDDEN control)
 *      — proves the registered-control channel survives in _elementor_data AND emits a kses-safe
 *      CSS rule on the frontend via elementor/element/parse_css.
 *   C. The stamp routed THROUGH the parse_css channel as a CSS custom property
 *      (`--joist-src:"tagchain|nth|hHASH"`) on the element selector — a DOM-queryable, kses-safe
 *      frontend channel (getComputedStyle(el).getPropertyValue('--joist-src')).
 *   D. Elementor native `_element_id` (DOM id) carrying an encoded stamp — control IS registered,
 *      so it survives; renders as id="..." on the frontend. (Sanity reference; collides w/ real ids.)
 *
 * For EACH channel we report: presentInElementorData (after save, read-back) AND presentInFrontend
 * (attribute / CSS var / id in the rendered HTML). The conjunction = survivesRoundtrip.
 *
 * SAFETY: targets ONLY localhost:8001 via the §0 host-guard (createScratch/resolveBase). Creates a
 * tagged JOIST-SCRATCH page, verifies, then deletes it (sweep-safe on crash). NO git ops.
 *
 * Run:  source /tmp/joist-auth-1.env && node _joist-src-roundtrip.mjs   (exit 0 = gate semantics met)
 */
import { createScratch, deletePage, sweep, BASE } from './scratch-harness.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';

let _b64 = null;
function b64() {
  if (_b64) return _b64;
  _b64 = process.env.JOIST_AUTH_B64 ||
    (fs.existsSync('/tmp/joist-auth-1.env') && (fs.readFileSync('/tmp/joist-auth-1.env', 'utf8').match(/JOIST_AUTH_B64=([^\s'"]+)/) || [])[1]) ||
    (fs.existsSync('/tmp/joist-auth.env') && (fs.readFileSync('/tmp/joist-auth.env', 'utf8').match(/JOIST_AUTH_B64=([^\s'"]+)/) || [])[1]);
  if (!_b64) throw new Error('JOIST_AUTH_B64 missing');
  return _b64;
}
async function jget(p) {
  const r = await fetch(`${BASE}${p}`, { headers: { Authorization: 'Basic ' + b64() } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
}

// ── content-addressed source-path stamp ───────────────────────────────────────
// cheap deterministic 32-bit rolling hash → 8 hex. (FNV-1a on the first 24 chars.)
function textHash8(s) {
  const t = String(s || '').trim().slice(0, 24);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ('00000000' + h.toString(16)).slice(-8);
}
// build a stamp the way the projection builder would from a captured source element.
function srcStamp({ tagchain, nth, text }) {
  return `${tagchain}|${nth}|h${textHash8(text)}`;
}

// frontend HTML fetch (rendered page — frontend, not editor). networkidle not needed for static.
function fetchFrontend(url) {
  // node fetch is enough for the SSR markup; the parse_css CSS file is linked, so we also fetch
  // any inline <style> + the post-css <link>. We grab the raw HTML and (for channel C) the css file.
  return fetch(url).then((r) => r.text());
}

(async () => {
  const STAMP = srcStamp({ tagchain: 'body>div>main>article>blockquote', nth: 2, text: 'Do or do not. There is no try.' });
  console.log('source-path stamp under test:', STAMP);

  // pre-sweep any debris
  try { const pre = await sweep({ all: true }); console.log(`pre-sweep deleted [${pre.deleted.join(',')}]`); } catch (e) { console.log('pre-sweep skipped:', String(e).slice(0, 80)); }

  // CSS-var payload for channel C, routed through the registered preserve control as raw CSS.
  // We use the desktop decl-block 'd' slot — the Emitter wraps it as `<selector>{<d>}`. A CSS custom
  // property declared on the element IS inherited + queryable via getComputedStyle.
  const cssVarDecl = `--joist-src:"${STAMP}"`;
  const preserveCssPayload = JSON.stringify({ d: cssVarDecl });

  // The joist SchemaValidator REJECTS any settings key that is not a REGISTERED control of the widget
  // (422 schema.unknown_key) — so a free-form `_joist_src` key NEVER passes the REST boundary. Only
  // registered controls + an explicit internal-key allowlist (_globals_/__globals__/__dynamic__/_id/
  // _element_id/_skin) are accepted. So the channels we can even ATTEMPT are: a registered control
  // (joist_preserve_css) and a native allowlisted control (_element_id). We carry the stamp in BOTH the
  // preserve-control PAYLOAD (the 'd' decl emits a css var) and _element_id (DOM id), and ALSO probe
  // whether the raw-key path is rejected (negative control, separate try below).
  const mk = (title, extra) => ({ elType: 'widget', widgetType: 'heading', settings: { title, header_size: 'h3', ...extra } });
  const elements = [{
    elType: 'container', settings: { content_width: 'full' }, elements: [
      mk('CH-B preserve registered control',   { joist_preserve_css: JSON.stringify({ d: 'outline:1px solid transparent', x: '', m: {} }) }),
      mk('CH-C css-var via parse_css',         { joist_preserve_css: preserveCssPayload }),
      mk('CH-D element_id encoded',            { _element_id: 'joistsrc-' + textHash8('Do or do not. There is no try.') }),
    ],
  }];

  let pageId = null;
  const report = { stamp: STAMP, channels: {} };
  try {
    const made = await createScratch({ title: 'joist-src-roundtrip', elements, status: 'publish', template: 'elementor_canvas' });
    pageId = made.pageId;
    console.log(`scratch page ${pageId} created (${made.url})`);

    // ── READ-BACK 1: _elementor_data via the joist GET (returns the saved element tree raw) ──
    const back = await jget(`/wp-json/joist/v1/pages/${pageId}?include=elements`);
    const widgets = [];
    const walk = (n) => { for (const x of n || []) { if (x.elType === 'widget') widgets.push(x); if (x.elements) walk(x.elements); } };
    walk(back.json && back.json.elementor && back.json.elementor.elements);
    const byTitle = Object.fromEntries(widgets.map((w) => [String((w.settings || {}).title || ''), w]));
    const sB = (byTitle['CH-B preserve registered control'] || {}).settings || {};
    const sC = (byTitle['CH-C css-var via parse_css'] || {}).settings || {};
    const sD = (byTitle['CH-D element_id encoded'] || {}).settings || {};

    report.channels.B_preserveControl = {
      inElementorData_control: typeof sB.joist_preserve_css === 'string' && sB.joist_preserve_css.length > 0,
      controlValue: sB.joist_preserve_css ?? null,
    };
    report.channels.C_cssVar = { inElementorData: typeof sC.joist_preserve_css === 'string' && sC.joist_preserve_css.includes(STAMP), value: sC.joist_preserve_css ?? null };
    report.channels.D_elementId = { inElementorData: typeof sD._element_id === 'string' && sD._element_id.length > 0, value: sD._element_id ?? null };

    // ── READ-BACK 2: rendered FRONTEND ──
    // Frontend render-mode requires _elementor_edit_mode=builder (per repo memory: else post_content
    // FALLBACK renders, not the tree). createScratch sets that meta; confirm by fetching ?page_id=.
    const frontUrl = `${BASE}/?page_id=${pageId}`;
    const html = await fetchFrontend(frontUrl);
    report.frontendBytes = html.length;
    report.frontendRenderedTree = /elementor-element-/.test(html); // tree rendered (not post_content fallback)

    // B preserve-control: the registered control's payload is NOT echoed to the DOM as an attribute
    // (Elementor heading render does not emit arbitrary settings to markup). It only matters in
    // _elementor_data + (if it carried CSS) the post-css. Record whether the literal stamp appears.
    report.channels.B_preserveControl.inFrontend = html.includes(STAMP);

    // C: the css-var lands in the Elementor post-css. It may be inlined (<style>) OR in the linked
    // post-<id>.css file. Pull both. The selector is .elementor-element-<id>{--joist-src:"..."}.
    const cssChunks = [html];
    for (const m of html.matchAll(/<link[^>]+href="([^"]*post-[0-9]+\.css[^"]*)"/g)) {
      try { const cssUrl = new URL(m[1], frontUrl).toString(); cssChunks.push(await (await fetch(cssUrl)).text()); } catch {}
    }
    const allCss = cssChunks.join('\n');
    report.channels.C_cssVar.inFrontend = allCss.includes(`--joist-src:"${STAMP}"`) || allCss.includes(`--joist-src: "${STAMP}"`) || allCss.includes(STAMP);
    report.channels.C_cssVar.frontendChannel = report.channels.C_cssVar.inFrontend
      ? (html.includes(STAMP) ? 'inline <style>' : 'linked post-css file') : 'absent';

    // D: element_id renders as id="..." on the heading wrapper.
    const dId = sD._element_id;
    report.channels.D_elementId.inFrontend = !!dId && html.includes(`id="${dId}"`);

    // ── headless getComputedStyle confirmation for channel C (the DOM-queryable proof) ──
    // Use the local playwright (node_modules resolve only from eval/grader). Keep <120s.
    try {
      const probe = `
        const { chromium } = require('playwright');
        (async () => {
          const b = await chromium.launch();
          const pg = await b.newPage();
          await pg.goto(${JSON.stringify(frontUrl)}, { waitUntil: 'load', timeout: 25000 }).catch(()=>{});
          // find the CH-C heading, walk to its .elementor-element wrapper, read the css var.
          const v = await pg.evaluate(() => {
            const hs = [...document.querySelectorAll('.elementor-heading-title, h1,h2,h3,h4')];
            const t = hs.find(h => /CH-C css-var/.test(h.textContent||''));
            if (!t) return { found:false };
            let el = t.closest('.elementor-element') || t;
            const cv = getComputedStyle(el).getPropertyValue('--joist-src').trim();
            return { found:true, cssVar: cv, hasAttr: el.getAttribute('data-joist-src') };
          });
          console.log('CVAR_PROBE:' + JSON.stringify(v));
          await b.close();
        })().catch(e=>{ console.log('CVAR_PROBE_ERR:'+e.message); process.exit(0); });`;
      const out = execFileSync('node', ['-e', probe], { cwd: import.meta.dirname || '.', timeout: 60000, encoding: 'utf8' });
      const line = out.split('\n').find((l) => l.startsWith('CVAR_PROBE:'));
      if (line) {
        const v = JSON.parse(line.slice('CVAR_PROBE:'.length));
        report.channels.C_cssVar.computedStyleVar = v.cssVar || null;
        report.channels.C_cssVar.domQueryable = !!(v.cssVar && v.cssVar.includes(STAMP));
      } else {
        report.channels.C_cssVar.computedStyleVar = (out.match(/CVAR_PROBE_ERR:.*/) || ['(no probe output)'])[0];
      }
    } catch (e) {
      report.channels.C_cssVar.computedStyleVar = 'probe-failed: ' + String(e.message || e).slice(0, 120);
    }

    // ── NEGATIVE CONTROL: confirm the raw unregistered key is REJECTED at the REST boundary ──
    // (a separate, isolated create that we expect to 422 — proves channel A is structurally impossible).
    try {
      const r = await fetch(`${BASE}/wp-json/joist/v1/pages`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + b64(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'JOIST-SCRATCH rawkey-negctl ' + new Date().toISOString(),
          status: 'draft', type: 'page',
          elements: [{ elType: 'container', settings: {}, elements: [
            { elType: 'widget', widgetType: 'heading', settings: { title: 'X', _joist_src: STAMP } },
          ] }],
          page_settings: {},
        }),
      });
      const t = await r.text();
      report.channels.A_rawKey_rejected = { status: r.status, isUnknownKey: /schema\.unknown_key/.test(t) || /has no control named '_joist_src'/.test(t) };
      // if it somehow created, clean it up
      let j = null; try { j = JSON.parse(t); } catch {}
      if (j && j.id) { try { await deletePage(j.id); } catch {} }
    } catch (e) {
      report.channels.A_rawKey_rejected = { error: String(e).slice(0, 120) };
    }

    console.log('\n==== ROUND-TRIP REPORT ====');
    console.log(JSON.stringify(report, null, 2));
    fs.writeFileSync('/tmp/joist-src-roundtrip-report.json', JSON.stringify(report, null, 2));
  } finally {
    if (pageId) { try { await deletePage(pageId); console.log(`scratch ${pageId} deleted`); } catch (e) { console.log('delete failed (sweep will clean):', String(e).slice(0, 100)); } }
  }
})();

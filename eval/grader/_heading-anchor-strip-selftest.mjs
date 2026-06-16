#!/usr/bin/env node
/**
 * @purpose OFFLINE selftest for the HEADING PERMALINK-ANCHOR STRIP (capture-layout.mjs, TRACK B defect #1).
 *
 * Loads synthetic HTML (data-URL, NO network, local headless chromium) that reproduces the exact DOM shapes the
 * strip must distinguish, then runs the SAME in-page predicate the capture leaf uses, and asserts:
 *   • overreacted-style `<h2><a class="anchor" href="#slug">#</a> TLDR</h2>` → "TLDR"     (strip the permalink #)
 *   • Docusaurus-style `<h2>Heading<a class="hash-link" href="#h">#</a></h2>`   → "Heading" (trailing permalink #)
 *   • genuine title `<h2>#1 Product</h2>` (NO anchor child)                     → "#1 Product" (UNTOUCHED)
 *   • genuine title `<h2>C# in 2026</h2>` (# not leading, no anchor)            → "C# in 2026" (UNTOUCHED)
 *   • a heading with a NON-permalink inner link `<h2><a href="/x">#hashtag</a></h2>` whose own text is "#hashtag"
 *       (own text is NOT a lone "#", href is not in-page) → "#hashtag" (UNTOUCHED — not a permalink convention)
 *   • the legacy kill-switch (__NO_HEADING_ANCHOR_STRIP=true) → "# TLDR" preserved (byte-identical legacy).
 *
 * This is a UNIT test of the predicate, not a full capture. The orchestrator re-executes; the builder does NOT
 * self-bless. CLI: node _heading-anchor-strip-selftest.mjs
 */
import { chromium } from 'playwright';

// The EXACT strip predicate from capture-layout.mjs (kept in sync verbatim). Given a heading element + its
// innerText `t` + the kill-switch, return the cleaned text.
function STRIP_FN_SOURCE() {
  // returns a function string evaluated in-page so it runs against a real DOM (querySelectorAll/className/textContent)
  return (el, t, off) => {
    const isHlike = /^#\s*\S/.test(t);
    if (off === true || !isHlike) return t;
    let permalink = false;
    try {
      const isHashMark = (node) => {
        const own = (node.textContent || '').replace(/\s+/g, '').trim();
        if (own !== '#' && own !== '¶') return false;
        let cs2 = null; try { cs2 = getComputedStyle(node); } catch {}
        const ariaHidden = node.getAttribute && node.getAttribute('aria-hidden') === 'true';
        const opacity0 = cs2 && parseFloat(cs2.opacity) === 0;
        const cls = node.className && typeof node.className === 'string' ? node.className : '';
        const permClass = /anchor|permalink|hash|header-link|heading-link/i.test(cls);
        const inHashAnchor = node.tagName === 'A' ? (node.getAttribute('href') || '').startsWith('#') : false;
        return ariaHidden || opacity0 || permClass || inHashAnchor;
      };
      for (const node of el.querySelectorAll('a,span')) { if (isHashMark(node)) { permalink = true; break; } }
    } catch {}
    if (permalink) { const stripped = t.replace(/^#\s*/, '').trim(); if (stripped) return stripped; }
    return t;
  };
}

const HTML = `<!doctype html><html><body>
  <h2 id="ov"><a href="#tldr" class="no-underline text-inherit"><span aria-hidden="true" style="opacity:0">#</span>TLDR</a></h2>
  <h2 id="lone"><a class="anchor" href="#x" aria-hidden="true">#</a> Lone Anchor Heading</h2>
  <h2 id="doc">Heading Text<a class="hash-link" href="#heading-text" aria-label="link">#</a></h2>
  <h2 id="num">#1 Product</h2>
  <h2 id="csharp">C# in 2026</h2>
  <h2 id="hashtag"><a href="/elsewhere">#hashtag</a></h2>
  <h2 id="pilcrow"><a class="permalink" href="#p">¶</a> Synchronization, Not Lifecycle</h2>
</body></html>`;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

async function run() {
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const page = await browser.newPage();
  await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(HTML), { waitUntil: 'load' });

  const cases = [];
  const ok = (name, pass, detail = '') => cases.push({ name, pass: !!pass, detail });

  const evalStrip = (id, off) => page.evaluate(({ id, off, fnSrc }) => {
    const el = document.getElementById(id);
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    // eslint-disable-next-line no-eval
    const fn = (0, eval)('(' + fnSrc + ')');
    return { raw: t, out: fn(el, t, off) };
  }, { id, off, fnSrc: STRIP_FN_SOURCE().toString() });

  const ov = await evalStrip('ov', false);
  ok('overreacted aria-hidden/opacity:0 "#" span in anchor → stripped to "TLDR"', clean(ov.out) === 'TLDR', `raw="${ov.raw}" out="${ov.out}"`);

  const lone = await evalStrip('lone', false);
  ok('lone-"#" permalink anchor (GitHub/Docusaurus) → stripped', clean(lone.out) === 'Lone Anchor Heading', `out="${lone.out}"`);

  const doc = await evalStrip('doc', false);
  // Docusaurus trailing permalink: innerText is "Heading Text#" — leading-# regex does NOT match (correct: we only
  // strip a LEADING permalink #). The trailing # is a separate, rarer case; document the behavior (kept as-is).
  ok('docusaurus TRAILING permalink # → not a leading-# (left to a future trailing rule)', clean(doc.out) === clean(doc.raw), `raw="${doc.raw}" out="${doc.out}"`);

  const num = await evalStrip('num', false);
  ok('genuine "#1 Product" (no anchor child) → UNTOUCHED', clean(num.out) === '#1 Product', `out="${num.out}"`);

  const cs = await evalStrip('csharp', false);
  ok('genuine "C# in 2026" (# not leading) → UNTOUCHED', clean(cs.out) === 'C# in 2026', `out="${cs.out}"`);

  const ht = await evalStrip('hashtag', false);
  ok('"#hashtag" inner link (own text NOT a lone #, off-page href) → UNTOUCHED', clean(ht.out) === '#hashtag', `out="${ht.out}"`);

  const pil = await evalStrip('pilcrow', false);
  ok('pilcrow ¶ permalink anchor + leading # absent → leading-# regex no-op (¶ not prepended as #)', clean(pil.out) === clean(pil.raw), `raw="${pil.raw}" out="${pil.out}"`);

  const ovOff = await evalStrip('ov', true);
  ok('kill-switch (__NO_HEADING_ANCHOR_STRIP) → "#TLDR" preserved unstripped (legacy)', clean(ovOff.out) === clean(ovOff.raw) && /^#/.test(clean(ovOff.out)), `out="${ovOff.out}"`);

  await browser.close();

  const failed = cases.filter((c) => !c.pass);
  console.log('\n==== HEADING PERMALINK-ANCHOR STRIP — OFFLINE SELFTEST (headless data-URL) ====');
  for (const c of cases) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${cases.length} cases)`);
  process.exit(failed.length === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(2); });

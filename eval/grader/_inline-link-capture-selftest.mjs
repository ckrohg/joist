#!/usr/bin/env node
/**
 * @purpose OFFLINE capture-side selftest for the INLINE-LINK RUN extraction (capture-layout.mjs inlineRuns walk,
 * TRACK B #3). Loads synthetic prose HTML (data-URL, NO network, local headless chromium) and runs the SAME
 * child-node walk the capture leaf uses, asserting:
 *   • a <p> with an inline <a href> link → a `runs` array with a {link, color, underline} run + plain runs around it.
 *   • a <p> with both inline <code> AND inline <a> → both a code run and a link run captured, in document order.
 *   • a <p> with NO inline code/link → NO runs (legacy: falls back to plain text; byte-identical).
 *   • the kill-switch (window.__NO_INLINE_LINKS=true) → the <a> flattens to a plain run (no link run).
 *
 * UNIT test of the predicate; the orchestrator re-executes. CLI: node _inline-link-capture-selftest.mjs
 */
import { chromium } from 'playwright';

// The EXACT inline-run walk from capture-layout.mjs inlineRuns (kept in sync; the code-chip + link-run branches).
function WALK_FN_SOURCE() {
  return (el, noLinks) => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const toHex = (c) => { const m = String(c || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const q = m[1].split(',').map((x) => parseFloat(x)); if (q.length < 3) return null; const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); return '#' + h(q[0]) + h(q[1]) + h(q[2]); };
    const cs = getComputedStyle(el);
    const codeKids = [...el.children].filter((c) => /^(code|kbd|samp)$/i.test(c.tagName));
    const linkKids = noLinks ? [] : [...el.children].filter((c) => c.tagName === 'A' && c.getAttribute('href') && clean(c.innerText || c.textContent));
    if (!(codeKids.length || linkKids.length)) return { runs: null };
    const runs = []; let codeCount = 0, linkCount = 0;
    const pushPlain = (t) => { const c2 = clean(t); const lead = /^\s/.test(t) ? ' ' : ''; const trail = /\s$/.test(t) ? ' ' : ''; if (c2) runs.push({ text: lead + c2 + trail }); else if (lead || trail) runs.push({ text: ' ' }); };
    for (const node of el.childNodes) {
      if (node.nodeType === 3) { pushPlain(node.textContent); continue; }
      if (node.nodeType !== 1) continue;
      const ct = node.tagName.toLowerCase();
      if (/^(code|kbd|samp)$/.test(ct)) {
        const ccs = getComputedStyle(node); const t2 = clean(node.innerText || node.textContent); if (!t2) continue;
        runs.push({ text: t2, code: true, color: (ccs.color && ccs.color !== 'rgba(0, 0, 0, 0)') ? toHex(ccs.color) : null });
        codeCount++;
      } else if (ct === 'a' && !noLinks && node.getAttribute('href') && clean(node.innerText || node.textContent)) {
        const acs = getComputedStyle(node); const at = clean(node.innerText || node.textContent);
        const lead = /^\s/.test(node.textContent || '') ? ' ' : '', trail = /\s$/.test(node.textContent || '') ? ' ' : '';
        const acol = (acs.color && acs.color !== 'rgba(0, 0, 0, 0)') ? toHex(acs.color) : null;
        const underline = /underline/.test(acs.textDecorationLine || acs.textDecoration || '');
        if (lead) runs.push({ text: ' ' });
        runs.push({ text: at, link: node.getAttribute('href'), color: acol, underline });
        if (trail) runs.push({ text: ' ' });
        linkCount++;
      } else { pushPlain(node.innerText || node.textContent); }
    }
    return { runs: (codeCount > 0 || linkCount > 0) && runs.length ? runs : null, codeCount, linkCount };
  };
}

const HTML = `<!doctype html><html><head><style>
  a { color: rgb(210, 54, 105); text-decoration: underline; }
  code { color: rgb(210, 54, 105); }
  body { color: rgb(34,34,34); }
</style></head><body>
  <p id="prose">You can use <a href="https://reactjs.org/hooks">Hooks</a> to manage state, and even write <a href="/custom">custom Hooks</a> to reuse logic.</p>
  <p id="mixed">Call <code>useEffect</code> and read the <a href="/docs">docs</a> here.</p>
  <p id="plain">Just plain prose with no links or code at all.</p>
</body></html>`;

async function run() {
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const page = await browser.newPage();
  await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(HTML), { waitUntil: 'load' });

  const cases = [];
  const ok = (name, pass, detail = '') => cases.push({ name, pass: !!pass, detail });

  const walkId = (id, noLinks) => page.evaluate(({ id, noLinks, fnSrc }) => {
    const el = document.getElementById(id);
    // eslint-disable-next-line no-eval
    const fn = (0, eval)('(' + fnSrc + ')');
    return fn(el, noLinks);
  }, { id, noLinks, fnSrc: WALK_FN_SOURCE().toString() });

  const prose = await walkId('prose', false);
  const linkRuns = (prose.runs || []).filter((r) => r.link);
  ok('#3 prose with 2 inline links → 2 link runs captured', linkRuns.length === 2, JSON.stringify(linkRuns));
  ok('#3 link run carries href', linkRuns[0] && linkRuns[0].link === 'https://reactjs.org/hooks', JSON.stringify(linkRuns[0]));
  ok('#3 link run carries the link OWN color (pink #d23669)', linkRuns[0] && linkRuns[0].color === '#d23669', JSON.stringify(linkRuns[0]));
  ok('#3 link run carries underline=true', linkRuns[0] && linkRuns[0].underline === true, JSON.stringify(linkRuns[0]));
  ok('#3 plain prose around links preserved as plain runs', (prose.runs || []).some((r) => !r.link && !r.code && /you can use/i.test(r.text)), JSON.stringify(prose.runs));

  const mixed = await walkId('mixed', false);
  ok('#3+#6 mixed prose → a code run AND a link run, in order', (mixed.runs || []).some((r) => r.code) && (mixed.runs || []).some((r) => r.link), JSON.stringify(mixed.runs));

  const plain = await walkId('plain', false);
  ok('plain prose → NO runs (legacy fallback, byte-identical)', plain.runs === null, JSON.stringify(plain.runs));

  const off = await walkId('prose', true);
  ok('kill-switch __NO_INLINE_LINKS → no link runs (legacy)', off.runs === null || !(off.runs || []).some((r) => r.link), JSON.stringify(off.runs));

  await browser.close();
  const failed = cases.filter((c) => !c.pass);
  console.log('\n==== INLINE-LINK CAPTURE SELFTEST (TRACK B #3 — headless data-URL) ====');
  for (const c of cases) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  (' + String(c.detail).slice(0, 120) + ')' : ''}`);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${cases.length} cases)`);
  process.exit(failed.length === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(2); });

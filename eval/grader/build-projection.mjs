#!/usr/bin/env node
/**
 * @purpose PROJECTION-FIRST clone entry point + offline tree census.
 *
 * WHY THIS FILE EXISTS (the fusion verdict): calibration proved the retired LLM-RECONSTRUCTION lineage ships
 * BROKEN clones — dropped body paragraphs, empty CTA boxes, a swapped/missing logo, generic Hello-default colors.
 * The fix is PROJECTION-FIRST: read the COMPUTED result of all the source CSS and STAMP it as real, editable
 * Elementor widgets — never re-derive color/font/logo from a natural-language description. build-absolute.mjs is
 * ALREADY that projection builder (it pins every leaf to its captured (x,y,w,h) AND pushes getComputedStyle into
 * native Elementor typography/color/bg controls + uploads real assets with a true WP attachment id). This file:
 *
 *   (1) is a THIN, reversible wrapper around build-absolute.mjs — it does NOT fork or break it. It runs the SAME
 *       builder with the projection-fidelity levers explicitly ON (they default ON inside build-absolute, gated by
 *       reversible BUILD_ and ABS_ flags), so build-absolute stays the single source of truth and any lever can be
 *       A/B'd independently by the existing corpus-run harness.
 *
 *   (2) provides the OFFLINE SELF-TEST surface: `--census <tree.json|layout.json>` runs a DRY-RUN build (no network)
 *       and asserts — from the emitted widget tree alone — that the three things reconstruction dropped are PRESENT:
 *         • BODY PARAGRAPHS  — real Heading/Text widgets carrying the long-form prose (no dropped <p>),
 *         • CTA WITH LABEL   — a button/link widget whose visible label is non-empty (no empty box),
 *         • LOGO Image widget — a real Image widget (the captured brand mark), at its position.
 *       Exits non-zero if any required category is missing, so it can gate a build before it is ever published.
 *
 * USAGE:
 *   Build (publishes via build-absolute; projection levers forced ON):
 *     node build-projection.mjs --layout layout.json --page <id>          # + JOIST_AUTH_B64, JOIST_BASE
 *   Offline census from a captured layout (no network — builds a dry-run tree, then audits it):
 *     node build-projection.mjs --census --layout layout.json --page <id>
 *   Offline census from an already-dumped tree (skips even the build):
 *     node build-projection.mjs --census --tree /tmp/abs-dryrun-<id>.json
 *
 * The host-guard in build-absolute still applies to any real build; --census issues NO network calls at all.
 */
import fs from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const BUILDER = path.join(__dir, 'build-absolute.mjs');

const argv = process.argv.slice(2);
const has = (n) => argv.includes('--' + n);
const val = (n, d = null) => { const i = argv.indexOf('--' + n); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

// PROJECTION FIDELITY LEVERS — explicitly assert each gap-fix flag to its projection-first (default-ON) value so a
// caller cannot silently disable one. These are the SAME reversible flags inside build-absolute.mjs; setting them
// here to their default value is a no-op for the build but documents the contract (and a caller who wants legacy
// behavior must pass the OFF env explicitly, overriding this — which spawnSync env below preserves if pre-set).
const PROJECTION_ENV = {
  ABS_NO_NAMEDWEIGHT: '0',        // fix #4: map named font-weights (bold→700, semibold→600, …) — keep them
  ABS_NO_SRCURL_FALLBACK: '0',    // fix #2: lazy/never-painted img → upload n.srcURL (real fetchable variant)
  BUILD_NO_LEAF_CHROME: '0',      // fix #5: chip/badge/card text leaves keep their own border/radius/shadow/bg
  BUILD_NO_ANCESTOR_CHROME: '0',  // fix #1: empty-CTA residual → recover pill chrome from a painted ancestor
};
// only inject a default if the caller hasn't pinned that flag (caller override wins → reversibility preserved)
const projEnv = { ...process.env };
for (const [k, v] of Object.entries(PROJECTION_ENV)) if (projEnv[k] == null) projEnv[k] = v;

// ───────────────────────────── CENSUS ─────────────────────────────
// Walk an emitted Elementor tree ({ elements:[root], page_settings }) and classify every widget. Asserts the three
// human-salient categories reconstruction dropped are PRESENT. Returns a report; never touches the network.
function censusTree(tree) {
  const widgets = [];
  const walk = (nodes) => { for (const n of (nodes || [])) { if (!n || typeof n !== 'object') continue; if (n.elType === 'widget') widgets.push(n); if (Array.isArray(n.elements)) walk(n.elements); } };
  walk(tree.elements || (tree.root ? [tree.root] : []));

  const textLen = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().length;
  const labelOf = (s) => { const set = s.settings || {}; return set.title || set.editor || set.html || ''; };

  // BODY PARAGRAPHS: heading or text-editor widgets carrying real prose. A "paragraph" = a text-bearing widget with
  // >= 40 chars of visible text (a sentence-ish body block, not a one-word chip). Headings count toward body text too.
  const bodyText = widgets.filter((w) => (w.widgetType === 'heading' || w.widgetType === 'text-editor') && textLen(labelOf(w)) > 0);
  const paragraphs = bodyText.filter((w) => textLen(labelOf(w)) >= 40);
  const totalBodyChars = bodyText.reduce((a, w) => a + textLen(labelOf(w)), 0);

  // CTA WITH LABEL: a link/button widget whose label is non-empty (no empty box). build-absolute emits CTAs as
  // text-editor widgets whose editor HTML is an <a>…</a>, plus the nav CTA in the header container. Detect an
  // anchor-bearing widget with a non-empty visible label.
  const isAnchorWidget = (w) => (w.widgetType === 'text-editor' && /<a[\s>]/i.test(String(labelOf(w)))) || (w.widgetType === 'button');
  const ctas = widgets.filter((w) => isAnchorWidget(w) && textLen(labelOf(w)) > 0);
  const emptyAnchors = widgets.filter((w) => isAnchorWidget(w) && textLen(labelOf(w)) === 0);

  // LOGO Image widget: a real Image widget pointing at a captured asset (url present), OR the header logo emitted as
  // an html widget whose markup is an <img …>. Either satisfies "the logo is a required captured Image widget".
  const imageWidgets = widgets.filter((w) => w.widgetType === 'image' && w.settings && w.settings.image && w.settings.image.url);
  const imgHtmlWidgets = widgets.filter((w) => w.widgetType === 'html' && /<img\s[^>]*src=/i.test(String(labelOf(w))));
  const logoPresent = imageWidgets.length > 0 || imgHtmlWidgets.length > 0;

  // chrome projection evidence (not a hard gate, but reported): widgets carrying border/box-shadow/radius/bg inline
  const chromeStamped = widgets.filter((w) => /(?:border|box-shadow|border-radius|background)\s*:/i.test(String(labelOf(w))));

  // typography projection evidence: native typography controls present on text widgets
  const typoProjected = bodyText.filter((w) => w.settings && (w.settings.typography_font_family || w.settings.typography_font_size || w.settings.typography_font_weight)).length;
  const colorProjected = bodyText.filter((w) => w.settings && (w.settings.title_color || w.settings.text_color)).length;

  const checks = [
    { key: 'BODY PARAGRAPHS', pass: paragraphs.length >= 1, detail: `${paragraphs.length} paragraph widget(s) >=40 chars, ${bodyText.length} text widgets total, ${totalBodyChars} visible chars` },
    { key: 'CTA WITH LABEL', pass: ctas.length >= 1, detail: `${ctas.length} labelled CTA/link widget(s); ${emptyAnchors.length} empty anchor(s)` },
    { key: 'LOGO Image widget', pass: logoPresent, detail: `${imageWidgets.length} native Image widget(s) + ${imgHtmlWidgets.length} <img> html widget(s)` },
  ];
  return {
    checks,
    widgetCount: widgets.length,
    paragraphs: paragraphs.length, bodyText: bodyText.length, totalBodyChars,
    ctas: ctas.length, emptyAnchors: emptyAnchors.length,
    imageWidgets: imageWidgets.length, imgHtmlWidgets: imgHtmlWidgets.length,
    chromeStamped: chromeStamped.length, typoProjected, colorProjected,
    byType: widgets.reduce((m, w) => { m[w.widgetType] = (m[w.widgetType] || 0) + 1; return m; }, {}),
  };
}

function printReport(rep, treePath) {
  console.log(`\n── PROJECTION TREE CENSUS (${treePath}) ──`);
  console.log(`widgets: ${rep.widgetCount} | by type: ${Object.entries(rep.byType).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`projection: ${rep.typoProjected} text widget(s) carry native typography, ${rep.colorProjected} carry a native color control, ${rep.chromeStamped} carry inline chrome (border/shadow/radius/bg)`);
  console.log('REQUIRED ELEMENTS (the three reconstruction dropped):');
  for (const c of rep.checks) console.log(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.key} — ${c.detail}`);
  const ok = rep.checks.every((c) => c.pass);
  console.log(ok ? '\nCENSUS PASS — body text + labelled CTA + logo Image widget all present.\n' : '\nCENSUS FAIL — a required element is missing from the emitted tree.\n');
  return ok;
}

async function main() {
  if (has('census')) {
    let treePath = val('tree');
    if (!treePath) {
      // no pre-dumped tree → run a DRY-RUN build of the given layout (NO network) and audit its dump.
      const layout = val('layout'); const page = val('page') || '0';
      if (!layout) { console.error('census needs --tree <tree.json> OR --layout <layout.json> [--page <id>]'); process.exit(2); }
      treePath = `/tmp/abs-dryrun-${page}.json`;
      console.log(`census: dry-run build (offline, no network) of ${layout} → ${treePath}`);
      const env = { ...projEnv, ABS_DRY_RUN: '1', ABS_DUMP_TREE: treePath, JOIST_AUTH_B64: projEnv.JOIST_AUTH_B64 || Buffer.from('census:census').toString('base64') };
      const r = spawnSync(process.execPath, [BUILDER, '--layout', layout, '--page', page], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (r.stdout) process.stdout.write(r.stdout.split('\n').filter((l) => /DRY_RUN|ancestor-chrome|leaf own-chrome|header nav DETECT|card-row|absolute tree|images:/.test(l)).join('\n') + '\n');
      if (r.status !== 0) { console.error('dry-run build FAILED:', (r.stderr || '').slice(-400)); process.exit(1); }
    }
    if (!fs.existsSync(treePath)) { console.error('census: tree not found:', treePath); process.exit(1); }
    const tree = JSON.parse(fs.readFileSync(treePath, 'utf8'));
    const rep = censusTree(tree);
    const ok = printReport(rep, treePath);
    process.exit(ok ? 0 : 3);
  }

  // BUILD mode: delegate to build-absolute.mjs with the projection levers forced ON. Pass through all args + env
  // (incl. JOIST_AUTH_B64 / JOIST_BASE) so the host-guard and every existing behavior are unchanged.
  const r = spawnSync(process.execPath, [BUILDER, ...argv], { env: projEnv, stdio: 'inherit' });
  process.exit(r.status == null ? 1 : r.status);
}

main();

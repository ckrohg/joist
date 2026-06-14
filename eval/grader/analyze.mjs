#!/usr/bin/env node
/**
 * DefectAnalyzer — CLONE_FIDELITY_SYSTEM_SPEC.md §C.
 *
 * Closes the self-reinforcing loop: reads the brutal grader's report.json,
 * turns each tagged defect into (1) an actionable lesson written into the
 * joist-clone LESSONS.md managed block (so the NEXT clone inherits it),
 * (2) a durable PreferenceMemory-shaped rule payload (ready to POST to
 * /joist/v1/preferences), and (3) a TREND.jsonl record so the fidelity trend
 * over runs is measurable (compounding, not one-off).
 *
 * Usage: node analyze.mjs --report <out/report.json>
 *        [--lessons ../../plugin/skills/joist-clone/LESSONS.md] [--trend ./TREND.jsonl]
 *        [--post-prefs <base_url>]   # e.g. http://localhost:8001
 *
 * --post-prefs is OPTIONAL. When given AND env JOIST_WP_USER + JOIST_WP_APP_PASSWORD
 * are set, each derived rule is POSTed to <base_url>/wp-json/joist/v1/preferences
 * using HTTP Basic auth (a WordPress application password). Without the flag or
 * the creds, the analyzer just writes preferences-payload.json as before — it
 * NEVER fails the run on a missing/failed post.
 */
import fs from 'fs';
import path from 'path';
import { assertAllowedBase } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: refuse a stray (e.g. paused *.sg-host.com) --post-prefs host before any POST.

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const hasFlag = (n) => process.argv.includes('--' + n);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const reportPath = arg('report');
const lessonsPath = arg('lessons', path.resolve(HERE, '../../plugin/skills/lessons/LESSONS_CLONE.md'));
const trendPath = arg('trend', path.resolve(HERE, 'TREND.jsonl'));
const prefsOut = arg('prefs', path.resolve(path.dirname(reportPath || '.'), 'preferences-payload.json'));
if (!reportPath || !fs.existsSync(reportPath)) { console.error('need --report <report.json>'); process.exit(2); }

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const SEV_W = { high: 3, med: 2, low: 1 };

// capability_gap_tag → how to teach it (title + lesson/rule generator)
const GAP_KB = {
  section_completeness: {
    title: 'Build the FULL page — truncation is the #1 fidelity killer',
    lesson: (d) => `Count the source's top-level sections and full page height BEFORE authoring; author every one. Last grade: ${d.observed} vs ${d.expected}. Treat "all N sections covered?" as a hard gate before grading.`,
    rule: { kind: 'structural', pattern: 'page_truncation', directive: 'Author every top-level source section; verify clone page-height is within ~15% of source before grading.' },
  },
  asset_capture: {
    title: 'Capture & host REAL assets (images, logos, animated gradients)',
    lesson: (d) => `Source has assets the clone dropped (${d.observed} vs ${d.expected}). Screenshot/record real source art — including animated WebGL gradients (capture as a looping video/sprite) and logo images — upload to WP Media, and reference real URLs. NEVER flat-fill or placeholder where the source shows art/imagery.`,
    rule: { kind: 'layout_preference', pattern: 'missing_assets', directive: 'Capture+host real images/video/gradient from source; no flat fills or placeholder boxes where source has imagery.' },
  },
  structure_parser: {
    title: 'Render-then-extract (live DOM, not static HTML)',
    lesson: (d) => `Headings/sections were under-captured (${d.observed} vs ${d.expected}). Extract structure from the RENDERED DOM via Playwright (captures JS-loaded content: logos, tickers, carousels), not the static HTML source.`,
    rule: { kind: 'structural', pattern: 'static_scrape_miss', directive: 'Extract from rendered DOM (Playwright), not raw HTML; capture JS-loaded sections/logos/tickers.' },
  },
  typography_match: {
    title: 'Match computed typography exactly — do not default to bold/system',
    lesson: (d) => `Heading type mismatch (${d.observed} vs ${d.expected}). Extract the source's computed font-size/weight/family/letter-spacing per element and match it. (e.g. Stripe-class headlines are often LIGHT weight ~300 with a proprietary font like sohne-var — pick the closest web font; never assume bold/-apple-system.)`,
    rule: { kind: 'layout_preference', pattern: 'typography_default_bold', directive: 'Match source computed type (size/weight/family/tracking) per element; do not default headings to bold or system fonts.' },
  },
  color_extraction: {
    title: 'Match background + dominant palette (not a flat fill)',
    lesson: (d) => `Background/palette off (${d.observed} vs ${d.expected}). Sample the source's actual background and dominant palette (e.g. white + a colorful gradient ribbon, NOT a flat blue fill).`,
    rule: { kind: 'color_preference', pattern: 'flat_fill_substitution', directive: 'Match source background + dominant palette; never substitute a flat fill for a gradient/image background.' },
  },
  motion_runtime: {
    title: 'Reproduce + verify detected source motion',
    lesson: (d) => `Source motion not reproduced (${d.observed} vs ${d.expected}). Author the detected hover/scroll effects via joist-* classes / the escape-hatch and VERIFY they fire in the clone (the grader checks this).`,
    rule: { kind: 'structural', pattern: 'motion_not_reproduced', directive: 'Reproduce detected source hover/scroll motion via joist-* classes; grader must verify it fires.' },
  },
};

// aggregate defects by capability_gap_tag
const byGap = {};
for (const d of report.defects || []) {
  const g = d.capability_gap_tag || 'other';
  (byGap[g] ||= { tag: g, weight: 0, count: 0, worst: d }).weight += (SEV_W[d.severity] || 1);
  byGap[g].count++;
  if ((SEV_W[d.severity] || 1) >= (SEV_W[byGap[g].worst.severity] || 1)) byGap[g].worst = d;
}
const ranked = Object.values(byGap).sort((a, b) => b.weight - a.weight);

// ---- 1. lessons (managed block in LESSONS.md) ----
const stamp = report.graded_at_utc || 'unknown';
let block = `<!-- AUTO-LESSONS:START (DefectAnalyzer; last grade ${report.label || ''} ${report.fidelity_pct}% @ ${stamp}) -->\n`;
block += `## ⚙️ Auto-learned gaps (current priority — from the brutal grader)\n\n`;
block += `Last grade: **${report.label || 'clone'} = ${report.fidelity_pct}%** vs source. Fix these, top-first; the grader re-checks each run and these update automatically.\n\n`;
for (const g of ranked) {
  const kb = GAP_KB[g.tag];
  if (!kb) continue;
  block += `### ${kb.title}  _(gap: ${g.tag}, ${g.count}× , severity-weight ${g.weight})_\n${kb.lesson(g.worst)}\n\n`;
}
block += `<!-- AUTO-LESSONS:END -->`;

let lessons = fs.existsSync(lessonsPath) ? fs.readFileSync(lessonsPath, 'utf8') : '# joist-clone LESSONS\n';
const START = '<!-- AUTO-LESSONS:START', END = '<!-- AUTO-LESSONS:END -->';
if (lessons.includes(START)) {
  lessons = lessons.replace(new RegExp(START + '[\\s\\S]*?' + END.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')), block);
} else {
  lessons = lessons.trimEnd() + '\n\n---\n\n' + block + '\n';
}
fs.writeFileSync(lessonsPath, lessons);

// ---- 2. durable PreferenceMemory-shaped rules (ready to POST /joist/v1/preferences) ----
const rules = ranked.filter(g => GAP_KB[g.tag]).map(g => ({
  kind: GAP_KB[g.tag].rule.kind,
  pattern: GAP_KB[g.tag].rule.pattern,
  directive: GAP_KB[g.tag].rule.directive,
  rationale: `Auto-derived from grader defect (${g.tag}, ${g.count}×): ${g.worst.observed} vs ${g.worst.expected}`,
  // PreferencesController reads provenance.source (associative), so emit an
  // object — a flat array would make $item['provenance']['source'] null.
  provenance: {
    source: 'DefectAnalyzer',
    label: report.label || 'clone',
    gap_tag: g.tag,
    grade_pct: report.fidelity_pct,
    graded_at_utc: report.graded_at_utc || null,
  },
  scope: 'global',
  confidence: Math.min(0.9, 0.4 + g.weight * 0.1),
}));
fs.writeFileSync(prefsOut, JSON.stringify({ source: report.source, clone: report.clone, rules }, null, 2));

// ---- 2b. OPTIONAL: push durable rules into the live Joist PreferenceMemory ----
// (CLONE_FIDELITY_SYSTEM_SPEC §C — persist learning cross-session.)
// Strictly best-effort: a missing flag, missing creds, or a failed request
// must NEVER fail the analyzer. We just log and carry on.
async function postPrefs() {
  const baseUrl = arg('post-prefs');
  if (!hasFlag('post-prefs') || !baseUrl) {
    return; // no-op: payload file already written above.
  }
  // §0 SAFETY GUARD: --post-prefs is a WP host we PUT/POST to; assert it targets a training host (blocks the
  // paused shared host whose URL this flag's docs even cite as the example) BEFORE the fetch loop.
  if (/^https?:/i.test(baseUrl)) assertAllowedBase(baseUrl);
  const user = process.env.JOIST_WP_USER;
  const appPw = process.env.JOIST_WP_APP_PASSWORD;
  if (!user || !appPw) {
    console.log('⚠ --post-prefs set but JOIST_WP_USER / JOIST_WP_APP_PASSWORD missing — skipping POST (payload file still written).');
    return;
  }
  if (typeof fetch !== 'function') {
    console.log('⚠ global fetch unavailable (need Node 18+) — skipping POST.');
    return;
  }
  // WP application passwords are sent via HTTP Basic auth. App passwords contain
  // spaces in their display form; WP accepts them with or without, so pass through.
  const endpoint = baseUrl.replace(/\/+$/, '') + '/wp-json/joist/v1/preferences';
  const authHeader = 'Basic ' + Buffer.from(`${user}:${appPw}`).toString('base64');
  // Writes require an X-Joist-Session-Id header (ControllerBase bucketClass=writes).
  const sessionId = process.env.JOIST_SESSION_ID || `defect-analyzer-${Date.now()}`;

  console.log(`\nPosting ${rules.length} rule(s) → ${endpoint} (Basic auth as "${user}")`);
  let ok = 0, fail = 0;
  for (const rule of rules) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          'X-Joist-Session-Id': sessionId,
        },
        body: JSON.stringify(rule),
      });
      if (res.ok) {
        ok++;
        console.log(`  ✓ ${rule.kind}/${rule.pattern} → ${res.status}`);
      } else {
        fail++;
        let detail = '';
        try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text().catch(() => ''); }
        console.log(`  ✗ ${rule.kind}/${rule.pattern} → ${res.status} ${detail}`);
      }
    } catch (e) {
      fail++;
      console.log(`  ✗ ${rule.kind}/${rule.pattern} → network error: ${e?.message || e}`);
    }
  }
  console.log(`✓ posted ${ok}/${rules.length} rule(s) to PreferenceMemory${fail ? ` (${fail} failed)` : ''}.`);
}

// ---- 3. trend record (compounding visibility) ----
const trendRec = {
  ts: stamp, label: report.label || 'clone', source: report.source, clone: report.clone,
  fidelity_pct: report.fidelity_pct, dimensions_pct: report.dimensions_pct,
  top_gaps: ranked.slice(0, 4).map(g => ({ tag: g.tag, weight: g.weight, count: g.count })),
  defect_count: (report.defects || []).length,
};
fs.appendFileSync(trendPath, JSON.stringify(trendRec) + '\n');

// trend delta vs previous same-label run
let prev = null;
try { const lines = fs.readFileSync(trendPath, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.label === trendRec.label); if (lines.length >= 2) prev = lines[lines.length - 2]; } catch {}

console.log(`DefectAnalyzer — ${report.label}: ${report.fidelity_pct}%` + (prev ? ` (prev ${prev.fidelity_pct}%, Δ${report.fidelity_pct - prev.fidelity_pct >= 0 ? '+' : ''}${report.fidelity_pct - prev.fidelity_pct})` : ' (first run)'));
console.log(`\nCapability backlog (priority order):`);
ranked.forEach((g, i) => console.log(`  ${i + 1}. ${g.tag}  [${g.count}× , weight ${g.weight}]  → ${GAP_KB[g.tag]?.title || g.tag}`));
console.log(`\n✓ wrote ${ranked.filter(g => GAP_KB[g.tag]).length} auto-lessons → ${path.relative(process.cwd(), lessonsPath)}`);
console.log(`✓ wrote ${rules.length} durable rules → ${path.relative(process.cwd(), prefsOut)}`);
console.log(`✓ appended trend record → ${path.relative(process.cwd(), trendPath)}`);

// Optional live push (top-level await; .mjs module scope). Best-effort only.
await postPrefs();

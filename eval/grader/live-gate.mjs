// @purpose LIVE wiring for the pre-preview gate (gate.mjs) — composes the offline-built gate with its REAL
// WP/grade-structure/capture hooks so that when a guarded WordPress instance returns, the gate is a one-command
// run. Built + unit-tested OFFLINE with injected stubs (no WP); only EXECUTION needs WP. Design fusion-locked
// 2026-06-20 (MIXED signal — both judges same leg; the divergence was one model nearly choosing the unsound
// bare-PNG recheck, which this design explicitly rejects).
//
// SOUNDNESS SPINE (why each choice):
//  • RECHECK SOURCE = the FROZEN source CACHE (grade-structure mode c): seed /tmp/grade-src-cache/<srcTag>.{json,png}
//    from the build's capture bundle, then call grade-structure with the live URL → it reads the frozen source
//    (with ctaRuns) instead of re-fetching. This is the ONLY mode where the unstyled-CTA veto can RE-FIRE on
//    recheck (bare-PNG source returns empty ctaRuns → veto self-disables → publishes broken), is REPRODUCIBLE
//    (no per-fetch capture), and CANNOT DRIFT from the build (heal-source ≡ recheck-source).
//  • MEASUREMENT-PRESENCE GUARD (readRecheckReport): a detector returns null/absent when its signal is missing →
//    filtered out of vetoes.all → firedVetoes()=[] → "unmeasured" reads as "cleared" → publishes the UNHEALED
//    defect. So for every veto we have a healer for, require live signal on BOTH sides; if absent/degenerate,
//    INJECT a synthetic fired veto so the authoritative recheck HOLDS. Closes the clone-side self-disable hole.
//  • FAIL-CLOSED everywhere: empty-ctaRuns bundle → seed throws (HOLD before any grade); missing cache → assert
//    HOLDs (never falls back to live mode a); recheck exec/parse failure → synthetic recheck-failed veto → HOLD.
//  • enforceCorpusBar = FALSE: single-site Spearman 0.714 / bootstrap CI [0.036,1.000] / clean-only 0.543 → the
//    continuous bar is statistically too weak to enforce; correspondence rides as corpusBar METADATA only.

import { gate, ctaHealPlugin } from './gate.mjs';

export const SRC_CACHE_DIR = '/tmp/grade-src-cache';

// EXACT mirror of grade-structure.mjs:509 srcTag (GOLDEN-tested for parity in _live-gate-selftest.mjs). The `-lt`
// suffix is grade-structure's default (NO_LONGTEXT off); pass noLongtext=true only if the grader runs with NOLT.
export function srcCacheTag(sourceUrl, noLongtext = false) {
  return String(sourceUrl).replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 40) + (noLongtext ? '' : '-lt');
}

// Seed the frozen source cache from the build's capture bundle so the recheck reads it (mode c). FAIL-CLOSED: a
// bundle with no ctaRuns would make the rechecked unstyled-CTA veto un-fireable → refuse to seed (caller HOLDs).
export function seedFrozenSource(bundle, cfg, deps) {
  if (!bundle || !Array.isArray(bundle.ctaRuns) || bundle.ctaRuns.length === 0) {
    throw new Error('seedFrozenSource: bundle.ctaRuns empty/absent — recheck would self-disable the unstyled-CTA veto (fail-closed)');
  }
  const tag = srcCacheTag(cfg.sourceUrl, cfg.noLongtext);
  deps.mkdirp(SRC_CACHE_DIR);
  const meta = {
    texts: bundle.texts, textPos: bundle.textPos, census: bundle.census, ds: bundle.ds,
    ctaRuns: bundle.ctaRuns, pageH: bundle.pageH, mobileTexts: bundle.mobileTexts || null,
    ...(bundle.mobileH ? { mobileH: bundle.mobileH } : {}), midwidthSrc: bundle.midwidthSrc || null,
    _captureHash: bundle.captureHash || null,            // bind the cache to THIS build (assertCacheSeeded checks it)
  };
  deps.writeJSON(`${SRC_CACHE_DIR}/${tag}.json`, meta);
  deps.copyPng(bundle.srcCapturePng, `${SRC_CACHE_DIR}/${tag}.png`);
  return tag;
}

// Verify the seed landed AND matches the bundle being graded (no stale/cross-site cache reuse). Never falls back to
// live mode (a) — a missing/mismatched cache is a HOLD condition surfaced to the caller, not a silent re-fetch.
export function assertCacheSeeded(cfg, captureHash, deps) {
  const tag = srcCacheTag(cfg.sourceUrl, cfg.noLongtext);
  const jp = `${SRC_CACHE_DIR}/${tag}.json`, pp = `${SRC_CACHE_DIR}/${tag}.png`;
  if (!deps.exists(jp) || !deps.exists(pp)) throw new Error(`assertCacheSeeded: cache missing for ${tag} — refusing live-fetch fallback (fail-closed)`);
  if (captureHash != null) { const meta = deps.readJSON(jp); if (meta._captureHash !== captureHash) throw new Error(`assertCacheSeeded: cache hash ${meta._captureHash} != bundle ${captureHash} (stale/cross-site) — fail-closed`); }
  return tag;
}

// Parse a grade-structure report.json AND apply the measurement-presence guard: every veto we can heal MUST be
// measured on both sides on recheck, else we inject a synthetic fired veto ("unmeasured" ≠ "cleared"). Binds to the
// detector's REAL evidence shape (unstyled-CTA → {srcCtas, cloneCtas, ...}); a shape mismatch fails CLOSED (inject).
export function readRecheckReport(reportPath, registry, deps) {
  let report;
  try { report = deps.readJSON(reportPath); } catch (e) { return { honesty: { vetoes: { fired: [{ veto: 'recheck-parse-failed', severity: 1, evidence: { err: String(e.message || e) } }], all: [] } } }; }
  const all = (report && report.honesty && report.honesty.vetoes && report.honesty.vetoes.all) || [];
  report.honesty = report.honesty || {}; report.honesty.vetoes = report.honesty.vetoes || { fired: [], all };
  report.honesty.vetoes.fired = report.honesty.vetoes.fired || [];
  for (const name of Object.keys(registry || {})) {
    const e = all.find((v) => v.veto === name);
    const ev = e && e.evidence;
    // 'measured' iff the detector saw real CTA signal on BOTH sides (its evidence keys are srcCtas/cloneCtas).
    const measured = ev && Number.isFinite(+ev.srcCtas) && Number.isFinite(+ev.cloneCtas) && (+ev.srcCtas) >= 1 && (+ev.cloneCtas) >= 1;
    if (!measured) report.honesty.vetoes.fired.push({ veto: `${name}-unmeasured`, severity: 1, evidence: { reason: e ? 'degenerate-signal' : 'absent-from-all' } });
  }
  return report;
}

// PURE composer → { registry, hooks } for gate(). Offline-asserted. The healer's WP side is reached via the
// injected fetchImpl inside healUnstyledCTA; recheck + clone re-capture are child-process CLIs (injected as deps).
export function buildLiveWiring(cfg, bundle, deps) {
  const renderAndCrop = deps.makeRenderAndCrop({ srcCapturePng: bundle.srcCapturePng, screenshotFn: deps.screenshotFn });
  const registry = {
    'unstyled-CTA': ctaHealPlugin(async (healCtx) => {
      const r = await deps.healUnstyledCTA({ ...healCtx, srcCTAs: bundle.srcCTAs, renderAndCrop, log: deps.log, fetchImpl: deps.fetchImpl, resolveBaseImpl: deps.resolveBaseImpl });
      const unresolved = [...(r.rejected || []), ...(r.refused || []), ...(r.unmatched || []), ...(r.nullPaint || [])];
      // `accepted` is ADVISORY — the authoritative arbiter is the recheck (it can re-fire even if the loop accepted).
      return { healed: r.healed || [], accepted: (r.healed || []).length > 0 && unresolved.length === 0, unresolved };
    }),
  };
  const recheck = async () => {
    try {
      await deps.runGradeStructure({ source: cfg.sourceUrl, clone: cfg.cloneUrl, out: cfg.outDir });   // CHILD PROCESS (mode c, cache hit)
      return readRecheckReport(`${cfg.outDir}/report.json`, registry, deps);
    } catch (e) {
      return { honesty: { vetoes: { fired: [{ veto: 'recheck-failed', severity: 1, evidence: { err: String(e.message || e) } }], all: [] } } };
    }
  };
  const correspondence = async () => {
    await deps.runCaptureLayout({ source: cfg.cloneUrl, out: `${cfg.outDir}/clone-tree.json` });        // CHILD PROCESS
    return deps.gradeCorrespondence(bundle.srcTree, deps.readJSON(`${cfg.outDir}/clone-tree.json`), { textOnly: true }).score;
  };
  const healCtx = { pageId: cfg.pageId, base: cfg.base, b64: cfg.b64 };
  return { registry, hooks: { healCtx, recheck, correspondence, corpusMinBar: null, enforceCorpusBar: false } };
}

// One-command entry: load bundle → seed frozen source → assert seed → compose → run the gate on the BUILD's report
// (the report that fired the veto). Only the SOURCE is frozen; the CLONE is re-captured live by recheck. Any seed/
// assert throw is a fail-closed HOLD (never reach the grader with an un-fireable veto or a stale cache).
export async function runLiveGate(cfg, deps) {
  const bundle = deps.loadBundle(cfg.bundleDir);
  try { seedFrozenSource(bundle, cfg, deps); assertCacheSeeded(cfg, bundle.captureHash, deps); }
  catch (e) { return { decision: 'hold', actions: [{ action: 'fail-closed', reason: String(e.message || e) }], liveValidated: false, fired: [] }; }
  const { registry, hooks } = buildLiveWiring(cfg, bundle, deps);
  const buildReport = deps.readJSON(cfg.buildReportPath);
  return gate(buildReport, registry, hooks);
}

// Lazily-wired REAL deps (child-process CLIs + in-process pure imports + fs). Constructed only when called LIVE, so
// importing this module offline triggers nothing. Tests pass their own stub deps and never touch this.
export async function realDeps() {
  const fs = await import('node:fs');
  const { execFile } = await import('node:child_process');
  const { makeRenderAndCrop } = await import('./cta-render-crop.mjs');
  const { healUnstyledCTA } = await import('./cta-heal.mjs');
  const { gradeCorrespondence } = await import('./correspondence-reward.mjs');
  const { resolveBase } = await import('../../sandbox/host-guard.mjs');
  const run = (script, args, out) => new Promise((res, rej) => { execFile('node', [script, ...args], { cwd: new URL('.', import.meta.url).pathname }, (err) => err ? rej(err) : res(out)); });
  return {
    loadBundle: (dir) => JSON.parse(fs.readFileSync(`${dir}/bundle.json`, 'utf8')),
    readJSON: (p) => JSON.parse(fs.readFileSync(p, 'utf8')),
    writeJSON: (p, o) => fs.writeFileSync(p, JSON.stringify(o)),
    copyPng: (a, b) => fs.copyFileSync(a, b),
    mkdirp: (d) => fs.mkdirSync(d, { recursive: true }),
    exists: (p) => fs.existsSync(p),
    runGradeStructure: ({ source, clone, out }) => run('grade-structure.mjs', ['--source', source, '--clone', clone, '--out', out]),
    runCaptureLayout: ({ source, out }) => run('capture-layout.mjs', ['--source', source, '--out', out]),
    healUnstyledCTA, makeRenderAndCrop, gradeCorrespondence, resolveBaseImpl: resolveBase,
    screenshotFn: null, fetchImpl: undefined, log: (m) => console.log(m),
  };
}

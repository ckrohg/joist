#!/usr/bin/env node
// @purpose Hermetic OFFLINE gate for live-gate.mjs — proves the WIRING (registry shape, frozen-source seeding,
// recheck-report parsing + measurement-presence guard, heal→recheck→decision flow, fail-closed paths) with ZERO
// WordPress: every WP/render/CLI-touching dep is injected as a stub. The composition logic + guards run for real.
// Run: node _live-gate-selftest.mjs

import { srcCacheTag, seedFrozenSource, assertCacheSeeded, readRecheckReport, buildLiveWiring, runLiveGate } from './live-gate.mjs';

let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; fails.push(name); console.error(`  ✗ ${name} ${extra}`); } };

// ── GOLDEN: srcCacheTag must match grade-structure.mjs:509 EXACTLY (else the seed lands where the grader won't look)
const graderTag = (source, NO_LONGTEXT = false) => String(source).replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 40) + (NO_LONGTEXT ? '' : '-lt');
for (const u of ['https://resend.com', 'https://supabase.com/dashboard?x=1', 'http://localhost:8001/?page_id=2551']) {
  ok(`srcCacheTag parity: ${u}`, srcCacheTag(u) === graderTag(u), `${srcCacheTag(u)} vs ${graderTag(u)}`);
}
ok('srcCacheTag noLongtext variant parity', srcCacheTag('https://resend.com', true) === graderTag('https://resend.com', true));

// ── in-memory fake fs + stub deps ────────────────────────────────────────────────────────────────────────────
function makeDeps(over = {}) {
  const files = over._files || {};
  const calls = { runGradeStructure: 0, runCaptureLayout: 0, healUnstyledCTA: 0 };
  const base = {
    _files: files, _calls: calls,
    loadBundle: () => over._bundle,
    readJSON: (p) => { if (!(p in files)) throw new Error('ENOENT ' + p); return typeof files[p] === 'string' ? JSON.parse(files[p]) : files[p]; },
    writeJSON: (p, o) => { files[p] = o; },
    copyPng: (a, b) => { files[b] = 'png'; },
    mkdirp: () => {}, exists: (p) => p in files,
    makeRenderAndCrop: () => async () => ({ ssim: 0.9, exact: 0.6, cloneBox: { x: 0, y: 0, w: 10, h: 10 } }),
    healUnstyledCTA: async () => { calls.healUnstyledCTA++; return (over._heal || { healed: [{ id: 'cta1', text: 'Get started' }], rejected: [], refused: [], unmatched: [], nullPaint: [] }); },
    gradeCorrespondence: () => ({ score: 84 }),
    runGradeStructure: async ({ out }) => { calls.runGradeStructure++; files[`${out}/report.json`] = (over._recheck !== undefined ? over._recheck : { honesty: { vetoes: { fired: [], all: [{ veto: 'unstyled-CTA', fired: false, evidence: { srcCtas: 3, srcStyled: 2, cloneCtas: 3, cloneStyled: 3 } }] } } }); if (over._gradeThrows) throw new Error('grade exec failed'); },
    runCaptureLayout: async ({ out }) => { calls.runCaptureLayout++; files[out] = { root: { children: [] } }; }, // capture-layout --out is a FILE path
    log: () => {}, screenshotFn: null, fetchImpl: undefined, resolveBaseImpl: (b) => b,
  };
  return { ...base, ...Object.fromEntries(Object.entries(over).filter(([k]) => !k.startsWith('_'))) };
}
const goodBundle = { ctaRuns: [{ text: 'Get started', fgSat: 0, bgSat: 0.6, bgLum: 0.4, hasBg: true }], texts: [], textPos: [], census: {}, ds: {}, pageH: 820, srcCapturePng: '/frozen/src.png', srcTree: { root: { children: [] } }, srcCTAs: [{ text: 'Get started', box: { x: 1200, y: 24, w: 130, h: 44 }, leaf: {} }], captureHash: 'h-abc' };
const cfg = (over = {}) => ({ bundleDir: '/b', sourceUrl: 'https://resend.com', cloneUrl: 'http://localhost:8001/?page_id=9', pageId: 9, base: 'http://localhost:8001', b64: 'x', outDir: '/out', buildReportPath: '/build-report.json', ...over });

// ── seedFrozenSource: fail-closed on empty ctaRuns; writes cache with hash; assertCacheSeeded verifies ──────────
ok('seed fail-closed on empty ctaRuns', (() => { try { seedFrozenSource({ ctaRuns: [] }, cfg(), makeDeps()); return false; } catch { return true; } })());
{
  const d = makeDeps(); const tag = seedFrozenSource(goodBundle, cfg(), d);
  ok('seed wrote cache json+png with hash', (`/tmp/grade-src-cache/${tag}.json` in d._files) && d._files[`/tmp/grade-src-cache/${tag}.json`]._captureHash === 'h-abc');
  ok('assertCacheSeeded passes on matching hash', (() => { try { return assertCacheSeeded(cfg(), 'h-abc', d) === tag; } catch { return false; } })());
  ok('assertCacheSeeded FAILS on stale hash (cross-build)', (() => { try { assertCacheSeeded(cfg(), 'h-DIFFERENT', d); return false; } catch { return true; } })());
}

// ── readRecheckReport measurement-presence guard ──────────────────────────────────────────────────────────────
const reg = { 'unstyled-CTA': { veto: 'unstyled-CTA' } };
{
  const d = makeDeps({ _files: { '/r.json': { honesty: { vetoes: { fired: [], all: [{ veto: 'unstyled-CTA', evidence: { srcCtas: 3, cloneCtas: 3 } }] } } } } });
  ok('measured + not-fired → fired stays empty', readRecheckReport('/r.json', reg, d).honesty.vetoes.fired.length === 0);
}
{
  const d = makeDeps({ _files: { '/r.json': { honesty: { vetoes: { fired: [], all: [] } } } } });   // veto ABSENT from all (self-disabled)
  ok('SELF-DISABLE guard: absent-from-all → inject unmeasured (HOLD signal)', readRecheckReport('/r.json', reg, d).honesty.vetoes.fired.some((v) => v.veto === 'unstyled-CTA-unmeasured'));
}
{
  const d = makeDeps({ _files: { '/r.json': { honesty: { vetoes: { fired: [], all: [{ veto: 'unstyled-CTA', evidence: { srcCtas: 3, cloneCtas: 0 } }] } } } } }); // clone found 0 CTAs (degenerate)
  ok('SELF-DISABLE guard: cloneCtas:0 degenerate → inject unmeasured', readRecheckReport('/r.json', reg, d).honesty.vetoes.fired.some((v) => v.veto === 'unstyled-CTA-unmeasured'));
}
ok('readRecheckReport parse failure → recheck-parse-failed', readRecheckReport('/missing.json', reg, makeDeps()).honesty.vetoes.fired[0].veto === 'recheck-parse-failed');

// ── the 6 wiring cases through runLiveGate ───────────────────────────────────────────────────────────────────
(async () => {
  // 1. clean pass-through: build report has 0 fired vetoes → publish, no heal/recheck calls
  {
    const d = makeDeps({ _bundle: goodBundle, _files: { '/build-report.json': { honesty: { vetoes: { fired: [] } } } } });
    const r = await runLiveGate(cfg(), d);
    ok('case1 clean → publish, 0 heal/grade calls', r.decision === 'publish' && d._calls.healUnstyledCTA === 0 && d._calls.runGradeStructure === 0);
  }
  // 2. fired → heal → recheck CLEARS (measured) → publish + corpusBar metadata
  {
    const d = makeDeps({ _bundle: goodBundle, _files: { '/build-report.json': { honesty: { vetoes: { fired: [{ veto: 'unstyled-CTA', severity: 0.6 }] } } } } });
    const r = await runLiveGate(cfg(), d);
    ok('case2 heal→recheck-clear → publish', r.decision === 'publish' && d._calls.healUnstyledCTA === 1 && d._calls.runGradeStructure === 1);
    ok('case2 corpusBar metadata attached, NOT enforced', r.corpusBar && r.corpusBar.score === 84 && r.corpusBar.enforced === false);
  }
  // 3. fired → heal → recheck STILL fires same veto → hold (recheck authoritative over advisory accepted)
  {
    const recheck = { honesty: { vetoes: { fired: [{ veto: 'unstyled-CTA', severity: 0.6 }], all: [{ veto: 'unstyled-CTA', evidence: { srcCtas: 3, cloneCtas: 3 } }] } } };
    const d = makeDeps({ _bundle: goodBundle, _recheck: recheck, _files: { '/build-report.json': { honesty: { vetoes: { fired: [{ veto: 'unstyled-CTA', severity: 0.6 }] } } } } });
    const r = await runLiveGate(cfg(), d);
    ok('case3 recheck still-fires → hold', r.decision === 'hold' && /still-fired-after-heal/.test(JSON.stringify(r.actions)));
  }
  // 4. post-heal COLLATERAL: recheck clears CTA but a NEW veto appears → hold
  {
    const recheck = { honesty: { vetoes: { fired: [{ veto: 'invisible-heading', severity: 0.6 }], all: [{ veto: 'unstyled-CTA', evidence: { srcCtas: 3, cloneCtas: 3 } }] } } };
    const d = makeDeps({ _bundle: goodBundle, _recheck: recheck, _files: { '/build-report.json': { honesty: { vetoes: { fired: [{ veto: 'unstyled-CTA', severity: 0.6 }] } } } } });
    const r = await runLiveGate(cfg(), d);
    ok('case4 post-heal collateral (new veto) → hold', r.decision === 'hold' && /invisible-heading/.test(r.reason));
  }
  // 5. SELF-DISABLE soundness: recheck .fired empty but unstyled-CTA absent from .all → guard injects → hold
  {
    const recheck = { honesty: { vetoes: { fired: [], all: [] } } };
    const d = makeDeps({ _bundle: goodBundle, _recheck: recheck, _files: { '/build-report.json': { honesty: { vetoes: { fired: [{ veto: 'unstyled-CTA', severity: 0.6 }] } } } } });
    const r = await runLiveGate(cfg(), d);
    ok('case5 SELF-DISABLE → hold (not publish)', r.decision === 'hold' && /unstyled-CTA-unmeasured/.test(JSON.stringify(r.actions) + (r.reason || '')));
  }
  // 6. FAIL-CLOSED: (a) empty-ctaRuns bundle → seed throws → hold before any grade; (b) recheck exec throws → hold
  {
    const dA = makeDeps({ _bundle: { ...goodBundle, ctaRuns: [] }, _files: { '/build-report.json': { honesty: { vetoes: { fired: [{ veto: 'unstyled-CTA' }] } } } } });
    const rA = await runLiveGate(cfg(), dA);
    ok('case6a empty-ctaRuns bundle → fail-closed hold, grader never run', rA.decision === 'hold' && dA._calls.runGradeStructure === 0 && /fail-closed/.test(JSON.stringify(rA.actions)));
    const dB = makeDeps({ _bundle: goodBundle, _gradeThrows: true, _files: { '/build-report.json': { honesty: { vetoes: { fired: [{ veto: 'unstyled-CTA' }] } } } } });
    const rB = await runLiveGate(cfg(), dB);
    ok('case6b recheck exec throws → fail-closed hold (recheck-failed)', rB.decision === 'hold' && /recheck-failed/.test(JSON.stringify(rB.actions)));
  }

  console.log(`\nlive-gate selftest: ${pass} passed, ${fail} failed` + (fail ? ` [${fails.join('; ')}]` : ''));
  process.exit(fail ? 1 : 0);
})();

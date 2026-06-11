#!/usr/bin/env node
/**
 * @purpose _vjalign-selftest.mjs — STANDING pure-function selftest for VJ-ALIGN (vision-judge band-anchored
 * tile alignment). No network, no LLM, deterministic. Pins:
 *   T1 IDENTITY: identical leaves/bands both sides → mode 'band', every segment matched, clone ranges == source
 *      ranges (the band path degenerates to the proportional cut at hRatio 1 — no behavior change on aligned pages).
 *   T2 DIVERGED HEIGHTS (the 3146@1100 phantom): clone 1.45x taller with content shifted — every pair tile's
 *      clone range must bracket the SAME anchor content (anchor inside both ranges), where proportional-y is
 *      off by >700px for late bands (the phantom "wrong section" mechanism, must be measurable in the fixture).
 *   T3 CLONE-MISSING: a source band whose unique texts all vanish from the clone → exactly one 'missing' spec
 *      (sev5 deterministic downstream), and the bands AFTER it still pair correctly (no cascade misalignment).
 *   T4 CLONE-EXTRA: an uncovered clone band with >=2 novel texts → one 'extra' spec; an extra band whose texts
 *      EXIST in the source must NOT fire (innocent control).
 *   T5 FALLBACK: <4 anchor pairs → mode 'proportional-fallback' (honest degrade, no invented bands).
 *   T6 LIS CROSSING KILL: one false text match crossing the page (footer text matched into the hero) must be
 *      dropped by the monotone filter, leaving the map sane (all other anchors kept).
 * Exit 0 = ALL PASS, 1 = fail. Prints one JSON line per test.
 */
import { planBandTiles, matchUniqueAnchors, anchorMaps } from './vision-judge.mjs';

let fails = 0;
const check = (name, cond, detail) => { console.log(JSON.stringify({ test: name, pass: !!cond, ...(detail || {}) })); if (!cond) fails++; };

// fixture builders: 4 sections of 1000px each, a heading+para per section
const mkLeaves = (offsets, scale = 1, rename = {}) => {
  const texts = [['alpha heading text', 'alpha body copy words'], ['beta heading text', 'beta body copy words'], ['gamma heading text', 'gamma body copy words'], ['delta heading text', 'delta body copy words']];
  const out = [];
  texts.forEach((sec, i) => sec.forEach((t, j) => out.push({ key: rename[t] || t, y: Math.round((i * 1000 + 80 + j * 120 + (offsets[i] || 0)) * scale) })));
  return out.sort((a, b) => a.y - b.y);
};
const mkBands = (scale = 1) => [0, 1000, 2000, 3000].map((y) => ({ y: Math.round(y * scale), h: Math.round(1000 * scale) }));

// T1 IDENTITY
{
  const leaves = mkLeaves([0, 0, 0, 0]), bands = mkBands();
  const bp = planBandTiles({ srcLeaves: leaves, clnLeaves: leaves, srcBands: bands, clnBands: bands, srcH: 4000, clnH: 4000, tileH: 900 });
  const pairsOk = bp.plan.filter((s) => s.kind === 'pair').every((s) => Math.abs(s.cy0 - s.sy0) <= 1 && Math.abs(s.cy1 - s.sy1) <= 1);
  check('T1-identity', bp.mode === 'band' && bp.stats.matched === 4 && bp.stats.missing === 0 && bp.stats.extra === 0 && pairsOk,
    { mode: bp.mode, stats: bp.stats, pairsOk });
}

// T2 DIVERGED HEIGHTS — clone 1.45x taller (uneven: later sections stretch more, like an abs-pin unstack)
{
  const srcLeaves = mkLeaves([0, 0, 0, 0]), srcBands = mkBands();
  const stretch = (y) => Math.round(y < 1000 ? y : y < 2000 ? 1000 + (y - 1000) * 1.3 : y < 3000 ? 2300 + (y - 2000) * 1.6 : 3900 + (y - 3000) * 1.9);
  const clnLeaves = srcLeaves.map((l) => ({ key: l.key, y: stretch(l.y) }));
  const clnBands = srcBands.map((b) => ({ y: stretch(b.y), h: stretch(b.y + b.h) - stretch(b.y) }));
  const clnH = 5800, srcH = 4000;
  const bp = planBandTiles({ srcLeaves, clnLeaves, srcBands, clnBands, srcH, clnH, tileH: 900 });
  // every pair spec: all source anchors inside [sy0,sy1) must land inside [cy0,cy1) on the clone side
  let anchored = true, worstProp = 0;
  for (const s of bp.plan.filter((p) => p.kind === 'pair')) {
    for (const l of srcLeaves) {
      if (l.y < s.sy0 || l.y >= s.sy1) continue;
      const cl = clnLeaves.find((c) => c.key === l.key);
      if (!(cl.y >= s.cy0 - 40 && cl.y < s.cy1 + 40)) anchored = false;
      worstProp = Math.max(worstProp, Math.abs(cl.y - l.y * (clnH / srcH))); // how far proportional-y would miss
    }
  }
  check('T2-diverged', bp.mode === 'band' && bp.stats.matched === 4 && anchored && worstProp > 300,
    { mode: bp.mode, stats: bp.stats, anchored, proportionalWouldMissBy: worstProp });
}

// T3 CLONE-MISSING — gamma section absent from the clone; delta still pairs
{
  const srcLeaves = mkLeaves([0, 0, 0, 0]), srcBands = mkBands();
  const clnLeaves = srcLeaves.filter((l) => !l.key.startsWith('gamma')).map((l) => ({ key: l.key, y: l.y < 2000 ? l.y : l.y - 1000 }));
  const clnBands = [{ y: 0, h: 1000 }, { y: 1000, h: 1000 }, { y: 2000, h: 1000 }];
  const bp = planBandTiles({ srcLeaves, clnLeaves, srcBands, clnBands, srcH: 4000, clnH: 3000, tileH: 900 });
  const missing = bp.plan.filter((s) => s.kind === 'missing');
  const deltaPair = bp.plan.find((s) => s.kind === 'pair' && s.sy0 >= 3000);
  const deltaAnchor = clnLeaves.find((c) => c.key === 'delta heading text');
  const deltaOk = deltaPair && deltaAnchor.y >= deltaPair.cy0 - 40 && deltaAnchor.y < deltaPair.cy1 + 40;
  // missing specs must carry the anchor-interpolated clone window (>=240px) for MAIN's pixel arbitration
  const winOk = missing.length === 1 && Number.isFinite(missing[0].cy0) && missing[0].cy1 - missing[0].cy0 >= 240 && missing[0].cy0 >= 0 && missing[0].cy1 <= 3000;
  check('T3-missing', bp.mode === 'band' && missing.length === 1 && missing[0].sy0 === 2000 && bp.stats.missing === 1 && deltaOk && winOk,
    { stats: bp.stats, missing: missing.map((m) => [m.sy0, m.fullSy1]), window: missing.map((m) => [m.cy0, m.cy1]), deltaPair: deltaPair && [deltaPair.cy0, deltaPair.cy1], deltaCloneY: deltaAnchor.y, winOk });
}

// T4 CLONE-EXTRA + innocent control
{
  const srcLeaves = mkLeaves([0, 0, 0, 0]), srcBands = mkBands();
  // clone = source + a 1000px junk band appended with 2 novel texts
  const clnLeaves = [...srcLeaves, { key: 'junk widget promo text', y: 4150 }, { key: 'hallucinated cta words', y: 4400 }];
  const clnBands = [...mkBands(), { y: 4000, h: 1000 }];
  const bp = planBandTiles({ srcLeaves, clnLeaves, srcBands, clnBands, srcH: 4000, clnH: 5000, tileH: 900 });
  const extra = bp.plan.filter((s) => s.kind === 'extra');
  // innocent control: same appended band but its texts EXIST in the source (e.g. repeated footer) → no extra
  const cln2 = [...srcLeaves, { key: 'alpha heading text x', y: 4150 }, { key: 'delta body copy words x', y: 4400 }];
  const srcLeaves2 = [...srcLeaves, { key: 'alpha heading text x', y: 90 }, { key: 'delta body copy words x', y: 3210 }];
  const bp2 = planBandTiles({ srcLeaves: srcLeaves2, clnLeaves: cln2, srcBands, clnBands, srcH: 4000, clnH: 5000, tileH: 900 });
  check('T4-extra', bp.stats.extra === 1 && extra[0].cy0 === 4000 && bp2.stats.extra === 0,
    { extraStats: bp.stats, extraSpec: extra.map((e) => [e.cy0, e.fullCy1, e.sample]), innocentExtra: bp2.stats.extra });
}

// T5 FALLBACK — too few anchors
{
  const bp = planBandTiles({ srcLeaves: mkLeaves([0, 0, 0, 0]).slice(0, 3), clnLeaves: mkLeaves([0, 0, 0, 0]).slice(0, 2), srcBands: mkBands(), clnBands: mkBands(), srcH: 4000, clnH: 4000, tileH: 900 });
  check('T5-fallback', bp.mode === 'proportional-fallback' && bp.plan === null, { mode: bp.mode, pairs: bp.pairs });
}

// T6 LIS CROSSING KILL — footer text false-matched into the hero must be dropped, others kept
{
  const src = mkLeaves([0, 0, 0, 0]);
  const cln = mkLeaves([0, 0, 0, 0]).map((l) => l.key === 'delta body copy words' ? { key: l.key, y: 50 } : l); // crosses everything
  const pairs = matchUniqueAnchors(src, cln);
  const kept = pairs.map((p) => p.key);
  const crossDropped = !kept.includes('delta body copy words') || pairs.every((p, i) => i === 0 || p.cy >= pairs[i - 1].cy);
  const monotone = pairs.every((p, i) => i === 0 || (p.sy >= pairs[i - 1].sy && p.cy >= pairs[i - 1].cy));
  const { s2c } = anchorMaps(pairs, 4000, 4000);
  check('T6-lis', pairs.length >= 7 && crossDropped && monotone && Math.abs(s2c(2080) - 2080) < 60,
    { kept: pairs.length, monotone, mapAt2080: Math.round(s2c(2080)) });
}

console.log(fails === 0 ? 'VJALIGN SELFTEST: ALL PASS' : `VJALIGN SELFTEST: ${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);

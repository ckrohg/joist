// @purpose B1 round-4 FOLD DECISION calculator: reconstructs the projected fold from a sections.json report,
// verifies against the published projected.* numbers, then computes the MAX-GAMED composite — every foldable
// band raised to the best SURVIVING trick ceiling (post T13/T14, measured by the four labs):
//   identity leaves (img/picture/bg): LQIP blur-stamp ceiling 0.336 (zz-mi-attack A2 / attack3 N1 — grain ≤ plain;
//     wrong-busy 0.047..0.090 and gradient 0.015 are strictly lower, so LQIP bounds them); valid upper bound
//     per band: M_g = M + 0.336·(1−M)  (proof: (0.336−id)+ ≤ 0.336·(1−id) per leaf, area-weighted)
//   presence-only leaves (video/canvas): junk-<video>-tag ceiling 1.0 (T13 leaves a REAL playback surface at
//     full geometric credit BY DESIGN — wrong-video is uncomparable); mixed bands split 0.6·id + 0.4·presence.
// Safety criterion: compositeFolded_MAXGAMED < composite_unfolded  (max recoup < honest fold cost ⇒ a fully
// trick-bundled clone still scores BELOW the no-fold world ⇒ the fold can never reward trickery net).
import fs from 'fs';
const f = process.argv[2];
const r = JSON.parse(fs.readFileSync(f, 'utf8'));
const mi = r.detectors.mediaIdentity;
const FLOOR = 0.45, LQIP = +(process.argv[3] || 0.336);
const byIdx = new Map(mi.bands.map((b) => [b.idx, b]));
const mults = (r.detectors.textCollision?.mult ?? 1) * (r.detectors.fullBleed?.mult ?? 1)
  * (r.detectors.hOverflow?.mult ?? 1) * (r.detectors.overlap2?.mult ?? 1);
const fold = (m) => FLOOR + (1 - FLOOR) * m;
const chain = (ssimFolded) => {
  const pre = r.perElementScalar != null ? 0.5 * ssimFolded + 0.5 * r.perElementScalar : ssimFolded;
  const vm = +(pre * mults).toFixed(3);
  const comp = r.responsive
    ? +(0.35 * vm + 0.20 * r.editabilityMean + 0.20 * r.structuralFidelity + 0.25 * r.responsive.score).toFixed(3)
    : +(0.4 * vm + 0.3 * r.editabilityMean + 0.3 * r.structuralFidelity).toFixed(3);
  return { vm, comp };
};
let sH = 0, sG = 0, n = 0; const gamedBands = [];
for (const s of r.perSection) {
  n++;
  const b = byIdx.get(s.idx);
  const foldable = b && b.score != null && b.srcMediaFrac >= 0.10;
  const mH = foldable ? b.score : null;
  let mG = mH;
  if (foldable) {
    const A = b.srcMediaArea || 1;
    // presence-only area = leaves not identity-eligible; report has counts not areas — for PURE presence bands
    // (identityEligible 0) the whole area is video; for mixed, approximate video share by leaf-count share
    // (upper-bounded at 1). Live corpus today: bands are either pure-identity or pure-presence.
    const vidShare = b.leaves.eligible > 0 ? (b.leaves.eligible - b.leaves.identityEligible) / b.leaves.eligible : 0;
    const idH = b.identity == null ? null : b.identity;
    const idG = idH == null ? null : idH + LQIP * (1 - idH);
    if (idG == null) mG = 1;                                   // pure video band → junk-video tag = 1.0
    else if (vidShare === 0) mG = idG;                          // pure identity band (id == presence under gaming)
    else { const presG = idG * (1 - vidShare) + 1 * vidShare; mG = 0.6 * idG + 0.4 * presG; }
    mG = Math.max(mH, Math.min(1, mG));
    if (mG > mH + 1e-9) gamedBands.push({ idx: s.idx, frac: b.srcMediaFrac, mH: +mH.toFixed(3), mG: +mG.toFixed(3), vis: s.visual, dFold: +((fold(mG) - fold(mH)) * s.visual / n).toFixed(4) });
  }
  const vH = foldable ? (s.rasteredText ? Math.min(s.visual * fold(mH), 0.35) : s.visual * fold(mH)) : s.visual;
  const vG = foldable ? (s.rasteredText ? Math.min(s.visual * fold(mG), 0.35) : s.visual * fold(mG)) : s.visual;
  sH += vH; sG += vG;
}
const honest = chain(+(sH / n).toFixed(3)), gamed = chain(+(sG / n).toFixed(3));
console.log(JSON.stringify({
  page: r.clone, miMean: r.mediaIdentityMean, sections: n, mediaBands: mi.bands.length,
  unfolded: { visual: r.visualMean, composite: r.composite },
  publishedProjected: mi.projected,
  reconstructedHonestFold: honest,
  maxGamedFold: gamed,
  honestCost: +(r.composite - honest.comp).toFixed(4),
  maxRecoup: +(gamed.comp - honest.comp).toFixed(4),
  safe: gamed.comp < r.composite,
  margin: +(r.composite - gamed.comp).toFixed(4),
  gamedBands,
}, null, 1));

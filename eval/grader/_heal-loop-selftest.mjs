#!/usr/bin/env node
/** @purpose _heal-loop-selftest.mjs — HERMETIC gate for WS2 Arm D's deterministic core (diagnose + accept +
 * controller). No network: regen and scoring are STUBBED. Proves the anti-Goodhart accept() gate rejects every gaming
 * variant and accepts only guarded improvements, and the controller loops/stops correctly. Exit 1 on any fail. */
import { diagnose, accept, healSection } from './heal-loop.mjs';

let fails = 0; const ok = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); if (!c) fails++; };

// ── synthetic correspondence result + clone leaves (with healIds) ──
const cloneLeaves = [
  { healId: 'b1', text: 'Resend', box: { x: 40, y: 20, w: 90, h: 30 } },
  { healId: 'b2', text: 'Email for developers', box: { x: 168, y: 300, w: 600, h: 140 } },
  { healId: 'b3', text: 'Get started', box: { x: 168, y: 560, w: 150, h: 50 } },
];
const corr = {
  score: 70, R_text: 0.8, axes: { existence: 0.8, text: 0.9, position: 0.85, color: 0.6, typography: 0.8 },
  matches: [
    { srcIdx: 0, cloneIdx: 0, srcText: 'Resend', cloneText: 'Resend', textSim: 1, axes: { position: 0.95, color: 0.95, typography: 0.95 }, pairScore: 0.95, srcBox: { x: 40, y: 20, w: 90, h: 30 } },     // GOOD → lock
    { srcIdx: 1, cloneIdx: 1, srcText: 'Email for developers', cloneText: 'Email for developers', textSim: 1, axes: { position: 0.9, color: 0.30, typography: 0.9 }, pairScore: 0.62, srcBox: { x: 168, y: 300, w: 600, h: 140 } }, // BAD color → target
    { srcIdx: 2, cloneIdx: 2, srcText: 'Get started', cloneText: 'Get started', textSim: 1, axes: { position: 0.92, color: 0.9, typography: 0.92 }, pairScore: 0.91, srcBox: { x: 168, y: 560, w: 150, h: 50 } },  // GOOD → lock
  ],
  unmatchedSource: [{ idx: 3, text: 'Documentation', box: { x: 320, y: 560, w: 170, h: 50 }, fg: 'rgb(200,200,200)', typo: { size: 16, weight: 400 } }],
};

console.log('── (A) diagnose ──');
const m = diagnose(corr, cloneLeaves);
ok('locks the well-matched blocks (b1, b3)', m.locked.map((l) => l.healId).sort().join(',') === 'b1,b3', `locked=${m.locked.map((l) => l.healId).join(',')}`);
ok('does NOT lock the bad-color heading (b2)', !m.locked.find((l) => l.healId === 'b2'));
ok('targets ≤3 and includes the missing block + bad-color heading', m.targets.length <= 3 && m.targets.some((t) => t.issue === 'missing') && m.targets.some((t) => t.issue === 'wrong-color'), `targets=${m.targets.map((t) => t.issue).join(',')}`);
ok('every target has a concrete directive', m.targets.every((t) => t.directive && t.directive.length > 10));
ok('touchesText true (a missing text block is targeted)', m.touchesText === true);

console.log('── (B) accept — guarded improvement + anti-gaming ──');
const base = { corr, cloneLeaves };
const better = (over) => ({ corr: { ...corr, axes: { ...corr.axes, ...over.axes }, score: over.score ?? corr.score, R_text: over.R_text ?? corr.R_text, unmatchedSource: over.unmatchedSource ?? corr.unmatchedSource }, cloneLeaves: over.cloneLeaves ?? cloneLeaves });
const mColor = { ...m, targetAxis: 'color', touchesText: false, targets: [{ issue: 'wrong-color', axis: 'color', srcText: 'Email for developers' }], locked: m.locked };
ok('ACCEPTS a genuine color fix (composite up, color axis moved, nothing regressed)', accept(base, better({ score: 78, axes: { color: 0.85 } }), mColor).ok);
ok('REJECTS no composite gain', !accept(base, better({ score: 70.5, axes: { color: 0.85 } }), mColor).ok);
ok('REJECTS targeted axis did not move', !accept(base, better({ score: 75, axes: { typography: 0.99 } }), mColor).ok);
ok('REJECTS an axis regressing (position dropped)', !accept(base, better({ score: 78, axes: { color: 0.85, position: 0.70 } }), mColor).ok);
ok('REJECTS text recall dropping', !accept(base, better({ score: 78, axes: { color: 0.85 }, R_text: 0.6 }), mColor).ok);
// locked-block drift: b1 text changed
const drift = better({ score: 78, axes: { color: 0.85 }, cloneLeaves: [{ healId: 'b1', text: 'RESEND-X', box: { x: 40, y: 20, w: 90, h: 30 } }, cloneLeaves[1], cloneLeaves[2]] });
ok('REJECTS a locked block drifting (b1 text changed)', !accept(base, drift, mColor).ok);
// exact-text-once: a missing-text target where the clone now has the text TWICE (duplicate-stuffing)
const mText = { ...m, targetAxis: 'existence', touchesText: true, targets: [{ issue: 'missing', axis: 'existence', srcText: 'Documentation' }] };
const dup = better({ score: 78, axes: { existence: 0.95 }, unmatchedSource: [], cloneLeaves: [...cloneLeaves, { healId: 'd1', text: 'Documentation', box: { x: 320, y: 560, w: 170, h: 50 } }, { healId: 'd2', text: 'Documentation', box: { x: 700, y: 560, w: 170, h: 50 } }] });
ok('REJECTS duplicate-stuffing (targeted text not present exactly once)', !accept(base, dup, mText).ok);
const once = better({ score: 78, axes: { existence: 0.95 }, unmatchedSource: [], cloneLeaves: [...cloneLeaves, { healId: 'd1', text: 'Documentation', box: { x: 320, y: 560, w: 170, h: 50 } }] });
ok('ACCEPTS a real missing-text fix (text present exactly once, existence moved)', accept(base, once, mText).ok);

console.log('── (C) controller — loops, accepts, stops ──');
// stub scoreFn: maps html string "score:NN" → a corr; stub regenFn: proposes an improving html.
const mkState = (score) => ({ corr: { score, R_text: 0.8, axes: { existence: 0.8, text: 0.9, position: 0.85, color: Math.min(0.95, 0.6 + (score - 70) / 100), typography: 0.8 }, matches: corr.matches, unmatchedSource: [] }, cloneLeaves });
const scoreFn = async (html) => mkState(+(/score:(\d+)/.exec(html)?.[1] ?? 70));
let n = 70; const improveRegen = async () => { n += 8; return [{ html: `<section>score:${n}</section>`, cost: 0 }]; };
const r1 = await healSection({ currentHtml: '<section>score:70</section>', scoreFn, regenFn: improveRegen, target: 86, maxRounds: 2, log: () => {} });
ok('controller improves a degraded section across rounds', r1.improved && r1.after > r1.before, `before=${r1.before} after=${r1.after} rounds=${r1.rounds}`);
const flatRegen = async () => [{ html: '<section>score:70</section>', cost: 0 }]; // never improves
const r2 = await healSection({ currentHtml: '<section>score:70</section>', scoreFn, regenFn: flatRegen, target: 86, maxRounds: 2, log: () => {} });
ok('controller STOPS when no candidate passes the gate (no false improvement)', !r2.improved && r2.after === r2.before, `before=${r2.before} after=${r2.after}`);

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAIL'} — heal-loop selftest`);
process.exit(fails === 0 ? 0 : 1);

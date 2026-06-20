#!/usr/bin/env node
/** @purpose _heal-sweep.mjs — WS2 Arm E full-sweep: run the LIVE self-heal loop across several degradation types on a
 * known-good section and report the HEAL-RATE (the human-free certification that the loop recovers the common
 * failures). Content/recall degradations should heal; the sub-threshold control (recolor) should NOT show a spurious
 * large heal. Heavy: each case = render+capture+claude cycles (~7-10 min). Sequential on one scratch page. */
import fs from 'fs';
import { flatten } from './correspondence-reward.mjs';
import { makeScoreFn, DEGRADE } from './heal-live.mjs';
import { healSection, regenPatch } from './heal-loop.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const page = +arg('page', 806), k = +arg('k', 2), rounds = +arg('rounds', 1);
const TYPES = (arg('types', 'dropsub,dropcta,mutate') || '').split(',');     // content/recall — the healable class
const CONTROL = (arg('control', 'recolor') || '').split(',').filter(Boolean); // sub-threshold — should NOT falsely heal
const HEROBAND = 950;

const sourceLeaves = flatten(JSON.parse(fs.readFileSync('/tmp/resend-layout.json', 'utf8'))).filter((n) => n.box && n.box.y < HEROBAND);
const good = fs.readFileSync(new URL('./_heal-good-hero.html', import.meta.url).pathname, 'utf8');
const scoreFn = makeScoreFn({ sourceLeaves, page });

const goodState = await scoreFn(good); const goodScore = goodState.corr.score;
console.log(`=== Arm E SWEEP (k=${k} rounds=${rounds}) — good baseline ${goodScore} ===`);
const rows = [];
for (const type of [...TYPES, ...CONTROL]) {
  const fn = DEGRADE[type]; if (!fn) { console.log(`  ${type}: (unknown degradation, skip)`); continue; }
  const degraded = fn(good); if (degraded === good) { console.log(`  ${type}: no-op degradation, skip`); continue; }
  const res = await healSection({ currentHtml: degraded, scoreFn, regenFn: regenPatch, sourceImagePath: '/tmp/srchero-820.png', target: goodScore - 1, maxRounds: rounds, k, model: 'sonnet', log: () => {} });
  const isControl = CONTROL.includes(type);
  rows.push({ type, isControl, before: res.before, after: res.after, drop: +(goodScore - res.before).toFixed(1), gain: +(res.after - res.before).toFixed(1), healed: res.after > res.before + 1, cost: res.cost });
  const r = rows[rows.length - 1];
  console.log(`  ${type.padEnd(9)}${isControl ? '[ctl]' : '     '} drop=${String(r.drop).padStart(5)} → before=${r.before} after=${r.after}  gain=${r.gain >= 0 ? '+' : ''}${r.gain}  ${r.healed ? 'HEALED' : '—'}  $${r.cost}`);
}
const content = rows.filter((r) => !r.isControl), control = rows.filter((r) => r.isControl);
const detected = content.filter((r) => r.drop > 3), healed = detected.filter((r) => r.healed);
const healRate = detected.length ? healed.length / detected.length : 0;
console.log(`\nHEAL-RATE (of detected content degradations): ${healed.length}/${detected.length} = ${(healRate * 100).toFixed(0)}%`);
console.log(`control (sub-threshold) did NOT spuriously heal: ${control.every((r) => !r.healed || r.gain < 4) ? 'PASS' : 'FAIL'}  (${control.map((r) => r.type + ' gain ' + r.gain).join(', ') || 'none'})`);
console.log(`total cost $${rows.reduce((a, r) => a + r.cost, 0).toFixed(3)}`);
process.exit(healRate >= 0.8 && content.length ? 0 : 1);

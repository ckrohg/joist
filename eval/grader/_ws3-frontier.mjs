#!/usr/bin/env node
/** @purpose _ws3-frontier.mjs — WS3 validation: the 3-tier selector (veto-floor → correspondence frontier → listwise
 * judge) on the resend hero candidates. Shows the broken D0 is excluded by the $0 tiers (never reaches the paid judge),
 * the frontier = the clean band, and the judge fine-picks within it — cheaper + safer than judge-alone. */
import fs from 'fs';
import { bestOfNCorr } from './bestofn-select.mjs';
import { flatten, correspondSection } from './correspondence-reward.mjs';

const HEROBAND = 950, SEC = { x: 0, y: 0, w: 1440, h: HEROBAND, bg: 'rgb(8,8,8)' };
const heroLeaves = (p) => flatten(JSON.parse(fs.readFileSync(p, 'utf8'))).filter((n) => n.box && n.box.y < HEROBAND);
const srcHero = heroLeaves('/tmp/resend-layout.json');
const candidates = [
  { id: 'D0', shot: '/tmp/D0-flow-hero.png', tree: '/tmp/clone-772.json' },
  ...[1, 2, 3, 4, 5, 6].map((i) => ({ id: 'H' + i, shot: `/tmp/cand-${i}.png`, tree: `/tmp/cap-cand-${i}.json` })),
];
const correspond = (c) => correspondSection(srcHero, heroLeaves(c.tree), SEC, SEC, { srcPageBg: 'rgb(8,8,8)', clonePageBg: 'rgb(8,8,8)', textOnly: true }).score;

const res = await bestOfNCorr({ sourcePng: '/tmp/srchero-820.png', candidates, correspond, model: 'haiku', frontierBand: 14 });

console.log('=== WS3 — 3-tier selection (veto-floor → correspondence frontier → listwise judge) ===');
console.log('id   floored  corr   frontier  judge   reward');
for (const r of res.ranked) console.log(`${r.id.padEnd(4)} ${r.floor.floored ? 'FLOOR' : '  -  '}   ${String(r.corr ?? '-').padStart(5)}   ${r.frontier ? '  ✓   ' : '  ·   '}   ${String(r.judge ?? '-').padStart(4)}   ${r.reward}`);
console.log(`\nfloored ${res.flooredCount}/${candidates.length}  |  frontier ${res.frontierCount} (corr ≥ ${(res.maxCorr - 14).toFixed(0)})  |  judge calls ${res.judgeCalls} over the frontier (vs ${candidates.length} if judge-alone)  |  cost $${res.cost}`);
console.log(`SELECTED → ${res.winner.id} (reward ${res.winner.reward})`);
const d0 = res.ranked.find((r) => r.id === 'D0');
console.log(`\nbroken D0: ${d0.floor.floored ? 'FLOORED at Tier-0' : d0.frontier ? 'in frontier (✗ should be excluded)' : 'excluded by Tier-1 correspondence'} — ${d0.judge == null ? 'never reached the paid judge ✓' : 'reached the judge ✗'}`);

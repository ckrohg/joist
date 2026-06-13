#!/usr/bin/env node
// @purpose _assemble-judging-selftest.mjs — pins the two 2026-06-12 assemble-judging.mjs fixes:
//   (1) --seed is HONORED: two different seeds produce different left/right mappings; the same seed
//       reproduces the same mapping byte-for-byte (it used to be silently ignored — P3 judging taint).
//   (2) the answer key NEVER reaches stdout: no left/right mapping, no seed (seed + script = key).
//       Key file (answer-key.json) is the ONLY key channel.
// Pure-node, no network, no WordPress. Exit 0 = ALL PASS, exit 1 with the failed assertion otherwise.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildKey, SECTIONS } from './assemble-judging.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'assemble-judging.mjs');
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

// ── unit: pure key builder ───────────────────────────────────────────────────────────────────────────────────
const mapOf = (k) => JSON.stringify(k.pairs);
check('same seed reproduces identical mapping', mapOf(buildKey(7)) === mapOf(buildKey(7)));
check('legacy default seed reproduces original P3 key shape', Object.keys(buildKey(20260612).pairs).length === SECTIONS.length);
// find a seed whose mapping differs from seed 1 (10 coin flips; adjacent seeds can collide by chance, so scan)
let alt = -1;
for (let s = 2; s < 64; s++) if (mapOf(buildKey(s)) !== mapOf(buildKey(1))) { alt = s; break; }
check('different seeds produce different mappings', alt !== -1, alt !== -1 ? `seed 1 vs seed ${alt}` : 'seeds 2..63 ALL matched seed 1');

// ── CLI: --seed honored end-to-end + key/seed never on stdout ───────────────────────────────────────────────
// both seeds large (9 digits, never a plausible count/path substring) and chosen so the mappings DIFFER
const SEED_A = 391847261;
let SEED_B = SEED_A + 1;
while (mapOf(buildKey(SEED_B)) === mapOf(buildKey(SEED_A))) SEED_B++;
const dirs = { a1: '/tmp/asm-judging-selftest-a1', a2: '/tmp/asm-judging-selftest-a2', b: '/tmp/asm-judging-selftest-b' };
for (const d of Object.values(dirs)) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
const run = (args) => execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', timeout: 30000 });

const outA1 = run(['--seed', String(SEED_A), '--out', dirs.a1]);
const outA2 = run(['--seed', String(SEED_A), '--out', dirs.a2]);
const outB = run(['--seed', String(SEED_B), '--out', dirs.b]);
const keyA1 = JSON.parse(fs.readFileSync(path.join(dirs.a1, 'answer-key.json'), 'utf8'));
const keyA2 = JSON.parse(fs.readFileSync(path.join(dirs.a2, 'answer-key.json'), 'utf8'));
const keyB = JSON.parse(fs.readFileSync(path.join(dirs.b, 'answer-key.json'), 'utf8'));

check('CLI: key file records the passed seed', keyA1.seed === SEED_A && keyB.seed === SEED_B);
check('CLI: same seed -> identical key files', JSON.stringify(keyA1) === JSON.stringify(keyA2));
check('CLI: different seed -> different mapping', JSON.stringify(keyA1.pairs) !== JSON.stringify(keyB.pairs));
check('CLI: key matches pure buildKey(seed)', JSON.stringify(keyA1.pairs) === mapOf(buildKey(SEED_A)));

const LEAK = /"(left|right)"\s*:\s*"(with|without)"|"pairs"\s*:/;
for (const [name, out, seed] of [['A1', outA1, SEED_A], ['A2', outA2, SEED_A], ['B', outB, SEED_B]]) {
  check(`CLI ${name}: no mapping JSON on stdout`, !LEAK.test(out));
  check(`CLI ${name}: seed never on stdout`, !out.includes(String(seed)));
}
check('CLI: stdout mentions only counts+paths', /assembled \d+ pairs/.test(outA1) && outA1.includes('key sealed'));

const manifest = JSON.parse(fs.readFileSync(path.join(dirs.a1, 'manifest.json'), 'utf8'));
const mStr = JSON.stringify(manifest);
check('manifest: judge-facing, no seed / no arm identity / no render-* names', !/seed/i.test(mStr) && !/render-(with|without)/.test(mStr) && !/"(left|right)"\s*:\s*"(with|without)"/.test(mStr));
check('manifest: 10 pairs with left/right png names', manifest.pairs.length === 10 && manifest.pairs.every((p) => /^pair-\d\d-left\.png$/.test(p.left) && /^pair-\d\d-right\.png$/.test(p.right)));

// copy behavior: synthesize render files for pair 01 and confirm they land as pair-01-{left,right}.png
const dirC = '/tmp/asm-judging-selftest-c';
fs.rmSync(dirC, { recursive: true, force: true }); fs.mkdirSync(dirC, { recursive: true });
fs.writeFileSync(path.join(dirC, 'render-with-01.png'), Buffer.from('WITH-ARM'));
fs.writeFileSync(path.join(dirC, 'render-without-01.png'), Buffer.from('WITHOUT-ARM'));
run(['--seed', String(SEED_A), '--out', dirC]);
const keyC = JSON.parse(fs.readFileSync(path.join(dirC, 'answer-key.json'), 'utf8'));
const leftBytes = fs.readFileSync(path.join(dirC, 'pair-01-left.png'), 'utf8');
check('CLI: pair files copied per the sealed mapping', leftBytes === (keyC.pairs['01'].left === 'with' ? 'WITH-ARM' : 'WITHOUT-ARM'));

for (const d of [...Object.values(dirs), dirC]) fs.rmSync(d, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);

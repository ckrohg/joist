#!/usr/bin/env node
/**
 * @purpose tripwire.mjs — the permanent NEGATIVE-CONTROL TRIPWIRE for the autonomous publish/hold gate
 * (fusion design 2026-06-20; see knowledge/PATH_TO_TRUE_1TO1_V3.md §6 and the GATE_BEFORE_PREVIEW spine).
 *
 * It REPLAYS the real, current detectors (runVetoes) over an append-only, hash-pinned corpus of FROZEN RAW INPUTS
 * (screenshots — NOT frozen reports; a frozen report would re-exercise only the gate's ROUTING, never the DETECTION
 * surface where a wrongful ship actually originates). Two arms that must never be conflated:
 *
 *   • Arm 1 — REGRESSION tripwire (HARD). Fixtures whose breakage is detectable TODAY: replaying must fire the
 *     expected veto(s) → the gate HOLDs. A fixture that always passed now failing (a veto stopped firing / a clean
 *     control started firing) = the detection or routing layer REGRESSED → HALT THE WHOLE FLYWHEEL (trust nothing
 *     this cycle). Fail-closed: trade throughput for known-safe.
 *   • Arm 2 — DETECTOR-MISS CANARY (TRACKED, teeth short of halt). Human-confirmed-broken fixtures the detectors
 *     MISS today (they publish). They cannot assert HOLD without tripping permanently, so they assert a DEFICIT
 *     (gate publishes; liability:open), counted in blindSpotCount — a standing, owned, never-silently-growing
 *     liability. When a detector closes a hole, the fixture MIGRATES Arm 2 → Arm 1 (a deliberate, logged, one-way
 *     edit — never an auto-reseed).
 *
 * ANTI-SELF-GAMING INVARIANT (the one rule that keeps the tripwire from becoming a lying instrument):
 *   The oracle is EXTERNAL, IMMUTABLE, APPEND-ONLY. The detectors/gate may never create, relabel, filter, or retire
 *   the fixtures they are tested against — only run against hash-pinned bytes. Every `expect` derives from a
 *   `humanAnchor` frozen BEFORE admission, never from an automated score, and may relax in ONE direction only
 *   (a blind spot closing, Arm 2 → Arm 1), never tighten a red tripwire to green.
 *
 * It lives OUTSIDE gate.mjs on purpose (preserves the gate's pure/no-IO contract; embedding fixtures would make the
 * unit-under-test grade itself = the recursion we are avoiding). Wire it as STEP 0 of corpus-run.mjs (before any
 * live build) and as a standalone CI gate. The live publish path must require a fresh TripwirePassToken bound to
 * {gitSHA, detectorSHA, corpusHash, fixtureHashes} — a green run from an OLD detector SHA cannot authorize a publish.
 *
 * BIGGEST BLIND SPOT (named, not hidden): the corpus is a MEMORY of past catches — it has ZERO coverage of the FIRST
 * occurrence of any new failure mode. It drives the RECURRENCE of known failures toward zero; it does nothing about
 * the first instance of an unknown one. The freeze-pump (every human-LOOK-caught false-positive frozen as a new
 * fixture) is the only thing that grows coverage; under full autonomy it grows only as fast as humans review output.
 *
 * Usage:
 *   node tripwire.mjs                 # evaluate the frozen corpus → verdict + (on regression) the HALT paging line
 *   node tripwire.mjs --seed          # (re)generate tripwire-corpus.json from the labeled ladders (one-way arm set)
 *   node tripwire.mjs --json          # machine-readable verdict
 * Exit codes: 0 = pass, 2 = HALT (Arm-1 regression), 0-with-quarantine = Arm-2 deficit only (never blocks alone).
 */
import fs from 'fs';
import path from 'path';
import url from 'url';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { PNG } from 'pngjs';
import { runVetoes } from './veto-detectors.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CORPUS = path.join(HERE, 'calibration', 'tripwire-corpus.json');
const rootPath = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const fileSha = (p) => { try { return 'sha256:' + sha256(fs.readFileSync(p)); } catch { return null; } };

// ── pixel replay (mirror of grade-structure's runVetoes ctx construction; pixel-coverable detectors only) ──────
const grayV = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
function ssimCrop(a, b, x0, y0, x1, y1, step = 24) {
  const win = 8, C1 = 6.5, C2 = 58.5, X1 = Math.min(x1, a.width, b.width), Y1 = Math.min(y1, a.height, b.height);
  let tot = 0, n = 0;
  for (let by = y0; by + win <= Y1; by += step) for (let bx = x0; bx + win <= X1; bx += step) {
    let ma = 0, mb = 0;
    for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const ia = ((by + y) * a.width + bx + x) * 4, ib = ((by + y) * b.width + bx + x) * 4; ma += grayV(a.data, ia); mb += grayV(b.data, ib); }
    const N = 64; ma /= N; mb /= N;
    let va = 0, vb = 0, cov = 0;
    for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const ia = ((by + y) * a.width + bx + x) * 4, ib = ((by + y) * b.width + bx + x) * 4; const da = grayV(a.data, ia) - ma, db = grayV(b.data, ib) - mb; va += da * da; vb += db * db; cov += da * db; }
    va /= 63; vb /= 63; cov /= 63;
    tot += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
  }
  return n ? tot / n : 1;
}
function bands(a, b, bp = 200) {
  const H = Math.min(a.height, b.height), W = Math.min(a.width, b.width), nb = Math.ceil(H / bp), ssim = [], exact = [];
  for (let i = 0; i < nb; i++) {
    const y0 = i * bp, y1 = Math.min(H, y0 + bp);
    ssim.push(+ssimCrop(a, b, 0, y0, W, y1, 16).toFixed(4));
    let s = 0, t = 0;
    for (let y = y0; y < y1; y += 4) for (let x = 0; x < W; x += 4) { const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4; if (Math.abs(a.data[ia] - b.data[ib]) < 12 && Math.abs(a.data[ia + 1] - b.data[ib + 1]) < 12 && Math.abs(a.data[ia + 2] - b.data[ib + 2]) < 12) s++; t++; }
    exact.push(t ? +(s / t).toFixed(4) : 0);
  }
  return { ssim, exact };
}
const loadPng = (p) => PNG.sync.read(fs.readFileSync(p));
function replayFired(srcPath, clonePath) {
  const src = loadPng(rootPath(srcPath)), clone = loadPng(rootPath(clonePath));
  const { ssim: bandSSIM, exact: bandExact } = bands(src, clone);
  const ps = +ssimCrop(src, clone, 0, 0, Math.min(src.width, clone.width), Math.min(src.height, clone.height), 32).toFixed(4);
  const { fired } = runVetoes({ srcShot: src, cloneShot: clone, pageSSIM: ps, bandSSIM, bandExact, contrastFails: null, srcCtaRuns: null, cloneCtaRuns: null });
  return fired.map((v) => v.veto);
}

// ── SEED: build the corpus from the labeled ladders. Arm/expect derive from the rung's KNOWN LABEL (ground truth) +
// whether the CURRENT detectors catch it (the one allowed degree of freedom — a canary migrates to Arm 1 when a
// detector closes the hole). This runs ONCE; thereafter the corpus is frozen and re-running only CHECKS it. ────────
const LABEL_EXPECT = { hero: 'broken-hero', heading: 'invisible-heading' }; // injected-defect → the veto that owns it
function seed() {
  const man = path.join(HERE, 'calibration', 'ladders', 'manifest.json');
  if (!fs.existsSync(man)) { console.error('seed: ladders manifest missing'); process.exit(1); }
  const m = JSON.parse(fs.readFileSync(man, 'utf8'));
  const fixtures = []; let id = 0;
  for (const base of m.bases) {
    for (const rung of base.rungs) {
      const fired = replayFired(base.source_img, rung.clone_img);
      const want = LABEL_EXPECT[String(rung.defect)] || null; // the veto this rung's injected defect should trip
      const broken = rung.defect != null || (rung.level === 0 && base.base === 'linear'); // linear base clone has a LOOK-confirmed missing nav
      const tag = `TW-${String(++id).padStart(4, '0')}`;
      let rec;
      if (!broken) {
        // labeled-CLEAN → Arm 1 clean control: must fire NOTHING (a fire here = a deflation regression).
        rec = { id: tag, class: 'regression:clean-control', veto: null, expect: { detectionFires: [], gate: 'publish' }, humanAnchor: { overall_0_100: 100 } };
      } else if (want && fired.includes(want)) {
        // detectable TODAY → Arm 1 regression: the expected veto must keep firing.
        rec = { id: tag, class: 'regression:veto', veto: want, expect: { detectionFires: [want], gate: 'hold' }, humanAnchor: { overall_0_100: rung.level >= 3 ? 5 : 20 } };
      } else {
        // human-broken but the detectors MISS it → Arm 2 canary: publishes today, standing liability.
        const why = rung.defect === 'heading' ? 'invisible-heading needs live style-runs (contrastFails) — pixel-only here'
          : (rung.level === 0 ? 'missing-nav: broken-hero is hero-scoped (skips band 0) and no nav/content-void veto exists yet'
            : 'no detector covers this defect class yet');
        rec = { id: tag, class: 'canary:blind-spot', veto: null, expect: { detectionFires: [], gate: 'publish', liability: 'open' }, humanAnchor: { overall_0_100: 0 }, note: why };
      }
      rec.frozen = { source: base.source_img, clone: rung.clone_img };
      rec.hashes = { source: fileSha(rootPath(base.source_img)), clone: fileSha(rootPath(rung.clone_img)) };
      rec.provenance = `ladder:${base.base}-${rung.label}`;
      rec.immutable = true;
      fixtures.push(rec);
    }
  }
  const corpus = { tool: 'joist-tripwire-corpus', version: 1, note: 'append-only, hash-pinned FROZEN INPUTS; expects derive from known labels + a human anchor, NEVER from a grader score; relax one-way (Arm2→Arm1) only', fixtures };
  fs.writeFileSync(CORPUS, JSON.stringify(corpus, null, 2));
  const a1 = fixtures.filter((f) => f.class.startsWith('regression')).length, a2 = fixtures.filter((f) => f.class.startsWith('canary')).length;
  console.log(`seeded ${fixtures.length} fixtures → ${path.relative(ROOT, CORPUS)}  (Arm1 regression=${a1}, Arm2 canary=${a2})`);
}

// ── EVALUATE: replay every frozen fixture through the REAL detectors; check its arm's expectation. ────────────────
export function evaluate() {
  if (!fs.existsSync(CORPUS)) { console.error('no corpus — run `node tripwire.mjs --seed` first'); process.exit(1); }
  const corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  const halts = [], canaries = []; let passes = 0;
  for (const f of corpus.fixtures) {
    // input-integrity: a fixture whose frozen bytes changed is INVALID (the oracle must be immutable).
    const h = fileSha(rootPath(f.frozen.clone));
    if (f.hashes && f.hashes.clone && h && h !== f.hashes.clone) { halts.push({ id: f.id, kind: 'fixture-mutated', detail: 'frozen clone bytes changed' }); continue; }
    const fired = replayFired(f.frozen.source, f.frozen.clone);
    if (f.class === 'regression:veto') {
      const ok = f.expect.detectionFires.every((v) => fired.includes(v));
      if (ok) passes++; else halts.push({ id: f.id, kind: 'regression', veto: f.expect.detectionFires.join(','), expected: 'hold', got: 'publish', provenance: f.provenance });
    } else if (f.class === 'regression:clean-control') {
      if (fired.length === 0) passes++; else halts.push({ id: f.id, kind: 'deflation', expected: 'no-veto', got: fired.join(','), provenance: f.provenance });
    } else { // canary:blind-spot — assert the DEFICIT still holds (still missed). If it now FIRES, the hole CLOSED.
      if (fired.length === 0) canaries.push({ id: f.id, note: f.note, provenance: f.provenance });
      else canaries.push({ id: f.id, closed: true, nowFires: fired.join(','), note: 'HOLE CLOSED → migrate Arm2→Arm1 (one-way)', provenance: f.provenance });
    }
  }
  return { halts, canaries, blindSpotCount: canaries.filter((c) => !c.closed).length, closable: canaries.filter((c) => c.closed), passes, total: corpus.fixtures.length };
}

// ── pass token: binds a green verdict to the exact code + fixtures that produced it (anti-stale-pass). ────────────
export function passToken() {
  let gitSHA = 'nogit'; try { gitSHA = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch {}
  const detectorSHA = fileSha(path.join(HERE, 'veto-detectors.mjs'));
  const corpusHash = fileSha(CORPUS);
  return 'tw:' + sha256([gitSHA, detectorSHA, corpusHash].join('|')).slice(0, 16) + `@${gitSHA}`;
}

function main() {
  if (process.argv.includes('--seed')) return seed();
  const r = evaluate();
  const halt = r.halts.length > 0;
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ ...r, halt, token: halt ? null : passToken() }, null, 2)); process.exit(halt ? 2 : 0); }
  console.log(`\n══ TRIPWIRE ══  ${r.passes}/${r.total} fixtures pass  |  Arm1 halts=${r.halts.length}  Arm2 blindSpots=${r.blindSpotCount}  closable=${r.closable.length}\n`);
  if (r.halts.length) {
    console.log('🛑 HALT — a fixture that always passed now fails (detection/routing regressed). Flywheel must STOP:');
    for (const h of r.halts) console.log(`   TRIPWIRE HALT id=${h.id} kind=${h.kind} ${h.veto ? 'veto=' + h.veto + ' ' : ''}expected=${h.expected || 'no-fire'} got=${h.got || '-'} (${h.provenance})`);
  }
  if (r.closable.length) { console.log('\n✅ HOLE(S) CLOSED — migrate Arm2→Arm1 (one-way, deliberate edit):'); for (const c of r.closable) console.log(`   ${c.id} now fires ${c.nowFires} (${c.provenance})`); }
  if (r.blindSpotCount) { console.log(`\n⚠️  ${r.blindSpotCount} OPEN blind-spot canar${r.blindSpotCount === 1 ? 'y' : 'ies'} (publish today — owned liability, must not grow silently):`); for (const c of r.canaries.filter((x) => !x.closed)) console.log(`   ${c.id} — ${c.note} (${c.provenance})`); }
  if (!halt) console.log(`\nPASS — token ${passToken()}`);
  console.log('');
  process.exit(halt ? 2 : 0);
}

// run main() only when invoked directly — so _tripwire-selftest.mjs can import evaluate() without triggering it.
if (process.argv[1] && url.pathToFileURL(process.argv[1]).href === import.meta.url) main();

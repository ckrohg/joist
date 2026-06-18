#!/usr/bin/env node
/**
 * @purpose Single end-to-end CLONE entry point — consolidates the validated pipeline so it's one command,
 * not scattered scripts. Orchestrates: capture-layout (robust DOM box-tree) → build (chosen mode) →
 * grade-structure (visual + editability objective) → report composite + page URL.
 *
 * Modes (see knowledge/CLONE_PIPELINE.md for when each wins):
 *   router (default)   — build absolute (the high-fidelity skill); if it trips a RESPONSIVE veto-cap (a
 *                        desktop-pixel build is mobile-broken), build the floor-guaranteed hybrid-flow and ship
 *                        whichever WINS onto the page. The always-works floor (motor-cortex ①): never ship a
 *                        mobile-broken desktop-pin when a responsive floor beats it. (corpus: MIN 0.35→0.45,
 *                        veto-rate 1.0→0.29.) Reversible: pick an explicit mode, or JOIST_NO_ROUTER_FLOOR=1.
 *   absolute           — absolute-positioned NATIVE widgets: 1:1 desktop structure + editable. Desktop-pixel.
 *   hybrid             — editable simple sections + rastered hard sections. Fallback when capture collapses.
 *   raster             — full section-raster: 1:1 visual, 0 editable. Fallback for headless-unrenderable sites.
 *
 * Usage: node clone.mjs --source <url> --page <id> [--mode router|absolute|hybrid|raster] [--no-grade] [--cache] [--refresh]
 *   --cache    freeze the capture per source (absolute: cached ensemble layout at /tmp/abs-cache/<slug>/;
 *              hybrid: forwarded to build-hybrid's own /tmp/hybrid-cache). Deterministic rebuilds.
 *   --refresh  with --cache: force a fresh capture and re-freeze it. No-op without --cache.
 *   (raster mode has no capture cache — flags are ignored there.)
 *   --cap <dir>  full SOURCE capture dir (manifest.json + shots/ + outline.txt + source.html +
 *              crops-manifest.json) for the FINISH-THE-PAGE completeness gate (see below). If omitted,
 *              the gate is skipped (it needs the rich cap dir, not just the box-tree layout.json).
 *
 * ════════════════════════════ FINISH-THE-PAGE completeness gate (opt-in) ════════════════════════════
 *   After render+grade, optionally run grade-completeness-rail.mjs — a DETERMINISTIC, cap-anchored,
 *   no-model check that catches quiet ABRIDGEMENT (the author silently dropping whole source content
 *   bands — e.g. tailwind's dense bento rebuilt as a thin subset). grade-structure measures visual+
 *   editability fidelity of what IS there; it is BLIND to what's MISSING. The rail closes that hole:
 *   it reports completenessScore + a list of `omissions` (the dropped bands, each with the salient text /
 *   crop to add). Gated ON by env JOIST_COMPLETENESS=1 (default OFF → byte-identical to before). Requires
 *   --cap <dir>. Renders a frozen clone shot (via _render-shot.mjs) so the visual fallback is deterministic.
 *
 *   THE STANDING LOOP CONTRACT (what every clone must satisfy before STOP):
 *     1. render the clone  → 2. grade-structure (fidelity)  → 3. completeness rail with --clone-shot.
 *     4. if rail.pass === false: the author loop MUST add `rail.omissions` (each names the missing band's
 *        text / image crop) to the page, re-render, and re-gate. Do NOT STOP with pass===false unless the
 *        omissions are provably uncloneable at the chosen tier. A "high composite, low completeness" clone
 *        is an ABRIDGED clone — fidelity-at-density is a lie until the gate passes.
 *   This script performs steps 1-3 and REPORTS pass + omissions; step 4 (adding content) is the agentic
 *   author loop's job (it is not fully scriptable). See the joist-clone SKILL.md Phase 6 for the encoded
 *   author-side contract. Set JOIST_COMPLETENESS_GATE=1 (in addition) to EXIT NON-ZERO when pass===false,
 *   so a CI/corpus harness fails loudly on an abridged clone; otherwise the result is report-only.
 *
 * Env: JOIST_AUTH_B64 (source /tmp/joist-auth.env), JOIST_BASE.
 *   JOIST_COMPLETENESS=1       run the completeness rail in the grade step (needs --cap). Default OFF.
 *   JOIST_COMPLETENESS_GATE=1  additionally make a failing gate exit non-zero (hard gate for CI/corpus).
 *   JOIST_MOTION=1             run grade-motion.mjs as a REPORT-ONLY SHADOW field after grade-structure.
 *                              Default OFF. The live composite is a STATIC single-scroll grade — BLIND to
 *                              hover/scroll-reveal/parallax/pin/marquee/library motion — so a static clone of
 *                              an animated source scores identically today. This flag captures motion signals
 *                              for source-vs-clone and writes `motion-report.json` (motionScore + the detected
 *                              motion fingerprint + missing/extra motion) to the SAME grade out-dir. It is a
 *                              SHADOW measurement: it reads only `motionScore`, NEVER folds into `composite`,
 *                              and a grade-motion failure is swallowed (it cannot break the existing flow).
 *                              Richness-weighted: a static source ⇒ motionScore→1.0 (never deflates).
 */
import { spawn } from 'child_process';
import fs from 'fs';
import { resolveBase } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: never render/PUT to a non-training host
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const source = arg('source'), page = arg('page'), mode = arg('mode', 'router');
const capDir = arg('cap');                                       // full source capture dir for the completeness gate
const COMPLETENESS = process.env.JOIST_COMPLETENESS === '1';     // opt-in: run the finish-the-page rail
const COMPLETENESS_HARD = process.env.JOIST_COMPLETENESS_GATE === '1'; // additionally: fail (exit≠0) when not pass
const MOTION = process.env.JOIST_MOTION === '1';                 // opt-in: run grade-motion as a REPORT-ONLY shadow field (NEVER touches the composite)
// §0 SAFETY GUARD: default to the LOCAL sandbox (was the PAUSED shared host georges232.sg-host.com,
// which agents strayed onto and tanked). resolveBase() throws LOUDLY before any network call if a
// JOIST_BASE override points anywhere but localhost:8001 / JOIST_TRAINING_BASE / JOIST_ALLOWED_HOSTS.
const base = resolveBase(process.env.JOIST_BASE || 'http://localhost:8001');
if (!source || !page) { console.error('usage: node clone.mjs --source <url> --page <id> [--mode router|absolute|hybrid|raster] [--no-grade]'); process.exit(2); }
const slug = source.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 16).toLowerCase();
const layout = `/tmp/clone-layout-${slug}.json`;
const run = (cmd, args) => new Promise((res, rej) => { const p = spawn(cmd, args, { stdio: 'inherit', env: process.env }); p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${args.join(' ')} → exit ${c}`)))); });
// like run() but CAPTURES stdout (for the rail's --json line). Inherits stderr so progress is still visible.
const runCap = (cmd, args) => new Promise((res) => { let out = ''; const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], env: process.env }); p.stdout.on('data', (d) => (out += d)); p.on('close', (c) => res({ code: c, out })); });

// CAPTURE CACHE (--cache): freeze the ensemble layout per source so corpus rebuilds measure BUILDER
// changes without capture noise (mirrors build-hybrid's --cache). --refresh forces a recapture.
// Without --cache, behavior is byte-identical to before (always live capture).
const cacheDir = has('cache') ? `/tmp/abs-cache/${slug}` : null;
const cachedLayout = cacheDir ? `${cacheDir}/layout.json` : null;

(async () => {
  console.log(`\n=== CLONE ${source} → page ${page} (mode: ${mode}) ===`);
  if (mode === 'absolute' || mode === 'router') { // router starts from the absolute build (the high-fidelity skill)
    if (cachedLayout && fs.existsSync(cachedLayout) && !has('refresh')) {
      console.log(`• capture: CACHED ← ${cachedLayout}`); fs.copyFileSync(cachedLayout, layout);
    } else {
      console.log('• capture (ensemble, best-of-3 — stable on dynamic sites)…'); await run('node', ['capture-ensemble.mjs', '--source', source, '--out', layout, '--passes', '3']);
      if (cacheDir) { fs.mkdirSync(cacheDir, { recursive: true }); fs.copyFileSync(layout, cachedLayout); console.log(`  cached → ${cachedLayout}`); }
    }
    console.log('• build-absolute…'); await run('node', ['build-absolute.mjs', '--layout', layout, '--page', page]);
  } else if (mode === 'hybrid') {
    const ba = ['build-hybrid.mjs', '--source', source, '--page', page];
    if (has('cache')) ba.push('--cache'); if (has('refresh')) ba.push('--refresh');
    console.log('• build-hybrid…'); await run('node', ba);
  } else if (mode === 'raster') {
    console.log('• build-sectionraster…'); await run('node', ['build-sectionraster.mjs', '--source', source, '--page', page]);
  } else { console.error('unknown mode', mode); process.exit(2); }

  const cloneUrl = `${base}/?page_id=${page}`;
  if (!has('no-grade')) {
    console.log('• grade-structure…');
    let out = `/tmp/clone-grade-${slug}`;
    await run('node', ['grade-structure.mjs', '--source', source, '--clone', cloneUrl, '--out', out]);
    let report = null; try { report = JSON.parse(fs.readFileSync(`${out}/report.json`, 'utf8')); console.log(`\n=== RESULT ===\ncomposite ${report.composite} | visual ${report.visual} | editability ${report.editability} | hRatio ${report.breakdown.hRatio}`); } catch {}

    // ── ROUTER FLOOR GUARANTEE (mode=router, motor-cortex ①) ─────────────────────────────────────────
    // If the absolute build tripped a RESPONSIVE veto-cap (cliff/mobileH/amputation in report.midwidth.caps —
    // a desktop-pixel build that is mobile-broken), build the floor-guaranteed hybrid-flow (reusing the SAME
    // cached layout, so no double capture) and ship whichever WINS onto --page. The flow floor reflows by
    // construction → clears the responsive caps that floor absolute 7/7. We keep absolute only when it has NO
    // responsive cap (rare, simple pages) OR still out-scores the floor. Reversible: any explicit non-router
    // --mode skips this; JOIST_NO_ROUTER_FLOOR=1 forces keep-absolute. A hybrid-flow failure degrades to absolute.
    if (mode === 'router' && report && report.midwidth?.caps?.length && process.env.JOIST_NO_ROUTER_FLOOR !== '1') {
      console.log(`\n• router: absolute tripped responsive cap(s) [${report.midwidth.caps.join('; ')}] → build floor-guaranteed hybrid-flow…`);
      try {
        await run('node', ['build-hybrid-flow.mjs', '--layout', layout, '--source', source]);
        let led = null; try { led = JSON.parse(fs.readFileSync('/tmp/hybrid-residual-ledger.json', 'utf8')); } catch {}
        const hfComposite = led?.grade?.composite ?? -1, hfArm = led?.grade?.shipped ?? 'hybrid';
        const absComposite = report.composite ?? -1;
        if (led && hfComposite > absComposite) {
          const treePath = hfArm === 'flow' ? '/tmp/flow-only-tree.json' : '/tmp/hybrid-flow-tree.json';
          const tree = JSON.parse(fs.readFileSync(treePath, 'utf8'));
          console.log(`• router: hybrid-flow:${hfArm} ${hfComposite} > absolute ${absComposite} → ship onto page ${page}…`);
          const { render } = await import('../../sandbox/render.mjs');
          await render([tree], { page, slug: `router-${slug}`, title: 'Router clone (floor-guaranteed hybrid-flow)', width: 1440 });
          out = `/tmp/clone-grade-${slug}-router`;
          await run('node', ['grade-structure.mjs', '--source', source, '--clone', cloneUrl, '--out', out]);
          try { report = JSON.parse(fs.readFileSync(`${out}/report.json`, 'utf8')); } catch {}
          console.log(`\n=== ROUTED RESULT (shipped hybrid-flow:${hfArm}) ===\ncomposite ${report?.composite} | visual ${report?.visual} | editability ${report?.editability} | responsive ${report?.responsive}`);
        } else {
          console.log(`• router: absolute ${absComposite} >= hybrid-flow ${hfComposite} → KEEP absolute (the skill beat the floor)`);
        }
      } catch (e) {
        console.log(`• router: hybrid-flow fallback failed (${e.message}) → KEEP absolute (floor degrades to the rendered absolute build)`);
      }
    }

    // ── MOTION shadow field (opt-in JOIST_MOTION=1, REPORT-ONLY — NEVER touches the composite) ──────────
    // The grade above is a STATIC single-scroll fidelity grade: blind to hover/scroll-reveal/parallax/pin/
    // marquee/library motion. grade-motion captures motion signals for source-vs-clone and scores their
    // agreement, RICHNESS-WEIGHTED (a static source ⇒ score→1.0, never deflated). Pure shadow: we read only
    // `motionScore` + the detected fingerprint and write `motion-report.json` alongside report.json. A failure
    // is swallowed — it CANNOT regress the composite or break the standing grade flow.
    if (MOTION) {
      console.log('\n• grade-motion (REPORT-ONLY shadow — does NOT affect composite)…');
      try {
        const { code, out: mOut } = await runCap('node', ['grade-motion.mjs', '--source', source, '--clone', cloneUrl]);
        let motion = null;
        try { motion = JSON.parse(mOut.trim().split('\n').filter(Boolean).pop()); } catch (e) { console.log(`[motion] could not parse grade-motion JSON: ${e.message}`); }
        if (motion && typeof motion.motionScore === 'number') {
          fs.writeFileSync(`${out}/motion-report.json`, JSON.stringify(motion, null, 2));
          const fpS = motion.fingerprint && motion.fingerprint.source || {};
          console.log(`\n=== MOTION (shadow) ===\nmotionScore ${motion.motionScore} | richness ${motion.motionRichness} | classBlend ${motion.classBlend}`);
          console.log(`  source motion: reveal=${fpS.reveal} parallax=${fpS.parallax} pin=${fpS.pin} marquee=${fpS.marquee} hover=${fpS.hoverEffects}/${fpS.hoverCandidates} libs=[${(fpS.libs||[]).join(',')}]`);
          for (const m of (motion.missingMotion || []).slice(0, 12)) console.log(`  MISSING: ${m}`);
          console.log('[motion] report-only — composite UNCHANGED.');
        } else {
          console.log(`[motion] grade-motion produced no usable score (code ${code}) — shadow skipped, composite UNCHANGED.`);
        }
      } catch (e) {
        console.log(`[motion] grade-motion failed (${e.message}) — shadow skipped, composite UNCHANGED.`);
      }
    }

    // ── FINISH-THE-PAGE completeness gate (opt-in, deterministic, report+contract) ──────────────────
    // grade-structure scores the fidelity of what IS present; it is blind to ABRIDGEMENT (dropped source
    // bands). The rail closes that hole. Runs only when JOIST_COMPLETENESS=1 AND a rich --cap dir exists.
    if (COMPLETENESS) {
      if (!capDir || !fs.existsSync(capDir)) {
        console.log(`\n[completeness] SKIPPED — JOIST_COMPLETENESS=1 but no usable --cap <dir> (got ${capDir || 'none'}). The rail needs the full source capture (manifest/shots/outline/source.html), not just layout.json.`);
      } else {
        console.log('\n• grade-completeness-rail (FINISH-THE-PAGE gate)…');
        // frozen clone shot → deterministic visual fallback (per the rail's own --clone-shot guidance).
        const shot = `/tmp/clone-complete-${slug}.png`;
        try { await run('node', ['_render-shot.mjs', cloneUrl, shot, '1440']); } catch (e) { console.log(`[completeness] clone-shot render failed (${e.message}); rail will render its own (noisier) shot`); }
        const railArgs = ['grade-completeness-rail.mjs', '--cap', capDir, '--url', cloneUrl, '--json'];
        if (fs.existsSync(shot)) railArgs.push('--clone-shot', shot);
        const { out: railOut } = await runCap('node', railArgs);
        let rail = null;
        try { rail = JSON.parse(railOut.trim().split('\n').filter(Boolean).pop()); } catch (e) { console.log(`[completeness] could not parse rail JSON: ${e.message}`); }
        if (rail) {
          fs.writeFileSync(`${out}/completeness-rail.json`, JSON.stringify(rail, null, 2));
          console.log(`\n=== COMPLETENESS ===\ncompletenessScore ${rail.completenessScore} | pass=${rail.pass} | bands ${rail.bands.covered}/${rail.bands.total} (omitFrac ${rail.bands.omitFrac})${rail.critMass ? ` | CRIT-MASS ${rail.critMass}` : ''}`);
          if (!rail.pass) {
            // THE LOOP CONTRACT — surface the omissions the author loop MUST add before STOP.
            console.log(`\n[FINISH-THE-PAGE] pass===false — the clone is ABRIDGED. The author loop MUST add result.omissions below, re-render, and re-gate before STOP (unless each is provably uncloneable at the chosen tier):`);
            for (const o of (rail.omissions || []).slice(0, 40)) console.log(`  • [s${o.where.section} y=${o.where.y}] ${o.what}`);
          } else {
            console.log('[FINISH-THE-PAGE] pass===true — no quiet abridgement; the page is complete.');
          }
          // Hard gate (CI/corpus): exit non-zero so an abridged clone fails loudly. report-only otherwise.
          if (COMPLETENESS_HARD && !rail.pass) { console.log(`PAGE: ${cloneUrl}\n`); process.exit(3); }
        }
      }
    }
  }
  console.log(`PAGE: ${cloneUrl}\n`);
})().catch((e) => { console.error('CLONE FAILED:', e.message); process.exit(1); });

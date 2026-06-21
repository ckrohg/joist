#!/usr/bin/env node
/** @purpose M2 (fusion-locked 2026-06-20): broaden the correspondence reward's trust BEYOND the single resend-hero
 * xval (Spearman 0.714, n=7, one site) BEFORE any enforcing publish gate leans on it. This is the OFFLINE-doable
 * core of M2: a DETERMINISTIC, frozen, multi-ARCHETYPE gate-readiness battery. For each of 4 structurally-different
 * section archetypes (HERO, TEXT_DOMINANT docs column, CARD_GRID 3×2, DARK_BAND light-on-dark) it builds a clean
 * base and a FROZEN set of degraded variants (mutators defined structurally, NOT tuned to a target score — the
 * fusion's anti-"distributionally-narrow" guard), then asserts the reward's BEHAVIOUR generalizes:
 *   (A) every degradation scores below identity (monotone-vs-clean) + a real spread;
 *   (B) CATASTROPHIC-LAST (the hard floor gate): every catastrophic variant (rasterized / giant-leaf / drop-most)
 *       ranks below EVERY mild variant, per archetype — a catastrophic inversion ABORTS gate-readiness;
 *   (C) axis-sanity per archetype (colour-shift hits colour not recall; invisible hits the contrast gate; content
 *       drop hits recall) — proves the right axis moves for the right reason on each layout shape, not just hero.
 * Also probes the KNOWN BLIND SPOT (G3/M4): a brand/logo text-swap is only a 1-leaf recall dent → demonstrates WHY
 * the missing/wrong-logo floor protection must come from the binary veto→gate-HOLD path (confirmed wired), not this
 * continuous reward.
 *
 * SCOPE HONESTY: synthetic archetypes test generalization of the reward's BEHAVIOUR across layout shapes with
 * constructed ground-truth. They do NOT substitute for real cross-SITE diversity — the pooled-Spearman-vs-vision
 * multi-site correlation (and a continuous-bar false-reject/accept sweep on real candidates) needs freshly-built
 * clones + the vision oracle = WP/data-gated. This battery is the precondition; that correlation is the completion.
 * Run: node _correspondence-xval-corpus.mjs   (exit 0 = gate-readiness PASS for the offline battery).
 */
import { correspondSection } from './correspondence-reward.mjs';

let fails = 0; const ok = (name, cond, extra = '') => { console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++; };
const mk = (kind, text, box, fg, bg, typo) => ({ kind, text, box: { x: box[0], y: box[1], w: box[2], h: box[3] }, paint: { kind: 'solid', value: fg }, bg: bg || null, typo: typo || { family: 'Inter', size: 16, weight: 400 } });

// ── 4 structurally-DIFFERENT archetypes (each = { SEC, bg, clean() }) — frozen layouts, authored before any scoring ──
const ARCHE = {
  HERO: {
    SEC: { x: 0, y: 0, w: 1440, h: 820 }, bg: 'rgb(8,8,8)',
    clean: () => [
      mk('text', 'Acme', [40, 20, 90, 30], 'rgb(255,255,255)', null, { family: 'Inter', size: 20, weight: 700 }),
      mk('text', 'Features', [180, 24, 70, 20], 'rgb(160,160,160)'), mk('text', 'Pricing', [430, 24, 60, 20], 'rgb(160,160,160)'),
      mk('text', 'Docs', [500, 24, 50, 20], 'rgb(160,160,160)'),
      mk('button', 'Log in', [1133, 16, 75, 36], 'rgb(255,255,255)'), mk('button', 'Get started', [1224, 16, 110, 36], 'rgb(8,8,8)', 'rgb(255,255,255)'),
      mk('heading', 'Email for developers', [168, 300, 600, 140], 'rgb(255,255,255)', null, { family: 'Inter', size: 72, weight: 700 }),
      mk('text', 'The best way to reach humans instead of spam folders. Deliver transactional email at scale.', [168, 470, 500, 60], 'rgb(160,160,160)'),
      mk('button', 'Get started', [168, 560, 150, 50], 'rgb(8,8,8)', 'rgb(255,255,255)'), mk('button', 'Documentation', [320, 560, 170, 50], 'rgb(200,200,200)'),
    ],
  },
  TEXT_DOMINANT: { // a docs / article column: no hero, narrow left-aligned column, many stacked paragraphs + subheads
    SEC: { x: 0, y: 0, w: 1440, h: 1600 }, bg: 'rgb(255,255,255)',
    clean: () => {
      const L = [mk('heading', 'Getting Started with the API', [120, 40, 700, 50], 'rgb(17,17,17)', 'rgb(255,255,255)', { family: 'Inter', size: 40, weight: 700 })];
      const paras = [
        'Install the client library using your package manager of choice and import it into your project.',
        'Authenticate by setting your secret key as an environment variable so it is never committed to source control.',
        'Every request returns a typed response object; errors are thrown as exceptions you can catch and inspect.',
        'Rate limits apply per key and reset every sixty seconds; the response headers tell you how many remain.',
        'Pagination uses opaque cursors rather than offsets, so a stable order is guaranteed across pages.',
        'Webhooks are signed with HMAC; verify the signature before trusting any payload you receive.',
      ];
      let y = 120;
      paras.forEach((p, i) => {
        if (i === 2 || i === 4) { L.push(mk('heading', i === 2 ? 'Authentication' : 'Pagination', [120, y, 400, 32], 'rgb(17,17,17)', 'rgb(255,255,255)', { family: 'Inter', size: 26, weight: 600 })); y += 56; }
        L.push(mk('text', p, [120, y, 760, 48], 'rgb(70,70,70)', 'rgb(255,255,255)', { family: 'Inter', size: 17, weight: 400 })); y += 96;
      });
      return L;
    },
  },
  CARD_GRID: { // a 3×2 features grid: repeated {title, body} cards — stresses 2D position + exclusive matching across repeats
    SEC: { x: 0, y: 0, w: 1440, h: 900 }, bg: 'rgb(250,250,252)',
    clean: () => {
      const L = [mk('heading', 'Everything you need to ship', [420, 40, 600, 44], 'rgb(17,17,17)', 'rgb(250,250,252)', { family: 'Inter', size: 34, weight: 700 })];
      const cards = [['Fast', 'Edge-rendered responses in milliseconds worldwide.'], ['Secure', 'SOC2 compliant with encryption at rest and in transit.'], ['Scalable', 'Handles millions of requests without configuration.'],
        ['Observable', 'Built-in tracing, metrics, and structured logs.'], ['Typed', 'End-to-end type safety from database to client.'], ['Simple', 'A single dependency and a five-line setup.']];
      const cols = [120, 540, 960];
      cards.forEach((c, i) => { const x = cols[i % 3], y = 200 + Math.floor(i / 3) * 320;
        L.push(mk('heading', c[0], [x, y, 280, 30], 'rgb(17,17,17)', 'rgb(255,255,255)', { family: 'Inter', size: 22, weight: 600 }));
        L.push(mk('text', c[1], [x, y + 44, 300, 60], 'rgb(90,90,90)', 'rgb(255,255,255)', { family: 'Inter', size: 15, weight: 400 })); });
      return L;
    },
  },
  DARK_BAND: { // a dark CTA band, light-on-dark — stresses the contrast gate + colour ΔE in the dark regime
    SEC: { x: 0, y: 0, w: 1440, h: 480 }, bg: 'rgb(10,12,30)',
    clean: () => [
      mk('heading', 'Ready to start building?', [360, 120, 720, 60], 'rgb(245,246,255)', 'rgb(10,12,30)', { family: 'Inter', size: 44, weight: 700 }),
      mk('text', 'Join thousands of teams shipping faster with a single platform.', [420, 210, 600, 40], 'rgb(180,184,210)', 'rgb(10,12,30)', { family: 'Inter', size: 18, weight: 400 }),
      mk('button', 'Create account', [560, 290, 180, 52], 'rgb(10,12,30)', 'rgb(245,246,255)', { family: 'Inter', size: 16, weight: 600 }),
      mk('button', 'Talk to sales', [760, 290, 150, 52], 'rgb(245,246,255)', null, { family: 'Inter', size: 16, weight: 600 }),
    ],
  },
};

// ── FROZEN generic mutators (clone-side transforms of the clean base; structural, NOT tuned to a target score) ──
const cloneOf = (ls) => ls.map((n) => ({ ...n, box: { ...n.box }, paint: { ...n.paint }, typo: { ...n.typo } }));
function tint(rgb, f) { const m = (rgb.match(/\d+/g) || [0, 0, 0]).map(Number); const T = [120, 140, 200]; return `rgb(${m.map((v, i) => Math.round(v * (1 - f) + T[i] * f)).join(',')})`; }
const MUT = {
  identity: (ls) => cloneOf(ls),
  colorTint: (ls) => cloneOf(ls).map((n) => ({ ...n, paint: { ...n.paint, value: tint(n.paint.value, 0.35) } })),          // mild colour shift, contrast preserved
  invisibleText: (ls, arche) => { const c = cloneOf(ls); const big = c.filter((n) => n.kind === 'heading').sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0] || c[0]; big.paint = { ...big.paint, value: arche.bg }; return c; }, // a heading → fg≈bg (contrast gate)
  dropTail: (ls) => { const c = cloneOf(ls); return c.slice(0, Math.max(1, Math.ceil(c.length * 0.6))); },                  // drop ~40% of content (recall)
  dropMost: (ls) => { const c = cloneOf(ls); return c.slice(0, Math.max(1, Math.ceil(c.length * 0.25))); },                 // catastrophic content loss
  rasterize: () => [],                                                                                                       // 0 text leaves (a rasterized clone)
  giantLeaf: (ls, arche) => [mk('text', ls.filter((n) => n.text).map((n) => n.text).join(' '), [arche.SEC.x, arche.SEC.y, arche.SEC.w, arche.SEC.h], 'rgb(0,0,0)', arche.bg)], // Goodhart: one huge leaf
  scramble: (ls) => { const c = cloneOf(ls); for (const n of c) { n.box = { ...n.box, x: n.box.x + 380, y: n.box.y + 240 }; } return c; }, // gross position error
  wrongBrand: (ls) => { const c = cloneOf(ls); const brand = c[0]; if (brand) brand.text = 'Globex Corporation'; return c; }, // the M4 blind-spot probe (1-leaf swap)
};

function scoreVariant(arche, mutKey) {
  const base = arche.clean();
  const clone = MUT[mutKey](base, arche);
  const ctx = { srcPageBg: arche.bg, clonePageBg: arche.bg, textOnly: true };
  return correspondSection(base, clone, arche.SEC, arche.SEC, ctx);
}

console.log('=== correspondence reward — multi-archetype gate-readiness battery (deterministic, offline) ===\n');
const MILD = ['identity', 'colorTint', 'invisibleText', 'dropTail'];
const CATASTROPHIC = ['dropMost', 'rasterize', 'giantLeaf'];
const summary = [];

for (const [name, arche] of Object.entries(ARCHE)) {
  console.log(`── ${name} ──`);
  const S = {}; for (const k of [...MILD, ...CATASTROPHIC, 'scramble', 'wrongBrand']) S[k] = scoreVariant(arche, k).score;
  console.log(`   ${Object.entries(S).map(([k, v]) => `${k}=${v}`).join('  ')}`);

  // (A) monotone-vs-clean + spread
  ok(`${name}: identity ≈ 100`, S.identity >= 99, `id=${S.identity}`);
  ok(`${name}: every degradation < identity`, [...MILD.slice(1), ...CATASTROPHIC].every((k) => S[k] < S.identity));
  ok(`${name}: real spread (identity − worst > 40)`, S.identity - Math.min(...CATASTROPHIC.map((k) => S[k])) > 40, `Δ=${(S.identity - Math.min(...CATASTROPHIC.map((k) => S[k]))).toFixed(1)}`);

  // (B) CATASTROPHIC-LAST — the hard floor gate (per-archetype catastrophic inversion ABORTS readiness)
  const worstMild = Math.min(...MILD.map((k) => S[k])), bestCatastrophic = Math.max(...CATASTROPHIC.map((k) => S[k]));
  ok(`${name}: catastrophic-last (every catastrophic < every mild)`, bestCatastrophic < worstMild, `bestCatastrophic=${bestCatastrophic} < worstMild=${worstMild}`);

  // (C) axis-sanity (the right axis moves for the right reason on THIS layout shape)
  const rIdentity = scoreVariant(arche, 'identity'), rTint = scoreVariant(arche, 'colorTint'), rInvis = scoreVariant(arche, 'invisibleText'), rDrop = scoreVariant(arche, 'dropTail');
  ok(`${name}: colour-shift hits colour, NOT recall`, rTint.R_text >= rIdentity.R_text - 1e-6 && rTint.axes.color < rIdentity.axes.color - 0.02, `R ${rTint.R_text} color ${rTint.axes.color}`);
  // an invisible heading is PERCEPTUALLY worse than a mild tint: the visibility gate multiplies the whole pairScore,
  // so it must drop the SCORE below colorTint (comparing the *aggregate* color axis is wrong — tint shifts EVERY
  // leaf's colour, which moves the mean colour axis more than tanking one heading does; the score is the honest probe).
  ok(`${name}: invisible heading scores worse than a mild tint (visibility gate)`, rInvis.score < rTint.score, `invis ${rInvis.score} < tint ${rTint.score}`);
  ok(`${name}: content drop hits recall`, rDrop.R_text < rIdentity.R_text - 0.05, `R ${rDrop.R_text} < ${rIdentity.R_text}`);

  // (D) Goodhart: a giant concatenated leaf cannot farm recall on this archetype
  ok(`${name}: giant-leaf cannot farm recall (R_text < 0.5)`, scoreVariant(arche, 'giantLeaf').R_text < 0.5, `R=${scoreVariant(arche, 'giantLeaf').R_text}`);

  summary.push({ name, ...S, worstMild, bestCatastrophic, logoDent: +(S.identity - S.wrongBrand).toFixed(1) });
}

// ── G3/M4 blind-spot demonstration: the continuous reward CANNOT be the floor protection for a wrong/missing logo.
//    (1) A text BRAND swap on HERO (the only archetype with a distinct small brand leaf) is just a minor recall dent.
//    (2) The decisive case: an IMAGE logo is INVISIBLE to the reward in textOnly mode (the mode a floor bar would
//        use) — adding/removing an image-logo leaf does not move the score at all. So missing-logo floor protection
//        MUST come from the binary wrong-logo veto → gate-HOLD path (preflight-confirmed wired), not this reward. ──
console.log('\n── KNOWN BLIND SPOT (why missing-logo needs the binary veto→gate-HOLD, not this reward) ──');
const heroDent = summary.find((s) => s.name === 'HERO').logoDent;
ok(`HERO: text brand-swap is a minor recall dent (<8 pts)`, heroDent < 8, `dent=${heroDent}`);
// image-logo invisibility: source carries an image logo the clone dropped; textOnly score must be unchanged.
const hero = ARCHE.HERO, base = hero.clean();
const withImgLogo = [...base, { kind: 'image', text: '', box: { x: 40, y: 18, w: 120, h: 36 }, src: 'https://acme.com/logo.svg', natW: 240, natH: 72 }];
const ctxT = { srcPageBg: hero.bg, clonePageBg: hero.bg, textOnly: true };
const sWithLogo = correspondSection(withImgLogo, base, hero.SEC, hero.SEC, ctxT).score;   // src HAS logo, clone DROPPED it
const sNoLogo = correspondSection(base, base, hero.SEC, hero.SEC, ctxT).score;
ok(`image logo is INVISIBLE to the reward in textOnly mode (dropped logo → 0 score change)`, Math.abs(sWithLogo - sNoLogo) < 1e-6, `withLogoSrc=${sWithLogo} vs noLogo=${sNoLogo}`);
console.log('   → floor protection for missing/wrong logo is the binary veto→gate-HOLD path (preflight-confirmed wired), NOT the continuous correspondence bar.');

console.log(`\n${fails === 0 ? 'GATE-READINESS (offline battery): PASS' : fails + ' FAILED'} — ${Object.keys(ARCHE).length} archetypes`);
console.log('REMAINING (WP/data-gated): pooled Spearman-vs-vision across real freshly-built clones on ≥3 sites + continuous-bar false-reject/accept sweep. This battery is the precondition; that correlation is the completion.');
process.exit(fails ? 1 : 0);

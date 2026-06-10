/**
 * @purpose Deterministic, network-free self-test for _bgsample.mjs dominantBoxBg vertical-discontinuity guard.
 * Proves: (1) uniform box → returns that colour; (2) FIX: light-top / dark-bottom box → ABSTAIN (null), so a
 * wrapper spanning a light headline over a dark code panel is no longer over-painted; (3) uniform-DARK box → still
 * returns the dark colour (the code-editor child keeps its bg — anti-over-correction); (4) short light/dark box
 * (< minSplitH) → not guarded (legacy modal returns dominant); (5) REVERSIBILITY: splitGuard=false reproduces the
 * legacy whole-box dominant for every case (the guard only ever ADDS abstentions, never changes a returned colour).
 * Run: node _bgsample-selftest.mjs
 */
import { dominantBoxBg } from './_bgsample.mjs';

let pass = true;
const log = (ok, msg) => { if (!ok) pass = false; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

// Build a px accessor over a virtual image: rows [0,split) = topColor, [split,H) = botColor.
const W = 1360, H = 838; // tailwind §9+§10 wrapper shape (light headline ~260px over dark editor)
const mk = (topColor, botColor, split) => (x, y) => (y < split ? topColor : botColor);
const WHITE = [255, 255, 255], DARK = [24, 40, 40], GRAYBOX = [248, 248, 248], PURPLE = [124, 58, 237];

// ── T1: uniform white box → returns white-ish ──
{
  const c = dominantBoxBg(mk(WHITE, WHITE, H), 0, 0, W, H, {});
  log(/^rgb\(2\d\d, 2\d\d, 2\d\d\)$/.test(c || ''), `T1 uniform white box → returns light colour (${c})`);
}

// ── T2: THE FIX — light top (260px) over dark bottom → ABSTAIN ──
{
  const c = dominantBoxBg(mk(WHITE, DARK, 260), 0, 0, W, H, {}); // dark dominates area (578/838) but top/bottom split
  log(c === null, `T2 FIX: light headline (260px) over dark editor → ABSTAIN (got ${c}) so wrapper stays transparent`);
}
// reversed polarity (dark top over light bottom) also abstains
{
  const c = dominantBoxBg(mk(DARK, WHITE, 578), 0, 0, W, H, {});
  log(c === null, `T2b FIX: dark top over light bottom → ABSTAIN (got ${c})`);
}

// ── T3: ANTI-OVER-CORRECTION — uniform DARK box (the code editor child) → still returns dark ──
{
  const c = dominantBoxBg(mk(DARK, DARK, H), 0, 0, W, 738, {});
  log(c === 'rgb(24, 40, 40)', `T3 uniform dark editor box → STILL returns dark rgb(24, 40, 40) (got ${c})`);
}
// a genuine solid colored brand band (uniform purple) is preserved too
{
  const c = dominantBoxBg(mk(PURPLE, PURPLE, H), 0, 0, W, H, {});
  log(c === 'rgb(120, 56, 232)', `T3b uniform purple band → preserved (got ${c})`);
}

// ── T4: short box below minSplitH → not guarded (legacy modal applies) ──
{
  const c = dominantBoxBg(mk(WHITE, DARK, 60), 0, 0, W, 200, { minSplitH: 240 }); // 200px < 240 → no split check
  log(c !== null, `T4 short box (<minSplitH) → not guarded, returns dominant (got ${c})`);
}

// ── T5: REVERSIBILITY — splitGuard=false reproduces legacy whole-box dominant for EVERY case (only adds abstentions) ──
{
  const cases = [
    mk(WHITE, WHITE, H), mk(WHITE, DARK, 260), mk(DARK, WHITE, 578), mk(DARK, DARK, H),
    mk(PURPLE, PURPLE, H), mk(GRAYBOX, GRAYBOX, H), mk(WHITE, DARK, 60),
  ];
  let mism = 0;
  for (const px of cases) {
    const on = dominantBoxBg(px, 0, 0, W, H, { splitGuard: true });
    const off = dominantBoxBg(px, 0, 0, W, H, { splitGuard: false });
    // legacy (off) must never be null where it had a dominant; on is off OR null (abstain). Never a DIFFERENT colour.
    if (on !== null && on !== off) mism++;
  }
  log(mism === 0, `T5 reversibility: splitGuard ON returns the legacy colour OR null, never a different colour (mismatches ${mism})`);
}
// and OFF on the fix case == the old over-paint (proves the flag truly reverts)
{
  const off = dominantBoxBg(mk(WHITE, DARK, 260), 0, 0, W, H, { splitGuard: false });
  log(off === 'rgb(24, 40, 40)', `T5b reversibility: splitGuard OFF re-introduces the dark over-paint rgb(24, 40, 40) (got ${off})`);
}

console.log(pass ? '\nBGSAMPLE SELFTEST: ALL PASS' : '\nBGSAMPLE SELFTEST: FAIL');
process.exit(pass ? 0 : 1);

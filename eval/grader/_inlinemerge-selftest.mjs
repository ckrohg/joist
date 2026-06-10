#!/usr/bin/env node
/**
 * @purpose Self-test for the MIXED-INLINE MERGE fix in capture-layout.mjs (2026-06-10).
 * walk()'s leaf gate only whole-leafed a paragraph when every visible element kid was svg OR a
 * CHILDLESS span/b/i/em/strong/br; a prose paragraph with <a>/<code>/<strong>-with-children kids
 * recursed over ELEMENT children only and its bare nodeType-3 text was silently DROPPED
 * (overreacted.io: 139 elements, 39.8% of visible chars). New default-ON behavior: a bare-text
 * parent whose visible kids are ALL inline-display (and whose subtree holds NO media) leafs WHOLE;
 * the MAXD flatten loop marks a whole-leafed parent's descendants consumed (no parent+child dup).
 * CAPTURE_NO_INLINEMERGE=1 must reproduce the legacy drop byte-identically.
 *
 * file:// fixture, asserts:
 *   T1 mixed <p> with <a>+<code> kids → legacy LOSES bare text, new keeps FULL text as ONE leaf
 *   T2 no duplicate emission: the inline <a>/<code> fragments do NOT also appear as separate leaves
 *   T3 media guard: <span>by <a><img></a></span> → img leaf survives in BOTH modes (never swallowed)
 *   T4 S7 sameSize split preserved: h1 with different-size spans still splits (no merge)
 *   T5 deep (>MAXD) mixed paragraph → flatten path keeps full text ONCE (descendants skipped, no dup)
 *   T6 flag-off = legacy: leaf multiset identical to the pre-fix shape (fragments, no merged paragraph)
 * Run: node eval/grader/_inlinemerge-selftest.mjs
 */
import fs from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cap = path.join(here, 'capture-layout.mjs');

// real PNG file (leaf() drops data: srcs by design) — 32x32 opaque square
const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAFElEQVR4nGP8z4AfMOGVHlVAPwUAJfkBBW4nnvkAAAAASUVORK5CYII=';
fs.writeFileSync('/tmp/inlinemerge-img.png', Buffer.from(pngB64, 'base64'));

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Arial;margin:40px;width:1200px} p{font-size:16px;line-height:1.5;margin:16px 0}
code{font-family:monospace;font-size:16px} a{color:#d23669}
.big{font-size:40px}.small{font-size:18px;display:block}
img{width:32px;height:32px}
</style></head><body>
<h1>Inline merge fixture</h1>
<p id="mixed">MIXSTART the bare prose around <a href="/x">ANCHORFRAG</a> and inline <code>CODEFRAG</code> must survive MIXEND.</p>
<p id="plain">PLAINPARA stays exactly as before, one leaf, no change.</p>
<span id="bio" style="display:block">BYTOKEN <a href="/me"><img src="file:///tmp/inlinemerge-img.png" alt="avatar"></a></span>
<img id="real" src="file:///tmp/inlinemerge-img.png" alt="x" style="width:64px;height:64px">
<h1 id="s7"><span class="big">HEADBIG</span><span class="small">SUBSMALL</span></h1>
${(() => { let s = '<p id="deepmix">DEEPSTART bare prose with <a href="/y">DEEPANCHOR</a> and <code>DEEPCODE</code> kept once DEEPEND.</p>'; for (let i = 0; i < 10; i++) s = `<div class="w${i}" style="padding:1px">${s}<p>fill${i} unique sibling text ${i}</p></div>`; return s; })()}
</body></html>`;
const fix = '/tmp/inlinemerge-fixture.html';
fs.writeFileSync(fix, html);

const run = (env, out) => {
  execFileSync('node', [cap, '--source', 'file://' + fix, '--out', out], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
};
const flatAll = (n, out = []) => { if (!n) return out; if (n.kind === 'container') { (n.children || []).forEach((c) => flatAll(c, out)); return out; } out.push(n); return out; };

const onData = run({}, '/tmp/inlinemerge-on.json');
const offData = run({ CAPTURE_NO_INLINEMERGE: '1' }, '/tmp/inlinemerge-off.json');
const ON = flatAll(onData.root), OFF = flatAll(offData.root);
const onTexts = ON.filter((l) => l.text).map((l) => l.text);
const offTexts = OFF.filter((l) => l.text).map((l) => l.text);
const onJoin = onTexts.join('\n'), offJoin = offTexts.join('\n');

let fails = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails++; };

// T1: merged paragraph — new keeps bare prose + fragments in ONE leaf; legacy loses the bare prose
const merged = onTexts.filter((x) => x.includes('MIXSTART') && x.includes('ANCHORFRAG') && x.includes('CODEFRAG') && x.includes('MIXEND'));
t('T1a new merges mixed <p> whole (one leaf, full text)', merged.length === 1, `merged-leaf count=${merged.length}`);
t('T1b legacy loses the bare prose', !offJoin.includes('MIXSTART') && !offJoin.includes('MIXEND'), 'MIXSTART/MIXEND absent flag-off');
t('T1c legacy still emits the inline fragments', offJoin.includes('ANCHORFRAG') && offJoin.includes('CODEFRAG'));
// T2: no duplicate fragments flag-on
const anchorLeaves = onTexts.filter((x) => x.includes('ANCHORFRAG')).length;
const codeLeaves = onTexts.filter((x) => x.includes('CODEFRAG')).length;
t('T2 no duplicate fragment leaves flag-on', anchorLeaves === 1 && codeLeaves === 1, `ANCHORFRAG in ${anchorLeaves} leaf/leaves, CODEFRAG in ${codeLeaves}`);
// T3: media guard — img inside an inline <a> inside a bare-text span survives in both modes
const onImgs = ON.filter((l) => l.kind === 'image').length, offImgs = OFF.filter((l) => l.kind === 'image').length;
t('T3 media guard: image leaves identical on/off', onImgs === offImgs && onImgs >= 2, `on=${onImgs} off=${offImgs}`);
// T4: S7 split preserved — HEADBIG and SUBSMALL stay separate leaves (no merged HEADBIG SUBSMALL leaf)
const s7merged = onTexts.some((x) => x.includes('HEADBIG') && x.includes('SUBSMALL'));
t('T4 S7 different-size spans still split (sameSize kept)', !s7merged && onJoin.includes('HEADBIG') && onJoin.includes('SUBSMALL'));
// T5: deep mixed paragraph (beyond MAXD → flatten path) — full text exactly once, fragments not re-emitted
const deepWhole = onTexts.filter((x) => x.includes('DEEPSTART') && x.includes('DEEPANCHOR') && x.includes('DEEPCODE') && x.includes('DEEPEND')).length;
const deepAnchorTotal = onTexts.filter((x) => x.includes('DEEPANCHOR')).length;
t('T5 deep flatten keeps mixed <p> once, no parent+child dup', deepWhole === 1 && deepAnchorTotal === 1, `whole=${deepWhole} DEEPANCHOR-leaves=${deepAnchorTotal}`);
// T6: control + plain paragraph identical both modes
t('T6 plain paragraph identical on/off', onTexts.includes('PLAINPARA stays exactly as before, one leaf, no change.') && offTexts.includes('PLAINPARA stays exactly as before, one leaf, no change.'));

console.log(`\nchars captured: legacy=${offJoin.length} new=${onJoin.length} (+${onJoin.length - offJoin.length})`);
console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS');
process.exit(fails ? 1 : 0);

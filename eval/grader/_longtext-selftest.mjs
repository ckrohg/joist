/**
 * @purpose Self-test for the LONG-TEXT KEEP fix in capture-layout.mjs (2026-06-09).
 * leaf() used to silently DROP any text leaf >600 chars — blog body text vanished from capture.
 * New default-ON behavior: split at the element's own text-bearing block children when present
 * (no duplicate emission), else keep the full text as one leaf capped at 8000 chars.
 * CAPTURE_NO_LONGTEXT=1 must reproduce the legacy drop byte-identically.
 *
 * Builds a deterministic file:// fixture with 5 cases, runs capture-layout.mjs with the flag
 * OFF (new) and ON (legacy), flattens text leaves, and asserts:
 *   T1 legacy drops every >600-char text; new keeps them (LP1/LP2 present, full length)
 *   T2 control short text identical in both modes
 *   T3 mega-card (block-children wrapper, beyond MAXD flatten): split into per-<p> leaves,
 *      each paragraph captured EXACTLY ONCE (no parent+child double-capture)
 *   T4 >8000-char paragraph capped at 8000 (kept, not dropped)
 *   T5 leaf set diff = legacy ⊆ new; additions are only long-text leaves / split children
 * Run: node eval/grader/_longtext-selftest.mjs
 */
import fs from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cap = path.join(here, 'capture-layout.mjs');

// deterministic filler: repeats "<TOKEN> wordN" until len chars
const fill = (token, len) => { let s = ''; let i = 0; while (s.length < len) s += `${token} word${i++} `; return s.trim(); };

const LP1 = fill('LP1TOKEN', 1200);            // genuine long paragraph, no kids
const LP2A = fill('LP2TOKEN', 500), LP2B = fill('LP2EM', 450); // long paragraph with inline em (inlineSimple)
const MC1 = fill('MC1TOKEN', 300), MC2 = fill('MC2TOKEN', 300), MC3 = fill('MC3TOKEN', 300);
const LP3 = fill('LP3TOKEN', 9000);            // giant paragraph → 8000 cap
const CTRL = 'CTRLSHORT alpha beta gamma delta epsilon.';

const deep = (inner, n) => { let s = inner; for (let i = 0; i < n; i++) s = `<div class="w${i}">${s}</div>`; return s; };
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Arial;margin:40px;width:1200px} p{font-size:16px;line-height:1.5;margin:16px 0}
a.card{display:block;text-decoration:none;color:#111;border:1px solid #ddd;padding:20px}
</style></head><body>
<h1>Long text fixture</h1>
<p id="ctrl">${CTRL}</p>
<p id="lp1">${LP1}</p>
<p id="lp2">${LP2A} <em>${LP2B}</em></p>
${deep(`<a class="card" href="/x"><p id="mc1">${MC1}</p><p id="mc2">${MC2}</p><p id="mc3">${MC3}</p></a>`, 10)}
<p id="lp3">${LP3}</p>
</body></html>`;
const fix = '/tmp/longtext-fixture.html';
fs.writeFileSync(fix, html);

const run = (env, out) => {
  execFileSync('node', [cap, '--source', 'file://' + fix, '--out', out], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
};

const flatTexts = (n, out = []) => { if (!n) return out; if (n.kind === 'container') { (n.children || []).forEach((c) => flatTexts(c, out)); return out; } if (n.text) out.push(n.text); if (n.kind === 'list' || n.kind === 'tabs') for (const it of (n.items || [])) out.push(it.text || it.title || ''); return out; };

const newData = run({}, '/tmp/longtext-new.json');
const oldData = run({ CAPTURE_NO_LONGTEXT: '1' }, '/tmp/longtext-legacy.json');
const tNew = flatTexts(newData.root), tOld = flatTexts(oldData.root);
const joinNew = tNew.join('\n'), joinOld = tOld.join('\n');
const count = (hay, tok) => (hay.match(new RegExp(tok, 'g')) || []).length;

let pass = 0, fail = 0;
const T = (name, cond, detail) => { if (cond) { pass++; console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`); } else { fail++; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); } };

// T1: legacy drops >600 texts, new keeps them
T('T1a legacy drops LP1/LP2/LP3', count(joinOld, 'LP1TOKEN') === 0 && count(joinOld, 'LP2TOKEN') === 0 && count(joinOld, 'LP3TOKEN') === 0, `legacy texts=${tOld.length}`);
const lp1 = tNew.find((t) => t.includes('LP1TOKEN'));
T('T1b new keeps LP1 full', !!lp1 && lp1.length === LP1.length, `len=${lp1 ? lp1.length : 0}/${LP1.length}`);
T('T1c new keeps LP2 (text+em flattened once)', count(joinNew, 'LP2TOKEN word0 ') === 1 && count(joinNew, 'LP2EM word0 ') === 1);

// T2: control short text identical in both
T('T2 control short identical', joinNew.includes(CTRL) && joinOld.includes(CTRL));

// T3: mega-card split — each paragraph EXACTLY ONCE (no parent+child double-capture)
T('T3a card paragraphs captured once each', count(joinNew, 'MC1TOKEN word0 ') === 1 && count(joinNew, 'MC2TOKEN word0 ') === 1 && count(joinNew, 'MC3TOKEN word0 ') === 1,
  `counts=${count(joinNew, 'MC1TOKEN word0 ')},${count(joinNew, 'MC2TOKEN word0 ')},${count(joinNew, 'MC3TOKEN word0 ')}`);
const mcWhole = tNew.find((t) => t.includes('MC1TOKEN') && t.includes('MC3TOKEN'));
T('T3b no mega-blob leaf (split, not concatenated)', !mcWhole, mcWhole ? `blob len=${mcWhole.length}` : 'split into per-p leaves');
// legacy keeps the individual <p>s via the flatten loop (only the parent <a> blob was dropped);
// the new split path must agree with that (same texts, once each — no parent+child double-capture).
T('T3c legacy also captured card paragraphs once each (flatten fallback)', count(joinOld, 'MC1TOKEN word0 ') === 1 && count(joinOld, 'MC2TOKEN word0 ') === 1 && count(joinOld, 'MC3TOKEN word0 ') === 1);

// T4: 8000 cap
const lp3 = tNew.find((t) => t.includes('LP3TOKEN'));
T('T4 giant paragraph kept and capped at 8000', !!lp3 && lp3.length === 8000, `len=${lp3 ? lp3.length : 0}`);

// T5: legacy leaf set ⊆ new leaf set; additions only long/split texts
const setOld = new Set(tOld), setNew = new Set(tNew);
const removed = [...setOld].filter((t) => !setNew.has(t));
const added = [...setNew].filter((t) => !setOld.has(t));
const badAdd = added.filter((t) => t.length <= 600 && !/LP\d|MC\d|LP2EM/.test(t));
T('T5 legacy ⊆ new; additions only long-text', removed.length === 0 && badAdd.length === 0, `removed=${removed.length} added=${added.length} badAdd=${badAdd.length}`);

console.log(`\nchars captured: legacy=${joinOld.length} new=${joinNew.length} (+${joinNew.length - joinOld.length})`);
console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);

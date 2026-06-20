#!/usr/bin/env node
/**
 * @purpose bestofn-clone.mjs — LEVER C: per-section best-of-N clone orchestrator. For each source SECTION, pick the
 * best of K candidate reconstructions with the cheap reward (bestOfNCheap: veto-floor + listwise), then ASSEMBLE the
 * winning section trees into one page and render it. This is select-by-reward applied per section across a whole page —
 * the operator that converts generation diversity + a trustworthy-cheap reward into a better PAGE (not just one hero).
 *
 * Assembly is TREE-LEVEL (concat the transpiled section containers), not HTML-merge — transpile-html already baked each
 * candidate's CSS into Elementor settings, so stacking the section containers avoids cross-candidate <style> collisions.
 *
 * Manifest (--manifest m.json): { source, sections: [ { name, srcCrop, candidates: [ {html?, tree, shot} ] } ] }
 *   - tree  = transpiled Elementor tree.json for the candidate (from transpile-html --no-site-parts)
 *   - shot  = the candidate's rendered PNG (what the cheap reward scores)
 * Emits the selection per section + the assembled page tree, renders it to --page (or a fresh page), prints the URL.
 *
 * Usage: node bestofn-clone.mjs --manifest m.json [--page N] [--model haiku] [--out /tmp/boN-clone] [--sections-dir]
 * NOTE: authoring the K candidate HTMLs per section is done OUTSIDE this script (LLM authors → transpile → render);
 * this orchestrates select + assemble + render. The corpus-lift measurement = grade the assembled page vs the source.
 */
import fs from 'fs';
import path from 'path';
import { bestOfNCheap } from './bestofn-select.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };

// pull the renderable section container(s) out of a transpiled page tree (root container → its element children).
function sectionContainers(treePath) {
  const t = JSON.parse(fs.readFileSync(treePath, 'utf8'));
  const arr = Array.isArray(t) ? t : [t];
  const out = [];
  for (const root of arr) { if (root.elType === 'container' && Array.isArray(root.elements)) out.push(...root.elements); else out.push(root); }
  return out;
}

export async function bestofnClone({ manifest, model = 'haiku' }) {
  const m = typeof manifest === 'string' ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : manifest;
  const picks = [];
  for (const sec of m.sections) {
    const shots = sec.candidates.map((c) => c.shot);
    const sidecarFracs = sec.sidecarFracs || null;
    const res = await bestOfNCheap({ sourcePng: sec.srcCrop, candidates: shots, sidecarFracs, model });
    const winIdx = sec.candidates.findIndex((c) => c.shot === res.winner.cand);
    const win = sec.candidates[winIdx] || sec.candidates[0];
    picks.push({ name: sec.name, winner: win, reward: res.winner.reward, flooredCount: res.flooredCount, cost: res.cost,
      ranking: res.ranked.map((r) => ({ shot: path.basename(r.cand), reward: r.reward, floored: r.floored })) });
  }
  // TREE-LEVEL ASSEMBLY: stack each winning section's containers into one full-bleed page column.
  const pageEls = [];
  for (const p of picks) pageEls.push(...sectionContainers(p.winner.tree));
  const pageTree = [{ elType: 'container', settings: { content_width: 'full', flex_direction: 'column', flex_gap: { unit: 'px', size: '0' }, padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } }, elements: pageEls }];
  return { picks, pageTree, totalCost: +picks.reduce((s, p) => s + (p.cost || 0), 0).toFixed(4) };
}

const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace('file://', ''));
if (IS_MAIN) (async () => {
  const MAN = arg('manifest'); if (!MAN) { console.error('usage: bestofn-clone.mjs --manifest m.json [--page N] [--model haiku] [--out dir]'); process.exit(2); }
  const out = arg('out', '/tmp/boN-clone'); fs.mkdirSync(out, { recursive: true });
  const r = await bestofnClone({ manifest: MAN, model: arg('model', 'haiku') });
  const treePath = path.join(out, 'page-tree.json'); fs.writeFileSync(treePath, JSON.stringify(r.pageTree));
  console.log('\n=== BEST-OF-N CLONE (per-section select → assemble) ===');
  for (const p of r.picks) console.log(`  section "${p.name}": picked ${path.basename(p.winner.shot || p.winner.tree)} (reward ${p.reward}, floored ${p.flooredCount}) — [${p.ranking.map((x) => x.shot + (x.floored ? '✗' : '') + ':' + x.reward).join('  ')}]`);
  console.log(`assembled page tree (${r.pageTree[0].elements.length} top-level sections) → ${treePath}  | select cost $${r.totalCost}`);
  const page = arg('page');
  if (page) { const { render } = await import('../../sandbox/render.mjs'); const res = await render(r.pageTree, { page: +page, slug: 'boN-clone', title: 'Best-of-N per-section clone', shot: path.join(out, 'page.png'), width: 1440 });
    console.log(`rendered → ${res.url || ('http://localhost:8001/?page_id=' + page)}  shot ${path.join(out, 'page.png')}`); }
})().catch((e) => { console.error('bestofn-clone FAILED:', e && e.stack || e); process.exit(1); });

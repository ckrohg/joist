/**
 * @purpose DOM glue for the sticky-note annotation tool. Loads the localhost:8001 clone in a
 * same-origin iframe (right) + a captured source screenshot (left); a transparent fixed overlay over
 * the clone catches clicks → reads the IFRAME's document with elementsFromPoint(x,y) (PLURAL, full
 * z-stack, topmost first) → walks each hit up to the nearest --joist-src owner → dedupes to distinct
 * stamped widgets (cap 4) → a z-stack PICKER (primary offender + optional colliding_with) → a label
 * panel (defect_class / severity / note) → stores a pin record to localStorage → highlights the mapped
 * SOURCE region on the left. Download/Load JSONL. All resolve/picker/store logic is in annotate-core.js
 * (imported verbatim, the same module the offline selftest exercises); the host guard is guard.js.
 *
 * HARD RAIL: the iframe.src is built by guard.js cloneUrlForPage() → assertCloneBase, so the tool can
 * only ever point at localhost:8001 (the paused shared host is refused, offline, before navigation).
 * Same-origin (tool served from the same host as the clone via serve.mjs) is REQUIRED — elementsFromPoint
 * / getComputedStyle on the iframe document throw cross-origin otherwise.
 */
import { cloneUrlForPage, resolveCloneBase, assertCloneBase } from './guard.js';
import {
  DEFECT_CLASSES, walkToStamp, resolveZStack, makePin, validatePin,
  pinsToJsonl, jsonlToPins, resolveSourceRegion, stripStamp,
} from './annotate-core.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) n.append(c);
  return n;
};

// ── state ─────────────────────────────────────────────────────────────────────
const state = {
  slug: 'synthetic',
  pageId: '',
  sourceBbox: null,           // { meta, byPath }
  pins: [],                   // array of pin records
  candidates: [],             // current z-stack picker candidates
  primaryIdx: 0,              // chosen primary candidate index
  collideIdx: null,           // chosen colliding_with candidate index (optional)
  click: null,                // { x, y, scroll_y, viewport_w } in clone coords
  severity: 3,
};
const LS_KEY = () => `joist.annotate.${state.slug}`;

// ── iframe + clone document access ──────────────────────────────────────────────
function cloneDoc() {
  const f = $('#cloneFrame');
  try { return f.contentDocument || f.contentWindow.document; }
  catch (e) { return null; } // cross-origin → null (guard + serve.mjs keep us same-origin)
}
function readStamp(node) {
  // node is an element inside the IFRAME document → read its --joist-src via the iframe's getComputedStyle.
  const win = $('#cloneFrame').contentWindow;
  try { return stripStamp(win.getComputedStyle(node).getPropertyValue('--joist-src')); }
  catch (e) { return ''; }
}
function bboxOf(node) {
  const r = node.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

function loadClone() {
  const f = $('#cloneFrame');
  const status = $('#guardBadge');
  if (!state.pageId) { status.textContent = 'enter a page id'; status.className = 'badge'; return; }
  try {
    const u = cloneUrlForPage(state.pageId);
    f.src = u;
    status.textContent = 'clone: ' + u;
    status.className = 'badge guard-ok';
  } catch (e) {
    f.removeAttribute('src');
    status.textContent = 'BLOCKED: ' + e.message;
    status.className = 'badge guard-bad';
  }
}

// ── source pane (left) ──────────────────────────────────────────────────────────
async function loadSource() {
  const res = await fetch(`assets/${encodeURIComponent(state.slug)}/source-bbox.json`).catch(() => null);
  if (!res || !res.ok) { state.sourceBbox = null; return; }
  state.sourceBbox = await res.json();
  const img = $('#sourceImg');
  const shot = (state.sourceBbox.meta && state.sourceBbox.meta.shot) || 'source.png';
  img.src = `assets/${encodeURIComponent(state.slug)}/${shot}`;
  $('#srcInfo').textContent = `${state.sourceBbox.meta.count} regions @ vw ${state.sourceBbox.meta.vw} (stampRate ${state.sourceBbox.meta.stampRate})`;
}
function highlightSource(stamp) {
  const hi = $('#sourceHi');
  const region = resolveSourceRegion(stamp, state.sourceBbox);
  if (!region) { hi.classList.remove('show'); return; }
  const img = $('#sourceImg');
  // scale source coords (captured @ meta.vw) to the rendered image width.
  const sx = img.clientWidth && state.sourceBbox.meta.vw ? img.clientWidth / state.sourceBbox.meta.vw : 1;
  hi.style.left = (region.x * sx) + 'px';
  hi.style.top = (region.y * sx) + 'px';
  hi.style.width = (region.w * sx) + 'px';
  hi.style.height = (region.h * sx) + 'px';
  hi.classList.add('show');
}

// ── click → elementsFromPoint → z-stack candidates ─────────────────────────────
function onOverlayClick(ev) {
  const doc = cloneDoc();
  if (!doc) { alert('Clone document not accessible (cross-origin?). Serve the tool same-origin via serve.mjs and target localhost:8001.'); return; }
  const overlay = $('#overlay');
  const r = overlay.getBoundingClientRect();
  // overlay is positioned over the iframe with the same box → client coords map 1:1 into the iframe viewport.
  const x = ev.clientX - r.left;
  const y = ev.clientY - r.top;
  const win = $('#cloneFrame').contentWindow;
  const hits = doc.elementsFromPoint(x, y); // PLURAL — full z-stack, topmost first
  const cands = resolveZStack(hits, readStamp, bboxOf, 4);
  state.candidates = cands;
  state.primaryIdx = 0;
  state.collideIdx = null;
  state.click = { x, y, scroll_y: Math.round(win.scrollY || 0), viewport_w: Math.round(win.innerWidth || doc.documentElement.clientWidth) };
  if (!cands.length) { alert('No --joist-src stamped widget under this point (only synthetic/unstamped DOM here).'); return; }
  openPicker(ev.clientX, ev.clientY);
}

// ── z-stack picker + label panel ────────────────────────────────────────────────
function openPicker(px, py) {
  const p = $('#picker');
  renderPicker();
  p.classList.add('show');
  // position near the click but clamped to the viewport
  const w = 340, vw = window.innerWidth, vh = window.innerHeight;
  p.style.left = Math.min(px + 12, vw - w - 8) + 'px';
  p.style.top = Math.min(Math.max(8, py - 40), vh - p.offsetHeight - 8) + 'px';
  // default-highlight the primary's source region
  highlightSource(state.candidates[state.primaryIdx].stamp);
}
function closePicker() { $('#picker').classList.remove('show'); $('#sourceHi').classList.remove('show'); }

function renderPicker() {
  const candWrap = $('#candidates');
  candWrap.textContent = '';
  const multi = state.candidates.length > 1;
  $('#pickerHint').textContent = multi
    ? `${state.candidates.length} stamped widgets overlap here. Pick the PRIMARY offender; optionally shift-pick a second as "colliding with".`
    : '1 stamped widget under this point.';
  state.candidates.forEach((c, i) => {
    const role = i === state.primaryIdx ? el('span', { class: 'role p', text: 'PRIMARY' })
      : i === state.collideIdx ? el('span', { class: 'role c', text: 'COLLIDES' }) : '';
    const row = el('div', {
      class: 'cand' + (i === state.primaryIdx ? ' primary-sel' : '') + (i === state.collideIdx ? ' collide-sel' : ''),
      onclick: (ev) => {
        if (ev.shiftKey && multi && i !== state.primaryIdx) {
          state.collideIdx = (state.collideIdx === i) ? null : i; // toggle colliding_with
        } else {
          state.primaryIdx = i;
          if (state.collideIdx === i) state.collideIdx = null; // primary can't also be the collider
          highlightSource(c.stamp);
        }
        renderPicker();
      },
    }, [
      el('div', { class: 'depth', text: `z${c.depth}` }),
      el('div', {}, [
        el('div', { class: 'stamp', text: c.stamp }, []),
        el('div', { class: 'meta', text: `<${c.ownerTag || '?'}>  ${c.bbox ? Math.round(c.bbox.w) + '×' + Math.round(c.bbox.h) : ''}` }),
        role || '',
      ]),
    ]);
    candWrap.append(row);
  });
  // severity buttons reflect state
  [...$('#sevRow').children].forEach((b, i) => b.classList.toggle('on', (i + 1) === state.severity));
}

function savePinFromPicker() {
  const primary = state.candidates[state.primaryIdx];
  const collide = state.collideIdx != null ? state.candidates[state.collideIdx] : null;
  const defect_class = $('#defectSel').value;
  const note = $('#noteInput').value;
  let pin;
  try {
    pin = makePin({
      element_ref: primary.stamp,
      colliding_with: collide ? collide.stamp : null,
      bbox: primary.bbox,
      viewport_w: state.click.viewport_w,
      scroll_y: state.click.scroll_y,
      defect_class,
      severity: state.severity,
      note,
      page_id: state.pageId,
    });
  } catch (e) { alert('Could not save pin: ' + e.message); return; }
  state.pins.push(pin);
  persist();
  renderPins();
  $('#noteInput').value = '';
  closePicker();
}

// ── persistence + pin rendering ─────────────────────────────────────────────────
function persist() { localStorage.setItem(LS_KEY(), pinsToJsonl(state.pins)); }
function restore() {
  const raw = localStorage.getItem(LS_KEY());
  try { state.pins = raw ? jsonlToPins(raw) : []; } catch { state.pins = []; }
}
function renderPins() {
  // sticky dots over the clone (positioned by bbox, adjusted for current scroll)
  const layer = $('#pinLayer');
  layer.textContent = '';
  const win = $('#cloneFrame').contentWindow;
  const curScroll = (() => { try { return win.scrollY || 0; } catch { return 0; } })();
  state.pins.forEach((pin, i) => {
    if (!pin.bbox) return;
    const cx = pin.bbox.x + pin.bbox.w / 2;
    const cy = pin.bbox.y + pin.bbox.h / 2 - (curScroll - pin.scroll_y); // re-anchor to current scroll
    const dot = el('div', {
      class: 'pin sev' + pin.severity + (pin.colliding_with ? ' collide' : ''),
      title: `${pin.defect_class} (sev ${pin.severity})${pin.colliding_with ? ' ⇄ ' + pin.colliding_with : ''}\n${pin.note || ''}`,
      text: String(i + 1),
      onclick: () => highlightSource(pin.element_ref),
    });
    dot.style.left = cx + 'px';
    dot.style.top = cy + 'px';
    layer.append(dot);
  });
  // list panel
  const list = $('#pinRows');
  list.textContent = '';
  state.pins.forEach((pin, i) => {
    list.append(el('div', { class: 'pinrow' }, [
      el('span', { class: 'n', text: String(i + 1) }),
      el('span', { class: 'dc', text: pin.defect_class + ' ·s' + pin.severity }),
      el('span', { class: 'st', text: pin.element_ref.slice(0, 28) + (pin.colliding_with ? ' ⇄' : '') }),
      el('span', { class: 'del', text: '✕', onclick: () => { state.pins.splice(i, 1); persist(); renderPins(); } }),
    ]));
  });
  $('#pinCount').textContent = state.pins.length + ' pins';
}

// ── download / load JSONL ───────────────────────────────────────────────────────
function downloadJsonl() {
  const blob = new Blob([pinsToJsonl(state.pins)], { type: 'application/x-ndjson' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `annotations-${state.slug}-${Date.now()}.jsonl` });
  document.body.append(a); a.click(); a.remove();
}
function loadJsonlFile(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const pins = jsonlToPins(rd.result);
      const bad = pins.flatMap((p, i) => { const e = validatePin(p); return e.length ? [`line ${i + 1}: ${e[0]}`] : []; });
      if (bad.length) { alert('Some lines invalid:\n' + bad.slice(0, 6).join('\n')); }
      state.pins = pins.filter((p) => validatePin(p).length === 0);
      persist(); renderPins();
    } catch (e) { alert('Load failed: ' + e.message); }
  };
  rd.readAsText(file);
}

// ── wiring ───────────────────────────────────────────────────────────────────────
function buildLabelPanel() {
  const sel = $('#defectSel');
  for (const d of DEFECT_CLASSES) sel.append(el('option', { value: d.value, text: d.label }));
  const sevRow = $('#sevRow');
  for (let s = 1; s <= 5; s++) sevRow.append(el('button', { class: 'btn', text: String(s), onclick: () => { state.severity = s; renderPicker(); } }));
}

function init() {
  buildLabelPanel();
  // guard badge: show the resolved (guarded) base up front.
  try { $('#baseBadge').textContent = 'base ' + resolveCloneBase(); $('#baseBadge').className = 'badge guard-ok'; }
  catch (e) { $('#baseBadge').textContent = e.message; $('#baseBadge').className = 'badge guard-bad'; }

  $('#slug').value = state.slug;
  $('#slug').addEventListener('change', async (e) => { state.slug = e.target.value.trim() || 'synthetic'; restore(); await loadSource(); renderPins(); });
  $('#pageId').addEventListener('change', (e) => { state.pageId = e.target.value.trim(); loadClone(); });
  $('#loadCloneBtn').addEventListener('click', loadClone);
  $('#overlay').addEventListener('click', onOverlayClick);
  $('#cloneFrame').addEventListener('load', () => { renderPins(); });
  $('#downloadBtn').addEventListener('click', downloadJsonl);
  $('#loadInput').addEventListener('change', (e) => { if (e.target.files[0]) loadJsonlFile(e.target.files[0]); });
  $('#saveBtn').addEventListener('click', savePinFromPicker);
  $('#cancelBtn').addEventListener('click', closePicker);
  $('#clearBtn').addEventListener('click', () => { if (confirm('Clear all pins for ' + state.slug + '?')) { state.pins = []; persist(); renderPins(); } });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });

  restore();
  loadSource();
  renderPins();
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

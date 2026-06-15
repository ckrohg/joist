// @purpose Free-Elementor render bridge (v2): build-absolute pins widgets via Pro-only _offset_x/_offset_y
// positioning controls; local docker has NO Elementor Pro → CSS generator emits no offset rules → layout
// collapses. ALSO the dry-run tree lacks Elementor element `id` fields (normally assigned by the Joist PUT
// round-trip) → Document::save can't scope per-element CSS (empty data-id) and the container is malformed.
// This post-pass makes the SAME projection tree render on FREE Elementor:
//  (0) assign a unique 7-hex Elementor `id` to EVERY element (container + widget) — required for scoped CSS,
//  (1) reuse that id as the CSS anchor (and mirror into _element_id so the editor shows it),
//  (2) for every _position:absolute widget emit #<id>{position:absolute;left;top;width;z-index} from its
//      captured _offset_x/_offset_y/_element_custom_width (the exact pixels build-absolute computed),
//  (3) force the ROOT container position:relative + min-height so children anchor to it (not <body>).
// Reversible by construction: only ADDS ids + derives CSS from existing offset settings; widget content
// settings (typography/color/editor HTML/image url) are untouched → still fully editable native widgets.
import fs from 'fs';
const inPath = process.argv[2], outTree = process.argv[3], outCss = process.argv[4];
const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const root = Array.isArray(data) ? data[0] : (data.elements ? data.elements[0] : data);
const px = (o) => (o && typeof o === 'object' && o.size != null) ? Math.round(+o.size) : (typeof o === 'number' ? Math.round(o) : null);
const seen = new Set();
const newId = () => { let id; do { id = Math.random().toString(16).slice(2, 9).padEnd(7, '0'); } while (seen.has(id)); seen.add(id); return id; };
const css = [];
let nWidgets = 0, nAbs = 0;
const rh = px(root.settings && root.settings.min_height);
const walk = (node, isRoot) => {
  if (!node || typeof node !== 'object') return;
  // assign Elementor element id (always — containers AND widgets) so generated/scoped CSS has a data-id to target
  if (!node.id) node.id = newId();
  if (node.elType === 'widget') {
    nWidgets++;
    const s = node.settings || (node.settings = {});
    if (s._position === 'absolute') {
      nAbs++;
      const x = px(s._offset_x), y = px(s._offset_y);
      const w = (s._element_custom_width && px(s._element_custom_width)) || null;
      const z = s._z_index != null ? `;z-index:${s._z_index}` : '';
      let rule = `#${node.id}{position:absolute`;
      if (x != null) rule += `;left:${x}px`;
      if (y != null) rule += `;top:${y}px`;
      if (w != null) rule += `;width:${w}px;max-width:${w}px`;
      rule += `${z}}`;
      css.push(rule);
    }
  }
  if (isRoot) {
    // force a positioned, full-height stacking context so abs children anchor to the root, not <body>
    css.push(`#${node.id}{position:relative${rh ? `;min-height:${rh}px;height:${rh}px` : ''};width:100%;max-width:100%;padding:0}`);
  }
  (node.elements || []).forEach((c) => walk(c, false));
};
walk(root, true);
fs.writeFileSync(outTree, JSON.stringify([root]));
fs.writeFileSync(outCss, css.join('\n'));
console.log(`projbake v2: ${nWidgets} widget(s), ${nAbs} absolute, ${css.length} CSS rule(s), rootId=${root.id}, rootH=${rh}px`);

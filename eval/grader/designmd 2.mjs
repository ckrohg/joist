#!/usr/bin/env node
/**
 * @purpose DESIGN.md intermediate-representation layer (steal #1 from knowledge/DESIGNMD_STEAL_PLAN.md).
 * Pure, I/O-free, dependency-free module with two halves:
 *   • emitDesignMd(model)  → a valid DESIGN.md string (YAML token front-matter + canonical prose body),
 *                            serialized from build-structured.mjs's existing color/typo clusters PLUS the
 *                            spacing/radius/shadow clusters P2 adds. Components are synthesized from token
 *                            ROLES (Primary/Text Dark/BG Light/Heading/Body…) so the consuming layer is real.
 *   • lintDesignMd(text)   → the DESIGN.md lint findings (port of the google-labs-code/design.md rule set):
 *                            broken-ref, orphaned-tokens, section-order, unknown-key, missing-primary,
 *                            missing-typography, contrast-ratio, token-summary, missing-sections.
 * Format spec: https://github.com/google-labs-code/design.md . The contrast-ratio / missing-primary /
 * missing-typography rules also run inside grade-structure.mjs against the rendered page; HERE they run
 * against the IR file, and broken-ref / orphaned-tokens / section-order / unknown-key are file-only rules
 * that the rendered-page grader cannot do.
 */

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------
export const CANONICAL_SECTIONS = ['Overview', 'Colors', 'Typography', 'Layout', 'Elevation & Depth', 'Shapes', 'Components', "Do's and Don'ts"];
const FM_KEYS = new Set(['version', 'name', 'description', 'colors', 'typography', 'rounded', 'spacing', 'components']);
const TYPO_KEYS = new Set(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'fontFeature', 'fontVariation']);
const COMP_KEYS = new Set(['backgroundColor', 'textColor', 'typography', 'rounded', 'padding', 'size', 'height', 'width']);

export const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'token';
// dedup a slug against a Set of taken names → name, name-2, name-3…
function uniqueSlug(base, taken) { let s = base, i = 2; while (taken.has(s)) s = `${base}-${i++}`; taken.add(s); return s; }

// hex parsing + WCAG contrast (mirrors the math in grade-structure.mjs so the file-lint agrees with the page-lint)
export function hexToRgb(h) {
  const m = String(h || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i); if (!m) return null;
  let x = m[1]; if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
export function contrastRatio(hexA, hexB) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB); if (!a || !b) return null;
  const la = lum(a) + 0.05, lb = lum(b) + 0.05; return la > lb ? la / lb : lb / la;
}

// ---------------------------------------------------------------------------
// EMIT — model → DESIGN.md string
// ---------------------------------------------------------------------------
/**
 * model = {
 *   name, description?, pageBg?,
 *   colors: [{ id?, role, hex, count? }],
 *   typography: [{ id?, role, fontFamily?, fontSize?, fontWeight?, lineHeight?, letterSpacing?, textTransform?, count? }],
 *   rounded:  [{ name, px, count? }],   // sorted ascending
 *   spacing:  [{ name, px, count? }],   // sorted ascending
 *   shadows:  [{ name, value, count? }],
 * }
 */
export function buildTokenModel(model) {
  const takenC = new Set(), takenT = new Set();
  const colors = (model.colors || []).filter((c) => c && c.hex).map((c) => ({ ...c, token: uniqueSlug(slugify(c.role || 'color'), takenC) }));
  const typography = (model.typography || []).map((t) => ({ ...t, token: uniqueSlug(slugify(t.role || 'text'), takenT) }));
  const rounded = (model.rounded || []).filter((r) => r && r.name);
  const spacing = (model.spacing || []).filter((s) => s && s.name);
  const shadows = (model.shadows || []).filter((s) => s && s.value);
  // role → token lookups (first match wins)
  const byRole = (arr, ...roles) => { for (const r of roles) { const hit = arr.find((x) => slugify(x.role) === slugify(r)); if (hit) return hit.token; } return arr[0] ? arr[0].token : null; };
  const lightest = colors.slice().sort((a, b) => lum(hexToRgb(b.hex) || [0, 0, 0]) - lum(hexToRgb(a.hex) || [0, 0, 0]))[0];
  const darkest = colors.slice().sort((a, b) => lum(hexToRgb(a.hex) || [255, 255, 255]) - lum(hexToRgb(b.hex) || [255, 255, 255]))[0];
  const accent = byRole(colors, 'primary', 'accent');
  const accentObj = colors.find((c) => c.token === accent);
  const bgLight = byRole(colors, 'bg-light') || (lightest && lightest.token);
  const textDark = byRole(colors, 'text-dark', 'text') || (darkest && darkest.token);
  // pick the better-contrasting foreground token against a given surface (so a bright accent gets dark text, etc.)
  const betterFg = (bgHex) => { let best = null, bestR = -1; for (const c of colors) { const r = contrastRatio(c.hex, bgHex); if (r != null && r > bestR) { bestR = r; best = c; } } return best ? best.token : bgLight; };
  const btnFg = accentObj ? betterFg(accentObj.hex) : bgLight;
  const rMid = rounded[Math.floor(rounded.length / 2)] || rounded[0];
  const rBig = rounded[rounded.length - 1] || rMid;
  const sBig = spacing[spacing.length - 1] || spacing[Math.floor(spacing.length / 2)] || spacing[0];
  const tDisplay = byRole(typography, 'display', 'heading');
  const tBody = byRole(typography, 'body', 'text');
  // synthesize components from ROLES — the real consuming layer (gives broken-ref/orphaned/contrast teeth)
  const components = {};
  if (accent && btnFg) components.button = { backgroundColor: `{colors.${accent}}`, textColor: `{colors.${btnFg}}`, ...(tBody ? { typography: `{typography.${tBody}}` } : {}), ...(rMid ? { rounded: `{rounded.${rMid.name}}` } : {}) };
  if (bgLight) components.card = { backgroundColor: `{colors.${bgLight}}`, ...(textDark ? { textColor: `{colors.${textDark}}` } : {}), ...(rBig ? { rounded: `{rounded.${rBig.name}}` } : {}), ...(sBig ? { padding: `{spacing.${sBig.name}}` } : {}) };
  if (tDisplay && textDark) components.heading = { typography: `{typography.${tDisplay}}`, textColor: `{colors.${textDark}}` };
  if (tBody && textDark) components.body = { typography: `{typography.${tBody}}`, textColor: `{colors.${textDark}}` };
  return { name: model.name || 'Captured', description: model.description, pageBg: model.pageBg, colors, typography, rounded, spacing, shadows, components, refs: { accent, bgLight, textDark } };
}

function yamlTypography(t) {
  const lines = [`  ${t.token}:`];
  if (t.fontFamily) lines.push(`    fontFamily: ${t.fontFamily}`);
  if (t.fontSize) lines.push(`    fontSize: ${typeof t.fontSize === 'number' ? t.fontSize + 'px' : t.fontSize}`);
  if (t.fontWeight) lines.push(`    fontWeight: ${t.fontWeight}`);
  if (t.lineHeight) lines.push(`    lineHeight: ${typeof t.lineHeight === 'number' ? t.lineHeight + 'px' : t.lineHeight}`);
  if (t.letterSpacing != null && t.letterSpacing !== '') lines.push(`    letterSpacing: ${typeof t.letterSpacing === 'number' ? t.letterSpacing + 'px' : t.letterSpacing}`);
  return lines.join('\n');
}

export function emitDesignMd(rawModel) {
  const m = buildTokenModel(rawModel);
  const fm = ['---', `version: alpha`, `name: ${m.name}`];
  if (m.description) fm.push(`description: ${m.description}`);
  // colors
  fm.push('colors:');
  for (const c of m.colors) fm.push(`  ${c.token}: "${String(c.hex).toUpperCase()}"`);
  // typography
  if (m.typography.length) { fm.push('typography:'); for (const t of m.typography) fm.push(yamlTypography(t)); }
  // rounded
  if (m.rounded.length) { fm.push('rounded:'); for (const r of m.rounded) fm.push(`  ${r.name}: ${r.px}px`); }
  // spacing
  if (m.spacing.length) { fm.push('spacing:'); for (const s of m.spacing) fm.push(`  ${s.name}: ${s.px}px`); }
  // components
  if (Object.keys(m.components).length) {
    fm.push('components:');
    for (const [name, comp] of Object.entries(m.components)) { fm.push(`  ${name}:`); for (const [k, v] of Object.entries(comp)) fm.push(`    ${k}: ${/[{":]/.test(String(v)) ? `"${v}"` : v}`); }
  }
  fm.push('---');

  // ---- prose body (canonical section order) ----
  const body = [];
  body.push('', '## Overview', `Design system extracted from **${m.name}**${m.description ? ' — ' + m.description : ''}. Tokens below are the normative values; this prose is application context. ${m.colors.length} color, ${m.typography.length} typography, ${m.rounded.length} radius, ${m.spacing.length} spacing token(s).`);
  body.push('', '## Colors', m.colors.length ? m.colors.map((c) => `- \`${c.token}\` — ${c.hex.toUpperCase()}${c.role ? ` (${c.role})` : ''}`).join('\n') : '_No color tokens extracted._');
  if (m.typography.length) body.push('', '## Typography', m.typography.map((t) => `- \`${t.token}\` — ${t.fontFamily || 'inherit'}${t.fontSize ? `, ${typeof t.fontSize === 'number' ? t.fontSize + 'px' : t.fontSize}` : ''}${t.fontWeight ? ` ${t.fontWeight}` : ''}${t.role ? ` (${t.role})` : ''}`).join('\n'));
  if (m.spacing.length) body.push('', '## Layout', `Spacing scale: ${m.spacing.map((s) => `\`${s.name}\`=${s.px}px`).join(', ')}.${m.pageBg ? ` Page background \`${m.pageBg}\`.` : ''}`);
  if (m.shadows.length) body.push('', '## Elevation & Depth', m.shadows.map((s, i) => `- \`${s.name}\` — \`${s.value}\``).join('\n'));
  if (m.rounded.length) body.push('', '## Shapes', `Corner radius scale: ${m.rounded.map((r) => `\`${r.name}\`=${r.px}px`).join(', ')}.`);
  if (Object.keys(m.components).length) body.push('', '## Components', Object.entries(m.components).map(([n, c]) => `- **${n}** — ${Object.entries(c).map(([k, v]) => `${k}: ${v}`).join(', ')}`).join('\n'));
  body.push('', "## Do's and Don'ts", "- DO use the global color & typography tokens; let token edits propagate (no baked literals).", "- DO keep text/background pairs at WCAG AA contrast (≥ 4.5:1 for body text).", "- DON'T introduce off-scale font sizes, ad-hoc hex values, or one-off radii — extend a token instead.", "- DON'T rasterize text that the tokens can render natively.");
  return fm.join('\n') + '\n' + body.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// LINT — DESIGN.md string → findings
// ---------------------------------------------------------------------------
// minimal tolerant front-matter parser: indentation-based nested maps + scalar leaves (no arrays in our schema)
export function parseFrontMatter(text) {
  const fm = (String(text).match(/^---\n([\s\S]*?)\n---/) || [])[1]; if (fm == null) return { ok: false, data: {}, raw: '' };
  const lines = fm.split('\n');
  const root = {}; const stack = [{ indent: -1, obj: root }];
  for (const raw of lines) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indent = raw.length - raw.replace(/^\s*/, '').length;
    const mm = raw.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/); if (!mm) continue;
    const key = mm[1]; let val = mm[2];
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (val === '') { const child = {}; parent[key] = child; stack.push({ indent, obj: child }); }
    else { if (/^".*"$/.test(val)) val = val.slice(1, -1); parent[key] = val; }
  }
  return { ok: true, data: root, raw: fm };
}

// collect every {a.b.c} reference appearing in front-matter values + prose body
function collectRefs(text) { return [...String(text).matchAll(/\{([a-zA-Z0-9_.-]+)\}/g)].map((m) => m[1]); }
function resolveRef(data, ref) { return ref.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), data); }

export function lintDesignMd(text) {
  const findings = [];
  const add = (rule, severity, message) => findings.push({ rule, severity, message });
  const { ok, data } = parseFrontMatter(text);
  if (!ok) { add('broken-ref', 'error', 'No YAML front matter (--- … ---) found.'); return { findings, errors: 1, warnings: 0 }; }
  const colors = data.colors || {}, typography = data.typography || {}, components = data.components || {};

  // unknown-key (front-matter top-level + typography/component sub-keys)
  for (const k of Object.keys(data)) if (!FM_KEYS.has(k)) add('unknown-key', 'warning', `Unknown top-level key "${k}" — likely a typo.`);
  for (const [tn, t] of Object.entries(typography)) if (t && typeof t === 'object') for (const k of Object.keys(t)) if (!TYPO_KEYS.has(k)) add('unknown-key', 'warning', `Unknown typography key "${k}" in "${tn}".`);
  for (const [cn, c] of Object.entries(components)) if (c && typeof c === 'object') for (const k of Object.keys(c)) if (!COMP_KEYS.has(k)) add('unknown-key', 'warning', `Unknown component key "${k}" in "${cn}".`);

  // missing-primary / missing-typography
  const colorKeys = Object.keys(colors);
  if (!colorKeys.length) add('missing-primary', 'warning', 'No colors defined.');
  else if (!colorKeys.some((k) => /^(primary|accent)/.test(k))) add('missing-primary', 'warning', 'No primary/accent color token — agents will auto-generate one.');
  if (!Object.keys(typography).length) add('missing-typography', 'warning', 'No typography tokens — default font fallback will be used.');

  // broken-ref: every {ref} must resolve in the front-matter
  const refs = collectRefs(text);
  for (const r of [...new Set(refs)]) if (resolveRef(data, r) === undefined) add('broken-ref', 'error', `Unresolved token reference {${r}}.`);

  // orphaned-tokens: a color token defined but never referenced by a component or another token value
  const refSet = new Set(refs);
  for (const ck of colorKeys) if (!refSet.has(`colors.${ck}`)) add('orphaned-tokens', 'warning', `Color token "colors.${ck}" is defined but never referenced by a component.`);

  // contrast-ratio: component backgroundColor/textColor pairs below WCAG AA (4.5:1)
  for (const [cn, c] of Object.entries(components)) {
    if (!c || typeof c !== 'object' || !c.backgroundColor || !c.textColor) continue;
    const bgRef = (c.backgroundColor.match(/\{colors\.([^}]+)\}/) || [])[1];
    const fgRef = (c.textColor.match(/\{colors\.([^}]+)\}/) || [])[1];
    const bg = bgRef ? colors[bgRef] : c.backgroundColor, fg = fgRef ? colors[fgRef] : c.textColor;
    const ratio = contrastRatio(fg, bg);
    if (ratio != null && ratio < 4.5) add('contrast-ratio', 'warning', `Component "${cn}" text/background contrast ${ratio.toFixed(2)}:1 is below WCAG AA (4.5:1).`);
  }

  // section-order: ## headings must follow the canonical order
  const headings = [...String(text).matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  const known = headings.filter((h) => CANONICAL_SECTIONS.includes(h));
  let last = -1; for (const h of known) { const idx = CANONICAL_SECTIONS.indexOf(h); if (idx < last) { add('section-order', 'warning', `Section "${h}" is out of canonical order.`); break; } last = idx; }

  // info rules
  add('token-summary', 'info', `${colorKeys.length} color, ${Object.keys(typography).length} typography, ${Object.keys(data.rounded || {}).length} radius, ${Object.keys(data.spacing || {}).length} spacing, ${Object.keys(components).length} component token(s).`);
  const missingSecs = CANONICAL_SECTIONS.filter((s) => !headings.includes(s));
  if (missingSecs.length) add('missing-sections', 'info', `Optional sections absent: ${missingSecs.join(', ')}.`);

  return { findings, errors: findings.filter((f) => f.severity === 'error').length, warnings: findings.filter((f) => f.severity === 'warning').length };
}

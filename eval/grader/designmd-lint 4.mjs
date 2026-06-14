#!/usr/bin/env node
/**
 * @purpose CLI wrapper over designmd.mjs lintDesignMd — the file-level DESIGN.md lint (broken-ref,
 * orphaned-tokens, section-order, unknown-key + contrast/missing-primary/missing-typography). Mirrors the
 * google-labs-code/design.md `lint` command: prints findings grouped by severity and exits 1 on any error
 * (0 otherwise), so it can gate a build or run in the corpus harness.
 * Usage: node designmd-lint.mjs <file.DESIGN.md> [--json]
 */
import fs from 'fs';
import { lintDesignMd } from './designmd.mjs';

const file = process.argv[2];
const asJson = process.argv.includes('--json');
if (!file || file.startsWith('--')) { console.error('usage: node designmd-lint.mjs <file.DESIGN.md> [--json]'); process.exit(2); }
let text; try { text = fs.readFileSync(file, 'utf8'); } catch (e) { console.error(`cannot read ${file}: ${(e && e.message) || e}`); process.exit(2); }

const result = lintDesignMd(text);
if (asJson) { console.log(JSON.stringify({ file, ...result }, null, 2)); process.exit(result.errors > 0 ? 1 : 0); }

const icon = { error: '✗', warning: '⚠', info: 'ℹ' };
const order = { error: 0, warning: 1, info: 2 };
console.log(`\n  DESIGN.md lint — ${file}`);
console.log('  ' + '─'.repeat(56));
for (const f of result.findings.slice().sort((a, b) => order[a.severity] - order[b.severity])) {
  console.log(`  ${icon[f.severity] || '·'} [${f.rule}] ${f.message}`);
}
console.log('  ' + '─'.repeat(56));
console.log(`  ${result.errors} error(s), ${result.warnings} warning(s)\n`);
process.exit(result.errors > 0 ? 1 : 0);

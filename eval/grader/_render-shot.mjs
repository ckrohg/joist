#!/usr/bin/env node
/**
 * @purpose Screenshot helper for sandbox/render.mjs. Lives in eval/grader/ so it
 * resolves the shared `playwright` install (node_modules here). Renders a URL,
 * full-page screenshots it, and prints a computed-style probe (heading/button/
 * container) to stdout as JSON so render() can confirm the widgets rendered STYLED
 * (not just present in the DOM). Invoked as:
 *   node _render-shot.mjs <url> <outPng> [width]
 */
import { chromium } from 'playwright';

const url = process.argv[2];
const out = process.argv[3] || '/tmp/joist-render.png';
const width = Number(process.argv[4] || 1200);

const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
try {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: out, fullPage: true });
  const probe = await page.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const h = document.querySelector('.elementor-heading-title');
    const btn = document.querySelector('.elementor-button');
    const cont = document.querySelector('.e-con, .elementor-container, .elementor-section');
    const hcs = cs(h), bcs = cs(btn), ccs = cs(cont);
    return {
      headingText: h ? h.textContent.trim() : null,
      headingColor: hcs ? hcs.color : null,
      headingFontSize: hcs ? hcs.fontSize : null,
      buttonText: btn ? btn.textContent.trim() : null,
      buttonBg: bcs ? bcs.backgroundColor : null,
      buttonColor: bcs ? bcs.color : null,
      buttonRadius: bcs ? bcs.borderTopLeftRadius : null,
      containerBg: ccs ? ccs.backgroundColor : null,
      elementorCssLinks: document.querySelectorAll('link[href*="elementor"],link[id*="elementor"]').length,
    };
  });
  process.stdout.write(JSON.stringify(probe));
} finally {
  await browser.close();
}

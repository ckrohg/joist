// @purpose Probe rendered page DOM to diagnose layout (absolute honored? fallback? overflow source).
import { chromium } from 'playwright';
const [, , url, wArg] = process.argv;
const width = parseInt(wArg || '1440', 10);
const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
const page = await browser.newPage({ viewport: { width, height: 1000 } });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2000);
const r = await page.evaluate((w) => {
  const out = {};
  out.title = document.title;
  out.bodyClass = document.body.className.slice(0, 200);
  out.hasElementor = !!document.querySelector('.elementor');
  out.elCount = document.querySelectorAll('.elementor-element').length;
  out.imgCount = document.querySelectorAll('img').length;
  out.hrCount = document.querySelectorAll('.elementor hr').length;
  out.codeChips = document.querySelectorAll('.elementor code').length;
  // widest element causing overflow
  let widest = null, maxR = 0;
  document.querySelectorAll('.elementor-element').forEach(el => { const rc = el.getBoundingClientRect(); if (rc.right > maxR && rc.width > 0) { maxR = rc.right; widest = el; } });
  if (widest) out.widest = { right: Math.round(maxR), cls: widest.className.slice(0, 80), id: widest.id, tag: widest.tagName };
  // tallest few elements
  const els = [...document.querySelectorAll('.elementor-element')].map(el => { const rc = el.getBoundingClientRect(); return { id: el.id, h: Math.round(rc.height), y: Math.round(rc.top + window.scrollY), cls: el.className.slice(0, 50) }; }).filter(e => e.h > 1500).sort((a, b) => b.h - a.h).slice(0, 6);
  out.tallest = els;
  // first main container position
  const main = document.querySelector('.elementor-section, .e-con, .elementor > .elementor-element');
  if (main) { const cs = getComputedStyle(main); out.firstCon = { position: cs.position, display: cs.display }; }
  // sample a widget's position style
  const w1 = document.querySelector('.elementor-widget');
  if (w1) { const cs = getComputedStyle(w1); out.sampleWidget = { position: cs.position, left: cs.left, top: cs.top }; }
  return out;
}, width);
console.log(JSON.stringify(r, null, 1));
await browser.close();

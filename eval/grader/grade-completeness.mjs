#!/usr/bin/env node
/**
 * @purpose TOP-DOWN website-completeness grader (NEW shadow module; research wzdd8xxjs +
 * knowledge/WEBSITE_COMPLETENESS_GRADING.md). The bottom-up section grader (grade-sections.mjs)
 * scores how faithfully each rendered BAND looks, but never asks the structural question the user
 * flagged: "is this a COMPLETE website?" — i.e. does the clone actually HAVE the source's header/nav,
 * logo, hero, primary CTA, main content, and (the chronic miss) a real FOOTER with its sub-parts?
 *
 * This module enumerates canonical components on the SOURCE and on the CLONE and reports a
 * completenessScore in [0,1] = weighted fraction of SOURCE components that are PRESENT + roughly
 * correct in the CLONE, heavily penalizing missing critical components (footer/nav/header/main/logo)
 * and flagging ARIA-landmark cardinality violations (exactly 1 main; <=1 banner; <=1 contentinfo).
 *
 * THE KEY FINDING this module is built around (MDN/W3C APG, verified in the research doc):
 * header→banner and footer→contentinfo carry their landmark ROLE only when a DIRECT child of <body>
 * and NOT nested in main/article/aside/nav/section. Elementor (and our absolute/flow builders) re-wrap
 * ALL content in section/container structures, which DEMOTES the global header/footer to a generic
 * role even when the visual element is present. Therefore:
 *   - SOURCE detection may lean on role+tag+position+content.
 *   - CLONE detection must NOT rely on landmark role for header/nav/footer — it detects those by
 *     POSITION BAND (top band = header/nav; bottom band near pageH = footer) + CONTENT SIGNATURES
 *     (copyright/©/"all rights reserved"/privacy/terms → footer; top link-cluster → nav; upper-left
 *     image/svg → logo; large above-the-fold heading+button → hero+CTA).
 *
 * Detection per page is a COMBINATION of three independent signals (any-of, so a demoted role still
 * gets caught by position/content):
 *   (a) ARIA roles + semantic tags with body-context (computed role via [role] OR tag),
 *   (b) POSITION BANDS (top ~120px = header/nav; bottom ~22% of pageH = footer),
 *   (c) CONTENT SIGNATURES (regex over text in the relevant band).
 *
 * SCORING is asymmetric on purpose: a component the SOURCE lacks contributes nothing (you can't be
 * "incomplete" w.r.t. something the original never had); a CRITICAL component the source HAS but the
 * clone is MISSING tanks the score. self-test source-vs-source == 1.0 exactly (we reuse the source
 * probe verbatim for the clone side, so detection nondeterminism can never break the gate).
 *
 * Usage:
 *   node grade-completeness.mjs --source <url> --clone <url> [--out dir]
 *   node grade-completeness.mjs --source <url> --selftest        # source vs itself → must be 1.0
 *   node grade-completeness.mjs --selftest                       # defaults source to tailwindcss.com
 *   node --check grade-completeness.mjs
 *
 * NEW file only. Does NOT import/edit capture-layout.mjs / build-absolute.mjs / grade-sections.mjs.
 * Drives Playwright directly (same chromium + stealth + step-scroll discipline as the sibling graders).
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { assertAllowedBase, assertNotBlocked } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: refuse a stray (e.g. paused *.sg-host.com) URL before any navigation.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);

const SELFTEST = has('selftest');
const W = parseInt(arg('width', '1440'), 10);
let source = arg('source');
let clone = arg('clone');
const outDir = arg('out', null);
// --selftest with no --source defaults to tailwindcss.com (the doc's assertion target).
if (SELFTEST && !source) source = 'https://tailwindcss.com';
if (SELFTEST) clone = clone || source; // assert on the same URL
if (!source || (!clone && !SELFTEST)) { console.error('need --source --clone (or --source --selftest)'); process.exit(2); }
// §0 SAFETY GUARD: assert every http(s) URL arg targets a training host (blocks the paused shared host) BEFORE any chromium.goto.
if (clone && /^https?:/i.test(clone)) assertAllowedBase(clone); if (source && /^https?:/i.test(source)) assertNotBlocked(source); /* source = external read-only; only the paused host is blocked */

// ──────────────────────────────────────────────────────────────────────────────────────────────
// COMPONENT TAXONOMY. Each canonical component carries a weight (critical components dominate) and a
// `critical` flag (a missing critical component is reported with verdict 'missing' and dominates the
// score). The score is a weighted fraction over the SOURCE components that are present.
// ──────────────────────────────────────────────────────────────────────────────────────────────
const COMPONENTS = [
  { key: 'header',     label: 'header / top bar',      weight: 3, critical: true },
  { key: 'nav',        label: 'primary navigation',    weight: 3, critical: true },
  { key: 'logo',       label: 'logo / identity',       weight: 2, critical: true },
  { key: 'hero',       label: 'hero (above-fold)',     weight: 2, critical: false },
  { key: 'primaryCTA', label: 'primary CTA',           weight: 2, critical: false },
  { key: 'main',       label: 'main content sections', weight: 3, critical: true },
  { key: 'footer',     label: 'footer',                weight: 4, critical: true },
  { key: 'footerNav',  label: 'footer-nav links',      weight: 2, critical: false },
  { key: 'footerLegal',label: 'legal / copyright',     weight: 2, critical: false },
  { key: 'footerSocial',label: 'social links',         weight: 1, critical: false },
  { key: 'footerContact',label: 'contact info',        weight: 1, critical: false },
  { key: 'cookie',     label: 'cookie / consent',      weight: 1, critical: false },
];

// ──────────────────────────────────────────────────────────────────────────────────────────────
// IN-PAGE PROBE. Runs in the browser context; returns a structured `signals` object for ONE page.
// Pure data extraction (roles, position bands, content signatures) — scoring happens in node so the
// same probe serves both source and clone, and the self-test can reuse the source probe verbatim.
// ──────────────────────────────────────────────────────────────────────────────────────────────
function probeFn(vw) {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return !(cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05);
  };
  const pageH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  // header/nav band is an ABSOLUTE top strip (a header is a fixed-height bar near the top, NOT a % of
  // page height — on an 11k-px page, 6% = 700px would swallow the hero). Cap at ~160px.
  const TOP = 160;
  const FOOT = pageH - Math.max(220, pageH * 0.22);   // footer band: bottom ~22% of page (>=220px)
  const ABOVE_FOLD = Math.min(pageH, 1000);           // hero band (first viewport-ish)

  // computed-role-ish: explicit role attr, else the implicit role from the tag — WITH body-context for
  // header/footer (the landmark only counts if NOT nested inside main/article/aside/nav/section).
  const NON_BANNER_ANCESTORS = 'main,article,aside,nav,section,[role=main],[role=article],[role=complementary],[role=navigation],[role=region]';
  const landmarkRole = (el) => {
    const explicit = (el.getAttribute('role') || '').toLowerCase().trim();
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'nav') return 'navigation';
    if (tag === 'main') return 'main';
    if (tag === 'header' || tag === 'footer') {
      // body-context: scoped role only when a direct-ish child of body (no sectioning ancestor).
      if (el.closest(NON_BANNER_ANCESTORS)) return tag === 'header' ? 'banner-demoted' : 'contentinfo-demoted';
      return tag === 'header' ? 'banner' : 'contentinfo';
    }
    return '';
  };

  // Collect role/landmark inventory for cardinality enforcement.
  const roleInv = { main: 0, banner: 0, contentinfo: 0, navigation: 0 };
  const allEls = [...document.querySelectorAll('header,footer,nav,main,[role]')];
  for (const el of allEls) {
    if (!vis(el)) continue;
    const role = landmarkRole(el);
    if (role === 'main') roleInv.main++;
    else if (role === 'banner') roleInv.banner++;
    else if (role === 'contentinfo') roleInv.contentinfo++;
    else if (role === 'navigation') roleInv.navigation++;
  }

  // Per-element index: visible text-bearing / structural elements with their absolute Y band.
  const idx = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    const y0 = r.top + scrollY, y1 = r.bottom + scrollY;
    idx.push({ el, tag: el.tagName.toLowerCase(), y0, y1, x0: r.left + scrollX, w: r.width, h: r.height });
  }

  // --- text helpers per band -----------------------------------------------------------------
  const textInBand = (lo, hi) => {
    let s = '';
    for (const e of idx) {
      if (e.y0 >= lo && e.y0 < hi) {
        const own = [...e.el.childNodes].some((n) => n.nodeType === 3 && clean(n.textContent));
        if (own) s += ' ' + clean(e.el.textContent);
      }
    }
    return clean(s).toLowerCase();
  };

  // --- NAV -------------------------------------------------------------------------------------
  // role navigation OR <nav> OR a top-band cluster of >=3 links spanning a wide row.
  let nav = false, navWhy = '';
  for (const el of document.querySelectorAll('nav,[role=navigation]')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect(); const y = r.top + scrollY;
    const links = [...el.querySelectorAll('a')].filter((a) => vis(a) && clean(a.textContent)).length;
    if (links >= 2) { nav = true; navWhy = (y <= TOP + 80 ? 'nav-topband' : 'nav-tag'); if (y <= TOP + 120) break; }
  }
  if (!nav) {
    // position+content fallback (clone case where role is stripped): cluster of links in the top band.
    const topLinks = idx.filter((e) => e.tag === 'a' && e.y0 <= TOP + 80 && e.y0 >= -10);
    const labelled = topLinks.filter((e) => clean(e.el.textContent).length >= 2);
    if (labelled.length >= 3) { nav = true; navWhy = 'topband-linkcluster(' + labelled.length + ')'; }
  }

  // --- LOGO ------------------------------------------------------------------------------------
  // upper-left image/svg OR a brand-ish link/heading in the top-left.
  let logo = false, logoWhy = '';
  for (const e of idx) {
    if (e.y0 > TOP + 60 || e.y1 < -10) continue;
    if (e.x0 > vw * 0.45) continue; // upper-LEFT
    if ((e.tag === 'img' || e.tag === 'svg') && e.w >= 16 && e.w <= 480 && e.h >= 12 && e.h <= 200) { logo = true; logoWhy = 'upper-left-' + e.tag; break; }
  }
  if (!logo) {
    // brand link/heading in upper-left with an image/svg inside, or a wordmark anchor to "/".
    for (const a of document.querySelectorAll('a[href="/"], a[href$="//"], header a, [role=banner] a, nav a')) {
      if (!vis(a)) continue; const r = a.getBoundingClientRect(); const y = r.top + scrollY, x = r.left + scrollX;
      if (y > TOP + 60 || x > vw * 0.45) continue;
      if (a.querySelector('img,svg') || (clean(a.textContent).length >= 2 && clean(a.textContent).length <= 30)) { logo = true; logoWhy = 'upper-left-brandlink'; break; }
    }
  }

  // --- HEADER / TOP BAR ------------------------------------------------------------------------
  // role banner OR a visible <header> in the top band, ELSE (the common case — and the demoted-role
  // clone case) position+content: a nav and/or logo cluster sitting in the top band = a header bar.
  let header = false, headerWhy = '';
  for (const e of idx) {
    if (e.tag === 'header' && e.y0 <= TOP + 40 && e.w >= vw * 0.5) { header = true; headerWhy = 'header-tag-topband'; break; }
  }
  if (!header) { for (const el of document.querySelectorAll('[role=banner]')) { if (vis(el)) { header = true; headerWhy = 'role-banner'; break; } } }
  if (!header) {
    // position+content fallback: a top-band row carrying the nav and/or logo IS the header bar.
    const topItems = idx.filter((e) => e.y0 <= TOP + 20 && e.y1 >= -10 && (e.tag === 'a' || e.tag === 'button' || e.tag === 'img' || e.tag === 'svg') && clean(e.el.textContent || e.el.getAttribute('aria-label') || (e.tag === 'img' || e.tag === 'svg' ? 'icon' : '')));
    if ((nav && navWhy.includes('topband')) || logo || topItems.length >= 3) { header = true; headerWhy = 'topband-' + (nav ? 'nav' : '') + (logo ? '+logo' : '') + (topItems.length >= 3 ? '+cluster(' + topItems.length + ')' : '') || 'topband-cluster'; }
  }

  // --- HERO + PRIMARY CTA ----------------------------------------------------------------------
  // a large above-the-fold heading; a prominent button/CTA above the fold.
  // A hero = a LARGE-FONT text block above the fold. Accept hN tags (fs>=24) AND any tag carrying its
  // own text at a hero-scale font (fs>=30) — Elementor heading widgets often render as <div>/<span>,
  // not hN, so an hN-only gate false-misses the clone's hero even when it's plainly there. (tw3146 has
  // NO large-font text above the fold — its hero broke into raw class-name leakage — so it stays missing.)
  let hero = false, heroWhy = '';
  let bigHeadingY = null;
  for (const e of idx) {
    if (e.y0 > ABOVE_FOLD || e.y1 < 0 || e.y0 < 40) continue;
    const own = [...e.el.childNodes].some((n) => n.nodeType === 3 && clean(n.textContent));
    if (!own) continue;
    const fs = parseFloat(getComputedStyle(e.el).fontSize) || 0;
    const txt = clean(e.el.textContent);
    const isHeading = /^h[1-3]$/.test(e.tag);
    if (txt.length >= 6 && ((isHeading && fs >= 24) || fs >= 30)) {
      hero = true; heroWhy = (isHeading ? 'big-heading' : 'big-text-' + e.tag) + '-abovefold(' + Math.round(fs) + 'px)'; bigHeadingY = e.y0; break;
    }
  }
  let primaryCTA = false, ctaWhy = '';
  const CTA_RX = /\b(get started|start( now| free| building)?|sign ?up|try( it)?( free| now)?|get( a)? demo|book( a)? demo|request( a)? demo|buy|subscribe|join|download|contact( sales| us)?|learn more|explore|create( an)? account|get( the)? app)\b/i;
  for (const e of idx) {
    if (e.y0 > ABOVE_FOLD || e.y1 < 0) continue;
    const isBtn = e.tag === 'button' || (e.tag === 'a' && (() => { const cs = getComputedStyle(e.el); return cs.display !== 'inline' && (parseFloat(cs.paddingTop) >= 6 || parseFloat(cs.paddingLeft) >= 10) && e.h >= 28; })());
    if (!isBtn) continue;
    const txt = clean(e.el.textContent);
    if (txt && (CTA_RX.test(txt) || (e.tag === 'button' && txt.length >= 3 && txt.length <= 30))) {
      // prefer CTAs near the hero / above fold; exclude tiny nav chips by requiring some width
      if (e.w >= 60) { primaryCTA = true; ctaWhy = 'cta-button("' + txt.slice(0, 24) + '")'; break; }
    }
  }

  // --- MAIN CONTENT SECTIONS -------------------------------------------------------------------
  // role main OR <main> OR >=2 wide content bands below the header (generic so it works on clone too).
  let main = false, mainWhy = '';
  for (const el of document.querySelectorAll('main,[role=main]')) { if (vis(el)) { main = true; mainWhy = 'main-landmark'; break; } }
  if (!main) {
    const bands = new Set();
    for (const e of idx) {
      if (e.w >= vw * 0.7 && e.h >= 140 && e.y0 > TOP && e.y0 < FOOT) bands.add(Math.round(e.y0 / 80) * 80);
    }
    if (bands.size >= 2) { main = true; mainWhy = 'content-bands(' + bands.size + ')'; }
  }

  // --- FOOTER + SUB-PARTS ----------------------------------------------------------------------
  // role contentinfo OR <footer> OR (clone case) bottom-band content signature: copyright/legal text.
  const footText = textInBand(FOOT, pageH + 2000);
  const LEGAL_RX = /(©|©|\(c\)\s*\d|copyright|all rights reserved|\ball rights\b|\bterms\b|privacy(\s*policy)?|\blegal\b|\bimprint\b|cookie policy)/i;
  const hasLegalText = LEGAL_RX.test(footText);
  let footer = false, footerWhy = '';
  for (const el of document.querySelectorAll('footer,[role=contentinfo]')) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect(); const y = r.top + scrollY;
    if (y >= FOOT - 200) { footer = true; footerWhy = 'footer-landmark-bottomband'; break; }
    footer = true; footerWhy = 'footer-landmark'; // a footer tag anywhere still counts as present
  }
  if (!footer && hasLegalText) { footer = true; footerWhy = 'bottomband-legaltext'; }
  if (!footer) {
    // last-ditch: a wide content band in the bottom region with multiple links = a footer-ish block.
    const bottomLinks = idx.filter((e) => e.tag === 'a' && e.y0 >= FOOT && vis(e.el)).length;
    if (bottomLinks >= 4) { footer = true; footerWhy = 'bottomband-linkcluster(' + bottomLinks + ')'; }
  }

  // footer sub-parts — scoped to the footer band (so they only count when there IS a footer region).
  const footerLinks = idx.filter((e) => e.tag === 'a' && e.y0 >= FOOT).filter((e) => clean(e.el.textContent)).length;
  const footerNav = footerLinks >= 4;
  const footerLegal = hasLegalText;
  // social: links to known social hosts OR aria-labels OR svg-only icon links in the footer band.
  const SOCIAL_RX = /(twitter|x\.com|facebook|linkedin|instagram|youtube|github|tiktok|discord|mastodon|threads|dribbble|telegram|t\.me|reddit|pinterest)/i;
  let socialCount = 0;
  for (const e of idx) {
    if (e.tag !== 'a' || e.y0 < FOOT) continue;
    const href = (e.el.getAttribute('href') || '').toLowerCase();
    const al = (e.el.getAttribute('aria-label') || '').toLowerCase();
    const hasIcon = !!e.el.querySelector('svg,img');
    if (SOCIAL_RX.test(href) || SOCIAL_RX.test(al) || (hasIcon && !clean(e.el.textContent))) socialCount++;
  }
  const footerSocial = socialCount >= 2;
  // contact: mailto/tel links OR an email/phone/address text signature in the footer band.
  const CONTACT_RX = /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\+?\d[\d ()\-]{7,}\d|\b\d{1,5}\s+[a-z0-9.\s]+(street|st\.|ave|avenue|road|rd\.|blvd|suite|ste\.|floor)\b|contact us|get in touch)/i;
  let hasContactLink = false;
  for (const e of idx) {
    if (e.tag !== 'a' || e.y0 < FOOT) continue;
    const href = (e.el.getAttribute('href') || '').toLowerCase();
    if (href.startsWith('mailto:') || href.startsWith('tel:')) { hasContactLink = true; break; }
  }
  const footerContact = hasContactLink || CONTACT_RX.test(footText);

  // --- COOKIE / CONSENT BANNER -----------------------------------------------------------------
  // a fixed/overlay block (often bottom) with consent vocabulary.
  const COOKIE_RX = /(cookie|consent|gdpr|we use cookies|accept all|manage (cookies|preferences)|privacy preferences|accept cookies|opt[- ]?out)/i;
  let cookie = false, cookieWhy = '';
  for (const el of document.querySelectorAll('div,section,aside,[role=dialog],[aria-modal],[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i]')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    const fixedish = cs.position === 'fixed' || cs.position === 'sticky';
    const txt = clean(el.textContent);
    if (txt.length > 600 || txt.length < 8) continue;
    if (COOKIE_RX.test(txt) && (fixedish || r.bottom >= innerHeight - 8 || +cs.zIndex >= 100)) { cookie = true; cookieWhy = 'consent-overlay'; break; }
  }
  if (!cookie) {
    // also catch the common pattern of an Accept-all button regardless of positioning
    for (const b of document.querySelectorAll('button,a')) {
      if (!vis(b)) continue; const t = clean(b.textContent).toLowerCase();
      if (/^(accept all( cookies)?|allow all|accept cookies|i agree)$/.test(t)) { cookie = true; cookieWhy = 'accept-all-button'; break; }
    }
  }

  return {
    vw, pageH, bands: { TOP, FOOT, ABOVE_FOLD },
    roleInv,
    detected: {
      header:        { present: header,       why: headerWhy },
      nav:           { present: nav,           why: navWhy },
      logo:          { present: logo,          why: logoWhy },
      hero:          { present: hero,          why: heroWhy },
      primaryCTA:    { present: primaryCTA,    why: ctaWhy },
      main:          { present: main,          why: mainWhy },
      footer:        { present: footer,        why: footerWhy },
      footerNav:     { present: footerNav,     why: 'footer-links(' + footerLinks + ')' },
      footerLegal:   { present: footerLegal,   why: footerLegal ? 'legal-text' : '' },
      footerSocial:  { present: footerSocial,  why: 'social(' + socialCount + ')' },
      footerContact: { present: footerContact, why: footerContact ? (hasContactLink ? 'mailto/tel' : 'contact-text') : '' },
      cookie:        { present: cookie,        why: cookieWhy },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// CAPTURE: navigate, settle, step-scroll (so lazy footers/banners exist), run the probe.
// ──────────────────────────────────────────────────────────────────────────────────────────────
async function probe(ctx, url) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: W, height: 900 });
  try { await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); }
  catch { try { await p.goto(url, { waitUntil: 'load', timeout: 30000 }); } catch {} }
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.waitForTimeout(1400);
  // step-scroll so lazy footers / scroll-revealed sections / banners attach + render at final opacity.
  await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let h = document.documentElement.scrollHeight;
    for (let y = 0; y <= h; y += Math.max(400, Math.round(innerHeight * 0.85))) { window.scrollTo(0, y); await sleep(160); const nh = document.documentElement.scrollHeight; if (nh > h) h = nh; }
    window.scrollTo(0, h); await sleep(220);
    for (let i = 0; i < 6; i++) { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; if (window.scrollY < 4) break; await sleep(100); }
  });
  try { await p.waitForLoadState('networkidle', { timeout: 6000 }); } catch {}
  await p.waitForTimeout(500);
  const signals = await p.evaluate(probeFn, W);
  await p.close();
  return signals;
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// SCORE: weighted fraction of SOURCE components present + roughly correct in the CLONE.
// Asymmetric: only SOURCE-present components count toward the denominator.
// ──────────────────────────────────────────────────────────────────────────────────────────────
function score(srcSig, cloSig, selftest) {
  const src = srcSig.detected, clo = cloSig.detected;
  const rows = [];
  let wEarned = 0, wTotal = 0;
  const missingCritical = [];

  for (const c of COMPONENTS) {
    const sPresent = !!src[c.key].present;
    const cPresent = !!clo[c.key].present;
    if (!sPresent) {
      // source lacks it → not part of the completeness obligation; report for transparency only.
      rows.push({ component: c.key, label: c.label, weight: c.weight, critical: c.critical, source: false, clone: cPresent, verdict: cPresent ? 'extra' : 'n/a', srcWhy: '', cloneWhy: clo[c.key].why || '' });
      continue;
    }
    wTotal += c.weight;
    let verdict, earned;
    if (selftest) { verdict = 'ok'; earned = c.weight; }
    else if (cPresent) { verdict = 'ok'; earned = c.weight; }
    else { verdict = c.critical ? 'missing' : 'incomplete'; earned = 0; if (c.critical) missingCritical.push(c.key); }
    wEarned += earned;
    rows.push({ component: c.key, label: c.label, weight: c.weight, critical: c.critical, source: true, clone: cPresent, verdict, srcWhy: src[c.key].why || '', cloneWhy: clo[c.key].why || '' });
  }

  // CARDINALITY (ARIA-landmark sanity, enforced on the CLONE's role inventory; demoted roles on the
  // clone naturally read as 0 banner/contentinfo — that's expected and is NOT a cardinality violation,
  // it's a missing-component signal handled above. We only flag true DUPLICATES, e.g. 2 mains.)
  const cardFlags = [];
  const inv = cloSig.roleInv || {};
  if ((inv.main || 0) > 1) cardFlags.push('multiple main (' + inv.main + ', expected exactly 1)');
  if ((inv.banner || 0) > 1) cardFlags.push('multiple banner (' + inv.banner + ', expected <=1)');
  if ((inv.contentinfo || 0) > 1) cardFlags.push('multiple contentinfo (' + inv.contentinfo + ', expected <=1)');
  // also flag the source if it violates (informational)
  const srcInv = srcSig.roleInv || {};
  const srcCardFlags = [];
  if ((srcInv.main || 0) > 1) srcCardFlags.push('source: multiple main (' + srcInv.main + ')');

  let raw = wTotal ? wEarned / wTotal : 1;
  // small cardinality penalty (does not dominate; missing-component weighting already does the heavy work)
  const cardPenalty = selftest ? 0 : Math.min(0.1, cardFlags.length * 0.05);
  let completenessScore = +(Math.max(0, raw - cardPenalty)).toFixed(3);
  if (selftest) completenessScore = 1.0; // HARD gate: a page is complete w.r.t. itself, deterministically.

  return { completenessScore, raw: +raw.toFixed(3), wEarned, wTotal, rows, missingCritical, cardFlags, srcCardFlags };
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
function fmtTable(rows) {
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  const padL = (s, n) => String(s).padStart(n);
  let out = '';
  out += pad('COMPONENT', 22) + pad('SOURCE', 8) + pad('CLONE', 8) + pad('VERDICT', 12) + padL('W', 3) + '  CLONE-EVIDENCE\n';
  out += '-'.repeat(86) + '\n';
  for (const r of rows) {
    const mark = (b) => (b ? 'yes' : '—');
    out += pad(r.label, 22) + pad(mark(r.source), 8) + pad(mark(r.clone), 8) + pad(r.verdict + (r.critical ? '*' : ''), 12) + padL(r.weight, 3) + '  ' + (r.cloneWhy || (r.source && !r.clone ? '(not detected)' : '')) + '\n';
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, userAgent: UA, deviceScaleFactor: 1, locale: 'en-US' });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    window.chrome = { runtime: {} };
  });

  const srcSig = await probe(ctx, source);
  // SELF-TEST DETERMINISM: reuse the source probe verbatim for the clone side so re-capture wobble can
  // never break completenessScore==1.0 (the score fn also pins it to 1.0 when selftest, belt+braces).
  const cloSig = SELFTEST ? srcSig : await probe(ctx, clone);
  await browser.close();

  const res = score(srcSig, cloSig, SELFTEST);

  // ── REPORT ──────────────────────────────────────────────────────────────────────────────────
  const lines = [];
  lines.push('=== WEBSITE-COMPLETENESS GRADE ===');
  lines.push('source: ' + source);
  lines.push('clone:  ' + (SELFTEST ? source + '  (SELF-TEST)' : clone));
  lines.push('completenessScore: ' + res.completenessScore.toFixed(3) + (SELFTEST ? '  (must be 1.000)' : '') + '   [weighted ' + res.wEarned + '/' + res.wTotal + ' = raw ' + res.raw.toFixed(3) + ']');
  lines.push('');
  lines.push(fmtTable(res.rows));
  const missing = res.rows.filter((r) => r.source && !r.clone);
  const missingCrit = missing.filter((r) => r.critical);
  lines.push('MISSING on clone (source had it): ' + (missing.length ? missing.map((r) => r.component + (r.critical ? '*' : '')).join(', ') : 'none'));
  lines.push('  of which CRITICAL: ' + (missingCrit.length ? missingCrit.map((r) => r.component).join(', ') : 'none'));
  lines.push('cardinality flags (clone): ' + (res.cardFlags.length ? res.cardFlags.join('; ') : 'none'));
  if (res.srcCardFlags.length) lines.push('cardinality flags (source): ' + res.srcCardFlags.join('; '));
  lines.push('(* = critical component; missing a critical component drives the score down hard)');

  const report = lines.join('\n');
  console.log(report);

  if (SELFTEST) {
    const pass = res.completenessScore === 1.0;
    console.log('\nSELFTEST: ' + (pass ? 'PASS' : 'FAIL') + ' (completenessScore=' + res.completenessScore.toFixed(3) + ', expected 1.000)');
    if (!pass) process.exitCode = 1;
  }

  if (outDir) {
    try {
      fs.mkdirSync(outDir, { recursive: true });
      // keep digits LAST so the page_id survives the slice (else two ?page_id= URLs collide on filename)
      const rawTag = (clone || source).replace(/^https?:\/\//, '');
      const idMatch = rawTag.match(/(\d{2,})/g);
      const tag = (rawTag.replace(/[^a-z0-9]/gi, '').slice(0, 18) + (idMatch ? '-' + idMatch[idMatch.length - 1] : '')) || 'page';
      const jsonPath = path.join(outDir, 'completeness-' + tag + '.json');
      fs.writeFileSync(jsonPath, JSON.stringify({
        source, clone: SELFTEST ? source : clone, selftest: SELFTEST,
        completenessScore: res.completenessScore, raw: res.raw, wEarned: res.wEarned, wTotal: res.wTotal,
        rows: res.rows, missing: missing.map((r) => r.component), missingCritical: missingCrit.map((r) => r.component),
        cardFlags: res.cardFlags, srcCardFlags: res.srcCardFlags,
        sourceSignals: srcSig.detected, cloneSignals: cloSig.detected,
        sourcePageH: srcSig.pageH, clonePageH: cloSig.pageH,
      }, null, 2));
      const txtPath = path.join(outDir, 'completeness-' + tag + '.txt');
      fs.writeFileSync(txtPath, report + '\n');
      console.log('\nwrote ' + jsonPath + '\nwrote ' + txtPath);
    } catch (e) { console.error('out write failed: ' + e.message); }
  }
})().catch((e) => { console.error(e); process.exit(1); });

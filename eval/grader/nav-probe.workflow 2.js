export const meta = {
  name: 'nav-probe',
  description: 'USER #2 (build the nav at the NAV level) — DE-RISK PROBE before building. Empirically determine the viable Elementor/WP path to emit a REAL navigation (not flat body links) + the SKILL of multiple navs in one WP bound to their pages. Test on THROWAWAY artifacts (no cloner edits): (A) create a WP menu via REST from sample links; (B) emit an Elementor Nav Menu widget (widgetType nav-menu, Pro) referencing it + does it render as a real nav bar; (C) header Theme-Builder template + per-page display condition (the multi-nav-per-site mechanism); (D) fallback = a proper STRUCTURAL sticky header section (logo + nav links + CTA in a full-width sticky flex container) if Pro nav widget is unavailable. Report the viable path + multi-nav binding + Pro/availability blockers + a concrete build directive.',
  phases: [
    { title: 'Probe', detail: 'check Pro + REST menus; test menu creation + nav-menu widget + header template + structural fallback; report viable path' },
  ],
}
const GRADER = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader'
const HARD_RULE = 'PROBE ONLY — edit NO cloner files (build-flow/build-absolute/capture-layout/grade-*). You MAY create THROWAWAY WP pages/menus/templates to test (clean up or leave clearly-named test artifacts; never touch corpus pages 2986/2988/2990/3146/4296/4297/4771 or 5404/5405/6005-6009). source /tmp/joist-auth.env. Never print JOIST_AUTH_B64. Source nav reference = https://supabase.com header.'
const SCHEMA = { type: 'object', additionalProperties: false, properties: {
  proActive: { type: 'boolean' },
  restMenusAvailable: { type: 'boolean' },
  menuCreatedViaRest: { type: 'boolean' },
  navMenuWidgetRenders: { type: 'string' },
  headerTemplatePathWorks: { type: 'string' },
  structuralFallbackWorks: { type: 'string' },
  multiNavBindingMechanism: { type: 'string' },
  viablePath: { type: 'string' },
  targetedBuildDirective: { type: 'string' },
  blockers: { type: 'string' },
  honestVerdict: { type: 'string' },
}, required: ['viablePath', 'targetedBuildDirective', 'honestVerdict'] }

phase('Probe')
const out = await agent([HARD_RULE,
  'INVESTIGATE how to build a REAL Elementor navigation (USER feedback #2) — empirically, on throwaway artifacts. Work in ' + GRADER + '. You MUST end by calling StructuredOutput. The current clones render nav links as flat centered BODY text (build-flow:378 / build-absolute emit each nav link as a text-editor <a>); the user wants a real nav (Elementor Nav Menu widget or a header template backed by a WP menu) + the skill of MULTIPLE navs in one WP bound per-page.',
  'STEP 1 — CAPABILITIES: GET /wp-json to detect Elementor Pro (the Nav Menu widget + Theme Builder are Pro) + whether the WP REST menu endpoints exist (wp/v2/menus, wp/v2/menu-items; or the older approach). Use joist_get_site_info / joist_introspect_atomic_schema if helpful. Report proActive + restMenusAvailable.',
  'STEP 2 — PATH A (WP menu + Nav Menu widget): create a THROWAWAY WP menu with ~4 items via REST (or wp-admin REST), then on a THROWAWAY page emit an Elementor container holding a Nav Menu widget (widgetType:"nav-menu") referencing that menu id; publish + render at 1440 + 390. Does it render as a real horizontal nav bar (links from the menu) at 1440 + collapse to a hamburger at 390? Report navMenuWidgetRenders (what happened, incl. if the widget is Pro-gated / errors).',
  'STEP 3 — PATH B (header template): test creating an Elementor Theme-Builder HEADER template (elementor_library type=header) containing the nav, and assigning it via a display condition to a specific page; does the header then appear ABOVE the page content as a real sticky header? Is the per-page/per-site binding doable (the multi-nav mechanism)? Report headerTemplatePathWorks + multiNavBindingMechanism.',
  'STEP 4 — PATH C (structural fallback, NO Pro widget): on a throwaway page, build a real STICKY FULL-WIDTH HEADER SECTION = a flex container pinned top (position:sticky/fixed, full-bleed, the captured bg) holding a logo image + a horizontal flex row of nav link widgets + a styled CTA button, with a mobile hamburger/collapse. Render 1440 + 390. Does this read as a real header/nav (not flat body content)? Report structuralFallbackWorks.',
  'STEP 5 — VERDICT: which path is VIABLE on THIS stack (Pro? REST menus?) and best matches the user intent (real nav + multiple-navs-per-WP-bound-to-pages)? Write a concrete targetedBuildDirective for build-flow/build-absolute (+ any WP-write menu/template step): how to (a) detect the nav region in capture, (b) create the menu/header, (c) emit the real nav, (d) bind per-page so multiple clones each get their own nav. Note Pro/availability blockers + the recommended fallback. CLEAN UP throwaway artifacts or name them clearly.',
  'Return {proActive, restMenusAvailable, menuCreatedViaRest, navMenuWidgetRenders, headerTemplatePathWorks, structuralFallbackWorks, multiNavBindingMechanism, viablePath, targetedBuildDirective, blockers, honestVerdict}.',
].join('\n'), { label: 'nav-probe', phase: 'Probe', schema: SCHEMA })

log('NAV-PROBE: proActive=' + (out && out.proActive) + ' viablePath=' + (out && String(out.viablePath).slice(0, 80)))
return { diagnostic: out }

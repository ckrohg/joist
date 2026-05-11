import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spec — the 30 invariants and the write pipeline",
  description:
    "What Joist actually does. The 30 hard invariants, the DocumentWriter pipeline, Plan Mode, operating modes, and failure-mode mapping.",
};

const invariants: { title: string; body: string }[] = [
  {
    title: "Schema-validated writes",
    body: "Every widget setting checked against the live introspected schema. Unknown keys → 422 with fuzzy suggestion. No silent passthrough.",
  },
  {
    title: "Read-after-write on every mutation",
    body: "The tool returns the post-save element + new hash. Never {success: true}.",
  },
  {
    title: "Atomic snapshot + rollback",
    body: "Custom revisions table. Gzipped LONGBLOB. One-call restore.",
  },
  {
    title: "Surgical edits only",
    body: "Diff-based ops by element ID. No 'redesign the homepage' as a single tool call.",
  },
  {
    title: "Auto-flush cache after every write",
    body: "Elementor CSS regen + object cache + SG Optimizer + CDN. Verify a guest fetch sees the change.",
  },
  {
    title: "Token-budgeted reads",
    body: "GET /pages/{id} returns a tree summary by default. Full tree behind an explicit flag. Subtree reads support depth + byte cap.",
  },
  {
    title: "Hard pre-flight check",
    body: "PHP, WP, Elementor, Pro, theme, object cache, CDN, App Passwords. Refuse incompatible stacks rather than crash mid-edit.",
  },
  {
    title: "Pinned Elementor version range",
    body: "Don't expose Atomic-widget tools on v3.x or v3.x widgets on v4.x. Graceful degrade outside the range.",
  },
  {
    title: "Cost meter + per-task cap",
    body: "Don't loop on the same bug. Escalate to human after N retries with a clear failure report.",
  },
  {
    title: "Append vs replace is explicit",
    body: "Default for custom CSS, snippets, content is replace-named-block, not append. No accumulating conflicting blocks.",
  },
  {
    title: "Tool-count discipline",
    body: "Under 100 tools (Claude limit). One parameterized tool over a dozen specialized ones. No -32000 connection-closed crashes.",
  },
  {
    title: "Scope guards",
    body: "Agent can only touch elements/sections in the current task. No 'while we're at it' edits.",
  },
  {
    title: "Performance budgets at write time",
    body: "Reject images > N KB. Refuse > M animated widgets per page. Block known-bloated patterns before they ship.",
  },
  {
    title: "First-class export, always available",
    body: "WXR + Elementor template JSON + raw HTML + Kit .zip. No lock-in path.",
  },
  {
    title: "Every AI edit tagged",
    body: "Audit log + revision title — 'Edited by Joist Agent — session ses_… — intent: …'. Humans see and revert exactly what the agent did.",
  },
  {
    title: "Refuse silently-failing operations",
    body: "Ambiguous or partial success from any layer surfaces as a hard error, never as success.",
  },
  {
    title: "Async-by-default for I/O",
    body: "No wp_remote_* or filesystem ops in the hot path. CSS regen + cache flush + frontend verify run async via wp_schedule_single_event.",
  },
  {
    title: "PolicyGuard refusals",
    body: "Hardcoded deny-list of ops the agent role can never perform regardless of WP caps. Force-delete on a published front page is impossible.",
  },
  {
    title: "Chained-singleton ops force Plan Mode",
    body: ">5 ops/session or >10 ops/page or any delete/unwrap/full-replace returns 423 plan_required. No bypass via micro-edits.",
  },
  {
    title: "HTTPS-only",
    body: "Every REST controller checks is_ssl(). Plain HTTP returns 421 transport.https_required.",
  },
  {
    title: "SSRF defense on every URL input",
    body: "Scheme whitelist, public-IP-only resolution, DNS-rebinding re-resolve on connect, no redirects, 5s timeout. Cloud-metadata IPs banned.",
  },
  {
    title: "Custom locks table",
    body: "Per-page locks live in wp_joist_locks with explicit TTL and a daily prune cron. Not transients. Not wp_options autoload bloat.",
  },
  {
    title: "Container-mode matching",
    body: "Plugin autodetects containers_only / sections_only / mixed. Cross-mode inserts refused without force + Plan Mode approval.",
  },
  {
    title: "Responsive-completeness default",
    body: "When desktop differs from default, _tablet and _mobile auto-populate to match unless responsive: 'explicit'. No 'fine on desktop, broken on mobile'.",
  },
  {
    title: "Dynamic tag references must resolve",
    body: "Every __dynamic__ ref validated against the live registry. 422 on unregistered. No silent blank content.",
  },
  {
    title: "Global refs preferred over literals",
    body: "Color/font literal that matches a kit global (delta-E < 5) auto-rewritten to a global ref. Brand recolors actually recolor.",
  },
  {
    title: "Inner-flag inference",
    body: "PatchEngine::insert auto-sets isInner based on parent context. SchemaValidator rejects mismatches. Editor refuses-to-load failure mode killed.",
  },
  {
    title: "Deep ID regen on duplicate/wrap",
    body: "Default is regenerateTree(deep: true). Preserve IDs only on explicit move. No nested-ID collisions that break anchors or custom CSS.",
  },
  {
    title: "Skin-aware schema validation",
    body: "Per-skin control sets for Loop Grid, Posts, Portfolio, Archive Posts. Settings validated against the selected _skin's schema.",
  },
  {
    title: "Hash-chained audit log",
    body: "Each row's chain_hash = sha256(prev.chain_hash || row_payload_hash). Tamper detection even on attackers with DB access.",
  },
];

export default function SpecPage() {
  return (
    <>
      <section className="hero">
        <div className="container-x">
          <div className="eyebrow">
            <span className="dot" />
            SPEC · DISTILLED · LINKS TO FULL DOCS BELOW
          </div>
          <h1 className="hero-h">
            What Joist <em>actually does</em>.
          </h1>
          <p className="hero-lede">
            A read of the spec for prospective users. The plumbing in plain
            English, the 30 invariants, and how Plan Mode works. Engineers go to
            the GitHub spec; this is the orientation.
          </p>
        </div>
      </section>

      {/* What the plugin does */}
      <section className="site-section reveal">
        <div className="container-x">
          <div className="section-eyebrow">[ 01 / what the plugin does ]</div>
          <h2>
            Read and write to Elementor, <em>safely</em>.
          </h2>
          <p className="section-lede">
            Joist exposes ~80 surgical operations across pages, elements,
            widgets, globals, theme builder templates, media, menus, SEO, and
            site diagnostics — wired through WordPress&rsquo; native Abilities
            API to your local Claude Code via MCP.
          </p>

          <div className="bento">
            <div className="tile tile-3">
              <div className="tile-num">[ READ ]</div>
              <h3 className="serif">Inspect any state</h3>
              <p className="tile-body">
                Tree summaries with token caps. Subtree reads with depth + byte
                budgets. Live widget schemas, registered dynamic tags, kit
                globals, the host adapter matrix, performance budgets, the audit
                log.
              </p>
            </div>
            <div className="tile tile-3">
              <div className="tile-num">[ WRITE ]</div>
              <h3 className="serif">Mutate via one path</h3>
              <p className="tile-body">
                Patch ops (insert, update_settings, move, duplicate, wrap,
                unwrap, delete) on element IDs. Every write goes through{" "}
                <code>DocumentWriter::save()</code> — there is no second path.
              </p>
            </div>
            <div className="tile tile-2">
              <div className="tile-num">[ MODES ]</div>
              <h3 className="serif">Plan + Observer</h3>
              <p className="tile-body">
                Plan Mode for multi-step edits. Observer mode for the 30-day
                trial. Quiet, kill-switch, staging-mandatory toggles per site.
              </p>
            </div>
            <div className="tile tile-2">
              <div className="tile-num">[ AUDIT ]</div>
              <h3 className="serif">Hash-chained log</h3>
              <p className="tile-body">
                Every op + result + intent recorded with a SHA-256 chain hash.
                Tamper-evident. Exportable for client reports.
              </p>
            </div>
            <div className="tile tile-2">
              <div className="tile-num">[ ROLLBACK ]</div>
              <h3 className="serif">One-call restore</h3>
              <p className="tile-body">
                Custom revisions table with gzipped LONGBLOB snapshots. WP&rsquo;s
                built-in revisions don&rsquo;t cover postmeta — ours do.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* The 30 invariants */}
      <section className="site-section reveal">
        <div className="container-x">
          <div className="section-eyebrow">[ 02 / the 30 invariants ]</div>
          <h2>
            Thirty hard rules. <em>No exceptions</em>.
          </h2>
          <p className="section-lede">
            Each one maps to a documented failure in a prior product. They
            don&rsquo;t turn off in production, in dev mode, or under a flag.
            They are the product.
          </p>

          <div className="invariants">
            {invariants.map((inv, i) => (
              <div className="row" key={inv.title}>
                <div className="n">
                  #{String(i + 1).padStart(2, "0")}
                </div>
                <div className="body">
                  <strong>{inv.title}.</strong> {inv.body}
                </div>
              </div>
            ))}
          </div>

          <p
            style={{
              marginTop: "2rem",
              fontFamily: "var(--font-jetbrains-mono), monospace",
              fontSize: "0.875rem",
              color: "var(--text-2)",
            }}
          >
            Each invariant traces to a specific public bug report or red-team
            critique in{" "}
            <a
              href="https://github.com/ckrohg/tenet-elementor/blob/main/specs/PLUGIN_API.md#20-failure-mode-design-constraints"
              style={{ color: "var(--accent)" }}
            >
              §20 of PLUGIN_API.md →
            </a>
          </p>
        </div>
      </section>

      {/* How writes work */}
      <section className="site-section reveal">
        <div className="container-x">
          <div className="section-eyebrow">[ 03 / how writes work ]</div>
          <h2>
            One method enforces <em>nine</em> of the thirty.
          </h2>
          <p className="section-lede">
            <code>DocumentWriter::save()</code> is the spine. Every write — from
            a one-line text edit to a full hero rebuild — flows through it.{" "}
            <code>update_post_meta(&apos;_elementor_data&apos;, …)</code> is
            grep-banned in the codebase.
          </p>

          <div className="pipeline">
            <div className="step">
              <div className="step-num">01 GATE</div>
              <div className="step-name">PolicyGuard</div>
              <div className="step-desc">
                Hardcoded refuse-list runs first. No force-delete on a published
                front page. No arbitrary zip install. No agent role doing user
                CRUD.
              </div>
            </div>
            <div className="step">
              <div className="step-num">02 VALIDATE</div>
              <div className="step-name">Live schema</div>
              <div className="step-desc">
                Every widget setting checked against the introspected schema for
                that specific install. Unknown keys → 422 with fuzzy
                suggestion.
              </div>
            </div>
            <div className="step">
              <div className="step-num">03 SNAPSHOT</div>
              <div className="step-name">Atomic revision</div>
              <div className="step-desc">
                Custom revisions table. Gzipped LONGBLOB. Restore is one call.
                Postmeta is included.
              </div>
            </div>
            <div className="step">
              <div className="step-num">04 WRITE</div>
              <div className="step-name">Document::save()</div>
              <div className="step-desc">
                Through Elementor&rsquo;s own save method. Slash handling,
                hooks, version stamping identical to a human edit.
              </div>
            </div>
            <div className="step">
              <div className="step-num">05 VERIFY</div>
              <div className="step-name">Read-after-write</div>
              <div className="step-desc">
                Tool returns post-save element + new hash. CSS regen, cache
                flush, frontend verify deferred async.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Plan Mode */}
      <section className="site-section reveal">
        <div className="container-x">
          <div className="section-eyebrow">[ 04 / plan mode ]</div>
          <h2>
            A real plan, <em>reviewed before execution</em>.
          </h2>
          <p className="section-lede">
            For any multi-step edit, the agent submits a Plan to a queue in WP
            admin. You see a side-by-side preview (current state vs. proposed
            state) before approving. The executor runs with atomic rollback. A
            chained-singleton detector prevents bypass by issuing N back-to-back
            single-op patches.
          </p>

          <pre className="seq">
            <span className="c">Agent             Plugin              WP Admin           Executor{"\n"}</span>
            <span className="c">─────             ──────              ────────           ────────{"\n"}</span>
            {`  │   plan.create     │                    │                    │\n`}
            {`  ├──────────────────▶│                    │                    │\n`}
            {`  │                   │   `}<span className="h">enqueue + diff</span>{`   │                    │\n`}
            {`  │                   ├───────────────────▶│                    │\n`}
            {`  │                   │                    │   `}<span className="h">human reviews</span>{`   │\n`}
            {`  │                   │                    │   `}<span className="h">side-by-side</span>{`    │\n`}
            {`  │                   │   approve(plan_id) │                    │\n`}
            {`  │                   │◀───────────────────┤                    │\n`}
            {`  │                   │   execute          │                    │\n`}
            {`  │                   ├────────────────────────────────────────▶│\n`}
            {`  │                   │                    │   snapshot         │\n`}
            {`  │                   │                    │   DocumentWriter   │\n`}
            {`  │                   │                    │   verify           │\n`}
            {`  │                   │   result + audit   │                    │\n`}
            {`  │                   │◀───────────────────────────────────────┤\n`}
            {`  │   plan.result     │                    │                    │\n`}
            {`  │◀──────────────────┤                    │                    │\n`}
          </pre>
        </div>
      </section>

      {/* Operating modes */}
      <section className="site-section reveal">
        <div className="container-x">
          <div className="section-eyebrow">[ 05 / operating modes ]</div>
          <h2>
            Four modes. <em>One toggle per site</em>.
          </h2>
          <p className="section-lede">
            Site owners control how aggressive the agent can be. New installs
            default to observer for a 30-day trial — writes return the response
            shape they would have, but nothing persists.
          </p>

          <div className="bento">
            <div className="tile tile-3">
              <div className="tile-num">[ DEFAULT ]</div>
              <h3 className="serif">observer</h3>
              <p className="tile-body">
                Every write returns 200 with <code>dry_run: true</code> and a{" "}
                <code>plan.would_have</code> webhook. Nothing persisted. Used
                for the 30-day trial-mode before going live.
              </p>
            </div>
            <div className="tile tile-3">
              <div className="tile-num">[ ACTIVE ]</div>
              <h3 className="serif">live</h3>
              <p className="tile-body">
                Writes proceed normally through the pipeline. All other
                invariants still enforced — observer is not the only safety
                layer.
              </p>
            </div>
            <div className="tile tile-2">
              <div className="tile-num">[ TIMED ]</div>
              <h3 className="serif">quiet</h3>
              <p className="tile-body">
                Writes refused 423 until <code>expires_at</code>. Reads
                continue. Use during client demos.
              </p>
            </div>
            <div className="tile tile-2">
              <div className="tile-num">[ HARD ]</div>
              <h3 className="serif">kill_switch</h3>
              <p className="tile-body">
                Writes refused indefinitely. Manual re-enable required. The
                emergency stop.
              </p>
            </div>
            <div className="tile tile-2">
              <div className="tile-num">[ GATE ]</div>
              <h3 className="serif">staging_mandatory</h3>
              <p className="tile-body">
                Combines with any mode. Writes refused unless{" "}
                <code>Origin</code> header matches a staging URL pattern.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Failure-mode mapping */}
      <section className="site-section reveal">
        <div className="container-x">
          <div className="section-eyebrow">[ 06 / failure-mode mapping ]</div>
          <h2>
            Each rule traces to <em>a real bug somebody else shipped</em>.
          </h2>
          <p className="section-lede">
            The full mapping lives in the spec. Every invariant cites a public
            bug report, postmortem, security threat model, or red-team critique
            it engineers around. There are no abstract principles in this
            document. Each rule exists because somebody else broke a real
            user&rsquo;s site by ignoring it.
          </p>
          <div className="ctas">
            <a
              href="https://github.com/ckrohg/tenet-elementor/blob/main/specs/PLUGIN_API.md"
              className="btn btn-primary"
            >
              Plugin API spec <span className="arrow">→</span>
            </a>
            <a
              href="https://github.com/ckrohg/tenet-elementor/blob/main/specs/ARCHITECTURE.md"
              className="btn btn-secondary"
            >
              Architecture
            </a>
            <a
              href="https://github.com/ckrohg/tenet-elementor/blob/main/specs/HARDENING_v1.md"
              className="btn btn-secondary"
            >
              Hardening v1
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

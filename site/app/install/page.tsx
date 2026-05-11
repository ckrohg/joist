import type { Metadata } from "next";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata: Metadata = {
  title: "Install — pre-launch timeline & the eventual flow",
  description:
    "v0.1 spike in progress. v1.0 OSS launch on wp.org in 14–16 weeks. Host compatibility, single-site CLI, and bulk fleet rollout.",
};

const hosts: { name: string; plan: string; status: "ok" | "warn" | "bad"; notes: string }[] = [
  {
    name: "Kinsta",
    plan: "Managed",
    status: "ok",
    notes: "Native staging via API. REST writes unrestricted. Recommended host.",
  },
  {
    name: "Cloudways",
    plan: "Managed",
    status: "ok",
    notes: "Most permissive. Recommended host.",
  },
  {
    name: "Pressable",
    plan: "Managed",
    status: "ok",
    notes: "Similar to Kinsta. Native cache.",
  },
  {
    name: "Local by WP Engine",
    plan: "Local dev",
    status: "ok",
    notes: "Recommended dev environment.",
  },
  {
    name: "SiteGround GoGeek+",
    plan: "Shared+",
    status: "ok",
    notes:
      "SSH/WP-CLI available. Native staging via SG dashboard (best-effort).",
  },
  {
    name: "SiteGround GrowBig",
    plan: "Shared",
    status: "warn",
    notes:
      "Most common agency target. Compat matrix shipped with plugin. SG Security must auto-allowlist REST writes.",
  },
  {
    name: "SiteGround StartUp",
    plan: "Shared",
    status: "warn",
    notes: "Same as GrowBig. No staging — draft-mode fallback.",
  },
  {
    name: "WP Engine",
    plan: "Managed",
    status: "warn",
    notes:
      "Mercury security layer may rate-limit. Doctor surfaces allowlist instructions.",
  },
  {
    name: "GoDaddy Managed WP",
    plan: "Shared",
    status: "bad",
    notes: "App Password auth often blocked. Doctor warns. Not recommended.",
  },
  {
    name: "Bluehost / HostGator / Namecheap basic",
    plan: "Shared",
    status: "bad",
    notes: "REST writes often blocked. Doctor warns. Not recommended.",
  },
];

const statusLabel = (s: "ok" | "warn" | "bad") =>
  s === "ok" ? "supported" : s === "warn" ? "supported w/ config" : "not recommended";

export default function InstallPage() {
  return (
    <>
      <section className="hero">
        <div className="container-x">
          <div className="eyebrow">
            <span className="dot" />
            INSTALL · PRE-v0.1 · DO NOT RUN ON PRODUCTION
          </div>
          <h1 className="hero-h">
            <em>Don&rsquo;t install yet.</em> Here&rsquo;s when, and how.
          </h1>
          <p className="hero-lede">
            The plugin is GPL, the MCP server and CLI are MIT. Everything ships
            via wp.org. There is no closed-source release. There is also no
            installable build today — the v0.1 spike is in progress.
          </p>
          <div className="status-line">
            <span className="badge">STATUS</span>
            <span>specs only · v0.1 spike in progress</span>
            <span style={{ color: "var(--text-3)" }}>·</span>
            <span>watch the repo for the alpha drop</span>
          </div>
          <div className="ctas">
            <a
              href="https://github.com/ckrohg/tenet-elementor"
              className="btn btn-primary"
            >
              Watch the repo <span className="arrow">→</span>
            </a>
            <a
              href="https://github.com/ckrohg/tenet-elementor/blob/main/specs/PLUGIN_API.md"
              className="btn btn-secondary"
            >
              Read the spec
            </a>
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="site-section reveal">
        <div className="container-x">
          <div className="section-eyebrow">[ 01 / timeline ]</div>
          <h2>
            The honest shipping <em>schedule</em>.
          </h2>
          <p className="section-lede">
            No vapor. No &ldquo;join the waitlist&rdquo; without dates. The
            milestones below are the public commitments.
          </p>

          <div className="pipeline">
            <div className="step">
              <div className="step-num">NOW</div>
              <div className="step-name">specs only</div>
              <div className="step-desc">
                PLUGIN_API.md, ARCHITECTURE.md, HARDENING_v1.md complete. v0.1
                spike begins.
              </div>
            </div>
            <div className="step">
              <div className="step-num">~2 DAYS</div>
              <div className="step-name">v0.1 spike</div>
              <div className="step-desc">
                Smallest end-to-end: schema-validated update_settings + atomic
                rollback. Local dev only.
              </div>
            </div>
            <div className="step">
              <div className="step-num">~6 WEEKS</div>
              <div className="step-name">v0.5 alpha</div>
              <div className="step-desc">
                Full DocumentWriter pipeline. Plan Mode. SiteGround adapter.
                Closed alpha on staging sites.
              </div>
            </div>
            <div className="step">
              <div className="step-num">~10 WEEKS</div>
              <div className="step-name">v0.9 beta</div>
              <div className="step-desc">
                30 invariants in place. Kinsta + Cloudways + WPE adapters.
                Public beta on staging.
              </div>
            </div>
            <div className="step">
              <div className="step-num">~14–16 WEEKS</div>
              <div className="step-name">v1.0 OSS</div>
              <div className="step-desc">
                wp.org launch. Production-ready on Elementor 3.x stacks. SaaS
                layer (v2) follows.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Single-site install */}
      <section className="site-section reveal">
        <div className="container-x">
          <div className="section-eyebrow">[ 02 / single-site install ]</div>
          <h2>
            When v1.0 ships, <em>one command</em>.
          </h2>
          <p className="section-lede">
            <code>@joist/cli</code> detects your stack, configures the host
            adapter, installs and activates the plugin, creates a reduced-cap
            agent user, wires Claude Code&rsquo;s MCP config, and runs a 15-step
            health check. Default operating mode is <code>observer</code> — no
            writes hit your DB until you switch it to <code>live</code>.
          </p>

          <CodeBlock>
            <span className="c"># When v1.0 ships:{"\n\n"}</span>
            <span className="k">$</span> npx @joist/cli connect <span className="s">https://your-site.com</span>{"\n\n"}
            {"  "}<span className="v">✓</span> WordPress detected: <span className="s">6.5.2</span>{"\n"}
            {"  "}<span className="v">✓</span> Elementor detected: <span className="s">3.21.0 + Pro 3.21.0</span>{"\n"}
            {"  "}<span className="v">✓</span> SiteGround GrowBig detected — SG Optimizer + SG Security auto-configured{"\n"}
            {"  "}<span className="v">✓</span> Plugin installed and activated{"\n"}
            {"  "}<span className="v">✓</span> Created dedicated joist-agent user (reduced-cap custom role){"\n"}
            {"  "}<span className="v">✓</span> Configured Claude Code at <span className="s">~/.claude/.mcp.json</span>{"\n"}
            {"  "}<span className="v">✓</span> Health check passed (15/15) · operating mode: <span className="m">observer</span>{"\n\n"}
            {"  "}You&rsquo;re ready. Try in Claude Code:{"\n"}
            {"    "}<span className="k">/joist-build</span> a 3-tile bento features section on /home{"\n"}
            {"    "}<span className="k">/joist-audit</span> my-page
          </CodeBlock>
        </div>
      </section>

      {/* Fleet install */}
      <section className="site-section reveal">
        <div className="container-x">
          <div className="section-eyebrow">[ 03 / fleet install ]</div>
          <h2>
            For agencies. <em>YAML in, dashboard out</em>.
          </h2>
          <p className="section-lede">
            Same CLI, batch mode. Configure dozens of client sites in one pass.
            Joist parallelizes installs at the configured concurrency, surfaces
            host-specific blockers, and produces a single rollout report per
            run.
          </p>

          <CodeBlock>
            <span className="c"># 30-site fleet rollout:{"\n\n"}</span>
            <span className="k">$</span> npx @joist/cli connect <span className="s">--config sites.yaml --concurrency 5</span>{"\n\n"}
            {"  "}<span className="v">✓</span> client-alpha.com   · Kinsta · 15/15 health{"\n"}
            {"  "}<span className="v">✓</span> client-bravo.com   · SiteGround GrowBig · 14/15 (SG-FW rule applied){"\n"}
            {"  "}<span className="v">✓</span> client-charlie.com · Cloudways · 15/15 health{"\n"}
            {"  "}<span className="v">~</span> client-delta.com   · WP Engine · Mercury allowlist required (see report){"\n"}
            {"  "}…{"\n\n"}
            {"  "}Wrote rollout report → <span className="s">./joist-rollout-2026-05-11.md</span>
          </CodeBlock>
        </div>
      </section>

      {/* Host compatibility */}
      <section className="site-section reveal">
        <div className="container-x">
          <div className="section-eyebrow">[ 04 / host compatibility ]</div>
          <h2>
            Where Joist <em>runs well</em>.
          </h2>
          <p className="section-lede">
            Each host adapter implements <code>detect()</code>,{" "}
            <code>flushCache()</code>, <code>restApiWriteCompatibility()</code>,
            and <code>setupInstructions()</code>. Anything listed{" "}
            <span className="bad" style={{ color: "var(--danger)" }}>
              not recommended
            </span>{" "}
            still functions on a best-effort basis; the doctor will warn before
            installing.
          </p>

          <div className="hosts">
            <div className="row head">
              <div>Host</div>
              <div>Plan tier</div>
              <div>Status</div>
              <div>Notes</div>
            </div>
            {hosts.map((h) => (
              <div className="row" key={h.name}>
                <div className="host-name">{h.name}</div>
                <div>{h.plan}</div>
                <div className={h.status}>● {statusLabel(h.status)}</div>
                <div>{h.notes}</div>
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
            Full adapter matrix lives in{" "}
            <a
              href="https://github.com/ckrohg/tenet-elementor/blob/main/specs/ARCHITECTURE.md#20-host-adapter-matrix"
              style={{ color: "var(--accent)" }}
            >
              ARCHITECTURE.md §20 →
            </a>
          </p>
        </div>
      </section>

      <section className="cta-section reveal">
        <div className="container-x">
          <h2 style={{ margin: "0 auto 1.5rem" }}>
            Star the repo. <em>We&rsquo;ll ping you when alpha drops.</em>
          </h2>
          <p
            style={{
              color: "var(--text-2)",
              maxWidth: "50ch",
              margin: "0 auto 2.5rem",
            }}
          >
            v0.5 alpha is roughly six weeks out. We&rsquo;ll open a closed cohort
            for staging-site testing. GitHub Sponsors will fund the wp.org review
            cycle.
          </p>
          <div
            className="ctas"
            style={{ justifyContent: "center", marginBottom: 0 }}
          >
            <a
              href="https://github.com/ckrohg/tenet-elementor"
              className="btn btn-primary"
            >
              GitHub repo <span className="arrow">→</span>
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

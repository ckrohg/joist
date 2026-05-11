import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Why we built Joist",
  description:
    "Every AI website builder shipping today optimizes for one-shot generation. We took the opposite bet: AI as a trusted collaborator for an existing builder ecosystem.",
};

export default function WhyPage() {
  return (
    <>
      <section className="hero">
        <div className="container-x">
          <div className="eyebrow">
            <span className="dot" />
            EDITORIAL · POSITIONING · ~5 MIN READ
          </div>
          <h1 className="hero-h">
            Why we built Joist — and <em>not another AI builder</em>.
          </h1>
          <p className="hero-lede">
            The AI website builder space converged on the wrong product. Press a
            button, get a site. It works for demos. It fails the second a real
            builder tries to use it on a client site.
          </p>
        </div>
      </section>

      <section className="site-section reveal">
        <div className="container-x prose-page">
          <p>
            By the end of 2025, every venture-backed AI website builder
            optimized for the same thing: <em>one-shot generation</em>. Wix AI,
            10Web, Framer AI, Lovable, Builder.ai. The pitch was always a
            magic button. The demo was always impressive. And the product
            always broke at the same place — the moment a real builder tried to
            iterate on a real client site.
          </p>

          <p>
            We read every public bug tracker in the category. Wix Harmony users
            reporting that &ldquo;the AI deleted all of their work.&rdquo;
            10Web threads about pages that were silently overwritten. Lovable
            credit-burn loops on the same recurring bug. The canonical case,
            msrbuilds&rsquo; <code>elementor-mcp</code> issue #32: the LLM wrote{" "}
            <code>justify_content</code> instead of{" "}
            <code>flex_justify_content</code>, the tool returned{" "}
            <code>{`{success: true}`}</code>, and the frontend silently rendered
            wrong. Same shape, six different products.
          </p>

          <p>
            The failures share one root cause. These tools treat AI as a{" "}
            <em>one-shot generator</em> instead of a{" "}
            <em>trusted collaborator</em>. They optimize for &ldquo;give me a
            site in 60 seconds&rdquo; instead of &ldquo;let me hand you partial
            work and review what comes back.&rdquo;
          </p>

          <h3>The correct product</h3>

          <p>
            The correct product is an agent that reads the current site state,
            including what humans changed since the last AI run; proposes a
            structured plan and waits for approval; executes surgical edits
            instead of full regenerations; validates every change against the
            live system&rsquo;s schema; confirms the write actually landed; and
            logs every edit so humans can see and revert exactly what was
            touched. That is a different category from &ldquo;AI website
            builder.&rdquo; It is an <strong>agentic backbone</strong> for an
            existing builder.
          </p>

          <p>
            We picked Elementor because it is the largest underserved surface in
            this market. WordPress runs roughly 43% of the web. Elementor alone
            powers millions of those sites. WordPress.com just enabled MCP write
            access. WordPress core just shipped the Abilities API and the
            official <code>mcp-adapter</code>. Elementor&rsquo;s own Angie agent
            shipped in March 2026, but is currently scoped to code and widget
            generation — not full site building. The window for a community-first,
            OSS-distributed agent layer is open and won&rsquo;t stay open long.
          </p>

          <h3>Discipline as the product</h3>

          <p>
            Our differentiation is not features. It is{" "}
            <em>discipline</em>. Every widget setting validated against the
            live schema before write — the bug class that killed every prior
            open-source attempt. Read-after-write verification on every
            mutation. Atomic rollback via snapshot-then-save. Optimistic
            concurrency hashes so humans and agents can co-edit without
            clobbering. Plan Mode — the agent proposes, the human approves, the
            executor runs. A hash-chained audit log so every AI edit is
            attributed and revertible. Anti-slop quality gates that refuse
            indigo-500 gradients and &ldquo;Build the future of X&rdquo;
            headlines.
          </p>

          <p>
            None of these are clever. Each one is the engineered absence of a
            specific failure mode that has cost a real builder real client
            trust. We documented thirty of them. Each rule in the spec cites the
            public bug report it engineers around.
          </p>

          <h3>Why open source</h3>

          <p>
            The WordPress plugin economy <em>requires</em> open-source
            distribution to reach scale. Yoast (acquired for ~$300M), Elementor
            itself (~$700M valuation), Astra (~$50M ARR), GravityForms
            (&gt;$20M ARR) — every modern WordPress success has shipped the
            same playbook: free GPL plugin on wp.org as the wedge, paid SaaS or
            Pro layer as the revenue moat. We&rsquo;re running it for the
            agentic era, on the largest CMS ecosystem on earth, at the moment
            the gap is most visible and the WordPress MCP plumbing is most
            standardized.
          </p>

          <p>
            The plugin is GPL. The MCP server and CLI are MIT. The architecture
            spec is in the repo. The constitution that says what we will and
            won&rsquo;t build is in the repo. The failure-mode constraints
            document — the actual differentiator — is in the repo. If
            you&rsquo;ve shipped to wp.org you will recognize every bug
            we&rsquo;re engineering around.
          </p>

          <h3>What we&rsquo;re not</h3>

          <p>
            We are not Elementor&rsquo;s competitor. We are Elementor&rsquo;s
            agentic backbone — the layer that makes Elementor sites
            AI-co-editable without compromising the Elementor experience for the
            humans who edit them. We are not an &ldquo;AI website builder&rdquo;
            and we will not pitch as one. We are not no-code; we serve people
            who know what an Elementor widget is. We are not selling
            productivity theater or 10x claims. We are selling{" "}
            <em>the disappearance of a specific set of bugs</em>.
          </p>

          <h3>The invitation</h3>

          <p>
            We&rsquo;re building this in public, on GitHub. The first version
            ships in roughly three months. Star the repo, read the specs, file
            issues, push back on the architecture. If you run Elementor sites
            for clients — or you&rsquo;re an agency tired of AI tools that
            don&rsquo;t survive your QA — this is the project to subscribe to.
          </p>

          <div className="ctas" style={{ marginTop: "3rem" }}>
            <a
              href="https://github.com/ckrohg/tenet-elementor"
              className="btn btn-primary"
            >
              GitHub repo <span className="arrow">→</span>
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
    </>
  );
}

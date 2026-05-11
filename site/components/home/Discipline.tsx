import { Fragment, type ReactNode } from "react";

const failures: [string, ReactNode][] = [
  [
    "silent_write_success",
    <>
      Tool returned <code>{`{success: true}`}</code> while the actual save to{" "}
      <code>_elementor_data</code> never landed. Page rendered broken; the
      agent thought it worked.
    </>,
  ],
  [
    "schema_drift",
    <>
      LLM emitted <code>justify_content</code> instead of{" "}
      <code>flex_justify_content</code>. Plugin accepted it. Frontend rendered
      default alignment. <em>(msrbuilds #32, the canonical case.)</em>
    </>,
  ],
  [
    "regenerate_destroys",
    <>
      User asked to &ldquo;redesign the hero.&rdquo; AI regenerated the entire
      page and deleted three weeks of human work.
    </>,
  ],
  [
    "cache_drift",
    <>
      Write succeeded in the DB. Cache served the old version for hours. Agent
      and human disagreed on what was live.
    </>,
  ],
  [
    "round_trip_clobber",
    <>
      Human opened Elementor between two agent calls. Agent&rsquo;s next write
      overwrote the human edits. No conflict detection.
    </>,
  ],
  [
    "credit_burn_loop",
    <>
      Agent looped on its own bug. Spent $40 of Anthropic credits proposing six
      wrong fixes to the same problem.
    </>,
  ],
];

export function Discipline() {
  return (
    <section id="discipline" className="site-section reveal">
      <div className="container-x">
        <div className="section-eyebrow">[ 01 / why this exists ]</div>
        <h2>
          Every prior AI builder shipped <em>the same bugs</em>.
        </h2>
        <p className="section-lede">
          We read every public bug tracker, postmortem, and Trustpilot review of
          Wix AI, 10Web, Lovable, Elementor MCP servers, Builder.ai. Same
          failure modes everywhere. Joist&rsquo;s architecture refuses each one
          by name.
        </p>

        <dl className="failures">
          {failures.map(([name, desc]) => (
            <Fragment key={name}>
              <dt>{name}</dt>
              <dd>{desc}</dd>
            </Fragment>
          ))}
        </dl>

        <p
          style={{
            marginTop: "2.5rem",
            fontFamily: "var(--font-jetbrains-mono), monospace",
            fontSize: "0.875rem",
            color: "var(--text-2)",
          }}
        >
          <span className="we-do">Joist refuses to do any of these.</span> We
          treat each as a hard invariant. 30 total.{" "}
          <a
            href="/spec"
            style={{ color: "var(--accent)" }}
          >
            Read all 30 →
          </a>
        </p>
      </div>
    </section>
  );
}

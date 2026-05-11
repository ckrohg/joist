export function FinalCta() {
  return (
    <section className="cta-section reveal">
      <div className="container-x">
        <h2 style={{ margin: "0 auto 1.5rem" }}>
          Watch the repo. <em>Don&rsquo;t install yet.</em>
        </h2>
        <p
          style={{
            color: "var(--text-2)",
            maxWidth: "50ch",
            margin: "0 auto 2.5rem",
          }}
        >
          v0.1 spike runs in ~2 days. v0.5 alpha in 6 weeks. v1.0 OSS launch on
          wp.org in 14–16. Star the repo and we&rsquo;ll ping you when the
          alpha is ready for a staging site.
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
          <a
            href="https://github.com/ckrohg/tenet-elementor/blob/main/specs/PLUGIN_API.md"
            className="btn btn-secondary"
          >
            Read the spec
          </a>
        </div>
      </div>
    </section>
  );
}

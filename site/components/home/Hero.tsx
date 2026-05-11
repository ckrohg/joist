import Link from "next/link";

export function Hero() {
  return (
    <header className="hero">
      <div className="container-x">
        <div className="eyebrow">
          <span className="dot" />
          OPEN SOURCE · MIT + GPL · PRE-v0.1
        </div>
        <h1 className="hero-h">
          The open-source backbone for{" "}
          <em>AI-edited Elementor</em> sites.
        </h1>
        <p className="hero-lede">
          A WordPress plugin + Claude Code skill that gives an AI agent safe,
          schema-validated, audit-logged read/write access to any Elementor
          site. Build new pages, edit existing ones, refresh content — as a
          trusted teammate, not a magic button.
        </p>
        <div className="ctas">
          <Link href="/install" className="btn btn-primary">
            Get started <span className="arrow">→</span>
          </Link>
          <Link href="/spec" className="btn btn-secondary">
            Read the discipline
          </Link>
        </div>
        <div className="status-line">
          <span className="badge">STATUS</span>
          <span>pre-v0.1 · specs only · do not install on production</span>
          <span style={{ color: "var(--text-3)" }}>·</span>
          <span>v1.0 target: ~14–16 weeks</span>
        </div>

        <pre className="diagram">
          <span className="c">{`┌──────────────────────────────────────────────────────────────┐\n`}</span>
          <span className="c">│</span>  <span className="h">Claude Code</span> on your machine                                  <span className="c">│</span>{"\n"}
          <span className="c">{`└─────────────────────────┬────────────────────────────────────┘\n`}</span>
          <span className="c">                          │  MCP tool calls (HTTPS · App Pwd){"\n"}</span>
          <span className="c">                          ▼{"\n"}</span>
          <span className="c">{`┌──────────────────────────────────────────────────────────────┐\n`}</span>
          <span className="c">│</span>  <span className="h">joist</span> plugin · registers WP Abilities · 30 hard invariants  <span className="c">│</span>{"\n"}
          <span className="c">│</span>    ├─ <span className="v">schema-validates</span> every widget setting before write     <span className="c">│</span>{"\n"}
          <span className="c">│</span>    ├─ <span className="v">snapshots</span> + atomic rollback · hash-chained audit log   <span className="c">│</span>{"\n"}
          <span className="c">│</span>    ├─ <span className="v">refuses</span> unknown keys · refuses silent failure          <span className="c">│</span>{"\n"}
          <span className="c">│</span>    └─ writes via Elementor's own <span className="v">Document::save()</span>            <span className="c">│</span>{"\n"}
          <span className="c">{`└─────────────────────────┬────────────────────────────────────┘\n`}</span>
          <span className="c">                          ▼{"\n"}</span>
          {"        "}<span className="h">Elementor</span> unchanged → wp_postmeta → frontend
        </pre>
      </div>
    </header>
  );
}

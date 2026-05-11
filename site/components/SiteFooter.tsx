import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container-x foot-inner">
        <div className="foot-col">
          <h4>Joist</h4>
          <Link href="/spec">Spec</Link>
          <Link href="/install">Install</Link>
          <Link href="/why">Why we built it</Link>
        </div>
        <div className="foot-col">
          <h4>Build</h4>
          <a href="https://github.com/ckrohg/tenet-elementor">GitHub</a>
          <a href="https://github.com/ckrohg/tenet-elementor/blob/main/specs/PLUGIN_API.md">
            Plugin API spec
          </a>
          <a href="https://github.com/ckrohg/tenet-elementor/blob/main/specs/ARCHITECTURE.md">
            Architecture
          </a>
          <a href="https://github.com/ckrohg/tenet-elementor/blob/main/specs/HARDENING_v1.md">
            Hardening v1
          </a>
        </div>
        <div className="foot-col">
          <h4>Community</h4>
          <span style={{ color: "var(--text-3)" }}>Discord — v0.5</span>
          <span style={{ color: "var(--text-3)" }}>
            GitHub Discussions — v0.5
          </span>
        </div>
        <div className="foot-col" style={{ maxWidth: "22ch" }}>
          <h4>Status</h4>
          pre-v0.1 · specs only · do not install on production · v1.0 target
          ~14–16w
        </div>
      </div>
    </footer>
  );
}

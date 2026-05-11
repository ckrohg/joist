import Link from "next/link";

export default function NotFound() {
  return (
    <section className="hero">
      <div className="container-x">
        <div className="eyebrow">
          <span className="dot" />
          404 · ROUTE NOT REGISTERED · NO SILENT FAILURE
        </div>
        <h1 className="hero-h">
          That page <em>does not exist</em>.
        </h1>
        <p className="hero-lede">
          Nothing matches that URL. Joist refuses to render a placeholder it
          can&rsquo;t validate. Pick a known route below.
        </p>
        <div className="ctas">
          <Link href="/" className="btn btn-primary">
            Back to home <span className="arrow">→</span>
          </Link>
          <Link href="/spec" className="btn btn-secondary">
            Read the spec
          </Link>
          <Link href="/install" className="btn btn-secondary">
            Install timeline
          </Link>
        </div>
        <div className="status-line">
          <span className="badge">CODE</span>
          <span>http.404 · route.not_registered · suggestion: /, /spec, /install, /why</span>
        </div>
      </div>
    </section>
  );
}

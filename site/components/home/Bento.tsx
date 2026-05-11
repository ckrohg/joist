export function Bento() {
  return (
    <section className="site-section reveal">
      <div className="container-x">
        <div className="section-eyebrow">
          [ 03 / what makes joist different ]
        </div>
        <h2>
          The discipline <em>is</em> the product.
        </h2>
        <p className="section-lede">
          Four invariants that took every prior tool a year of bug reports to
          discover. Joist enforces them on every write, by design.
        </p>

        <div className="bento">
          <div className="tile tile-big">
            <div className="tile-num">[ 01 ]</div>
            <div className="tile-title serif">
              Validate against the live site.
            </div>
            <p className="tile-body">
              Every widget setting checked against the introspected schema of{" "}
              <em>that specific install</em> — not a hardcoded one. Unknown
              keys never pass through silently. Suggestions include
              Levenshtein-1 + <code>flex_*</code>-aware fuzzy matches so the
              agent self-corrects in one round-trip.
            </p>
            <pre className="tile-code">
              <span className="c">{`// agent writes:\n`}</span>
              {`{ "`}<span className="k">justify_content</span>{`": "center" }\n\n`}
              <span className="c">{`// joist responds 422 with:\n`}</span>
              {`{\n  "code": "schema.unknown_key",\n  "`}<span className="k">recovery_suggestions</span>{`": [\n    { "op": "update_settings",\n      "args": { "`}<span className="m">flex_justify_content</span>{`": "center" },\n      "rationale": "`}<span className="s">Levenshtein-1 + flex_*-aware match</span>{`" }\n  ]\n}`}
            </pre>
          </div>

          <div className="tile tile-tall">
            <div className="tile-num">[ 02 ]</div>
            <div className="tile-title serif">Plan Mode is a real plan.</div>
            <p className="tile-body">
              The agent proposes, you approve in WP admin with a side-by-side
              preview, the executor runs with atomic rollback. Single-call
              patches are gated by a chained-singleton detector — you
              can&rsquo;t bypass the plan by issuing N micro-edits.
            </p>
          </div>

          <div className="tile tile-2">
            <div className="metric">30</div>
            <div className="metric-sub">
              hard invariants enforced on every write
            </div>
          </div>

          <div className="tile tile-2 quote-tile">
            <blockquote>
              &ldquo;The first AI tool pitch I&rsquo;ve read in a year that
              doesn&rsquo;t read like ChatGPT wrote it.&rdquo;
            </blockquote>
            <div className="cite">
              — red-team review
              <br />
              by an agency owner
            </div>
          </div>

          <div className="tile tile-3">
            <div className="tile-num">[ 03 ]</div>
            <div className="tile-title serif">Round-trip safe.</div>
            <p className="tile-body">
              Every read returns a content hash. Every write echoes the hash it
              was planned against. Human edits in the Elementor UI invalidate
              that hash — the agent&rsquo;s next write fails fast and re-reads.
              No clobbering. No &ldquo;the AI deleted my work&rdquo; tickets.
            </p>
          </div>

          <div className="tile tile-3">
            <div className="tile-num">[ 04 ]</div>
            <div className="tile-title serif">Refuses to ship slop.</div>
            <p className="tile-body">
              Anti-slop rules in the codebase reject indigo-500 gradients,
              &ldquo;Build the future of X&rdquo; headlines, AI 3D blobs,
              uniform 16px radii. Steers toward shadcn / Aceternity / Awwwards
              taste sources — not Envato kits.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

import { CodeBlock } from "../CodeBlock";

const steps = [
  {
    n: "01 GATE",
    name: "PolicyGuard",
    desc: "Refuse-list runs first. No force-delete. No arbitrary zip install. No agent role doing user CRUD.",
  },
  {
    n: "02 VALIDATE",
    name: "Live schema",
    desc: "Every widget setting checked against introspected schema. Unknown keys → 422 with Levenshtein-1 + flex_*-aware suggestion.",
  },
  {
    n: "03 SNAPSHOT",
    name: "Atomic revision",
    desc: "Custom revisions table. Gzipped LONGBLOB. Restore is one call. WP's built-in revisions don't cover postmeta — ours do.",
  },
  {
    n: "04 WRITE",
    name: "Document::save()",
    desc: "Through Elementor's own path. Slash handling, hooks, version stamping identical to a human edit.",
  },
  {
    n: "05 VERIFY",
    name: "Read-after-write",
    desc: "Tool returns the post-save element + new hash. Never {success: true}. CSS regen + cache flush deferred async.",
  },
];

export function Pipeline() {
  return (
    <section id="how" className="site-section reveal">
      <div className="container-x">
        <div className="section-eyebrow">[ 02 / the write pipeline ]</div>
        <h2>
          Every write goes through <em>one path</em>.
        </h2>
        <p className="section-lede">
          <code>DocumentWriter::save()</code> is the spine. It enforces 9 of the
          30 invariants in a single method.{" "}
          <code>update_post_meta(&apos;_elementor_data&apos;, …)</code> is
          grep-banned in the codebase. There is no second way to write.
        </p>

        <div className="pipeline">
          {steps.map((s) => (
            <div className="step" key={s.n}>
              <div className="step-num">{s.n}</div>
              <div className="step-name">{s.name}</div>
              <div className="step-desc">{s.desc}</div>
            </div>
          ))}
        </div>

        <CodeBlock>
          <span className="c">{`// The actual spine. (Simplified — see specs/ARCHITECTURE.md §4)\n\n`}</span>
          <span className="k">public function</span> save(
          <span className="v">SaveRequest</span> $req): <span className="v">SaveResult</span>{"\n"}
          {"{\n"}
          {"    "}$this-&gt;policy-&gt;<span className="k">assertAllowed</span>($req);             <span className="c">{`// constraint #18`}</span>{"\n"}
          {"    "}$this-&gt;opMode-&gt;<span className="k">intercept</span>($req);                <span className="c">{`// observer/quiet/kill`}</span>{"\n"}
          {"    "}$this-&gt;sessions-&gt;<span className="k">recordOp</span>($req);                 <span className="c">{`// chained-singleton (#19)`}</span>{"\n\n"}
          {"    "}$lock = $this-&gt;locks-&gt;<span className="k">acquire</span>($req-&gt;postId);{"\n"}
          {"    "}<span className="k">try</span> {`{`}{"\n"}
          {"        "}$this-&gt;elementor-&gt;<span className="k">assertSupportedVersion</span>();{"\n"}
          {"        "}$this-&gt;layoutMode-&gt;<span className="k">validateInserts</span>($req);     <span className="c">{`// container vs section (#23)`}</span>{"\n"}
          {"        "}$this-&gt;dynamicTags-&gt;<span className="k">validateTree</span>($req);      <span className="c">{`// no dangling refs (#25)`}</span>{"\n"}
          {"        "}$this-&gt;validator-&gt;<span className="k">validateTree</span>($req);         <span className="c">{`// schema + responsive (#1, #24)`}</span>{"\n\n"}
          {"        "}[$elements, $tx] = $this-&gt;globals-&gt;<span className="k">preferGlobals</span>($req); <span className="c">{`// (#26)`}</span>{"\n"}
          {"        "}$revId = $this-&gt;revisions-&gt;<span className="k">snapshot</span>($req);{"\n\n"}
          {"        "}$doc = $this-&gt;elementor-&gt;<span className="k">getDocument</span>($req-&gt;postId);{"\n"}
          {"        "}$doc-&gt;<span className="k">save</span>([<span className="s">&apos;elements&apos;</span> =&gt; $elements]); <span className="c">{`// Elementor's own path`}</span>{"\n\n"}
          {"        "}$verified = $doc-&gt;<span className="k">get_elements_data</span>();        <span className="c">{`// read-after-write (#2)`}</span>{"\n"}
          {"        "}$this-&gt;audit-&gt;<span className="k">log</span>(<span className="s">&apos;document.save&apos;</span>, $req, $verified); <span className="c">{`// chain_hash (#30)`}</span>{"\n\n"}
          {"        "}<span className="k">wp_schedule_single_event</span>(<span className="v">time()</span> + 1, <span className="s">&apos;joist_post_save_verify&apos;</span>, [{"\n"}
          {"            "}<span className="s">&apos;post_id&apos;</span> =&gt; $req-&gt;postId,                  <span className="c">{`// async: regen CSS, flush cache,`}</span>{"\n"}
          {"            "}<span className="s">&apos;hash&apos;</span>    =&gt; $this-&gt;hasher-&gt;<span className="k">forElements</span>($verified), <span className="c">{`// verify frontend, fire webhook`}</span>{"\n"}
          {"        "}]);{"\n\n"}
          {"        "}<span className="k">return new</span> SaveResult($verified, $tx, $revId);{"\n"}
          {"    "}{`}`} <span className="k">catch</span> (\Throwable $e) {`{`}{"\n"}
          {"        "}$this-&gt;revisions-&gt;<span className="k">rollback</span>($revId);              <span className="c">{`// no silent failure (#16)`}</span>{"\n"}
          {"        "}<span className="k">throw</span> $e;{"\n"}
          {"    "}{`}`} <span className="k">finally</span> {`{`}{"\n"}
          {"        "}$this-&gt;locks-&gt;<span className="k">release</span>($lock);{"\n"}
          {"    "}{`}`}{"\n"}
          {`}`}
        </CodeBlock>
      </div>
    </section>
  );
}

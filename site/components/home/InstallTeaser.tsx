import { CodeBlock } from "../CodeBlock";

export function InstallTeaser() {
  return (
    <section id="install" className="site-section reveal">
      <div className="container-x">
        <div className="section-eyebrow">[ 04 / when it ships ]</div>
        <h2>
          v1.0 target: <em>14–16 weeks</em>.
        </h2>
        <p className="section-lede">
          The plugin is GPL. The MCP server + CLI are MIT. Everything is open
          source. Distribution via wp.org. The SaaS layer (v2) adds bulk-fleet
          management, autonomous post-launch agents, and white-label for
          agencies running 10+ client sites.
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
          {"    "}<span className="k">/joist-audit</span> my-page{"\n\n"}
          <span className="k">$</span> npx @joist/cli connect <span className="s">--config sites.yaml --concurrency 5</span>  <span className="c"># 30-site fleet rollout</span>
        </CodeBlock>
      </div>
    </section>
  );
}

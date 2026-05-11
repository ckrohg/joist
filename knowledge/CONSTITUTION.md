# Constitution

> Non-negotiable rules for how we build and ship joist. Distilled from postmortem research of every prior attempt + the strategic frame we've chosen.

---

## The rule

**Trust is the moat. Every other property of the product serves it.**

A product that builds Elementor sites quickly but breaks them invisibly is worth less than one that builds slowly and refuses to break things. The category we're entering has been littered with corpses of fast, magical, silently-failing tools. Our wedge is the opposite — explicit, validated, audit-logged, revertible. If a feature tradeoff weakens trust, we don't ship it.

---

## Principles

### 1. Refuse silent failure
Every operation that touches user data must either succeed verifiably or fail loudly. Read-after-write on every mutation. Schema validation before every save. If the underlying API returns ambiguous success, we surface it as a hard error. The single most damaging bug class in the AI-builder category is "tool returned success, page silently broken" — we close that door first.

### 2. Validate against the world, not the model
The LLM doesn't know what widgets are installed on this site, what version of Elementor is running, what controls a widget accepts. Every output is validated against the live introspected schema before we attempt to write it. Unknown keys are errors, not silent passthroughs. The model is a generator, not an authority.

### 3. Surgical edits over regenerations
The agent edits by element ID. It does not "redesign the homepage" as a single tool call. Every multi-step change goes through Plan Mode. Every plan is reviewable, every step is revertible. Full-page regenerate is how Wix and 10Web wiped their users' work; we will not.

### 4. The human is the editor of record
The plugin does not auto-mutate live sites. Plan Mode requires explicit human approval for multi-step writes. The Elementor editor remains the canonical UI. Audit logs attribute every change. Revisions snapshot before every edit. The agent is a teammate, not a replacement.

### 5. Round-trip safe is non-optional
Human edits in the Elementor UI must coexist with agent edits. Optimistic concurrency hashes catch conflicts before they corrupt. The agent re-reads when humans have touched the page. There is no "AI-generated" marker that breaks future human editing.

### 6. Refuse to ship slop
We have explicit anti-slop rules — typography defaults, color defaults, layout patterns, headline pattern matchers. The agent rejects its own output if it matches the slop archetype (indigo-500 gradients, "Build the future of X" headlines, AI 3D blobs). Real-content discipline beats filled-in-looking pages. When in doubt, insert a placeholder; don't generate filler.

### 7. Cost transparency
Every operation has a token cost meter. Per-task spending caps. Cheap-mode fallback when retries loop. Never burn the user's budget on the agent's own bugs.

### 8. Open source as the wedge
The plugin is GPL. The MCP server is MIT. The CLI is MIT. We ship to wp.org. We do not gate basic functionality behind a paid tier in v1. The SaaS layer (later) adds multi-site, white-label, hosted brand kits, and post-launch agents — capabilities that don't make sense in a single-site OSS plugin. The plugin and the OSS users are not second-class.

### 9. The user's data is the user's data
First-class export, always. Kit `.zip`, Elementor template JSON, WXR, static HTML. No vendor lock-in. No data hostage situations. If the user wants to leave, they take everything.

### 10. Standards over inventions
Use WordPress's Abilities API. Use `mcp-adapter`. Use Application Passwords. Use Elementor's own `Document::save()`. We are not reinventing primitives; we're orchestrating them with discipline. Custom mechanisms only when standards don't exist (revision table for postmeta, hash canonicalization).

---

## Anti-patterns we refuse

- **Magic-button thinking** — "press a button, get a finished site." This is the category mistake we're correcting, not perpetuating.
- **AI-as-authority** — letting the model's confident output skip validation. The model is wrong often. The schema is the source of truth.
- **Append-only mutations** — `add-custom-css` that accumulates conflicting blocks. Default operations are replace-named-block, not append.
- **Tool sprawl** — exposing 200 specialized MCP tools because each new feature seemed worth its own endpoint. Parameterized tools > specialized ones. Under 80 tools total.
- **Lock-in by data shape** — storing layout data in a format only our tools can read. Everything we write is native Elementor JSON or native WP postmeta.
- **Hidden costs** — charging credits opaquely, looping silently on errors, burning tokens without surfacing usage. Cost meters are visible.
- **Closed-source plugin** — the plugin must be GPL to land on wp.org and to earn community trust. Paid features live in a separate hosted layer.
- **Auto-update breaking changes** — pinning to tested Elementor version ranges; refusing to operate outside them rather than crashing mid-edit.
- **Background mutations without consent** — autonomous post-launch agents (v2) emit *plans*, never auto-mutate.

---

## How constitutional change works

| Level | What changes | Mechanism | Frequency |
|---|---|---|---|
| **Tactical** | a default, threshold, or quality-gate config | PR + rationale | Frequent |
| **Architectural** | a class boundary, API shape, transport choice | PR + spec update + migration plan | Rare |
| **Principle** | one of the 10 principles | PR + multi-incident evidence + community discussion | Very rare |
| **The rule** | the trust-is-moat framing | Founder-level deliberation | Once-per-product-lifetime |

The 16 failure-mode constraints in `specs/PLUGIN_API.md §20` are concrete instantiations of these principles. They can be added to as new failure modes are discovered; they cannot be subtracted from without explicit acknowledgement that the corresponding principle is being weakened.

---

## How the constitution stays alive

A constitution that's set and forgotten becomes scripture. To prevent that:

1. **The 16 failure-mode constraints are CI-tested.** Every constraint maps to a test. If the test goes stale or starts failing without an amendment, the constitution is bypassing reality and needs review.
2. **Anti-slop rules are pattern-matched.** The SlopDetector runs in CI on example outputs. When it stops rejecting things, either reality has shifted or the rules have drifted — investigate.
3. **Quarterly review.** Every quarter, walk the principles list against the past three months of incidents/issues/feedback. If a principle was never invoked, it might be a dead letter. If a principle was repeatedly invoked but ignored, the team is bypassing it.
4. **External eyes.** When a contributor's PR conflicts with a principle, that's a signal — either the principle needs better documentation or the principle is wrong.

The risk we guard against is not change. It is silence.

---

## Closing

The purpose of building an AI agent is not fewer humans editing websites. It is the better use of human judgment.

Our agent's job is not to remove the editor from the loop. Its job is to handle the grind — copy variants, image generation, SEO meta, section composition, broken link sweeps — so that the editor's attention can go to the rare, the ambiguous, and the consequential. The decisions that actually need a human.

Done well, this is a trusted teammate.
Done poorly, it is a faster broken-page generator.

We chose the former on purpose. Every architectural decision, every failure-mode constraint, every anti-slop rule serves that choice.

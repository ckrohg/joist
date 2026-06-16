# Sticky-note annotation tool + recall-probe wiring

Element-precise human feedback on a rendered clone (replaces the blind page-level 0-100 sheet), wired to the grader
ledger as **VALIDATION ONLY** (did the grader catch what the human pinned) — never as a channel to fit grader
weights/tolerances to labels.

## The three files

| file | what it is |
|---|---|
| `index.html` | the sticky-note tool. Live-DOM overlay over the **localhost:8001 clone** (host-guarded). Click → `elementsFromPoint` (full z-stack) → walk up to the nearest `--joist-src` → drop a pin. Relational collision pins (`element_ref` + `colliding_with`). Side-by-side captured source screenshot with stamp→region highlight. localStorage + Download JSONL. |
| `capture-source-bbox.mjs` | produces the SOURCE pane assets: `source-<id>.png` + `source-bbox-<id>.json` (stamp→bbox), keyed by the same content-addressed stamp the clone carries and the grader uses. |
| `annotation-recall.mjs` | the **recall probe**: for each human pin, did the grader ledger flag the same `element_ref` (or ancestor / descendant / — for collision pins — the edge covering the pair) with a matching axis at a reasonable severity band? Reports recall + miss **per axis**. Plus an **injection-seed adapter** (each pin → a synthetic-injection CATEGORY for a label-blind fixture) and a `noWeightFit:true` assertion. |

## Workflow

```bash
# 1. capture the source assets (once per page). Either re-screenshot the live source:
node capture-source-bbox.mjs --url https://stripe.com --id 2551
#    or derive the bboxes for free from an existing grader compare blob (same stamps):
node capture-source-bbox.mjs --from-compare /tmp/compare-2551.json --id 2551   # still needs source-2551.png

# 2. serve this dir over localhost (so the iframe is same-origin with the clone host) and open index.html:
#    python3 -m http.server 8001  (or whatever serves the localhost WP) — the iframe loads /?page_id=<id>
#    Enter page_id + source id, click pins, Download JSONL → annotations-2551.jsonl

# 3. VALIDATE the grader against the human pins (recall, NOT weight-fitting):
node annotation-recall.mjs --annotations annotations-2551.jsonl --ledger /tmp/ledger-2551.json
#    → "collision pins 5/5 caught; recolor pins 3/4" + per-miss injection-seed CATEGORY
```

The ledger is an `axisdelta-engine` / `grade-fused` output (a `{events:[...]}` blob, or a wrapper that embeds one).

## Eval-integrity boundary (the whole point)

`annotation-recall.mjs` **imports no engine, writes no weight/floor/tolerance/τ.** The grader's weights stay
label-blind-noise + perceptual-prior. The annotations are a **hold-out test set**. A recall MISS is a reported
coverage gap → a TODO for a label-blind synthetic-injection fixture (the injection-seed adapter spells the
perturbation CATEGORY, not tuned constants), **never** a knob to turn on the grader.

Offline selftests (no capture, no network):

```bash
node annotation-recall.mjs --selftest      # synthetic annotations + synthetic ledger → correct recall/miss (4/7)
node capture-source-bbox.mjs --selftest    # stamp determinism + bbox-json shape
```

## Hard rails

- The tool targets the **localhost clone ONLY** (`resolveBase` JS mirror of `sandbox/host-guard.mjs`: default-deny,
  hard-block `georges232` / `*.sg-host.com` / the IP literal). The source pane uses a **captured** screenshot — it
  never cross-origin-loads the live external source.
- Any render/screenshot goes through `node` + playwright + a timeout (the `capture-source-bbox.mjs` helper), never
  mcp-playwright.

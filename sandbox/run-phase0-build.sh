#!/usr/bin/env bash
# Re-run the BUILD+GRADE half of Phase 0 against the already-bootstrapped sandbox
# (capture /tmp/p0-tailwind.json already exists). Applies the pretty-permalink fix first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== fix live permalinks (pretty → /wp-json/ REST works) =="
cd "$ROOT/sandbox"
# --import-id is IGNORED by this wp-cli -> pages land at auto IDs; resolve the tailwind page (seed-3146 -> id) by slug.
# Init it as an Elementor DOCUMENT (edit_mode=builder + empty data) so the Joist GET returns a hash (else build PUT 400s).
PID=$(docker compose run --rm -T wpcli-1 -c '
  ID=$(wp post list --post_type=page --name=seed-3146 --field=ID 2>/dev/null | head -1);
  [ -z "$ID" ] && ID=$(wp post create --post_type=page --post_status=publish --post_title=seed-3146 --porcelain 2>/dev/null);
  wp rewrite structure "/%postname%/" >/dev/null 2>&1; wp rewrite flush --hard >/dev/null 2>&1;
  wp cap add administrator joist_use_agent_api >/dev/null 2>&1;
  wp post meta update $ID _elementor_edit_mode builder >/dev/null;
  wp post meta update $ID _elementor_data "[]" >/dev/null;
  wp post meta update $ID _elementor_version "$(wp plugin get elementor --field=version)" >/dev/null;
  echo "PID=$ID"
' 2>/dev/null | grep -oE "PID=[0-9]+" | cut -d= -f2)
echo "tailwind sandbox page id = $PID"
curl -fsS "http://localhost:8001/wp-json/" -o /dev/null && echo "wp-json reachable" || echo "wp-json still not reachable"

echo "== rebuild tailwind on the sandbox (page $PID) + grade =="
cd "$ROOT/eval/grader"
source /tmp/joist-auth-1.env            # local JOIST_BASE + JOIST_AUTH_B64
node "${BUILDER:-build-absolute.mjs}" --layout /tmp/p0-tailwind.json --page "$PID"
node grade-sections.mjs --source https://tailwindcss.com --clone "http://localhost:8001/?page_id=$PID" --out /tmp/p0g-tailwind

echo "== PARITY VERDICT =="
node -e '
  const j=require("/tmp/p0g-tailwind/sections.json"); const r=j.report||j;
  const local=+r.composite, base=0.85, d=+(local-base).toFixed(3);
  console.log("local composite", local.toFixed(3), "| sg-host baseline", base, "| delta", d,
    "| ssim", (+(r.ssimRaw||r.visualMean||0)).toFixed(3), "struct", (+(r.structuralFidelity||0)).toFixed(3));
  console.log(Math.abs(d)<=0.05 ? "PARITY PASS (within noise) — farm viable" :
    "PARITY GAP "+d+" — likely Elementor version (local 4.1.1 vs sg-host) or missing Kit/theme-css");
'

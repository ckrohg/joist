#!/usr/bin/env bash
# Phase 0 end-to-end: stand up ONE sandbox, bootstrap, clone tailwind on it, grade,
# and compare the composite to the sg-host baseline (~0.85) to PROVE local parity.
# Prereq: Docker daemon RUNNING. Run from repo root:  bash sandbox/run-phase0.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
G="$ROOT/eval/grader"
cd "$ROOT/sandbox"

echo "== 1. bring up db + wp =="
docker compose up -d db-1 wp-1
echo "== 2. wait for WP to answer =="
for i in $(seq 1 40); do curl -fsS -o /dev/null "http://localhost:8001/wp-login.php" && { echo "wp up"; break; }; sleep 3; done

echo "== 3. bootstrap (install core/theme/elementor/joist + app-password + seed pages) =="
chmod +x bootstrap.sh
docker compose run --rm wpcli-1 /bootstrap.sh | tee /tmp/joist-sbx1-bootstrap.log
# extract the auth lines the bootstrap printed
grep -E '^export (JOIST_BASE|JOIST_AUTH_B64)=' /tmp/joist-sbx1-bootstrap.log > /tmp/joist-auth-1.env
echo "wrote /tmp/joist-auth-1.env (redacted)"

echo "== 4. clone tailwind onto the LOCAL sandbox (page 3146) =="
cd "$G"
source /tmp/joist-auth-1.env          # sets JOIST_BASE=localhost:8001 + JOIST_AUTH_B64
node capture-ensemble.mjs --source https://tailwindcss.com --out /tmp/p0-tailwind.json --passes 2
node build-absolute.mjs --layout /tmp/p0-tailwind.json --page 3146

echo "== 5. grade the local clone vs source =="
node grade-sections.mjs --source https://tailwindcss.com --clone "http://localhost:8001/?page_id=3146" --out /tmp/p0g-tailwind

echo "== 6. PARITY VERDICT =="
node -e '
  const r=require("/tmp/p0g-tailwind/sections.json").report||require("/tmp/p0g-tailwind/sections.json");
  const local=+r.composite, base=0.85, d=+(local-base).toFixed(3);
  console.log("local composite", local.toFixed(3), "| sg-host baseline", base, "| delta", d);
  console.log(Math.abs(d)<=0.05 ? "PARITY PASS (within noise) — farm is viable" :
    "PARITY GAP "+d+" — investigate (likely Elementor version / kit / theme-css mismatch)");
'

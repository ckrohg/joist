#!/bin/bash
# @purpose vj-detached.sh — COMMITTED detached runner for vision-judge with the STRUCTURE FEED WIRED
# (VJ-ALIGN round 2026-06-10). The previous launchers lived in /tmp and launched vision-judge WITHOUT
# --structure, so publishedScore (the veto combiner — the ONLY publishable number) was null in every
# calibration run. This runner makes the feed mandatory: it runs grade-structure.mjs FIRST (foreground,
# deterministic) unless STRUCTURE=<existing report.json> is exported, then launches vision-judge DETACHED
# via python os.fork+os.setsid DOUBLE-FORK (nohup+disown is PROVEN FATAL here: the 2026-06-09 calibration
# launch died with the launching agent — see /tmp/vj-cal-launch2.sh postmortem header).
#
# Usage: ./vj-detached.sh <name> <source-url> <clone-url> [extra vision-judge args...]
#        STRUCTURE=/path/report.json ./vj-detached.sh ...   # reuse an existing grade-structure report
# Outputs: /tmp/vj-<name>/ (tiles, manifest.json, results.json with publishedScore NON-NULL),
#          /tmp/vj-<name>.log, /tmp/vj-<name>.pid, /tmp/vj-<name>-structure/ (when freshly graded).
set -euo pipefail
NAME="${1:?usage: vj-detached.sh <name> <source-url> <clone-url> [extra args]}"
SOURCE="${2:?need source url}"
CLONE="${3:?need clone url}"
shift 3
GRADER_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="/tmp/vj-$NAME"
rm -rf "$OUT"; mkdir -p "$OUT"

# ── STRUCTURE FEED: publishedScore = min(vision, deterministic veto caps) needs grade-structure's report ────
if [ -z "${STRUCTURE:-}" ]; then
  STRUCT_OUT="/tmp/vj-$NAME-structure"
  mkdir -p "$STRUCT_OUT"
  echo "$(date '+%H:%M:%S') grading structure (foreground, deterministic) -> $STRUCT_OUT"
  node "$GRADER_DIR/grade-structure.mjs" --source "$SOURCE" --clone "$CLONE" --out "$STRUCT_OUT" \
    > "$STRUCT_OUT/run.log" 2>&1 || { echo "FATAL: grade-structure failed (see $STRUCT_OUT/run.log)"; exit 1; }
  STRUCTURE="$STRUCT_OUT/report.json"
fi
[ -f "$STRUCTURE" ] || { echo "FATAL: no structure report at $STRUCTURE"; exit 1; }
echo "$(date '+%H:%M:%S') structure feed: $STRUCTURE"

# ── DETACHED LAUNCH: python setsid double-fork; grandchild execs node, owns its own session ─────────────────
python3 - "$GRADER_DIR" "$OUT" "$STRUCTURE" "$SOURCE" "$CLONE" "$@" <<'PY'
import os, sys
gdir, out, structure, source, clone, *extra = sys.argv[1:]
if os.fork() > 0:
    sys.exit(0)          # parent returns to bash immediately
os.setsid()              # new session: survives the launching terminal/agent
if os.fork() > 0:
    os._exit(0)          # first child exits; grandchild is fully detached
log = open(out + '.log', 'ab', buffering=0)
os.dup2(log.fileno(), 1)
os.dup2(log.fileno(), 2)
devnull = os.open(os.devnull, os.O_RDONLY)
os.dup2(devnull, 0)
os.chdir(gdir)
with open(out + '.pid', 'w') as f:
    f.write(str(os.getpid()))
os.execvp('node', ['node', 'vision-judge.mjs',
                   '--source', source, '--clone', clone,
                   '--structure', structure, '--out', out] + extra)
PY
sleep 1
echo "$(date '+%H:%M:%S') launched detached: pid=$(cat "$OUT.pid" 2>/dev/null || echo '?') out=$OUT log=$OUT.log"

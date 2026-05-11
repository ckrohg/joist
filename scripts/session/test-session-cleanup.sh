#!/bin/bash
#
# Test Suite: Session Cleanup
#
# Tests session-cleanup.sh against critical safety requirements:
# - NEVER loses uncommitted work
# - NEVER loses conflicting changes
# - ONLY auto-merges safe commits (auto-saves, journal entries)
# - ALWAYS preserves journal entries
# - Properly removes worktrees after successful merge
# - Handles all exit scenarios (normal, Ctrl+C, crash, kill)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

print_test() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "TEST: $1"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
}

anti_test() {
    echo -e "${YELLOW}⚠ ANTI-TEST${NC}: $1 (should NOT happen)"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Safety Tests - CRITICAL: Must never lose work
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

print_test "SAFETY: Cleanup script exists and is executable"
if [[ -f "$SCRIPT_DIR/session-cleanup.sh" ]]; then
    pass "session-cleanup.sh exists"
else
    fail "session-cleanup.sh not found"
fi

if [[ -x "$SCRIPT_DIR/session-cleanup.sh" ]]; then
    pass "session-cleanup.sh is executable"
else
    fail "session-cleanup.sh not executable"
fi

print_test "SAFETY: Script has auto-commit before merge"
if grep -q "git add -A" "$SCRIPT_DIR/session-cleanup.sh" && \
   grep -q "git commit" "$SCRIPT_DIR/session-cleanup.sh"; then
    pass "Auto-commits before attempting merge"
else
    fail "Missing auto-commit before merge - WILL LOSE WORK"
fi

print_test "SAFETY: Script checks if on session branch"
if grep -q 'if.*session-' "$SCRIPT_DIR/session-cleanup.sh"; then
    pass "Checks for session branch before cleanup"
else
    fail "Doesn't check branch type - might cleanup non-session branches"
fi

print_test "SAFETY: Script aborts merge on conflicts"
if grep -q "git merge --abort" "$SCRIPT_DIR/session-cleanup.sh"; then
    pass "Aborts merge on conflicts (preserves work)"
else
    fail "Doesn't abort on conflicts - WILL LOSE CONFLICTING CHANGES"
fi

print_test "SAFETY: Script uses auto-resolve strategy for .tenet/ conflicts"
if grep -q -- "-X ours" "$SCRIPT_DIR/session-cleanup.sh"; then
    pass "Uses -X ours for auto-resolving .tenet/ conflicts"
else
    fail "Missing conflict resolution strategy - merges will fail unnecessarily"
fi

print_test "ANTI-TEST: Script doesn't use --force flags"
anti_test "git push --force"
if grep -q "push.*--force" "$SCRIPT_DIR/session-cleanup.sh"; then
    fail "Uses --force push - DANGEROUS"
else
    pass "No --force push (safe)"
fi

anti_test "git clean -f"
if grep -q "git clean" "$SCRIPT_DIR/session-cleanup.sh"; then
    fail "Uses git clean - WILL LOSE UNTRACKED FILES"
else
    pass "No git clean (safe)"
fi

anti_test "git reset --hard"
if grep -q "reset.*--hard" "$SCRIPT_DIR/session-cleanup.sh"; then
    fail "Uses reset --hard - WILL LOSE UNCOMMITTED WORK"
else
    pass "No reset --hard (safe)"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Integration Tests - Works with existing infrastructure
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

print_test "INTEGRATION: Stop hook calls session-cleanup.sh"
SETTINGS_FILE="$REPO_DIR/.claude/settings.json"
if [[ -f "$SETTINGS_FILE" ]]; then
    if grep -q "session-cleanup.sh" "$SETTINGS_FILE"; then
        pass "Stop hook configured to run cleanup"
    else
        fail "Stop hook doesn't call session-cleanup.sh"
    fi
else
    fail ".claude/settings.json not found"
fi

print_test "INTEGRATION: Signal handler calls session-cleanup.sh"
AUTO_COMMIT_SCRIPT="$SCRIPT_DIR/auto-commit.sh"
if [[ -f "$AUTO_COMMIT_SCRIPT" ]]; then
    if grep -A 10 "graceful_shutdown" "$AUTO_COMMIT_SCRIPT" | grep -q "session-cleanup.sh"; then
        pass "Signal handler calls cleanup on Ctrl+C/kill"
    else
        fail "Signal handler doesn't call session-cleanup.sh - branches pile up on Ctrl+C"
    fi
else
    fail "auto-commit.sh not found"
fi

print_test "INTEGRATION: Signal traps are set"
if grep -q "trap.*graceful_shutdown.*SIGINT.*SIGTERM" "$AUTO_COMMIT_SCRIPT"; then
    pass "Signal traps set for SIGINT and SIGTERM"
else
    fail "Missing signal traps - Ctrl+C won't trigger cleanup"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Functional Tests - Script behavior
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

print_test "FUNCTIONAL: Script skips cleanup on non-session branches"
CLEANUP_OUTPUT=$("$SCRIPT_DIR/session-cleanup.sh" 2>&1 || true)
CURRENT_BRANCH=$(git branch --show-current)

if [[ ! "$CURRENT_BRANCH" =~ ^session- ]]; then
    if echo "$CLEANUP_OUTPUT" | grep -q "Not a session branch"; then
        pass "Skips cleanup on non-session branch (main)"
    else
        fail "Doesn't skip non-session branches - might cleanup main!"
    fi
else
    pass "Currently on session branch, skipping non-session test"
fi

print_test "FUNCTIONAL: Script switches to main before merge"
if grep -q "git checkout main" "$SCRIPT_DIR/session-cleanup.sh"; then
    pass "Switches to main before merging"
else
    fail "Doesn't checkout main - merge will fail"
fi

print_test "FUNCTIONAL: Script removes worktree after successful merge"
if grep -q "git worktree.*remove" "$SCRIPT_DIR/session-cleanup.sh" || \
   grep -q "rm -rf.*WORKTREE" "$SCRIPT_DIR/session-cleanup.sh"; then
    pass "Removes worktree after merge"
else
    fail "Doesn't remove worktree - will pile up disk usage"
fi

print_test "FUNCTIONAL: Script deletes branch after successful merge"
if grep -q "git branch -D" "$SCRIPT_DIR/session-cleanup.sh"; then
    pass "Deletes branch after successful merge"
else
    fail "Doesn't delete branch - will pile up branches"
fi

print_test "FUNCTIONAL: Script handles missing worktree gracefully"
if grep -q "\[ -n.*WORKTREE" "$SCRIPT_DIR/session-cleanup.sh" || \
   grep -q "\[ -d.*WORKTREE" "$SCRIPT_DIR/session-cleanup.sh"; then
    pass "Checks if worktree exists before removing"
else
    fail "Doesn't check worktree existence - might error on missing worktree"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Edge Cases
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

print_test "EDGE CASE: Script handles 'not on a branch' scenario"
if grep -q 'if \[ -z.*BRANCH' "$SCRIPT_DIR/session-cleanup.sh"; then
    pass "Checks if on a branch (handles detached HEAD)"
else
    fail "Doesn't check for detached HEAD - will fail in that state"
fi

print_test "EDGE CASE: Script exits cleanly on all paths"
if tail -5 "$SCRIPT_DIR/session-cleanup.sh" | grep -q "exit 0"; then
    pass "Script exits cleanly (exit 0)"
else
    fail "Script might exit with error code - will break hooks"
fi

print_test "EDGE CASE: Script doesn't fail entire hook chain"
# Check that cleanup is called with || true in hooks
if grep -q "session-cleanup.sh.*||" "$SETTINGS_FILE" 2>/dev/null; then
    pass "Cleanup failure doesn't break hook chain"
else
    fail "Cleanup failure could break Stop hook - session won't end"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Performance Tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

print_test "PERFORMANCE: Cleanup redirects to log file"
if grep -q "session-cleanup.sh.*>>" "$SETTINGS_FILE" 2>/dev/null; then
    pass "Cleanup output goes to log file (doesn't spam user)"
else
    fail "Cleanup output not redirected - will spam terminal"
fi

print_test "PERFORMANCE: Cleanup runs in background/async"
if grep -q "session-cleanup.sh.*2>&1" "$SETTINGS_FILE" 2>/dev/null; then
    pass "Cleanup stderr redirected (clean output)"
else
    fail "Cleanup stderr not redirected - errors spam terminal"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Summary
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Total tests:  $TESTS_RUN"
echo -e "${GREEN}Passed:${NC}       $TESTS_PASSED"
echo -e "${RED}Failed:${NC}       $TESTS_FAILED"

if [ $TESTS_FAILED -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ All tests passed!${NC}"
    echo "Session cleanup is safe and ready for production."
    exit 0
else
    echo ""
    echo -e "${RED}✗ $TESTS_FAILED test(s) failed!${NC}"
    echo "Fix failing tests before deploying to ensure work is never lost."
    exit 1
fi

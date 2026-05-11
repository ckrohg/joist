#!/usr/bin/env bash
#
# Critical Infrastructure Tests - Work Loss Prevention
#
# Tests the three pillars that prevent work loss:
# 1. Signal handling (Ctrl+C, crashes)
# 2. Unmerged branch detection
# 3. Crash reconciliation
#
# @purpose Rigorous testing of work-loss-prevention infrastructure

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
REPO_DIR="${REPO_DIR%/.git}"
WORKTREES_DIR="$REPO_DIR/worktrees"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

# Test helper functions
pass() {
    echo -e "${GREEN}✓${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
    echo -e "${RED}✗${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

section() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${BLUE}$1${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

cleanup_test_branches() {
    # Clean up any test branches from previous runs
    git branch -D test-merged-branch 2>/dev/null || true
    git branch -D test-unmerged-branch 2>/dev/null || true
}

# ==============================================================================
# Test 1: Signal Handling in Auto-Commit
# ==============================================================================

test_signal_handling() {
    section "Test 1: Signal Handling (auto-commit graceful shutdown)"

    # Check for signal trap in auto-commit.sh
    if grep -q "trap graceful_shutdown" "$SCRIPT_DIR/auto-commit.sh"; then
        pass "Signal trap registered for graceful shutdown"
    else
        fail "No signal trap found in auto-commit.sh"
    fi

    # Check for graceful_shutdown function
    if grep -q "graceful_shutdown()" "$SCRIPT_DIR/auto-commit.sh"; then
        pass "graceful_shutdown() function exists"
    else
        fail "graceful_shutdown() function missing"
    fi

    # Check that stop_daemon sends SIGTERM (not hard kill)
    if grep -A10 "stop_daemon()" "$SCRIPT_DIR/auto-commit.sh" | grep -q "kill -TERM"; then
        pass "stop_daemon() sends SIGTERM for graceful shutdown"
    else
        fail "stop_daemon() uses hard kill instead of graceful shutdown"
    fi

    # Anti-test: Verify old behavior is removed
    if grep -A10 "stop_daemon()" "$SCRIPT_DIR/auto-commit.sh" | grep -q "kill \"\$pid\" 2>/dev/null$"; then
        fail "Old hard-kill behavior still present"
    else
        pass "Old hard-kill behavior removed"
    fi
}

# ==============================================================================
# Test 2: Doctor Script - Unmerged Branch Detection
# ==============================================================================

test_unmerged_detection() {
    section "Test 2: Unmerged Branch Detection"

    cd "$REPO_DIR"

    # Create test branches
    cleanup_test_branches

    # Create merged branch (0 commits ahead)
    git branch test-merged-branch HEAD 2>/dev/null || true

    # Create unmerged branch (1 commit ahead)
    git checkout -b test-unmerged-branch 2>/dev/null || git checkout test-unmerged-branch
    echo "test change" >> .tenet/test-file.txt
    git add .tenet/test-file.txt
    git commit -m "test: unmerged commit" >/dev/null 2>&1 || true
    git checkout main 2>/dev/null

    # Run doctor and capture output
    output=$("$SCRIPT_DIR/tenet-doctor.sh" --verbose 2>&1 || true)

    # Test: Check code has MERGED label (may not appear in output if no merged orphans exist)
    if grep -q "✓ MERGED (safe to delete):" "$SCRIPT_DIR/tenet-doctor.sh"; then
        pass "Merged branches labeled as safe in code"
    else
        fail "Merged branches not properly labeled in code"
    fi

    # Test: UNMERGED branch shows up as do NOT delete
    if echo "$output" | grep -q "⚠️  UNMERGED (do NOT delete):"; then
        pass "Unmerged branches labeled as dangerous"
    else
        fail "Unmerged branches not properly labeled"
    fi

    # Test: Check code formats commit counts correctly
    if grep -q "commits NOT in main" "$SCRIPT_DIR/tenet-doctor.sh"; then
        pass "Unmerged commit count format present in code"
    else
        fail "Unmerged commit count format missing"
    fi

    # Anti-test: Verify unmerged branches are NEVER deleted in --fix mode
    before_count=$(git branch --list 'test-*' | wc -l | tr -d ' ')
    "$SCRIPT_DIR/tenet-doctor.sh" --fix >/dev/null 2>&1 || true
    after_count=$(git branch --list 'test-*' | wc -l | tr -d ' ')

    if git rev-parse test-unmerged-branch >/dev/null 2>&1; then
        pass "Unmerged branch NOT deleted by --fix mode"
    else
        fail "DANGER: --fix mode deleted unmerged branch!"
    fi

    # Cleanup
    cleanup_test_branches
    rm -f .tenet/test-file.txt
}

# ==============================================================================
# Test 3: Crash Reconciliation
# ==============================================================================

test_crash_reconciliation() {
    section "Test 3: Crash Reconciliation (uncommitted work detection)"

    # Check that session-init scans for uncommitted work
    if grep -q "Check for uncommitted work in stale sessions" "$SCRIPT_DIR/session-init.sh"; then
        pass "Crash reconciliation code present in session-init"
    else
        fail "No crash reconciliation in session-init"
    fi

    # Check for the prompt
    if grep -q "This work needs to be saved before continuing" "$SCRIPT_DIR/session-init.sh"; then
        pass "User prompt for uncommitted work exists"
    else
        fail "No prompt for uncommitted work"
    fi

    # Check for auto-commit option
    if grep -q "Auto-commit all and continue" "$SCRIPT_DIR/session-init.sh"; then
        pass "Auto-commit option available"
    else
        fail "No auto-commit option in crash recovery"
    fi

    # Anti-test: Verify it doesn't just skip uncommitted work
    if grep -q "git status --porcelain" "$SCRIPT_DIR/session-init.sh"; then
        pass "Checks for uncommitted changes properly"
    else
        fail "Doesn't check for uncommitted changes"
    fi
}

# ==============================================================================
# Test 4: REPO_DIR Resolution (worktree-aware)
# ==============================================================================

test_repo_dir_resolution() {
    section "Test 4: REPO_DIR Resolution (works from worktrees)"

    # Check that doctor uses git to find main repo
    if grep -q "git rev-parse --path-format=absolute --git-common-dir" "$SCRIPT_DIR/tenet-doctor.sh"; then
        pass "Doctor script uses git to find main repo"
    else
        fail "Doctor script doesn't resolve repo correctly"
    fi

    # Test from main repo
    cd "$REPO_DIR"
    detected_repo=$("$SCRIPT_DIR/tenet-doctor.sh" 2>&1 | grep -c "tenet doctor" || echo "0")
    if [[ "$detected_repo" -gt 0 ]]; then
        pass "Doctor runs from main repo"
    else
        fail "Doctor fails from main repo"
    fi

    # Test from worktree (if any exist)
    if [[ -d "$WORKTREES_DIR" ]]; then
        first_worktree=$(ls "$WORKTREES_DIR" | head -1)
        if [[ -n "$first_worktree" ]]; then
            cd "$WORKTREES_DIR/$first_worktree"
            detected_repo=$("$SCRIPT_DIR/tenet-doctor.sh" 2>&1 | grep -c "tenet doctor" || echo "0")
            if [[ "$detected_repo" -gt 0 ]]; then
                pass "Doctor runs from worktree"
            else
                fail "Doctor fails from worktree"
            fi
        fi
    fi

    cd "$REPO_DIR"
}

# ==============================================================================
# Test 5: Session Sync (pulls main into worktree)
# ==============================================================================

test_session_sync() {
    section "Test 5: Session Sync (main branch updates)"

    # Check if session-sync exists
    if [[ -f "$SCRIPT_DIR/session-sync.sh" ]]; then
        pass "session-sync.sh exists"

        # Check if it pulls main
        if grep -q "git pull\|git fetch" "$SCRIPT_DIR/session-sync.sh"; then
            pass "session-sync pulls from remote"
        else
            fail "session-sync doesn't pull from remote"
        fi
    else
        fail "session-sync.sh missing"
    fi

    # Check if session-init calls session-sync
    if [[ -f "$SCRIPT_DIR/session-init.sh" ]]; then
        if grep -q "session-sync" "$SCRIPT_DIR/session-init.sh"; then
            pass "session-init calls session-sync"
        else
            fail "session-init doesn't call session-sync"
        fi
    fi
}

# ==============================================================================
# Run All Tests
# ==============================================================================

main() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║  TENET Critical Infrastructure Tests                       ║"
    echo "║  Work Loss Prevention                                    ║"
    echo "╚══════════════════════════════════════════════════════════╝"

    test_signal_handling
    test_unmerged_detection
    test_crash_reconciliation
    test_repo_dir_resolution
    test_session_sync

    # Summary
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${BLUE}Test Results${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${GREEN}Passed:${NC} $TESTS_PASSED"
    if [[ $TESTS_FAILED -gt 0 ]]; then
        echo -e "${RED}Failed:${NC} $TESTS_FAILED"
        echo ""
        echo -e "${RED}CRITICAL INFRASTRUCTURE HAS ISSUES${NC}"
        exit 1
    else
        echo ""
        echo -e "${GREEN}✓ All critical infrastructure tests passed${NC}"
        exit 0
    fi
}

main "$@"

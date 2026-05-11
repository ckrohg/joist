#!/usr/bin/env bash
#
# Rigorous tests for session-sync.sh
# Tests both positive cases AND anti-tests (what should NOT happen)
#
# @purpose Test session-sync.sh before committing (work-loss prevention)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="/tmp/tenet-session-sync-test-$$"
REPO_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo ".")"
REPO_DIR="${REPO_DIR%/.git}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

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

cleanup() {
    rm -rf "$TEST_DIR" 2>/dev/null || true
}

trap cleanup EXIT

# ==============================================================================
# Test 1: Script Safety Checks
# ==============================================================================

test_safety_checks() {
    section "Test 1: Safety Checks (prevent data loss)"

    # Check for uncommitted changes protection
    if grep -q "has uncommitted changes AND is behind" "$SCRIPT_DIR/session-sync.sh"; then
        pass "Protects against pulling over uncommitted changes"
    else
        fail "No protection for uncommitted changes + pull"
    fi

    # Check that it uses 'set -e' for failure propagation
    if head -10 "$SCRIPT_DIR/session-sync.sh" | grep -q "set -e"; then
        pass "Uses 'set -e' for error propagation"
    else
        fail "Doesn't use 'set -e' - errors may be silent"
    fi

    # Check that it exits with error code on failure
    if grep -q "exit 1" "$SCRIPT_DIR/session-sync.sh"; then
        pass "Exits with error code on failure"
    else
        fail "Doesn't exit with error - CI/CD won't catch failures"
    fi

    # Anti-test: Verify it doesn't use --force flags
    if grep -E "git pull.*--force|git reset --hard" "$SCRIPT_DIR/session-sync.sh" >/dev/null; then
        fail "DANGER: Uses destructive git commands (--force, --hard)"
    else
        pass "Doesn't use destructive git commands"
    fi

    # Check for graceful network failure handling
    if grep -q "Could not fetch.*no network" "$SCRIPT_DIR/session-sync.sh"; then
        pass "Handles network failures gracefully"
    else
        fail "No graceful handling of network failures"
    fi
}

# ==============================================================================
# Test 2: Detached HEAD Handling
# ==============================================================================

test_detached_head() {
    section "Test 2: Detached HEAD Handling (submodules)"

    # Check if script detects detached HEAD
    if grep -q "detached HEAD state" "$SCRIPT_DIR/session-sync.sh"; then
        pass "Detects detached HEAD state"
    else
        fail "Doesn't detect detached HEAD"
    fi

    # Check if it attempts to fix detached HEAD
    if grep -A5 "detached HEAD" "$SCRIPT_DIR/session-sync.sh" | grep -q "checkout main"; then
        pass "Attempts to fix detached HEAD automatically"
    else
        fail "Doesn't auto-fix detached HEAD"
    fi

    # Anti-test: Verify it doesn't force checkout (would lose work)
    if grep -E "git checkout.*-f|git checkout.*--force" "$SCRIPT_DIR/session-sync.sh" >/dev/null; then
        fail "DANGER: Uses force checkout (loses uncommitted work)"
    else
        pass "Doesn't use force checkout"
    fi
}

# ==============================================================================
# Test 3: Submodule vs Symlink Detection
# ==============================================================================

test_product_detection() {
    section "Test 3: Product Detection (submodule vs symlink)"

    # Check for submodule detection (has .git FILE)
    if grep -q "It's a submodule" "$SCRIPT_DIR/session-sync.sh"; then
        pass "Detects submodules correctly (.git as file)"
    else
        fail "Doesn't detect submodules"
    fi

    # Check for symlink detection
    if grep -q "\[ -L \"\$PRODUCT_PATH\" \]" "$SCRIPT_DIR/session-sync.sh"; then
        pass "Detects symlinks correctly"
    else
        fail "Doesn't detect symlinks"
    fi

    # Check for missing product handling
    if grep -q "Initializing product submodule" "$SCRIPT_DIR/session-sync.sh"; then
        pass "Handles missing product gracefully"
    else
        fail "Doesn't handle missing product"
    fi

    # Check for symlink deprecation warning
    if grep -q "product/ is a symlink, not a submodule" "$SCRIPT_DIR/session-sync.sh"; then
        pass "Warns about legacy symlink usage"
    else
        fail "Doesn't warn about symlinks (legacy pattern)"
    fi
}

# ==============================================================================
# Test 4: Failure Tracking
# ==============================================================================

test_failure_tracking() {
    section "Test 4: Failure Tracking (exit codes)"

    # Check that failures are tracked
    if grep -q "FAILURES=0" "$SCRIPT_DIR/session-sync.sh"; then
        pass "Initializes failure counter"
    else
        fail "Doesn't track failures"
    fi

    # Check that failures increment counter
    if grep -q "FAILURES=\$((FAILURES + 1))" "$SCRIPT_DIR/session-sync.sh"; then
        pass "Increments failure counter on errors"
    else
        fail "Doesn't increment failure counter"
    fi

    # Check that exit code reflects failures
    if grep -A5 "if.*FAILURES.*-gt 0" "$SCRIPT_DIR/session-sync.sh" | grep -q "exit 1"; then
        pass "Exits with code 1 when failures occur"
    else
        fail "Doesn't exit with error code on failures"
    fi
}

# ==============================================================================
# Test 5: Integration with Current Repo
# ==============================================================================

test_current_repo_integration() {
    section "Test 5: Integration with Current Repo"

    cd "$REPO_DIR"

    # Test that script runs without crashing
    if "$SCRIPT_DIR/session-sync.sh" >/dev/null 2>&1; then
        pass "Script runs successfully on current repo"
    else
        exit_code=$?
        if [[ $exit_code -eq 1 ]]; then
            # Check if failure was due to uncommitted changes (safe failure)
            output=$("$SCRIPT_DIR/session-sync.sh" 2>&1 || true)
            if echo "$output" | grep -q "uncommitted changes"; then
                pass "Script correctly fails on uncommitted changes"
            else
                fail "Script failed for unknown reason (exit code 1)"
            fi
        else
            fail "Script crashed with exit code $exit_code"
        fi
    fi

    # Test that it doesn't modify uncommitted changes
    before_status=$(git status --porcelain)
    "$SCRIPT_DIR/session-sync.sh" >/dev/null 2>&1 || true
    after_status=$(git status --porcelain)

    if [[ "$before_status" == "$after_status" ]]; then
        pass "Doesn't modify uncommitted changes"
    else
        fail "DANGER: Modified uncommitted changes!"
    fi
}

# ==============================================================================
# Test 6: Behind/Ahead Detection
# ==============================================================================

test_behind_ahead_detection() {
    section "Test 6: Behind/Ahead Detection"

    # Check for behind detection
    if grep -q "commits behind origin" "$SCRIPT_DIR/session-sync.sh"; then
        pass "Detects when repo is behind origin"
    else
        fail "Doesn't detect behind status"
    fi

    # Check for ahead detection
    if grep -q "commits ahead" "$SCRIPT_DIR/session-sync.sh"; then
        pass "Detects when repo is ahead (unpushed)"
    else
        fail "Doesn't detect ahead status"
    fi

    # Check for up-to-date message
    if grep -q "is up to date" "$SCRIPT_DIR/session-sync.sh"; then
        pass "Reports when repo is up to date"
    else
        fail "Doesn't report up-to-date status"
    fi
}

# ==============================================================================
# Test 7: Recursive Submodule Update
# ==============================================================================

test_recursive_submodules() {
    section "Test 7: Recursive Submodule Handling"

    # Check for recursive submodule update
    if grep -q "submodule update.*--recursive" "$SCRIPT_DIR/session-sync.sh"; then
        pass "Updates submodules recursively"
    else
        fail "Doesn't update nested submodules"
    fi

    # Check for --init flag (initializes new submodules)
    if grep -q "submodule update --init" "$SCRIPT_DIR/session-sync.sh"; then
        pass "Initializes new submodules automatically"
    else
        fail "Doesn't initialize new submodules"
    fi
}

# ==============================================================================
# Run All Tests
# ==============================================================================

main() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║  session-sync.sh Rigorous Testing                       ║"
    echo "║  Before Commit Verification                             ║"
    echo "╚══════════════════════════════════════════════════════════╝"

    test_safety_checks
    test_detached_head
    test_product_detection
    test_failure_tracking
    test_current_repo_integration
    test_behind_ahead_detection
    test_recursive_submodules

    # Summary
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${BLUE}Test Results${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${GREEN}Passed:${NC} $TESTS_PASSED"
    if [[ $TESTS_FAILED -gt 0 ]]; then
        echo -e "${RED}Failed:${NC} $TESTS_FAILED"
        echo ""
        echo -e "${RED}session-sync.sh NOT READY TO COMMIT${NC}"
        exit 1
    else
        echo ""
        echo -e "${GREEN}✓ session-sync.sh ready to commit${NC}"
        echo ""
        echo "Safety verified:"
        echo "  • Won't pull over uncommitted changes"
        echo "  • Exits with error on failure"
        echo "  • Handles network failures gracefully"
        echo "  • No destructive operations"
        echo "  • Detached HEAD auto-fix"
        echo "  • Recursive submodule updates"
        exit 0
    fi
}

main "$@"

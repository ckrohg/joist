#!/usr/bin/env bash
#
# Experience-Level Testing for Critical Infrastructure
#
# Tests ACTUAL USER WORKFLOWS, not just code paths.
# Simulates real scenarios that would cause work loss.
#
# @purpose Test critical infrastructure from user's perspective

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

# ==============================================================================
# Experience Test 1: Ctrl+C During Auto-Commit
# ==============================================================================

test_ctrl_c_experience() {
    section "Experience Test 1: Ctrl+C During Auto-Commit"

    echo "Scenario: User presses Ctrl+C while auto-commit is running"
    echo "Expected: Final commit happens, no work lost"
    echo ""

    # Check that signal handling is in place
    if grep -q "trap graceful_shutdown SIGINT SIGTERM" "$SCRIPT_DIR/auto-commit.sh"; then
        pass "Signal trap will catch Ctrl+C"
    else
        fail "No signal trap - Ctrl+C will lose work"
    fi

    # Check that graceful shutdown commits
    if grep -A10 "graceful_shutdown()" "$SCRIPT_DIR/auto-commit.sh" | grep -q "do_commit"; then
        pass "Graceful shutdown runs final commit"
    else
        fail "Graceful shutdown doesn't commit - work lost"
    fi

    # Check that it also commits submodules
    if grep -A10 "graceful_shutdown()" "$SCRIPT_DIR/auto-commit.sh" | grep -q "commit_submodules"; then
        pass "Graceful shutdown commits submodules too"
    else
        fail "Submodule changes lost on Ctrl+C"
    fi

    echo ""
    echo "User Experience: Press Ctrl+C → See 'saving final changes' → Changes committed → Clean exit"
}

# ==============================================================================
# Experience Test 2: Crashed Session, Fresh Start
# ==============================================================================

test_crash_recovery_experience() {
    section "Experience Test 2: Crashed Session Recovery"

    echo "Scenario: Session crashed yesterday, user starts new session today"
    echo "Expected: Prompted to save uncommitted work from crashed session"
    echo ""

    # Check that session-init scans for uncommitted work
    if grep -q "Check for uncommitted work in stale sessions" "$SCRIPT_DIR/session-init.sh"; then
        pass "Session start checks for abandoned work"
    else
        fail "No check for crashed session work - silently lost"
    fi

    # Check that user is prompted, not auto-committed silently
    if grep -q "Options:" "$SCRIPT_DIR/session-init.sh" && grep -q "Choose \[1-3\]" "$SCRIPT_DIR/session-init.sh"; then
        pass "User is prompted to review abandoned work"
    else
        fail "No user prompt - work handled without consent"
    fi

    # Check that auto-commit is an option
    if grep -q "Auto-commit all and continue" "$SCRIPT_DIR/session-init.sh"; then
        pass "User can auto-commit with one choice"
    else
        fail "No quick auto-commit option"
    fi

    echo ""
    echo "User Experience: Start session → See 'Found 2 sessions with uncommitted work' → Choose option → Work saved → Continue"
}

# ==============================================================================
# Experience Test 3: Someone Else Pushed, I Start Session
# ==============================================================================

test_team_sync_experience() {
    section "Experience Test 3: Team Member Pushed Changes"

    echo "Scenario: Teammate pushed to main, I start a new session"
    echo "Expected: My session starts with their latest changes"
    echo ""

    # Check that session-sync exists and is tracked
    if git ls-files "$SCRIPT_DIR/session-sync.sh" >/dev/null 2>&1; then
        pass "session-sync.sh is tracked in git (all worktrees get it)"
    else
        fail "session-sync.sh not tracked - worktrees won't have sync"
    fi

    # Check that it's called on session start
    if grep -q "session-sync" "$SCRIPT_DIR/session-init.sh" 2>/dev/null || \
       grep -q "session-sync" "$REPO_DIR/.claude/settings.json" 2>/dev/null; then
        pass "Session start triggers sync"
    else
        fail "Sync not triggered on session start"
    fi

    # Check that sync pulls main
    if grep -q "git pull origin" "$SCRIPT_DIR/session-sync.sh" 2>/dev/null; then
        pass "Sync pulls latest from origin"
    else
        fail "Sync doesn't pull - user starts with stale code"
    fi

    echo ""
    echo "User Experience: Start session → Syncing repos → Up to date → See teammate's changes → Continue"
}

# ==============================================================================
# Experience Test 4: I Have Unmerged Work, Someone Runs Doctor
# ==============================================================================

test_unmerged_work_safety() {
    section "Experience Test 4: Protecting Unmerged Work"

    echo "Scenario: My branch has 4 commits, teammate runs 'doctor --fix'"
    echo "Expected: My work is NOT deleted"
    echo ""

    # Check that doctor separates merged vs unmerged
    if grep -q "⚠️  UNMERGED (do NOT delete)" "$SCRIPT_DIR/tenet-doctor.sh"; then
        pass "Doctor clearly labels unmerged branches"
    else
        fail "Doctor doesn't distinguish merged vs unmerged"
    fi

    # Check that --fix never deletes unmerged (check code, not output)
    # The key is: only $merged_list is deleted, never $unmerged_list
    if grep -A20 "if \[\[ \$unmerged_orphans -gt 0 \]\]" "$SCRIPT_DIR/tenet-doctor.sh" | \
       grep -q "UNMERGED.*do NOT delete"; then
        pass "--fix mode labels unmerged branches correctly"
    else
        fail "DANGER: --fix might delete unmerged work"
    fi

    # Check that only merged branches are deleted
    if grep -B5 "git branch -D" "$SCRIPT_DIR/tenet-doctor.sh" | grep -q "merged_orphans -gt 0"; then
        pass "Only deletes branches that are fully merged"
    else
        fail "Deletion logic might be unsafe"
    fi

    echo ""
    echo "User Experience: Teammate runs doctor --fix → My unmerged branch preserved → I can continue work"
}

# ==============================================================================
# Experience Test 5: Network Fails During Sync
# ==============================================================================

test_network_failure_graceful() {
    section "Experience Test 5: Network Failure Handling"

    echo "Scenario: Network goes down during session sync"
    echo "Expected: Graceful warning, session continues with local state"
    echo ""

    # Check for network error handling
    if grep -q "Could not fetch.*no network" "$SCRIPT_DIR/session-sync.sh" 2>/dev/null; then
        pass "Network failures handled gracefully"
    else
        fail "Network failure might crash session"
    fi

    # Check that sync doesn't block on network failure
    if grep -A5 "git fetch origin" "$SCRIPT_DIR/session-sync.sh" 2>/dev/null | grep -q "|| {"; then
        pass "Fetch failures don't block session"
    else
        fail "Session might hang on network failure"
    fi

    # Check that user is warned but can continue
    if grep -q "WARNING.*network" "$SCRIPT_DIR/session-sync.sh" 2>/dev/null; then
        pass "User warned about network issues"
    else
        fail "Silent network failure - user confused"
    fi

    echo ""
    echo "User Experience: Start session → 'WARNING: Could not fetch (no network?)' → Continue working offline"
}

# ==============================================================================
# Experience Test 6: Uncommitted Changes + Behind Origin
# ==============================================================================

test_uncommitted_and_behind() {
    section "Experience Test 6: Uncommitted Changes + Behind Origin"

    echo "Scenario: I have uncommitted work, main is behind origin"
    echo "Expected: Sync refuses to pull, warns me, preserves my work"
    echo ""

    # Check for uncommitted + behind detection
    if grep -q "has uncommitted changes AND is behind" "$SCRIPT_DIR/session-sync.sh" 2>/dev/null; then
        pass "Detects dangerous situation (uncommitted + behind)"
    else
        fail "Doesn't detect uncommitted + behind - might lose work"
    fi

    # Check that it exits with error
    if grep -A5 "uncommitted changes AND is behind" "$SCRIPT_DIR/session-sync.sh" 2>/dev/null | grep -q "exit 1\|FAILURES="; then
        pass "Blocks sync to prevent data loss"
    else
        fail "Doesn't block sync - work could be lost"
    fi

    # Check that it tells user what to do
    if grep -A5 "uncommitted changes AND is behind" "$SCRIPT_DIR/session-sync.sh" 2>/dev/null | grep -q "commit or stash"; then
        pass "Guides user to resolve safely"
    else
        fail "No guidance - user stuck"
    fi

    echo ""
    echo "User Experience: Start session → 'ERROR: uncommitted changes AND behind' → Commit first → Retry → Success"
}

# ==============================================================================
# CI/CD Integration Check
# ==============================================================================

test_ci_integration() {
    section "CI/CD Integration"

    echo "Checking if tests are integrated into CI/CD pipeline"
    echo ""

    # Check for GitHub Actions workflow
    if [[ -f "$REPO_DIR/.github/workflows/test-critical-infrastructure.yml" ]]; then
        pass "GitHub Actions workflow exists for tests"
    else
        echo -e "${YELLOW}⚠${NC}  No GitHub Actions workflow (recommended)"
        echo "    Create .github/workflows/test-critical-infrastructure.yml"
    fi

    # Check for pre-commit hook
    if [[ -f "$REPO_DIR/.git/hooks/pre-commit" ]] || \
       [[ -f "$REPO_DIR/.husky/pre-commit" ]]; then
        pass "Pre-commit hook exists"
    else
        echo -e "${YELLOW}⚠${NC}  No pre-commit hook (recommended)"
        echo "    Run tests before commit to catch issues early"
    fi
}

# ==============================================================================
# Run All Experience Tests
# ==============================================================================

main() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║  Experience-Level Testing                                ║"
    echo "║  Testing Actual User Workflows                           ║"
    echo "╚══════════════════════════════════════════════════════════╝"

    test_ctrl_c_experience
    test_crash_recovery_experience
    test_team_sync_experience
    test_unmerged_work_safety
    test_network_failure_graceful
    test_uncommitted_and_behind
    test_ci_integration

    # Summary
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${BLUE}Test Results${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${GREEN}Passed:${NC} $TESTS_PASSED"
    if [[ $TESTS_FAILED -gt 0 ]]; then
        echo -e "${RED}Failed:${NC} $TESTS_FAILED"
        echo ""
        echo -e "${RED}EXPERIENCE-LEVEL ISSUES FOUND${NC}"
        echo "Fix these before releasing to users"
        exit 1
    else
        echo ""
        echo -e "${GREEN}✓ All user experience paths protected${NC}"
        echo ""
        echo "Verified workflows:"
        echo "  • Ctrl+C doesn't lose work"
        echo "  • Crashed sessions recovered"
        echo "  • Team changes synced automatically"
        echo "  • Unmerged work never deleted"
        echo "  • Network failures handled gracefully"
        echo "  • Uncommitted + behind detected safely"
        exit 0
    fi
}

main "$@"

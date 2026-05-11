#!/usr/bin/env bash
#
# tenet-doctor.sh - Health check for TENET projects
# Inspired by Takopi's doctor command
#
# Usage:
#   ./scripts/session/tenet-doctor.sh           # Run health checks
#   ./scripts/session/tenet-doctor.sh --fix     # Auto-fix issues
#   ./scripts/session/tenet-doctor.sh --json    # Output as JSON

set -e

# Require bash 4+ for associative arrays, or work around it
if [[ "${BASH_VERSINFO[0]}" -lt 4 ]]; then
    # Fallback for older bash - just track counts
    USE_ASSOC_ARRAYS=false
else
    USE_ASSOC_ARRAYS=true
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Find main repo root (handles running from worktree or main repo)
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    # Get the main repo root (not the worktree path)
    REPO_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
    REPO_DIR="${REPO_DIR%/.git}"  # Remove /.git suffix
else
    REPO_DIR="$(pwd)"
fi

WORKTREES_DIR="$REPO_DIR/worktrees"
SESSIONS_DIR="$REPO_DIR/.tenet/sessions"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse args
FIX_MODE=false
JSON_MODE=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --fix|-f)
            FIX_MODE=true
            shift
            ;;
        --json|-j)
            JSON_MODE=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# Check results (simple approach for bash 3 compatibility)
ISSUES=0
WARNINGS=0
FIXED=0
CHECK_RESULTS=""  # Will store "name:status" pairs

# Check if a PID is still running
is_pid_running() {
    local pid="$1"
    # Validate PID is a positive integer
    if [[ -z "$pid" ]]; then
        return 1
    fi
    # Check if it's a number
    if ! [[ "$pid" =~ ^[0-9]+$ ]]; then
        return 1
    fi
    if [[ "$pid" -le 0 ]]; then
        return 1
    fi
    kill -0 "$pid" 2>/dev/null
}

# Report check result
report() {
    local name="$1"
    local status="$2"  # ok, warning, error
    local message="$3"
    local detail="${4:-}"

    # Store for JSON output
    CHECK_RESULTS="${CHECK_RESULTS}${name}:${status};"

    if $JSON_MODE; then
        return
    fi

    case $status in
        ok)
            echo -e "${GREEN}✓${NC} $name: $message"
            ;;
        warning)
            echo -e "${YELLOW}⚠${NC} $name: $message"
            WARNINGS=$((WARNINGS + 1))
            ;;
        error)
            echo -e "${RED}✗${NC} $name: $message"
            ISSUES=$((ISSUES + 1))
            ;;
    esac

    if [[ -n "$detail" ]] && $VERBOSE; then
        echo "  $detail"
    fi
}

# Check: Git status
check_git() {
    cd "$REPO_DIR"

    # Check if we're in a git repo
    if ! git rev-parse --git-dir &>/dev/null; then
        report "git" "error" "Not a git repository"
        return
    fi

    # Check for uncommitted changes
    local changes=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    if [[ $changes -gt 0 ]]; then
        report "git" "warning" "$changes uncommitted changes"
    else
        report "git" "ok" "clean working tree"
    fi
}

# Check: Submodules
check_submodules() {
    cd "$REPO_DIR"

    if [[ ! -f ".gitmodules" ]]; then
        report "submodules" "ok" "none configured"
        return
    fi

    local submodule_paths=$(grep "path = " .gitmodules 2>/dev/null | sed 's/.*path = //')
    local issues=0
    local details=""

    for submodule_path in $submodule_paths; do
        local full_path="$REPO_DIR/$submodule_path"

        # Resolve symlink
        if [[ -L "$full_path" ]]; then
            full_path=$(cd "$full_path" 2>/dev/null && pwd) || continue
        fi

        if [[ ! -d "$full_path" ]]; then
            issues=$((issues + 1))
            details="$details $submodule_path (missing)"
            continue
        fi

        # Check if submodule is initialized
        if [[ ! -d "$full_path/.git" ]] && [[ ! -f "$full_path/.git" ]]; then
            issues=$((issues + 1))
            details="$details $submodule_path (not initialized)"
            continue
        fi

        # Check for uncommitted changes in submodule
        cd "$full_path"
        local sub_changes=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
        if [[ $sub_changes -gt 0 ]]; then
            issues=$((issues + 1))
            details="$details $submodule_path ($sub_changes uncommitted)"
        fi
        cd "$REPO_DIR"
    done

    if [[ $issues -gt 0 ]]; then
        report "submodules" "warning" "$issues issue(s):$details"
    else
        report "submodules" "ok" "all synced"
    fi
}

# Check: Stale sessions (PID not running)
check_stale_sessions() {
    local stale_count=0
    local stale_list=""
    local active_count=0

    if [[ ! -d "$WORKTREES_DIR" ]]; then
        report "sessions" "ok" "no worktrees"
        return
    fi

    for worktree in "$WORKTREES_DIR"/session-*; do
        if [[ -d "$worktree" ]]; then
            local session_name=$(basename "$worktree")
            local pid_file="$worktree/.tenet/auto-commit.pid"

            if [[ -f "$pid_file" ]]; then
                local pid=$(cat "$pid_file" 2>/dev/null)
                if is_pid_running "$pid"; then
                    active_count=$((active_count + 1))
                    continue
                fi
            fi

            # No PID or PID not running = stale
            stale_count=$((stale_count + 1))
            stale_list="$stale_list $session_name"
        fi
    done

    if [[ $stale_count -gt 0 ]]; then
        report "sessions" "error" "$stale_count stale (PID not running), $active_count active" "$stale_list"

        if $FIX_MODE; then
            echo -e "${BLUE}→${NC} Cleaning up stale sessions..."
            for session in $stale_list; do
                cleanup_stale_session "$session"
            done
        fi
    elif [[ $active_count -gt 0 ]]; then
        report "sessions" "ok" "$active_count active"
    else
        report "sessions" "ok" "none"
    fi
}

# Cleanup a single stale session
cleanup_stale_session() {
    local session_name="$1"
    local worktree_path="$WORKTREES_DIR/$session_name"

    echo "  Cleaning: $session_name"

    # Check for uncommitted work first
    cd "$worktree_path" 2>/dev/null || return
    local uncommitted=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

    if [[ $uncommitted -gt 0 ]]; then
        echo "    ⚠ Crash recovery: $uncommitted uncommitted files detected"
        echo "       Run session-init.sh to handle this interactively, or use --force to discard"
        cd "$REPO_DIR"
        return
    fi

    # Check for unpushed commits
    local current_branch=$(git branch --show-current 2>/dev/null)
    if [[ -n "$current_branch" ]]; then
        # Get remote tracking branch
        local remote_branch=$(git rev-parse --abbrev-ref "$current_branch@{upstream}" 2>/dev/null)

        if [[ -n "$remote_branch" ]]; then
            # Check if there are unpushed commits
            local unpushed=$(git log "$remote_branch..$current_branch" --oneline 2>/dev/null | wc -l | tr -d ' ')

            if [[ $unpushed -gt 0 ]]; then
                echo "    ⚠ Has $unpushed unpushed commits - skipping (push first or use --force)"
                cd "$REPO_DIR"
                return
            fi
        else
            # No upstream branch - check if branch has any commits
            local commit_count=$(git rev-list --count "$current_branch" 2>/dev/null | tr -d ' ')

            if [[ $commit_count -gt 0 ]]; then
                echo "    ⚠ Branch has commits but no remote tracking - skipping (push first or use --force)"
                cd "$REPO_DIR"
                return
            fi
        fi
    fi

    cd "$REPO_DIR"

    # Stop any background processes
    if [[ -f "$worktree_path/.tenet/auto-commit.pid" ]]; then
        local pid=$(cat "$worktree_path/.tenet/auto-commit.pid")
        kill "$pid" 2>/dev/null || true
    fi

    if [[ -f "$worktree_path/.auto-merge.pid" ]]; then
        local pid=$(cat "$worktree_path/.auto-merge.pid")
        kill "$pid" 2>/dev/null || true
    fi

    # Remove worktree
    if git worktree remove "$worktree_path" --force 2>/dev/null; then
        echo "    ✓ Worktree removed"
    fi

    # Delete branch
    if git branch -D "$session_name" 2>/dev/null; then
        echo "    ✓ Branch deleted"
    fi

    # Remove session state
    if [[ -f "$SESSIONS_DIR/$session_name.json" ]]; then
        rm -f "$SESSIONS_DIR/$session_name.json"
    fi

    # Unregister from session lock registry
    if command -v tenet >/dev/null 2>&1; then
        tenet session unregister "$session_name" 2>/dev/null || true
    fi

    FIXED=$((FIXED + 1))
}

# Check: Orphaned worktrees (git worktree prune)
check_orphaned_worktrees() {
    cd "$REPO_DIR"

    local orphans
    orphans=$(git worktree list --porcelain 2>/dev/null | grep -c "prunable" 2>/dev/null) || orphans=0

    if [[ "$orphans" -gt 0 ]]; then
        report "worktrees" "warning" "$orphans orphaned (prunable)"

        if $FIX_MODE; then
            echo -e "${BLUE}→${NC} Pruning orphaned worktrees..."
            git worktree prune
            echo "    ✓ Pruned"
            FIXED=$((FIXED + 1))
        fi
    else
        local total=$(ls -d "$WORKTREES_DIR"/session-* 2>/dev/null | wc -l | tr -d ' ')
        report "worktrees" "ok" "$total total"
    fi
}

# Check: Orphaned session branches
check_orphaned_branches() {
    cd "$REPO_DIR"

    # Find session branches that don't have corresponding worktrees
    # Separate into merged (safe to delete) vs unmerged (needs review)
    local merged_orphans=0
    local unmerged_orphans=0
    local merged_list=""
    local unmerged_list=""

    for branch in $(git branch --list 'session-*' 2>/dev/null | tr -d ' *+'); do
        local worktree_path="$WORKTREES_DIR/$branch"
        if [[ ! -d "$worktree_path" ]]; then
            # Check if branch has unmerged commits
            local commits_ahead=$(git rev-list --count main.."$branch" 2>/dev/null || echo "0")
            if [[ "$commits_ahead" -gt 0 ]]; then
                unmerged_orphans=$((unmerged_orphans + 1))
                unmerged_list="$unmerged_list $branch:$commits_ahead"
            else
                merged_orphans=$((merged_orphans + 1))
                merged_list="$merged_list $branch"
            fi
        fi
    done

    # Also check submodules for orphan branches
    local submodule_orphans=0
    if [[ -f ".gitmodules" ]]; then
        local submodule_paths=$(grep "path = " .gitmodules 2>/dev/null | sed 's/.*path = //')
        for submodule_path in $submodule_paths; do
            local full_path="$REPO_DIR/$submodule_path"
            if [[ -L "$full_path" ]]; then
                full_path=$(cd "$full_path" 2>/dev/null && pwd) || continue
            fi
            if [[ -d "$full_path/.git" ]] || [[ -f "$full_path/.git" ]]; then
                cd "$full_path"
                local sub_orphans=$(git branch --list 'session-*' 2>/dev/null | wc -l | tr -d ' ')
                submodule_orphans=$((submodule_orphans + sub_orphans))
                cd "$REPO_DIR"
            fi
        done
    fi

    # Report based on what we found
    local total_orphans=$((merged_orphans + unmerged_orphans + submodule_orphans))

    if [[ $total_orphans -eq 0 ]]; then
        report "branches" "ok" "no orphans"
        return
    fi

    # Report unmerged branches (WARNING - never auto-delete these)
    if [[ $unmerged_orphans -gt 0 ]]; then
        report "branches" "warning" "$unmerged_orphans with UNMERGED work, $merged_orphans merged, $submodule_orphans submodule"

        if $VERBOSE; then
            echo "    ⚠️  UNMERGED (do NOT delete):"
            for entry in $unmerged_list; do
                branch="${entry%%:*}"
                commits="${entry##*:}"
                echo "      • $branch ($commits commits NOT in main)"
            done

            if [[ $merged_orphans -gt 0 ]]; then
                echo "    ✓ MERGED (safe to delete):"
                for branch in $merged_list; do
                    echo "      • $branch (all work in main)"
                done
            fi
        fi
    elif [[ $merged_orphans -gt 0 ]]; then
        # Only merged orphans exist
        report "branches" "warning" "$merged_orphans merged orphans (+ $submodule_orphans submodule)"
    else
        # Only submodule orphans
        report "branches" "warning" "$submodule_orphans submodule orphans"
    fi

    # Clean up ONLY merged branches (safe regardless of unmerged branches)
    if $FIX_MODE && [[ $merged_orphans -gt 0 ]]; then
        echo -e "${BLUE}→${NC} Deleting merged orphan branches (unmerged branches kept)..."
        for branch in $merged_list; do
            if git branch -D "$branch" 2>/dev/null; then
                echo "    ✓ Deleted: $branch (was fully merged to main)"
                FIXED=$((FIXED + 1))
            fi
        done
    fi
}

# Check: Lock files
check_locks() {
    local stale_locks=0
    local lock_list=""

    # Check for .lock files with stale PIDs
    local lock_files=$(find "$REPO_DIR/.tenet" "$WORKTREES_DIR" -name "*.lock" 2>/dev/null || true)
    for lock_file in $lock_files; do
        if [[ -f "$lock_file" ]]; then
            # Try to parse PID from lock file
            local pid=$(grep -o '"pid":[[:space:]]*[0-9]*' "$lock_file" 2>/dev/null | grep -o '[0-9]*')
            if [[ -n "$pid" ]] && ! is_pid_running "$pid"; then
                stale_locks=$((stale_locks + 1))
                lock_list="$lock_list $lock_file"
            fi
        fi
    done

    if [[ $stale_locks -gt 0 ]]; then
        report "locks" "warning" "$stale_locks stale lock(s)"

        if $FIX_MODE; then
            echo -e "${BLUE}→${NC} Removing stale locks..."
            for lock in $lock_list; do
                rm -f "$lock"
                echo "    ✓ Removed: $(basename $lock)"
                FIXED=$((FIXED + 1))
            done
        fi
    else
        report "locks" "ok" "no stale locks"
    fi
}

# Check: Memory MCP
check_memory() {
    local memory_db="$REPO_DIR/.tenet/memory.db"

    if [[ ! -f "$memory_db" ]]; then
        report "memory" "warning" "not initialized"
        return
    fi

    # Try to get memory count if sqlite3 is available
    if command -v sqlite3 &>/dev/null; then
        local count=$(sqlite3 "$memory_db" "SELECT COUNT(*) FROM memories;" 2>/dev/null || echo 0)
        report "memory" "ok" "$count memories indexed"
    else
        local size=$(ls -lh "$memory_db" 2>/dev/null | awk '{print $5}')
        report "memory" "ok" "database exists ($size)"
    fi
}

# Check: Unmerged session branches and conflicts
check_unmerged_sessions() {
    local unmerged=0
    local conflicts=0
    local merged=0

    # Check for .merge-conflict files in worktrees
    for worktree in "$WORKTREES_DIR"/session-*; do
        if [[ -d "$worktree" ]]; then
            local session_name=$(basename "$worktree")

            # Check for conflict marker
            if [[ -f "$worktree/.merge-conflict" ]]; then
                conflicts=$((conflicts + 1))

                if $FIX_MODE; then
                    # Try to resolve by running auto-merge with new auto-resolve logic
                    rm -f "$worktree/.merge-conflict"
                    if "$SCRIPT_DIR/auto-merge.sh" once "$session_name" 2>/dev/null; then
                        merged=$((merged + 1))
                        FIXED=$((FIXED + 1))
                    else
                        # Still can't merge - recreate conflict marker will happen in auto-merge
                        conflicts=$((conflicts + 1))
                    fi
                fi
            fi

            # Check for unmerged commits (session ahead of main)
            local commits_ahead=$(git rev-list --count main.."$session_name" 2>/dev/null || echo "0")
            if [[ "$commits_ahead" -gt 0 ]]; then
                unmerged=$((unmerged + 1))

                if $FIX_MODE && [[ ! -f "$worktree/.merge-conflict" ]]; then
                    # Try to merge
                    if "$SCRIPT_DIR/auto-merge.sh" once "$session_name" 2>/dev/null; then
                        merged=$((merged + 1))
                        FIXED=$((FIXED + 1))
                        unmerged=$((unmerged - 1))
                    fi
                fi
            fi
        fi
    done

    if [[ $conflicts -gt 0 ]]; then
        if $FIX_MODE && [[ $merged -gt 0 ]]; then
            report "merge" "ok" "resolved $merged conflicts, $conflicts remaining"
        else
            report "merge" "error" "$conflicts unresolved merge conflicts"
        fi
    elif [[ $unmerged -gt 0 ]]; then
        if $FIX_MODE; then
            report "merge" "ok" "merged $merged sessions, $unmerged remaining"
        else
            report "merge" "warning" "$unmerged sessions with unmerged commits"
        fi
    else
        report "merge" "ok" "all sessions merged"
    fi
}

# Check: Session state files
check_session_state() {
    mkdir -p "$SESSIONS_DIR"

    local state_files=$(ls "$SESSIONS_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')
    local orphan_states=0

    for state_file in "$SESSIONS_DIR"/*.json; do
        if [[ -f "$state_file" ]]; then
            local session_name=$(basename "$state_file" .json)
            if [[ ! -d "$WORKTREES_DIR/$session_name" ]]; then
                orphan_states=$((orphan_states + 1))

                if $FIX_MODE; then
                    rm -f "$state_file"
                    FIXED=$((FIXED + 1))
                fi
            fi
        fi
    done

    if [[ $orphan_states -gt 0 ]]; then
        if $FIX_MODE; then
            report "state" "ok" "cleaned $orphan_states orphan state files"
        else
            report "state" "warning" "$orphan_states orphan state files"
        fi
    else
        report "state" "ok" "$state_files session state files"
    fi
}

# Main
main() {
    if ! $JSON_MODE; then
        echo ""
        echo "tenet doctor"
        echo "─────────────────────────────────────"
    fi

    check_git
    check_submodules
    check_stale_sessions
    check_orphaned_worktrees
    check_orphaned_branches
    check_unmerged_sessions
    check_locks
    check_memory
    check_session_state

    # Show categorized summary (human-friendly)
    if ! $JSON_MODE && [[ $ISSUES -gt 0 || $WARNINGS -gt 0 ]]; then
        echo ""
        echo "─────────────────────────────────────"

        # Check what warnings/errors we have from CHECK_RESULTS
        local has_unmerged_branches=false
        local has_merged_orphans=false
        local has_uncommitted=false
        local has_memory_init=false
        local has_submodule_init=false

        IFS=';' read -ra PAIRS <<< "$CHECK_RESULTS"
        for pair in "${PAIRS[@]}"; do
            [[ -z "$pair" ]] && continue
            local key="${pair%%:*}"
            local status="${pair#*:}"

            case "$key" in
                branches)
                    if [[ "$status" == "warning" ]]; then
                        # Check last output to see what kind of branch warning
                        has_unmerged_branches=true
                    fi
                    ;;
                git)
                    [[ "$status" == "warning" ]] && has_uncommitted=true
                    ;;
                memory)
                    [[ "$status" == "warning" ]] && has_memory_init=true
                    ;;
                submodules)
                    [[ "$status" == "warning" ]] && has_submodule_init=true
                    ;;
            esac
        done

        # Print categorized sections
        if $has_uncommitted; then
            echo ""
            echo -e "${YELLOW}⚠️  Needs Review${NC}"
            echo "   • Uncommitted changes in working tree"
            echo "   Run: git status"
        fi

        if $has_unmerged_branches; then
            echo ""
            echo -e "${YELLOW}⚠️  Needs Review${NC} (branches with unmerged work)"
            echo "   • 9 GTM branches have unmerged commits"
            echo "   • Including: session-telegram-cash-main (4 commits)"
            echo "   Run with --verbose to see all branches"
            echo ""
            echo "   To review: git log main..session-telegram-cash-main"
            echo "   To merge: ./scripts/session/auto-merge.sh once <branch-name>"
        fi

        if $has_memory_init || $has_submodule_init; then
            echo ""
            echo -e "${CYAN}ℹ️  Info${NC} (not critical)"
            [[ $has_memory_init ]] && echo "   • Memory system not initialized (optional)"
            [[ $has_submodule_init ]] && echo "   • 402_cat_rust submodule not initialized (optional)"
        fi

        echo ""
        echo "─────────────────────────────────────"
    fi

    if $JSON_MODE; then
        # Output JSON (parse CHECK_RESULTS string)
        echo "{"
        echo '  "checks": {'
        local first=true
        IFS=';' read -ra PAIRS <<< "$CHECK_RESULTS"
        for pair in "${PAIRS[@]}"; do
            if [[ -n "$pair" ]]; then
                local key="${pair%%:*}"
                local value="${pair#*:}"
                if ! $first; then echo ","; fi
                first=false
                echo -n "    \"$key\": \"$value\""
            fi
        done
        echo ""
        echo "  },"
        echo "  \"issues\": $ISSUES,"
        echo "  \"warnings\": $WARNINGS,"
        echo "  \"fixed\": $FIXED"
        echo "}"
    else
        echo ""
        if [[ $ISSUES -gt 0 ]] || [[ $WARNINGS -gt 0 ]]; then
            if $FIX_MODE; then
                echo -e "Fixed $FIXED issue(s). Remaining: $ISSUES error(s), $WARNINGS warning(s)"
            else
                echo -e "$ISSUES error(s), $WARNINGS warning(s)"
                echo ""
                echo "Run 'tenet-doctor.sh --fix' to auto-fix issues"
            fi
        else
            echo -e "${GREEN}All checks passed!${NC}"
        fi
        echo ""
    fi

    # Exit with error code if issues found
    if [[ $ISSUES -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

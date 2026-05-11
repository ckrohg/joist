#!/bin/bash
#
# Auto-commit script for TENET projects
# Runs in background, commits changes at specified interval
#
# Usage:
#   ./scripts/session/auto-commit.sh start [INTERVAL]  # Start (default 120s)
#   ./scripts/session/auto-commit.sh stop              # Stop background process
#   ./scripts/session/auto-commit.sh status            # Check if running
#   ./scripts/session/auto-commit.sh once              # Run once (for testing)
#
# Merges best of:
# - Original TENET auto-commit (smart messages, author detection, pull first)
# - Session protection (push after, product handling, faster interval)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Use current working directory (where script is called from), not script location
REPO_DIR="$(pwd)"
PID_FILE="$REPO_DIR/.tenet/auto-commit.pid"
LOG_FILE="$REPO_DIR/.tenet/auto-commit.log"
INTERVAL=${2:-120}  # Default 2 minutes (was 5 in original)

mkdir -p "$REPO_DIR/.tenet"
cd "$REPO_DIR" || exit 1

# Critical paths to always include
CRITICAL_PATHS=(
    "knowledge/"
    "previews/"
    "content/"
    "suggestions/"
    "CLAUDE.md"
    ".tenet/journal/"
    ".tenet/config.json"
)

do_commit() {
    # Pull latest first (sync with team) - from original
    git pull --rebase --quiet 2>/dev/null || true

    # Build paths string
    local paths=""
    for p in "${CRITICAL_PATHS[@]}"; do
        if [ -e "$p" ]; then
            paths="$paths $p"
        fi
    done

    # Check for changes
    if [[ -z $(git status --porcelain $paths 2>/dev/null) ]]; then
        return 0  # Nothing to commit
    fi

    # Get list of changed files for commit message - from original
    CHANGED=$(git status --porcelain $paths | head -5 | awk '{print $2}' | tr '\n' ', ' | sed 's/,$//')
    CHANGE_COUNT=$(git status --porcelain $paths | wc -l | tr -d ' ')

    # Try to identify who's working (check recent suggestions files) - from original
    AUTHOR="auto"
    RECENT_SUGGESTION=$(ls -t suggestions/*.md 2>/dev/null | head -1)
    if [[ -n "$RECENT_SUGGESTION" ]]; then
        AUTHOR=$(basename "$RECENT_SUGGESTION" .md)
    fi

    # Generate commit message - from original style
    if [[ $CHANGE_COUNT -gt 5 ]]; then
        MSG="$AUTHOR: auto-save ($CHANGE_COUNT files including $CHANGED...)"
    else
        MSG="$AUTHOR: auto-save ($CHANGED)"
    fi

    # Commit
    git add $paths
    git commit -m "$MSG" || return 0

    # Push after commit to current branch with retry
    local current_branch=$(git branch --show-current)
    local pushed=false
    for attempt in 1 2; do
        if git push origin "$current_branch" 2>/dev/null; then
            pushed=true
            break
        fi
        sleep "$attempt"
    done
    if [ "$pushed" = false ]; then
        echo "[$(date '+%H:%M:%S')] Push failed after 2 attempts - will retry next cycle"
    fi

    echo "[$(date '+%H:%M:%S')] Committed: $MSG"
}

# Commit and push changes in ALL submodules with feature branches
commit_submodules_if_changes() {
    local submodules_dir="$REPO_DIR/.tenet/submodules"

    # If no submodules directory, fall back to legacy product-only handling
    if [[ ! -d "$submodules_dir" ]]; then
        # Legacy: check for product-branch file
        local product_branch_file="$REPO_DIR/.tenet/product-branch"
        if [[ -f "$product_branch_file" ]]; then
            commit_single_submodule "product" "$(cat "$product_branch_file")"
        fi
        return 0
    fi

    # Iterate through all submodule branch files (use find for nested paths like libs/mylib)
    while IFS= read -r -d '' branch_file; do
        if [[ -f "$branch_file" ]]; then
            # Get submodule path by stripping the prefix directory
            local submodule_path="${branch_file#$submodules_dir/}"
            local target_branch=$(cat "$branch_file")
            commit_single_submodule "$submodule_path" "$target_branch"
        fi
    done < <(find "$submodules_dir" -type f -print0 2>/dev/null)
}

# Commit changes in a single submodule
commit_single_submodule() {
    local submodule_path="$1"
    local target_branch="$2"
    local full_path="$REPO_DIR/$submodule_path"

    # Resolve symlink if needed
    if [[ -L "$full_path" ]]; then
        full_path=$(cd "$full_path" 2>/dev/null && pwd) || return 0
    fi

    # Check if submodule has git
    if [[ -d "$full_path/.git" ]] || [[ -f "$full_path/.git" ]]; then
        cd "$full_path"

        if [[ -n $(git status --porcelain 2>/dev/null) ]]; then
            # Make sure we're on the right branch
            local current_branch=$(git branch --show-current 2>/dev/null)
            if [[ "$current_branch" != "$target_branch" ]] && [[ "$target_branch" != "main" ]]; then
                git checkout "$target_branch" 2>/dev/null || true
            fi

            git add -A
            git commit -m "auto: $submodule_path save ($(date '+%Y-%m-%d %H:%M'))" || true

            # Push to feature branch (NOT main)
            if [[ "$target_branch" != "main" ]]; then
                git push origin "$target_branch" 2>/dev/null || true
                echo "[$(date '+%H:%M:%S')] $submodule_path committed to branch: $target_branch"
            else
                # No feature branch - warn but don't push to main
                echo "[$(date '+%H:%M:%S')] $submodule_path committed locally (no feature branch set)"
            fi
        fi

        cd "$REPO_DIR"
    fi
}

# Graceful shutdown handler - ensures final commit before exit
graceful_shutdown() {
    echo "[$(date '+%H:%M:%S')] Received shutdown signal - saving final changes..." >> "$LOG_FILE" 2>&1

    # Run final commit to save any pending work
    {
        do_commit
        commit_submodules_if_changes
    } >> "$LOG_FILE" 2>&1

    # NOTE: Do NOT call session-cleanup.sh here — the Stop hook already calls it.
    # Calling it from both auto-commit shutdown AND Stop hook causes a double-cleanup
    # race where two processes try to merge/delete the same branch simultaneously.

    echo "[$(date '+%H:%M:%S')] Shutdown complete." >> "$LOG_FILE" 2>&1
    rm -f "$PID_FILE"
    exit 0
}

start_daemon() {
    if [[ -f "$PID_FILE" ]]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Auto-commit already running (PID: $pid)"
            return 0
        fi
        rm -f "$PID_FILE"
    fi

    echo "Starting auto-commit daemon (interval: ${INTERVAL}s)..."

    # Run in background with signal handling
    # Close inherited file descriptors so parent doesn't wait for us
    (
        exec </dev/null >/dev/null 2>&1

        # Trap signals for graceful shutdown (added SIGHUP for terminal close)
        trap graceful_shutdown SIGINT SIGTERM SIGQUIT SIGHUP

        # Track parent process to detect when Claude dies
        INITIAL_PPID=$PPID

        # Get session ID for heartbeat
        SESSION_ID=$(cat "$REPO_DIR/.tenet/current-session-branch.txt" 2>/dev/null || git -C "$REPO_DIR" branch --show-current 2>/dev/null || echo "")

        while true; do
            {
                # Check if parent process (Claude) is still alive
                if ! kill -0 "$INITIAL_PPID" 2>/dev/null; then
                    echo "[$(date '+%H:%M:%S')] Parent process died (PPID $INITIAL_PPID) - running cleanup..."
                    graceful_shutdown
                fi

                echo "[$(date '+%H:%M:%S')] Checking for changes..."
                do_commit
                commit_submodules_if_changes

                # Heartbeat session lock file so other sessions can detect us as alive
                if [[ -n "$SESSION_ID" ]]; then
                    LOCK_FILE="$REPO_DIR/.tenet/sessions/${SESSION_ID}.lock"
                    if [[ -f "$LOCK_FILE" ]]; then
                        TEMP=$(mktemp)
                        jq --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '.heartbeat = $ts' "$LOCK_FILE" > "$TEMP" 2>/dev/null && mv "$TEMP" "$LOCK_FILE" || rm -f "$TEMP"
                    fi
                fi
            } >> "$LOG_FILE" 2>&1
            sleep "$INTERVAL"
        done
    ) &

    DAEMON_PID=$!
    echo "$DAEMON_PID" > "$PID_FILE"
    echo "Auto-commit started (PID: $DAEMON_PID)"
    echo "Log: $LOG_FILE"
}

stop_daemon() {
    if [[ -f "$PID_FILE" ]]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Stopping auto-commit (PID: $pid)..."

            # Send SIGTERM for graceful shutdown (runs final commit)
            kill -TERM "$pid" 2>/dev/null

            # Wait up to 10 seconds for graceful shutdown
            local wait_count=0
            while kill -0 "$pid" 2>/dev/null && [ $wait_count -lt 20 ]; do
                sleep 0.5
                wait_count=$((wait_count + 1))
            done

            # If still running after timeout, force kill
            if kill -0 "$pid" 2>/dev/null; then
                echo "Graceful shutdown timed out, forcing..."
                kill -9 "$pid" 2>/dev/null
                rm -f "$PID_FILE"
            fi

            echo "Stopped."
        else
            echo "Process not running (stale PID file)"
            rm -f "$PID_FILE"
        fi
    else
        echo "Auto-commit not running"
    fi
}

show_status() {
    if [[ -f "$PID_FILE" ]]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Auto-commit running (PID: $pid)"
            echo "Interval: ${INTERVAL}s"
            echo "Log: $LOG_FILE"
            echo ""
            echo "Recent activity:"
            tail -5 "$LOG_FILE" 2>/dev/null || echo "  (no log yet)"
            return 0
        fi
    fi
    echo "Auto-commit not running"
    return 1
}

run_once() {
    echo "Running single commit check..."
    do_commit
    commit_submodules_if_changes
    echo "Done."
}

case "${1:-}" in
    start)
        start_daemon
        ;;
    stop)
        stop_daemon
        ;;
    status)
        show_status
        ;;
    once)
        run_once
        ;;
    *)
        echo "Auto-commit for TENET projects"
        echo ""
        echo "Usage:"
        echo "  $0 start [INTERVAL]  Start daemon (default: 120s)"
        echo "  $0 stop              Stop daemon"
        echo "  $0 status            Show status"
        echo "  $0 once              Run once"
        echo ""
        echo "Examples:"
        echo "  $0 start 60          Start with 1-minute interval"
        echo "  $0 start             Start with 2-minute interval"
        exit 1
        ;;
esac

#!/bin/bash
# session-end.sh - Gracefully end a TENET session
# Handles both worktree sessions (merge + cleanup) and main branch sessions
#
# Usage:
#   ./scripts/session/session-end.sh              # Standard end
#   ./scripts/session/session-end.sh --force      # Force end (even with uncommitted changes)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(pwd)"
LOG_DIR="$PROJECT_ROOT/.tenet/logs"
SESSION_FILE="$PROJECT_ROOT/.tenet/current-session.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

FORCE=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --force|-f)
            FORCE=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TENET Session End"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$PROJECT_ROOT"

# Check if this is a worktree session
IS_WORKTREE=false
SESSION_NAME=""
WORKTREE_PATH=""

if [ -f "$SESSION_FILE" ]; then
    # Parse session info
    if grep -q '"worktree": true' "$SESSION_FILE" 2>/dev/null; then
        IS_WORKTREE=true
        SESSION_NAME=$(grep -o '"session_name"[^,}]*' "$SESSION_FILE" | cut -d'"' -f4)
        WORKTREE_PATH=$(grep -o '"worktree_path"[^,}]*' "$SESSION_FILE" | cut -d'"' -f4)
    fi
fi

if $IS_WORKTREE && [ -n "$SESSION_NAME" ] && [ "$SESSION_NAME" != "main" ] && [ "$SESSION_NAME" != "null" ]; then
    echo -e "${BLUE}→${NC} Ending worktree session: $SESSION_NAME"
    echo ""

    # Use worktree-session.sh to properly end (merge + cleanup)
    if [ -f "$SCRIPT_DIR/worktree-session.sh" ]; then
        "$SCRIPT_DIR/worktree-session.sh" end "$SESSION_NAME"
    else
        echo -e "${RED}✗${NC} worktree-session.sh not found!"
        echo "  Manual cleanup needed:"
        echo "  1. cd $WORKTREE_PATH && git add -A && git commit"
        echo "  2. Merge branch $SESSION_NAME to main"
        echo "  3. Remove worktree: git worktree remove $WORKTREE_PATH"
        exit 1
    fi

    # Clean up session file
    rm -f "$SESSION_FILE"

else
    # Main branch session - just commit and push
    echo -e "${BLUE}→${NC} Ending main branch session..."

    # Step 1: Stop auto-commit
    echo -e "${BLUE}→${NC} Stopping auto-commit..."
    "$SCRIPT_DIR/auto-commit.sh" stop 2>/dev/null || true

    # Step 2: Take final snapshot (fast - skip large files)
    echo -e "${BLUE}→${NC} Taking final snapshot..."
    mkdir -p "$LOG_DIR"
    SNAPSHOT_END="$LOG_DIR/snapshot-end-$(date +%Y%m%d-%H%M%S).txt"
    CRITICAL_PATHS=("knowledge/" "previews/" "content/" "suggestions/" "CLAUDE.md")

    # Skip .tenet/ for snapshots (contains large memory.db)
    # Use stat instead of md5 for speed (size + mtime is enough for change detection)
    for p in "${CRITICAL_PATHS[@]}"; do
        if [ -e "$PROJECT_ROOT/$p" ]; then
            find "$PROJECT_ROOT/$p" -type f -exec stat -f "%z %m %N" {} \; 2>/dev/null
        fi
    done | sort > "$SNAPSHOT_END"

    # Step 3: Check for uncommitted changes
    echo -e "${BLUE}→${NC} Checking for uncommitted changes..."
    CHANGES=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

    if [ "$CHANGES" -gt 0 ]; then
        echo -e "${YELLOW}⚠${NC} Found $CHANGES uncommitted changes"
        git status --short

        echo ""
        echo -e "${BLUE}→${NC} Committing all changes..."
        git add -A
        # Unstage session metadata files that should never be committed
        git reset HEAD .tenet/current-session-branch.txt 2>/dev/null || true
        git reset HEAD .tenet/current-worktree.txt 2>/dev/null || true
        git reset HEAD .tenet/worktree-path.txt 2>/dev/null || true

        COMMIT_MSG="session: end $(date '+%Y-%m-%d %H:%M')"

        if git commit -m "$COMMIT_MSG"; then
            echo -e "${GREEN}✓${NC} Changes committed"
        else
            echo -e "${YELLOW}⚠${NC} Nothing to commit"
        fi
    else
        echo -e "${GREEN}✓${NC} No uncommitted changes"
    fi

    # Step 4: Push to remote
    echo -e "${BLUE}→${NC} Pushing to remote..."
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if git push origin "$CURRENT_BRANCH" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Pushed to origin/$CURRENT_BRANCH"
    else
        echo -e "${YELLOW}⚠${NC} Push failed (will retry on next session)"
    fi

    # Step 5: Sync product repo if symlink/submodule
    PRODUCT_PATH="$PROJECT_ROOT/product"
    if [ -L "$PRODUCT_PATH" ] || [ -d "$PRODUCT_PATH/.git" ]; then
        echo ""
        echo -e "${BLUE}→${NC} Syncing product repo..."

        if [ -L "$PRODUCT_PATH" ]; then
            TARGET=$(readlink "$PRODUCT_PATH")
            if [[ "$TARGET" == ../* ]]; then
                TARGET="$PROJECT_ROOT/$TARGET"
            fi
            TARGET=$(cd "$TARGET" 2>/dev/null && pwd)
        else
            TARGET="$PRODUCT_PATH"
        fi

        if [ -d "$TARGET/.git" ]; then
            cd "$TARGET"
            PRODUCT_CHANGES=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
            if [ "$PRODUCT_CHANGES" -gt 0 ]; then
                git add -A
                git commit -m "session: end $(date '+%Y-%m-%d %H:%M')" || true
                git push 2>/dev/null || echo -e "${YELLOW}⚠${NC} Product push failed"
                echo -e "${GREEN}✓${NC} Product repo synced"
            else
                echo -e "${GREEN}✓${NC} Product repo clean"
            fi
            cd "$PROJECT_ROOT"
        fi
    fi

    # Step 6: Compare snapshots
    if [ -f "$SESSION_FILE" ]; then
        SNAPSHOT_BEFORE=$(grep -o '"snapshot_before"[^,}]*' "$SESSION_FILE" | cut -d'"' -f4)

        if [ -f "$SNAPSHOT_BEFORE" ]; then
            echo ""
            echo -e "${BLUE}→${NC} Session file changes:"
            DIFF_OUTPUT=$(diff "$SNAPSHOT_BEFORE" "$SNAPSHOT_END" 2>/dev/null || true)

            if [ -n "$DIFF_OUTPUT" ]; then
                ADDED=$(echo "$DIFF_OUTPUT" | grep "^>" | wc -l | tr -d ' ')
                REMOVED=$(echo "$DIFF_OUTPUT" | grep "^<" | wc -l | tr -d ' ')
                echo "  Files added/modified: $ADDED"
                echo "  Files removed: $REMOVED"
                echo "$DIFF_OUTPUT" > "$LOG_DIR/session-diff-$(date +%Y%m%d-%H%M%S).txt"
            else
                echo "  No file changes this session"
            fi
        fi
    fi

    # Clean up session file
    rm -f "$SESSION_FILE"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  ${GREEN}Session ended successfully!${NC}"
    echo ""
    echo "  All changes committed and pushed."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
fi

#!/bin/bash
# session-sync.sh - Run at session start to ensure all repos are synced
# This prevents the "where did my files go" problem

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "TENET Session Sync"
echo "========================================"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GTM_ROOT="$(pwd)"

# Track failures
FAILURES=0

# Function to sync a repo
sync_repo() {
    local repo_path="$1"
    local repo_name="$2"

    if [ ! -d "$repo_path" ]; then
        echo -e "${RED}ERROR: $repo_name not found at $repo_path${NC}"
        FAILURES=$((FAILURES + 1))
        return 1
    fi

    echo ""
    echo "--- Syncing $repo_name ---"
    cd "$repo_path"

    # Check if it's a git repo
    if [ ! -d ".git" ]; then
        echo -e "${YELLOW}WARNING: $repo_name is not a git repo${NC}"
        return 0
    fi

    # Get current branch
    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")

    # Fetch latest
    echo "Fetching from origin..."
    git fetch origin 2>/dev/null || {
        echo -e "${YELLOW}WARNING: Could not fetch $repo_name (no network?)${NC}"
        return 0
    }

    # Check if behind
    if [ "$CURRENT_BRANCH" != "detached" ] && [ "$CURRENT_BRANCH" != "" ]; then
        LOCAL=$(git rev-parse HEAD)
        REMOTE=$(git rev-parse "origin/$CURRENT_BRANCH" 2>/dev/null || echo "")

        if [ -n "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ]; then
            BEHIND=$(git rev-list --count HEAD.."origin/$CURRENT_BRANCH" 2>/dev/null || echo "0")
            AHEAD=$(git rev-list --count "origin/$CURRENT_BRANCH"..HEAD 2>/dev/null || echo "0")

            if [ "$BEHIND" -gt 0 ]; then
                echo -e "${YELLOW}$repo_name is $BEHIND commits behind origin/$CURRENT_BRANCH${NC}"

                # Check for uncommitted changes
                if [ -n "$(git status --porcelain)" ]; then
                    echo -e "${RED}ERROR: $repo_name has uncommitted changes AND is behind${NC}"
                    echo "Please commit or stash changes, then pull"
                    FAILURES=$((FAILURES + 1))
                else
                    echo "Pulling latest..."
                    git pull origin "$CURRENT_BRANCH" || {
                        echo -e "${RED}ERROR: Failed to pull $repo_name${NC}"
                        FAILURES=$((FAILURES + 1))
                    }
                fi
            fi

            if [ "$AHEAD" -gt 0 ]; then
                echo -e "${YELLOW}$repo_name is $AHEAD commits ahead (unpushed)${NC}"
                # Auto-push if no uncommitted changes
                if [ -z "$(git status --porcelain)" ]; then
                    echo "Pushing $AHEAD commits to origin/$CURRENT_BRANCH..."
                    git push origin "$CURRENT_BRANCH" 2>/dev/null && {
                        echo -e "${GREEN}Pushed successfully${NC}"
                    } || {
                        echo -e "${RED}Push failed - check credentials or network${NC}"
                        FAILURES=$((FAILURES + 1))
                    }
                else
                    echo -e "${YELLOW}Has uncommitted changes - commit first, then push${NC}"
                fi
            fi
        else
            echo -e "${GREEN}$repo_name is up to date${NC}"
        fi
    else
        echo -e "${YELLOW}$repo_name is in detached HEAD state${NC}"
        # Try to checkout main and pull
        echo "Attempting to checkout main and pull..."
        git checkout main 2>/dev/null && git pull origin main 2>/dev/null || {
            echo -e "${YELLOW}Could not auto-fix detached HEAD${NC}"
        }
    fi

    # Show current state
    echo "Current: $(git log --oneline -1)"
}

# Sync main GTM repo
sync_repo "$GTM_ROOT" "tenet-gtm"

# Check for product - submodule or symlink
PRODUCT_PATH="$GTM_ROOT/product"
if [ -d "$PRODUCT_PATH" ] && [ -f "$PRODUCT_PATH/.git" ]; then
    # It's a submodule (submodules have .git as a FILE, not directory)
    echo ""
    echo "--- Updating product submodule ---"
    cd "$GTM_ROOT"

    # First, init if needed
    git submodule init product 2>/dev/null || true

    # Update to latest from remote
    git submodule update --remote product || {
        echo -e "${YELLOW}WARNING: Could not update product submodule${NC}"
    }

    # Show what commit we're on
    cd "$PRODUCT_PATH"
    echo -e "${GREEN}product submodule at: $(git log --oneline -1)${NC}"
    cd "$GTM_ROOT"

elif [ -L "$PRODUCT_PATH" ]; then
    # It's a symlink - resolve and sync the target (legacy support)
    echo -e "${YELLOW}WARNING: product/ is a symlink, not a submodule${NC}"
    echo "Consider converting to submodule for better reliability"

    TARGET=$(readlink "$PRODUCT_PATH")
    if [[ "$TARGET" == ../* ]]; then
        RESOLVED_TARGET="$GTM_ROOT/$TARGET"
    else
        RESOLVED_TARGET="$TARGET"
    fi
    RESOLVED_TARGET=$(cd "$RESOLVED_TARGET" 2>/dev/null && pwd)

    if [ -n "$RESOLVED_TARGET" ]; then
        sync_repo "$RESOLVED_TARGET" "tenet-platform (product symlink target)"
    else
        echo -e "${RED}ERROR: Could not resolve product symlink target${NC}"
        FAILURES=$((FAILURES + 1))
    fi
elif [ ! -e "$PRODUCT_PATH" ]; then
    # Product doesn't exist - try to init submodule
    echo ""
    echo "--- Initializing product submodule ---"
    cd "$GTM_ROOT"
    git submodule init product 2>/dev/null && git submodule update product || {
        echo -e "${YELLOW}WARNING: Could not initialize product submodule${NC}"
    }
fi

# Sync other submodules
echo ""
echo "--- Syncing submodules ---"
cd "$GTM_ROOT"
git submodule update --init --recursive 2>/dev/null || true

# Check registered services for unpushed/dirty state
CONFIG_FILE="$GTM_ROOT/.tenet/config.json"
if [ -f "$CONFIG_FILE" ] && command -v jq >/dev/null 2>&1; then
    SERVICE_COUNT=$(jq -r '.registered_services | length // 0' "$CONFIG_FILE" 2>/dev/null || echo "0")
    if [ "$SERVICE_COUNT" -gt 0 ]; then
        echo ""
        echo "--- Checking registered services ---"
        DIRTY_SERVICES=""
        UNPUSHED_SERVICES=""

        for i in $(seq 0 $((SERVICE_COUNT - 1))); do
            svc_name=$(jq -r ".registered_services[$i].name" "$CONFIG_FILE" 2>/dev/null)
            svc_path=$(jq -r ".registered_services[$i].path" "$CONFIG_FILE" 2>/dev/null)

            if [ -z "$svc_path" ] || [ "$svc_path" = "null" ] || [ ! -d "$svc_path/.git" ]; then
                continue
            fi

            cd "$svc_path" 2>/dev/null || continue

            # Check for uncommitted changes
            if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
                dirty_files=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
                DIRTY_SERVICES="$DIRTY_SERVICES\n  ${YELLOW}!${NC} $svc_name: $dirty_files uncommitted file(s)"
            fi

            # Check for unpushed commits and auto-push if clean
            branch=$(git branch --show-current 2>/dev/null)
            if [ -n "$branch" ]; then
                ahead=$(git rev-list --count "origin/$branch"..HEAD 2>/dev/null || echo "0")
                if [ "$ahead" -gt 0 ]; then
                    if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
                        # Clean working tree — auto-push
                        if git push origin "$branch" 2>/dev/null; then
                            UNPUSHED_SERVICES="$UNPUSHED_SERVICES\n  ${GREEN}✓${NC} $svc_name: pushed $ahead commit(s) on $branch"
                        else
                            UNPUSHED_SERVICES="$UNPUSHED_SERVICES\n  ${RED}✗${NC} $svc_name: push failed ($ahead commit(s) on $branch)"
                        fi
                    else
                        UNPUSHED_SERVICES="$UNPUSHED_SERVICES\n  ${YELLOW}↑${NC} $svc_name: $ahead unpushed commit(s) on $branch (has dirty files)"
                    fi
                fi
            fi

            cd "$GTM_ROOT"
        done

        if [ -n "$DIRTY_SERVICES" ] || [ -n "$UNPUSHED_SERVICES" ]; then
            echo -e "${YELLOW}Service status:${NC}"
            [ -n "$DIRTY_SERVICES" ] && echo -e "$DIRTY_SERVICES"
            [ -n "$UNPUSHED_SERVICES" ] && echo -e "$UNPUSHED_SERVICES"
        else
            echo -e "${GREEN}All registered services clean${NC}"
        fi
    fi
fi

# Final status
echo ""
echo "========================================"
if [ $FAILURES -gt 0 ]; then
    echo -e "${RED}Session sync completed with $FAILURES errors${NC}"
    echo "Please fix the above issues before continuing"
    exit 1
else
    echo -e "${GREEN}Session sync completed successfully${NC}"
fi
echo "========================================"

#!/usr/bin/env bash
#
# migrate-to-branch-sessions.sh - Migrate from worktree-based to branch-based sessions
#
# This script helps existing TENET users migrate to the new simplified session model.
# It handles:
# - Saving uncommitted work from worktrees
# - Merging session branches to main
# - Removing worktree directories
# - Cleaning up metadata files
#
# @purpose Migration from worktree sessions to branch-only sessions

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
WORKTREES_DIR="$REPO_DIR/worktrees"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TENET Migration: Worktree → Branch-Based Sessions"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "This will migrate your project from worktree-based sessions to"
echo "simpler branch-based sessions."
echo ""
echo "What this does:"
echo "  1. Save any uncommitted work in worktrees"
echo "  2. Merge session branches to main"
echo "  3. Remove worktree directories"
echo "  4. Clean up metadata files"
echo ""

# Check if worktrees exist
if [[ ! -d "$WORKTREES_DIR" ]]; then
    echo -e "${GREEN}✓${NC} No worktrees directory found - nothing to migrate"
    exit 0
fi

# Count worktrees
worktree_count=$(find "$WORKTREES_DIR" -maxdepth 1 -type d -name "session-*" 2>/dev/null | wc -l | tr -d ' ')

if [[ $worktree_count -eq 0 ]]; then
    echo -e "${GREEN}✓${NC} No worktrees found - nothing to migrate"
    echo ""
    echo "Cleaning up empty worktrees directory..."
    rmdir "$WORKTREES_DIR" 2>/dev/null || true
    exit 0
fi

echo -e "${YELLOW}⚠${NC}  Found $worktree_count worktree(s) to migrate"
echo ""

# Ensure we're on main branch
current_branch=$(git branch --show-current 2>/dev/null || echo "")
if [[ "$current_branch" != "main" ]]; then
    echo "Switching to main branch..."
    git checkout main 2>/dev/null || {
        echo -e "${RED}✗${NC} Failed to checkout main branch"
        echo "  Please switch to main manually and run this script again"
        exit 1
    }
fi

# Step 1: Save uncommitted work in worktrees
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Step 1: Checking for uncommitted work"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

for wt in "$WORKTREES_DIR"/session-*; do
    if [[ -d "$wt" ]]; then
        session_name=$(basename "$wt")
        cd "$wt"

        if git status --porcelain 2>/dev/null | grep -q .; then
            echo -e "${YELLOW}⚠${NC}  Uncommitted work in $session_name"
            git status --short
            echo ""
            echo "  Committing changes..."
            git add -A
            git commit -m "migration: auto-save uncommitted work before migration" || true
            echo -e "${GREEN}✓${NC}  Changes saved"
            echo ""
        else
            echo -e "${GREEN}✓${NC}  $session_name - no uncommitted changes"
        fi

        cd "$REPO_DIR"
    fi
done

# Step 2: Merge session branches to main
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Step 2: Merging session branches"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get all session branches
session_branches=$(git branch | grep "session-" | sed 's/^[* ]*//' || true)

if [[ -z "$session_branches" ]]; then
    echo -e "${GREEN}✓${NC} No session branches to merge"
else
    for branch in $session_branches; do
        echo "Merging $branch..."

        # Try to merge
        if git merge --no-edit "$branch" 2>/dev/null; then
            echo -e "${GREEN}✓${NC} Merged $branch"

            # Delete the branch
            git branch -D "$branch" 2>/dev/null || true
        else
            # Merge conflicts - show them and skip
            echo -e "${RED}✗${NC} Conflicts merging $branch"
            echo ""
            echo "  Conflicting files:"
            git diff --name-only --diff-filter=U 2>/dev/null | sed 's/^/    - /'
            echo ""
            echo "  Aborting this merge - you'll need to merge $branch manually"
            git merge --abort 2>/dev/null || true
            echo ""
        fi
    done
fi

# Step 3: Clean up worktrees
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Step 3: Removing worktrees"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Prune worktrees from git
echo "Pruning worktree references..."
git worktree prune 2>/dev/null || true

# Remove worktree directories
if [[ -d "$WORKTREES_DIR" ]]; then
    echo "Removing worktrees directory..."
    rm -rf "$WORKTREES_DIR" 2>/dev/null || {
        echo -e "${YELLOW}⚠${NC}  Could not remove $WORKTREES_DIR automatically"
        echo "  Please remove it manually: rm -rf $WORKTREES_DIR"
    }
    echo -e "${GREEN}✓${NC} Worktrees directory removed"
fi

# Step 4: Clean up metadata
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Step 4: Cleaning up metadata"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Remove worktree metadata files
rm -f "$REPO_DIR/.tenet/current-worktree.txt" 2>/dev/null || true
rm -f "$REPO_DIR/.tenet/worktree-path.txt" 2>/dev/null || true

echo -e "${GREEN}✓${NC} Metadata cleaned up"

# Step 5: Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Migration Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${GREEN}✓${NC} Migration completed successfully"
echo ""
echo "What changed:"
echo "  • Worktree directories removed"
echo "  • Session branches merged to main (where possible)"
echo "  • Metadata files cleaned up"
echo ""
echo "What's next:"
echo "  • New sessions will use simple branch-based isolation"
echo "  • No more worktree complexity or background processes"
echo "  • Run 'git status' to verify everything is clean"
echo ""

# Check for remaining session branches that weren't merged
remaining_branches=$(git branch | grep "session-" | sed 's/^[* ]*//' || true)
if [[ -n "$remaining_branches" ]]; then
    echo -e "${YELLOW}⚠${NC}  Note: Some session branches still exist (had conflicts):"
    echo "$remaining_branches" | sed 's/^/    - /'
    echo ""
    echo "  You can merge or delete these manually:"
    echo "    git merge <branch-name>   # to merge"
    echo "    git branch -D <branch-name>   # to delete"
    echo ""
fi

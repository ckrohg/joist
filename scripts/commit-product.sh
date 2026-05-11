#!/usr/bin/env bash
#
# commit-product.sh - Commit changes to product submodule
#
# Usage:
#   ./scripts/commit-product.sh "commit message"
#
# This handles all the submodule commit logic:
# - cd to product submodule
# - stage changes
# - commit
# - push to origin
# - update parent repo reference

set -e

if [[ -z "$1" ]]; then
    echo "Usage: $0 \"commit message\""
    exit 1
fi

COMMIT_MSG="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PRODUCT_DIR="$REPO_ROOT/product"

echo "📦 Committing to product submodule..."
echo ""

# Go to product submodule
cd "$PRODUCT_DIR"

# Check if on a branch
CURRENT_BRANCH=$(git branch --show-current)
if [[ -z "$CURRENT_BRANCH" ]]; then
    echo "⚠️  You're in detached HEAD state"
    echo "   Checking out main first..."
    git checkout main
fi

# Show what will be committed
echo "Changes to commit:"
git status --short
echo ""

# Stage all changes
git add -A

# Commit
git commit -m "$COMMIT_MSG"

# Push
git push origin main

# Update parent repo reference
cd "$REPO_ROOT"
git add product
git commit -m "chore: update product submodule

Latest commit: $(cd product && git log -1 --oneline)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
git push origin main

echo ""
echo "✅ Product changes committed and pushed!"
echo "   Submodule: $PRODUCT_DIR"
echo "   Parent updated to track latest"

#!/usr/bin/env bash
#
# commit-gtm.sh - Commit changes to GTM repo (knowledge, content, etc.)
#
# Usage:
#   ./scripts/commit-gtm.sh "commit message"
#
# This commits to the GTM repo (not the product submodule):
# - knowledge/
# - content/
# - suggestions/
# - previews/
# - etc.

set -e

if [[ -z "$1" ]]; then
    echo "Usage: $0 \"commit message\""
    exit 1
fi

COMMIT_MSG="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "📝 Committing to GTM repo..."
echo ""

cd "$REPO_ROOT"

# Show what will be committed (exclude all submodules)
echo "Changes to commit:"
git status --short | grep -v "^M. product" | grep -v "^M. runner" || true
echo ""

# Stage all changes except submodules (product, runner, etc.)
git add knowledge/ content/ suggestions/ previews/ CLAUDE.md .tenet/ scripts/ .gitmodules 2>/dev/null || true

# Use pathspec exclusion to ensure no submodules are staged
git reset HEAD product/ runner/ 2>/dev/null || true

# Check if there's anything to commit
if git diff --cached --quiet; then
    echo "⚠️  No changes to commit (excluding product submodule)"
    echo "   Use ./scripts/commit-product.sh for product changes"
    exit 0
fi

# Commit
git commit -m "$COMMIT_MSG"

# Push
git push origin main

echo ""
echo "✅ GTM changes committed and pushed!"

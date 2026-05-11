#!/usr/bin/env bash
#
# where-am-i.sh - Quick context check for git operations
#
# Shows:
# - Current directory
# - Which repo you're in (GTM or product submodule)
# - Current branch
# - Uncommitted changes
#
# Usage:
#   ./scripts/where-am-i.sh

set -e

CWD=$(pwd)

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${BLUE}📍 Current Location${NC}"
echo "─────────────────────────────────────"
echo ""

# Show current directory
echo -e "Directory: ${GREEN}$CWD${NC}"

# Detect which repo context (check for submodules first, then GTM)
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")

if [[ "$CWD" == *"/product"* ]] || [[ "$REMOTE_URL" == *"tenet-platform"* ]]; then
    echo -e "Context:   ${YELLOW}product submodule${NC} (tenet-platform)"
    echo ""
    echo "To commit here: ./scripts/commit-product.sh \"message\""
elif [[ "$CWD" == *"/runner"* ]] || [[ "$REMOTE_URL" == *"tenet-runner"* ]]; then
    echo -e "Context:   ${YELLOW}runner submodule${NC} (tenet-runner)"
    echo ""
    echo "To commit here: cd ../; git add runner && git commit -m \"Update runner submodule\""
elif [[ "$REMOTE_URL" == *"JFL-GTM"* ]] || [[ -f ".tenet/config.json" ]]; then
    echo -e "Context:   ${GREEN}GTM repo${NC} (main project)"
    echo ""
    echo "To commit here: ./scripts/commit-gtm.sh \"message\""
else
    # Check if we're in any submodule
    if git rev-parse --show-superproject-working-tree &>/dev/null; then
        SUBMODULE_NAME=$(basename "$CWD")
        echo -e "Context:   ${YELLOW}${SUBMODULE_NAME} submodule${NC}"
    else
        echo -e "Context:   ${YELLOW}unknown${NC}"
    fi
fi

echo ""

# Show current branch
BRANCH=$(git branch --show-current 2>/dev/null || echo "detached HEAD")
if [[ "$BRANCH" == "detached HEAD" ]]; then
    echo -e "Branch:    ${YELLOW}⚠️  detached HEAD${NC}"
    echo "           (run: git checkout main)"
else
    echo -e "Branch:    ${GREEN}$BRANCH${NC}"
fi

# Show uncommitted changes
CHANGES=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [[ "$CHANGES" -gt 0 ]]; then
    echo -e "Changes:   ${YELLOW}$CHANGES uncommitted${NC}"
    echo ""
    git status --short
else
    echo -e "Changes:   ${GREEN}none (clean)${NC}"
fi

echo ""

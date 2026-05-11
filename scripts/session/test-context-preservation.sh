#!/bin/bash
# test-context-preservation.sh - Verify that context files exist and are in sync
# Run this to catch "missing files" issues before they become problems

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================"
echo "Context Preservation Test"
echo "========================================"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GTM_ROOT="$(pwd)"

FAILURES=0
WARNINGS=0

# Test 1: Critical GTM knowledge files exist
echo ""
echo "Test 1: Critical knowledge files"
CRITICAL_FILES=(
    "knowledge/VISION.md"
    "knowledge/NARRATIVE.md"
    "knowledge/ROADMAP.md"
    "knowledge/BRAND_DECISIONS.md"
    "knowledge/DESIGN_SYSTEM.md"
    "knowledge/NAMING.md"
    "knowledge/PRODUCT_SPEC_V2.md"
)

for file in "${CRITICAL_FILES[@]}"; do
    if [ -f "$GTM_ROOT/$file" ]; then
        SIZE=$(wc -c < "$GTM_ROOT/$file")
        if [ "$SIZE" -lt 100 ]; then
            echo -e "${YELLOW}  WARNING: $file exists but is very small ($SIZE bytes)${NC}"
            WARNINGS=$((WARNINGS + 1))
        else
            echo -e "${GREEN}  ✓ $file ($SIZE bytes)${NC}"
        fi
    else
        echo -e "${RED}  ✗ $file MISSING${NC}"
        FAILURES=$((FAILURES + 1))
    fi
done

# Test 2: Product platform specs exist
echo ""
echo "Test 2: Product platform specs"
PRODUCT_PATH="$GTM_ROOT/product"
if [ -L "$PRODUCT_PATH" ]; then
    PRODUCT_PATH=$(cd "$PRODUCT_PATH" 2>/dev/null && pwd)
fi

PLATFORM_FILES=(
    "PLATFORM_SPEC.md"
    "TEMPLATE_SPEC.md"
    "CONTEXT_GRAPH_SPEC.md"
)

for file in "${PLATFORM_FILES[@]}"; do
    if [ -f "$PRODUCT_PATH/$file" ]; then
        SIZE=$(wc -c < "$PRODUCT_PATH/$file")
        echo -e "${GREEN}  ✓ product/$file ($SIZE bytes)${NC}"
    else
        echo -e "${RED}  ✗ product/$file MISSING${NC}"
        FAILURES=$((FAILURES + 1))
    fi
done

# Test 3: Git repos are in sync with remotes
echo ""
echo "Test 3: Git sync status"

check_git_sync() {
    local repo_path="$1"
    local repo_name="$2"

    cd "$repo_path" 2>/dev/null || return 1

    git fetch origin 2>/dev/null || {
        echo -e "${YELLOW}  WARNING: Could not fetch $repo_name${NC}"
        WARNINGS=$((WARNINGS + 1))
        return 0
    }

    BRANCH=$(git branch --show-current 2>/dev/null || echo "")
    if [ -z "$BRANCH" ]; then
        echo -e "${YELLOW}  WARNING: $repo_name is in detached HEAD${NC}"
        WARNINGS=$((WARNINGS + 1))
        return 0
    fi

    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "")

    if [ -z "$REMOTE" ]; then
        echo -e "${YELLOW}  WARNING: $repo_name has no remote tracking${NC}"
        WARNINGS=$((WARNINGS + 1))
        return 0
    fi

    BEHIND=$(git rev-list --count HEAD.."origin/$BRANCH" 2>/dev/null || echo "0")

    if [ "$BEHIND" -gt 0 ]; then
        echo -e "${RED}  ✗ $repo_name is $BEHIND commits BEHIND origin${NC}"
        FAILURES=$((FAILURES + 1))
    else
        echo -e "${GREEN}  ✓ $repo_name is in sync${NC}"
    fi
}

check_git_sync "$GTM_ROOT" "tenet-gtm"

# Check product target
PRODUCT_LINK="$GTM_ROOT/product"
if [ -L "$PRODUCT_LINK" ]; then
    TARGET=$(readlink "$PRODUCT_LINK")
    if [[ "$TARGET" == ../* ]]; then
        RESOLVED="$GTM_ROOT/$TARGET"
    else
        RESOLVED="$TARGET"
    fi
    RESOLVED=$(cd "$RESOLVED" 2>/dev/null && pwd)
    if [ -n "$RESOLVED" ]; then
        check_git_sync "$RESOLVED" "tenet-platform"
    fi
fi

# Test 4: No uncommitted critical changes
echo ""
echo "Test 4: Uncommitted changes check"
cd "$GTM_ROOT"
UNCOMMITTED=$(git status --porcelain knowledge/ 2>/dev/null | wc -l)
if [ "$UNCOMMITTED" -gt 0 ]; then
    echo -e "${YELLOW}  WARNING: $UNCOMMITTED uncommitted changes in knowledge/${NC}"
    git status --porcelain knowledge/ | head -5
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "${GREEN}  ✓ No uncommitted knowledge changes${NC}"
fi

# Summary
echo ""
echo "========================================"
if [ $FAILURES -gt 0 ]; then
    echo -e "${RED}FAILED: $FAILURES critical issues found${NC}"
    echo "Run: ./scripts/session-sync.sh to fix sync issues"
    exit 1
elif [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}PASSED with $WARNINGS warnings${NC}"
    exit 0
else
    echo -e "${GREEN}PASSED: All context preservation checks passed${NC}"
    exit 0
fi
echo "========================================"

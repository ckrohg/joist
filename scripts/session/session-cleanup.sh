#!/bin/bash
#
# Session Cleanup - Auto-merge session and cleanup
#
# Called by Stop hook or /end skill to clean up sessions.
# Handles both worktree mode (multiple sessions) and direct mode (single session).
# Only keeps branches that have real conflicts or uncommitted work.

set -e

# Get working branch from config (fallback to main)
get_working_branch() {
    local config_branch=$(jq -r '.working_branch // empty' .tenet/config.json 2>/dev/null)
    if [[ -n "$config_branch" ]]; then
        echo "$config_branch"
    else
        echo "main"
    fi
}

WORKING_BRANCH=$(get_working_branch)

# Stop background processes first
echo "Stopping background processes..."

# Stop auto-commit if running
if [ -f ".tenet/auto-commit.pid" ]; then
  PID=$(cat ".tenet/auto-commit.pid")
  if kill -0 "$PID" 2>/dev/null; then
    echo "  Stopping auto-commit (PID: $PID)..."
    kill -TERM "$PID" 2>/dev/null || true
    sleep 1
    # Force kill if still running
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f ".tenet/auto-commit.pid"
fi

# Stop auto-merge if running
if [ -f ".auto-merge.pid" ]; then
  PID=$(cat ".auto-merge.pid")
  if kill -0 "$PID" 2>/dev/null; then
    echo "  Stopping auto-merge (PID: $PID)..."
    kill -TERM "$PID" 2>/dev/null || true
    sleep 1
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f ".auto-merge.pid"
fi

# Context Hub is a persistent daemon — do NOT kill it on session end.
# It serves multiple sessions and runtimes (Claude Code, Pi, etc).

# Get current session info
BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [ -z "$BRANCH" ]; then
  echo "Not on a branch, skipping cleanup"
  exit 0
fi

# Skip if not a session branch
if [[ ! "$BRANCH" =~ ^session- ]]; then
  echo "Not a session branch, skipping cleanup"
  exit 0
fi

# Detect mode: are we in a worktree or working directly?
IN_WORKTREE=false
if [[ "$(pwd)" == *"/worktrees/session-"* ]]; then
  IN_WORKTREE=true
  echo "Cleaning up worktree session: $BRANCH"
else
  echo "Cleaning up direct session: $BRANCH"
fi

# Auto-commit any uncommitted changes first
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Auto-committing changes..."

  # Check if last commit is already "session: end" (make idempotent)
  LAST_MSG=$(git log -1 --pretty=%s 2>/dev/null || echo "")
  if [[ "$LAST_MSG" =~ ^session:\ end ]]; then
    echo "Last commit already is 'session: end', skipping duplicate commit"
  else
    git add -A
    # Unstage session metadata files that should never be committed
    git reset HEAD .tenet/current-session-branch.txt 2>/dev/null || true
    git reset HEAD .tenet/current-worktree.txt 2>/dev/null || true
    git reset HEAD .tenet/worktree-path.txt 2>/dev/null || true
    git commit -m "session: end $(date +%Y-%m-%d\ %H:%M)" || true
  fi
fi

# Detect main repo location
if [ "$IN_WORKTREE" = true ]; then
  # We're in a worktree - find main repo
  MAIN_REPO=$(git rev-parse --git-common-dir 2>/dev/null | sed 's|/\.git$||')
  if [ -z "$MAIN_REPO" ] || [ ! -d "$MAIN_REPO" ]; then
    # Fallback: find parent directory
    MAIN_REPO=$(git worktree list | grep "(bare)" | awk '{print $1}' | head -1)
    if [ -z "$MAIN_REPO" ]; then
      MAIN_REPO=$(git worktree list | head -1 | awk '{print $1}')
    fi
  fi
else
  # We're in direct mode - already in main repo
  MAIN_REPO=$(pwd)
fi

# Pre-merge cleanup: Remove files that will definitely conflict
echo "Pre-merge cleanup..."
git rm -f .tenet/current-session-branch.txt 2>/dev/null || true
git rm -f .tenet/current-worktree.txt 2>/dev/null || true
git rm -f .tenet/worktree-path.txt 2>/dev/null || true

# Remove any git conflict artifacts from previous failed merges
find .tenet -name "journal~*" -type f -delete 2>/dev/null || true

# Commit cleanup if there are changes
if ! git diff --quiet HEAD 2>/dev/null; then
  git commit -m "cleanup: remove session metadata before merge" 2>/dev/null || true
fi

# Try to merge to working branch
echo "Attempting to merge $BRANCH to $WORKING_BRANCH..."
cd "$MAIN_REPO"

# Checkout working branch in the main repo
if ! git checkout "$WORKING_BRANCH" 2>/dev/null; then
  echo "⚠ Could not checkout $WORKING_BRANCH, skipping merge"
  echo "  Session branch $BRANCH preserved for manual merge"
  # Unregister session from lock registry
  if command -v tenet >/dev/null 2>&1; then
    tenet session unregister "$BRANCH" 2>/dev/null || true
  fi
  exit 0
fi

# Attempt merge — no -X ours (that silently discards session changes on conflict)
# Let conflicts fall through to the auto-resolve path below which handles known patterns
MERGE_OUTPUT=$(git merge --no-edit "$BRANCH" 2>&1)
MERGE_STATUS=$?

if [ $MERGE_STATUS -eq 0 ]; then
  echo "✓ Merged $BRANCH to $WORKING_BRANCH"

  # Push to origin with retry
  push_success=false
  for attempt in 1 2 3; do
    if git push origin "$WORKING_BRANCH" 2>/dev/null; then
      push_success=true
      break
    fi
    echo "⚠ Push attempt $attempt failed, retrying in ${attempt}s..."
    sleep "$attempt"
  done
  if [ "$push_success" = false ]; then
    echo "✗ PUSH FAILED after 3 attempts — $WORKING_BRANCH has unpushed commits"
    echo "  Fix: git push origin $WORKING_BRANCH"
  fi

  # Remove worktree if it exists (NEVER remove the main repo)
  MAIN_TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null)
  WORKTREE_PATH=$(git worktree list | grep "$BRANCH" | grep -v "(bare)" | awk '{print $1}' | head -1)
  if [ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ]; then
    WORKTREE_REAL=$(cd "$WORKTREE_PATH" && pwd -P)
    MAIN_REAL=$(cd "$MAIN_TOPLEVEL" && pwd -P)
    if [ "$WORKTREE_REAL" = "$MAIN_REAL" ]; then
      echo "⚠ SAFETY: refusing to rm -rf main repo at $WORKTREE_PATH"
    elif [ "$WORKTREE_REAL" = "$HOME" ] || [ "$WORKTREE_REAL" = "/" ]; then
      echo "⚠ SAFETY: refusing to rm -rf protected path $WORKTREE_PATH"
    else
      echo "Removing worktree at $WORKTREE_PATH..."
      git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || true
      git worktree prune 2>/dev/null || true
    fi
  fi

  # Delete the branch
  echo "Deleting branch $BRANCH..."
  git branch -D "$BRANCH" 2>/dev/null || true

  echo "✓ Session cleanup complete - merged to $WORKING_BRANCH and pushed"

  # Unregister session from lock registry
  if command -v tenet >/dev/null 2>&1; then
    tenet session unregister "$BRANCH" 2>/dev/null || true
  fi
else
  # Merge failed - try auto-resolving common conflicts
  echo "Initial merge failed, attempting auto-resolve..."

  # Check what conflicts we have
  CONFLICTS=$(git diff --name-only --diff-filter=U 2>/dev/null)

  AUTO_RESOLVED=true
  while IFS= read -r file; do
    if [[ -z "$file" ]]; then
      continue
    fi

    case "$file" in
      .tenet/current-session-branch.txt|.tenet/current-worktree.txt|.tenet/worktree-path.txt)
        # Session metadata - just remove it
        echo "  Auto-resolving: $file (removing)"
        git rm -f "$file" 2>/dev/null || true
        ;;
      .tenet/journal~*)
        # Git conflict artifact - remove it
        echo "  Auto-resolving: $file (removing artifact)"
        git rm -f "$file" 2>/dev/null || true
        ;;
      .tenet/journal/*.jsonl)
        # Journal JSONL — append-only, merge both sides by concatenating
        echo "  Auto-resolving: $file (merging JSONL entries)"
        if [ -f "$file" ]; then
          # Strip conflict markers and keep all JSONL lines from both sides
          grep -v '^<<<<<<< \|^=======$\|^>>>>>>> ' "$file" > "${file}.merged" 2>/dev/null || true
          mv "${file}.merged" "$file"
          git add "$file" 2>/dev/null || true
        else
          git checkout --theirs "$file" 2>/dev/null || true
          git add "$file" 2>/dev/null || true
        fi
        ;;
      .tenet/map-events.jsonl|.tenet/service-events.jsonl|.tenet/skill-usage.jsonl)
        # Append-only JSONL files — same merge strategy as journals
        echo "  Auto-resolving: $file (merging JSONL)"
        if [ -f "$file" ]; then
          grep -v '^<<<<<<< \|^=======$\|^>>>>>>> ' "$file" > "${file}.merged" 2>/dev/null || true
          mv "${file}.merged" "$file"
          git add "$file" 2>/dev/null || true
        else
          git checkout --theirs "$file" 2>/dev/null || true
          git add "$file" 2>/dev/null || true
        fi
        ;;
      .tenet/config.json|.tenet/telemetry-agent-state.json)
        # Config files — keep session's version (theirs has newer state)
        echo "  Auto-resolving: $file (keeping session version)"
        git checkout --theirs "$file" 2>/dev/null || true
        git add "$file" 2>/dev/null || true
        ;;
      product)
        # Product directory conflict (likely symlink vs dir)
        # Keep working branch's version (which should be platform symlink or nothing)
        echo "  Auto-resolving: $file (keeping $WORKING_BRANCH's version)"
        git checkout --ours "$file" 2>/dev/null || git rm -f "$file" 2>/dev/null || true
        ;;
      platform|cli|runner)
        # Submodule conflicts - keep working branch's version
        echo "  Auto-resolving: $file (keeping $WORKING_BRANCH's submodule state)"
        git checkout --ours "$file" 2>/dev/null || true
        ;;
      *)
        # Unknown conflict - can't auto-resolve
        echo "  ⚠ Cannot auto-resolve: $file"
        AUTO_RESOLVED=false
        ;;
    esac
  done <<< "$CONFLICTS"

  if [ "$AUTO_RESOLVED" = true ]; then
    # All conflicts resolved, complete the merge
    echo "All conflicts auto-resolved, completing merge..."
    git add -A
    git commit --no-edit 2>/dev/null || true

    echo "✓ Merged $BRANCH to $WORKING_BRANCH (with auto-resolution)"

    # Push to origin with retry
    push_success=false
    for attempt in 1 2 3; do
      if git push origin "$WORKING_BRANCH" 2>/dev/null; then
        push_success=true
        break
      fi
      echo "⚠ Push attempt $attempt failed, retrying in ${attempt}s..."
      sleep "$attempt"
    done
    if [ "$push_success" = false ]; then
      echo "✗ PUSH FAILED after 3 attempts — $WORKING_BRANCH has unpushed commits"
      echo "  Fix: git push origin $WORKING_BRANCH"
    fi

    # Remove worktree if it exists (NEVER remove the main repo)
    MAIN_TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null)
    WORKTREE_PATH=$(git worktree list | grep "$BRANCH" | grep -v "(bare)" | awk '{print $1}' | head -1)
    if [ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ]; then
      WORKTREE_REAL=$(cd "$WORKTREE_PATH" && pwd -P)
      MAIN_REAL=$(cd "$MAIN_TOPLEVEL" && pwd -P)
      if [ "$WORKTREE_REAL" = "$MAIN_REAL" ]; then
        echo "⚠ SAFETY: refusing to rm -rf main repo at $WORKTREE_PATH"
      elif [ "$WORKTREE_REAL" = "$HOME" ] || [ "$WORKTREE_REAL" = "/" ]; then
        echo "⚠ SAFETY: refusing to rm -rf protected path $WORKTREE_PATH"
      else
        echo "Removing worktree at $WORKTREE_PATH..."
        git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || true
        git worktree prune 2>/dev/null || true
      fi
    fi

    # Delete the branch
    echo "Deleting branch $BRANCH..."
    git branch -D "$BRANCH" 2>/dev/null || true

    echo "✓ Session cleanup complete - merged to $WORKING_BRANCH and pushed"

    # Push journals to cloud (non-blocking)
    if command -v tenet >/dev/null 2>&1; then
      tenet sync --push --quiet 2>/dev/null &
      disown
    fi

    # Unregister session from lock registry
    if command -v tenet >/dev/null 2>&1; then
      tenet session unregister "$BRANCH" 2>/dev/null || true
    fi
  else
    # Still have unresolved conflicts
    echo "⚠ Merge conflicts remain, keeping branch $BRANCH"
    echo "  Review later with: git log $WORKING_BRANCH..$BRANCH"
    echo "  Conflicting files:"
    git diff --name-only --diff-filter=U 2>/dev/null | sed 's/^/    - /'
    git merge --abort 2>/dev/null || true

    # PR escape valve — push branch and create PR so work isn't silently lost
    if command -v gh >/dev/null 2>&1; then
      echo "  Creating PR for manual conflict resolution..."
      git checkout "$BRANCH" 2>/dev/null || true
      git push origin "$BRANCH" 2>/dev/null || true
      pr_url=$(gh pr create \
        --head "$BRANCH" \
        --base "$WORKING_BRANCH" \
        --title "session merge: $BRANCH → $WORKING_BRANCH (conflicts)" \
        --body "$(cat <<PREOF
Auto-merge failed for session branch \`$BRANCH\`.

**Conflicting files need manual resolution.**

Merge locally:
\`\`\`bash
git checkout $WORKING_BRANCH
git merge $BRANCH
# resolve conflicts
git push
\`\`\`
PREOF
)" 2>/dev/null) && echo "  ✓ PR created: $pr_url" || echo "  ⚠ PR creation failed — branch $BRANCH pushed for manual merge"
    fi

    # Unregister session even though we kept the branch
    if command -v tenet >/dev/null 2>&1; then
      tenet session unregister "$BRANCH" 2>/dev/null || true
    fi
  fi
fi

# Final unregister (in case we skipped merge paths)
if command -v tenet >/dev/null 2>&1; then
  tenet session unregister "$BRANCH" 2>/dev/null || true
fi

exit 0

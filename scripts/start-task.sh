#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/start-task.sh <task-name> [worktree-path]

Examples:
  scripts/start-task.sh calendar-legend-align
  scripts/start-task.sh "coach calendar legend" /private/tmp/coachkit-coach-calendar-legend

What it does:
  1) Fetches latest origin/main
  2) Creates branch codex/<task-name> from origin/main
  3) Creates a new git worktree for that branch
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: Not inside a git repository." >&2
  exit 1
fi

RAW_TASK="$1"
SLUG="$(printf '%s' "$RAW_TASK" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')"

if [[ -z "$SLUG" ]]; then
  echo "ERROR: Task name resolves to an empty slug. Use letters/numbers." >&2
  exit 1
fi

BRANCH="codex/$SLUG"
DEFAULT_WORKTREE="/private/tmp/coachkit-$SLUG"
WORKTREE_PATH="${2:-$DEFAULT_WORKTREE}"

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "ERROR: Local branch already exists: $BRANCH" >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  echo "ERROR: Remote branch already exists: origin/$BRANCH" >&2
  exit 1
fi

if [[ -e "$WORKTREE_PATH" ]]; then
  echo "ERROR: Worktree path already exists: $WORKTREE_PATH" >&2
  exit 1
fi

echo "Fetching origin/main..."
git fetch origin main

echo "Creating worktree..."
git worktree add -b "$BRANCH" "$WORKTREE_PATH" origin/main

cat <<EOF

Task workspace ready.
Branch:   $BRANCH
Worktree: $WORKTREE_PATH

Next:
  cd "$WORKTREE_PATH"
  git status
EOF

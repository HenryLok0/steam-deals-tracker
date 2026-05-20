#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: push_generated_changes.sh <commit-message> <path> [path...]" >&2
  exit 1
fi

commit_message="$1"
shift
paths=("$@")

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git add "${paths[@]}"
if git diff --staged --quiet; then
  echo "No changes detected."
  exit 0
fi

branch="${GITHUB_REF_NAME:-master}"

for attempt in 1 2 3 4 5; do
  git fetch origin "$branch"
  # Keep generated files in the working tree; move HEAD to the latest remote tip.
  git reset "origin/$branch"
  git add "${paths[@]}"
  if git diff --staged --quiet; then
    echo "No changes after syncing with remote."
    exit 0
  fi
  git commit -m "$commit_message"
  if git push origin "HEAD:$branch"; then
    echo "Push succeeded on attempt ${attempt}."
    exit 0
  fi
  echo "Push rejected, retrying (${attempt}/5)..."
  sleep 15
done

echo "Failed to push after 5 attempts." >&2
exit 1

#!/usr/bin/env bash
# Wipe this worktree's .data, rerun migrations, and seed dev user + local-repo-example.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

if [ -d .data ]; then
  rm -rf .data
  echo "Removed .data"
fi

mkdir -p .data
pnpm run migrate
pnpm run seed:dev
echo "Dev data reset complete."
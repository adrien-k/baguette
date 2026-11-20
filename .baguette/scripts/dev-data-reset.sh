#!/usr/bin/env bash
# Wipe the same DATA_DIR migrate/seed use, rerun migrations, and seed dev user + local-repo-example.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

export DATA_DIR="${DATA_DIR:-./.data}"
case "$DATA_DIR" in
  /*) WIPE_DIR="$DATA_DIR" ;;
  *) WIPE_DIR="$REPO_ROOT/$DATA_DIR" ;;
esac

if [ -d "$WIPE_DIR" ]; then
  rm -rf "$WIPE_DIR"
  echo "Removed $WIPE_DIR"
fi

mkdir -p "$WIPE_DIR"
pnpm run migrate
pnpm run seed:dev
echo "Dev data reset complete."
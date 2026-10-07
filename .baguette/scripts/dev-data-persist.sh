#!/usr/bin/env bash
# Copy ./.data into shared ../../../dev-data-dir (used by dev-data-load on new sessions).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

dest="../../../dev-data-dir"
if [ ! -d .data ]; then
  echo "No .data directory in this session; nothing to persist." >&2
  exit 1
fi

mkdir -p "$(dirname "$dest")"
rm -rf "$dest"
cp -a .data "$dest"
echo "Persisted dev data to $dest"

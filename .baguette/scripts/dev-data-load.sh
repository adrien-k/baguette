#!/usr/bin/env bash
# Copy shared dev SQLite from ../../../dev-data-dir into ./.data, migrate, run message backfills.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

src="../../../dev-data-dir"
if [ -d "$src" ]; then
  rm -rf .data
  cp -a "$src" .data
else
  echo "Dev data source not found ($src); skipping copy, running migrate only." >&2
fi
pnpm run migrate
node scripts/2026100601_backfill-message-rows.js
node scripts/2026100602_backfill-dedupe-streamed-assistants.js

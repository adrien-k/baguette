#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export NODE_ENV=development
export ENABLE_MOCK_AGENT=true
export MOCK_AGENT_SLEEP_MS=300
export MOCK_AGENT_STEP_DELAY_MS=200
export DATA_DIR="${ROOT}/.data-e2e"
export PORT="${E2E_PORT:-${PORT:-3010}}"
# E2e uses no real GitHub credentials — ignore repo/.env DEV_USER_GH_KEY.
unset DEV_USER_GH_KEY
rm -rf "$DATA_DIR"
mkdir -p "$DATA_DIR"
pnpm run migrate
pnpm run seed:e2e
pnpm run build
unset VITE_SERVER_ENABLED
exec node server/index.js

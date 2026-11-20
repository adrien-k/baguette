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
# Never talk to a real Slack from e2e: blank the tokens .env would seed an app from.
export SLACK_BOT_TOKEN=
export SLACK_APP_TOKEN=
export SLACK_API_URL="http://127.0.0.1:${E2E_SLACK_PORT:-3011}/api"
rm -rf "$DATA_DIR"
mkdir -p "$DATA_DIR"
pnpm run migrate
pnpm run build
unset VITE_SERVER_ENABLED
exec node server/index.js

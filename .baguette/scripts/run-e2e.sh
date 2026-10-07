#!/usr/bin/env bash
# Playwright e2e: starts the app via playwright.config.js webServer (e2e/start-dev.sh).
# Baguette assigns E2E_PORT when the run-e2e task declares ports: [E2E_PORT].
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
pnpm exec playwright install chromium
pnpm exec playwright test "$@"

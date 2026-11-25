# AgentDriver Design & SDK Audit

This document maps every SDK-specific behaviour across the five existing `server/agent-sdks/*/agent-service.ts` implementations to the unified `AgentDriver` + `GenericAgentService` architecture (`server/agent-sdks/driver.ts`).

## Placement Legend

- **`core`**: Lives in `GenericAgentService` or `server/services/agent-service-lifecycle.ts`.
- **`driver hook`**: Method or optional hook on `AgentDriver` implemented per driver.
- **`plugin capability`**: Declarative metadata or adapter on the SDK plugin manifest (`server/agent-sdks/registry.js`).
- **`drop`**: Legacy/redundant surface removed when migrating to `GenericAgentService`.

---

## 1. Public / Registered Feathers Methods & Service Registration

| Behaviour                                                                                                   | SDKs                                    | Exact Symbol / File Reference                                                          | Placement                                                                      |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Service mount + `disableExternal` + `registerAgentSdk`                                                      | All 5                                   | `registerInternalAgentService` (`agent-service-lifecycle.ts`); `register*AgentService` | `core`                                                                         |
| `handleMessageCreated`                                                                                      | All 5                                   | `handleAgentMessageCreated` (`agent-service-lifecycle.ts`); `*.handleMessageCreated`   | `core`                                                                         |
| `handleTableMessageCreated`                                                                                 | `mock`                                  | `MockAgentService.handleTableMessageCreated` (`mock/agent-service.ts`)                 | `drop` (alias of `handleMessageCreated` gated on `isMockAgentSdkEnabled()`)    |
| `stopTurn(activeKey)`                                                                                       | All 5                                   | `antigravity`, `claude`, `cursor`, `pi`, `mock` `stopTurn`                             | `core` + `driver hook` (`cancel` / `abort`)                                    |
| `stopSession(sessionId)`                                                                                    | All 5                                   | `antigravity` & `pi` (chat + review), `claude`/`cursor`/`mock` (chat only)             | `core` (standardize stopping chat + review key)                                |
| `runTurn`                                                                                                   | `antigravity`, `claude`, `cursor`, `pi` | `runTurn` in each service                                                              | `core` (orchestration) + `driver hook` (`prompt`)                              |
| `buildAgentOptions` / `buildQueryOptions`                                                                   | `antigravity`, `claude`, `cursor`, `pi` | `buildAgentOptions` / `buildQueryOptions`                                              | `driver hook` (driver-internal)                                                |
| `completeText`                                                                                              | All 5                                   | `completeText` in each service                                                         | `core` (timeout wrapper + `''` fallback) + `driver hook` (`completeText`)      |
| `isInterruptedSessionResumable`                                                                             | All 5                                   | `isAgentSessionResumable` (`agent-service-lifecycle.ts`)                               | `core` (reads `plugin.storedSessionIdColumn`)                                  |
| `prepareTiedSessionLoopCompaction`                                                                          | `antigravity`, `claude`, `cursor`, `pi` | `claudeTiedSessionLoopCompaction` vs `directPromptTiedSessionLoopCompaction`           | `core` default (`directPrompt`) + `driver hook` override (`compactBeforeLoop`) |
| `usesCompactionBeforeLoopRepeat`                                                                            | `claude`, `cursor`, `mock`              | `usesCompactionBeforeLoopRepeat()`                                                     | `plugin capability` (`supportsCompactionBeforeLoopRepeat`)                     |
| `get(id)` / `getActiveSession(id)`                                                                          | All 5                                   | `get` / `getActiveSession` in each service                                             | `core`                                                                         |
| `createAgentSession`, `resumeSession`, `ensureActiveSession`, `sendMessage`                                 | `claude`                                | `claude/agent-service.ts`                                                              | `drop` (replaced by `core` turn lifecycle + driver `resume`)                   |
| `syncSessionSettingsFromPatch`                                                                              | `claude`                                | `claude/agent-service.ts`                                                              | `driver hook` (`onSessionSettingsPatched`)                                     |
| `writeAlwaysApplyRule`, `writePromptRule`, `createOrResumeAgent`, `openSessionStore`, `disposeSessionStore` | `cursor`                                | `cursor/agent-service.ts`                                                              | `driver hook` / driver-private                                                 |

---

## 2. Lifecycle, Turn Execution & Active-Turn Steering

| Behaviour                                                                                             | SDKs                          | Exact Symbol / File Reference                                                      | Placement                                                          |
| ----------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Shared `handleAgentMessageCreated` (dedup, session/agent/SDK guard, channel/activeKey, turn mismatch) | All 5                         | `handleAgentMessageCreated` (`agent-service-lifecycle.ts`)                         | `core`                                                             |
| Mock SDK runtime enablement gate (`isMockAgentSdkEnabled`)                                            | `mock`                        | `mock/agent-service.ts`                                                            | `plugin capability` / registration gate                            |
| Shared outer turn lifecycle (`runAgentTurnLifecycle`)                                                 | `antigravity`, `cursor`, `pi` | `runAgentTurnLifecycle` (`agent-service-lifecycle.ts`)                             | `core` (extend to `claude` and `mock`)                             |
| Custom outer turn lifecycle bypassing `runAgentTurnLifecycle`                                         | `claude`, `mock`              | `claude/agent-service.ts`, `mock/agent-service.ts`                                 | `drop` (migrate onto `core` `runAgentTurnLifecycle`)               |
| Active-turn message injection / steering                                                              | `claude`, `cursor`, `pi`      | `claude` (`channel.push`), `cursor` (`currentRun.steer`), `pi` (`piSession.steer`) | `driver hook` (`steer`) + `plugin capability` (`supportsSteering`) |
| Channel-based long-lived query + deferred `queryInstance.close()`                                     | `claude`                      | `claude._openQuery`, `_disposeActiveSession`, `_closeQueryInstanceSafe`            | `driver hook` (driver-internal cleanup)                            |
| Per-turn MCP bridge (`startAntigravityMcpBridge`) + `consumeMcpToolResult`                            | `antigravity`                 | `antigravity/mcp-bridge.ts`                                                        | `driver hook` (`AcpProcessDriver`)                                 |
| Follow-up run polling (`Agent.listRuns`) for background subagents                                     | `cursor`                      | `cursor._streamRunChainWithFollowUps`                                              | `driver hook`                                                      |
| `AgentBusyError` stale run cancel + retry                                                             | `cursor`                      | `cursor._sendWithBusyRetry`                                                        | `driver hook`                                                      |
| Remote branch new-commit check + `injectBaguetteMessage`                                              | `claude`                      | `claude.sendMessage`, `injectBaguetteMessage`                                      | `drop` (legacy `sendMessage` only)                                 |
| Raw `SDKMessage` persistence (`persistMessage`)                                                       | `claude`                      | `claude.persistMessage`                                                            | `core` (via unified `acp-mapping.ts` + `MessageStreamWriter`)      |

---

## 3. Permission, Question & Tool-Allowlist Handling

| Behaviour                                                                                    | SDKs                       | Exact Symbol / File Reference                            | Placement                                          |
| -------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| `canUseTool` (`ExitPlanMode`, `AskUserQuestion`, `rejectSubagents`, default allow)           | `claude`                   | `claude.createCanUseTool`                                | `driver hook` (`requestPermission` / `canUseTool`) |
| `allowedTools` (`Bash(cmd*)` from `getAllowedCommandsFromUser()`) + `REVIEWER_ALLOWED_TOOLS` | `claude`                   | `commandsToAllowedTools`, `REVIEWER_ALLOWED_TOOLS`       | `driver hook`                                      |
| `endTurnAwaitingUser` -> `'approval'` terminal status                                        | `claude`, `cursor`, `mock` | `agent-service-lifecycle.ts`, `claude`, `cursor`, `mock` | `core`                                             |

---

## 4. Usage & Subscription Limit Handling

| Behaviour                                                                     | SDKs     | Exact Symbol / File Reference                                         | Placement                                                      |
| ----------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- | -------------------------------------------------------------- |
| Pre-turn `checkUsageLimitGate` + `onUsageLimit` / review fail                 | `claude` | `claude/agent-service.ts`                                             | `core` (gated by `plugin capability` `supportsUsageLimitGate`) |
| Mid-turn `ClaudeUsageLimitGuard` + `_checkPlanLimits` + `_recordOverageSpend` | `claude` | `claude._createUsageGuard`, `_checkPlanLimits`, `_recordOverageSpend` | `driver hook` (`createUsageGuard`)                             |
| Post-turn / thrown-error usage limit detection (`cursorUsageLimit`)           | `cursor` | `cursor._runTurn` `onError`, `_handleCursorUsageLimit`                | `driver hook` (`classifyTurnError`) + `core` `onUsageLimit`    |
| `recordTurnUsage` delegation to SDK-specific recorder                         | All 5    | `record-turn-usage.js` in each SDK                                    | `driver hook` (`recordTurnUsage`)                              |

---

## 5. Compaction, Resume, Model Resolution & Prompts

| Behaviour                                                                                | SDKs                                    | Exact Symbol / File Reference        | Placement                                                           |
| ---------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| `registerBaguetteToolMessageCompactionHook` during turn                                  | `antigravity`, `pi`                     | `agent-service-lifecycle.ts`         | `core` (controlled by `plugin capability` `registerCompactionHook`) |
| Stored session ID column on `agents`                                                     | All 5                                   | `StoredSessionIdColumn`              | `plugin capability` (`storedSessionIdColumn`) + `core`              |
| ACP `resumeSession` fallback to `newSession` + `authenticateAndRetry`                    | `antigravity`                           | `antigravity/agent-service.ts`       | `driver hook` (`AcpProcessDriver`)                                  |
| ACP `applyAcpSessionModel` (thought suffix or `setConfigOption`)                         | `antigravity`                           | `antigravity/agent-service.ts`       | `driver hook` (`AcpProcessDriver` model selection strategy)         |
| `SqliteLocalAgentStore` + `.cursor/rules/system-prompt.mdc` + `Agent.resume`             | `cursor`                                | `cursor/agent-service.ts`            | `driver hook`                                                       |
| `SessionManager` + `DefaultResourceLoader` + Pi extensions (`mcp`, `spill`, `lunaroute`) | `pi`                                    | `pi/agent-service.ts`                | `driver hook`                                                       |
| `buildSystemPromptAppend` + `loadEnabledMcpServersForSession`                            | `antigravity`, `claude`, `cursor`, `pi` | Shared helpers                       | `core` loader + `driver hook` formatter                             |
| `buildBaguetteToolList` / `buildReviewerAgentTools` -> `plugin.adaptTools`               | `antigravity`, `claude`, `cursor`, `pi` | Shared helpers + `plugin.adaptTools` | `core` (tool list build) + `plugin capability` (`adaptTools`)       |

---

## 6. Error Handling & `completeText`

| Behaviour                                                                                         | SDKs                | Exact Symbol / File Reference  | Placement                                                                 |
| ------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| `Forbidden` credential error handling                                                             | `claude`            | `claude/agent-service.ts`      | `core`                                                                    |
| Stream-started vs pre-stream error branching (`recordTurnError` vs `persistStatus` + `app:error`) | `antigravity`, `pi` | `antigravity`, `pi`            | `core` + `driver hook` (`classifyTurnError`)                              |
| `emitAppErrorEvenWithWriter` + silent stream end + `run.wait()` failure recovery                  | `cursor`            | `cursor/agent-service.ts`      | `plugin capability` + `driver hook`                                       |
| `METADATA_TIMEOUT_MS` race + fallback `''` for `completeText`                                     | All 5               | `completeText` in each service | `core` (timeout wrapper + fallback `''`) + `driver hook` (`completeText`) |

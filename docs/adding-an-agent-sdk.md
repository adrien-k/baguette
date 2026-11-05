# Adding an agent SDK

Agent runtimes (Claude, Cursor, Pi, Mock) are registered as **self-contained SDK plugins**.
Each SDK owns one folder — `server/agent-sdks/<sdk>/` — that contains everything
SDK-specific: the Feathers agent service, SDK helpers (models, connectivity, mapping,
session paths, …), and the SDK's own tests.

```
server/
├── agent-sdks/          ← everything agent-SDK specific lives here
│   ├── registry.js      plugin store: registerSdkPlugin / getSdkPlugin / servicePathForSdk / registerAgentSdk
│   ├── index.js         manifest: the only file that enumerates SDK plugins
│   ├── __tests__/
│   ├── claude/
│   │   ├── meta.js          key/label/servicePath for this SDK
│   │   ├── index.js         the plugin object (wired below)
│   │   ├── adapt-tools.js   plugin.adaptTools — Claude MCP server wrapping
│   │   ├── agent-service.ts Feathers service mounted on `claude-agent`
│   │   ├── mapping.ts, sdk-turn.ts, connectivity.js, gateway-models.js, env.js, …
│   │   └── __tests__/       ← claude tests live here
│   ├── cursor/ … ├── pi/ … ├── mock/ …
└── services/            ← cross-SDK code only (agents, messages, sessions, agent-configs, …)
```

## The plugin contract

`<sdk>/index.js` exports the plugin. Members are optional (except `key` / `label` /
`servicePath`); lookups fall back to sane defaults (see `agent-sdks/registry.js` and
`sdkPluginPublicMeta`):

```js
export const claudeAgentSdkPlugin = {
  key: 'claude',                  // agent_sdk value in the DB
  label: 'Claude',                // human-readable
  servicePath: 'claude-agent',    // internal Feathers path (never HTTP-exposed)

  // Mount the Feathers service + register the SDK meta (registerAgentSdk).
  register(app, { servicePath } = {}),

  // agent-configs `listModels` (config is a decrypted agent_configs row)
  requiresApiKey: true,                                   // set false if catalogs work with empty api_key (mock)
  async listModels(config, { refresh, user }),
  async clearModelsCache(config),     // drop cached provider catalog after create/patch

  // agent-configs `testConnectivity`
  async testConnectivity(config),

  // MessageStreamWriter tool-call builders (fresh instance per writer call)
  toolCallBuilders(),

  // model_params resolution from a loaded model catalog (MCP create-session, presets)
  resolveModelParams({ models, modelId, user }),

  // Convert generic `{ name, description, schema, handler }` tools into this SDK's shape.
  // Implement in `<sdk>/adapt-tools.js`. MCP (`services/mcp/server.js`) only builds
  // the generic list (`buildBaguetteToolList`); agent services call plugin.adaptTools.
  adaptTools(genericToolList),

  // Capabilities (exposed on agent-configs.getSdkMetas(); functions stay on the plugin)
  supportsModelParams: true,
  requiresModelParamsOnTurn: false,   // true for Cursor
  usesAgentPricingTable: false,       // true for Cursor and Pi
  appliesUserModelPrefs: false,       // true for Cursor (picker user prefs)
  storedSessionIdColumn: 'claude_session_id', // or null
  hasStoredSession(agent),
  normalizePickerModelId(id, pickerIds),
  normalizeApiUrl(url),               // when credentialSchema.hasApiUrl (Claude)

  // Optional usage hooks (sessions.insertUsageRow stays generic)
  resetUsageTotals(totalsKey),        // Claude running-total map; others omit
  usageLabelExtras(row),              // PR footer extras e.g. `{ fast: true }` (Cursor)

  // JSON-serializable Settings credential fields
  credentialSchema: {
    envVarOptions,          // [{ value, label }] or null
    defaultEnvVar,          // string or null
    hasApiUrl,              // Claude only today
    secretPlaceholder,      // default input placeholder
    secretPlaceholderByEnvVar, // optional { ENV_VAR: placeholder }
  },
};
```

`agent-configs.getSdkMetas()` returns the JSON-serializable subset (`key`, `label`,
`servicePath` / `service_path`, capability booleans, `storedSessionIdColumn`,
`requiresApiKey`, `credentialSchema`). The client calls this custom method (declared
in `client/src/feathers.js`) via `useSdkMetas()` — Settings and the model picker
must not branch on sdk keys. Server modules that need functions call
`getSdkPlugin(sdk)` directly. `shared/` and `client/` must not import the registry.

Export only through the registry: other modules must call `getSdkPlugin(sdk)` /
`registerAgentSdk(app, plugin)` (`server/agent-sdks/registry.js`), never import
across SDK folders except the manifest.

## Register a new SDK

1. Create `server/agent-sdks/<sdk>/` with `meta.js`, `agent-service.ts`, helpers, `__tests__/`.
2. Add the plugin object in `<sdk>/index.js` (capabilities + `adaptTools` + `credentialSchema`).
3. Add **two lines** in `agent-sdks/index.js`:

   ```js
   import { mySdkAgentSdkPlugin } from './<sdk>/index.js'; // 1. import
   const allSdkPlugins = [claudeAgentSdkPlugin /* … */, mySdkAgentSdkPlugin];
   ```

That's it — service mounting, agent-configs SDK meta (`getSdkMeta` / `getSdkMetas`,
model presets, settings modal), model listing, connectivity tests, stream writers,
and MCP model-params resolution all pick the new SDK up from the registry. Unknown
`sdk` values on agent-config create are rejected from the registered plugin set
(`listSdkPlugins` / the service `_sdks` map), not a hardcoded key list.

## Testing

Tests live next to the code they cover (`server/agent-sdks/<sdk>/__tests__/`), so an SDK
can be developed and checked in isolation:

```bash
pnpm vitest run server/agent-sdks/<sdk>   # this SDK only
pnpm test                                 # full suite
```

### Live LLM integration tests

Each SDK can ship a `*.live.test.js` that drives a real turn (tools, a `.baguette.yaml`
task, usage). The shared harness is `server/test-utils/sdk-live.js`. Tests **skip**
unless the matching env vars are set (see `.env.example`):

| SDK    | Required env                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------- |
| claude | `SDK_TESTS_CLAUDE_API_KEY` (or `SDK_TESTS_CLAUDE_AUTH_TOKEN`) + `SDK_TESTS_CLAUDE_MODEL`; optional `_API_URL`        |
| cursor | `SDK_TESTS_CURSOR_API_KEY` + `SDK_TESTS_CURSOR_MODEL`                                                                |
| pi     | `SDK_TESTS_PI_API_KEY` + `SDK_TESTS_PI_MODEL`; optional `SDK_TESTS_PI_API_KEY_ENV_VAR` (provider, default Anthropic) |
| mock   | `SDK_TESTS_MOCK=1` (no LLM; optional)                                                                                |

```bash
SDK_TESTS_CLAUDE_API_KEY=sk-ant-… SDK_TESTS_CLAUDE_MODEL=haiku pnpm vitest run server/agent-sdks/claude/__tests__/claude.live.test.js
```

The `agents-integration-test` task in `.baguette.yaml` runs the Pi, Claude, and Cursor live
files against cheap OpenCode Go / Cursor models (secrets `OPEN_CODE_GO_API_KEY` and
`CURSOR_API_KEY`). `pnpm test` / `run-tests` stay skip-gated.

Recommended models (one harness turn each, measured 2026-10-31):

| SDK    | Model                       | Gateway               | Observed cost |
| ------ | --------------------------- | --------------------- | ------------- |
| claude | `claude-haiku-5-5`          | OpenCode Go Anthropic | ~$0.0038      |
| cursor | `glm-5p3-flash`             | Cursor                | ~$0.0045      |
| pi     | `opencode-go/glm-5.3-flash` | OpenCode Go           | ~$0.0051      |

Cursor `composer-2.5` ran the same harness at ~$0.028 — about 6× `glm-5p3-flash`. Suite total on the recommended models is ~$0.013.

Each enabled `*.live.test.js` runs `runLiveSdkSuite`: **listModels** and **testConnectivity** on the saved agent config (Settings parity), a **builder** turn (CreateTodo / ListProjectCommands / RunTask), then a **reviewer** turn (CurrentSessionInfo, no issues). Mock runs list/connect/builder only.

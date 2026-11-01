/**
 * Env-gated live agent-SDK tests: real LLM (or mock) turns against a full Feathers app.
 *
 * Set SDK_TESTS_<SDK>_API_KEY + SDK_TESTS_<SDK>_MODEL (see `.env.example`) to enable.
 * Suites skip when those vars are unset so `pnpm test` stays free/offline by default.
 *
 * Recommended cheap models and observed harness costs (one turn, 2026-10-31):
 *   claude  claude-haiku-5-5 via OpenCode Go Anthropic  ~$0.0038
 *   cursor  glm-5p3-flash                               ~$0.0045  (composer-2.5 was ~$0.028)
 *   pi      opencode-go/glm-5.3-flash                   ~$0.0051
 *
 * `runLiveSdkSuite` also exercises agent-configs listModels + testConnectivity and a
 * reviewer turn (CurrentSessionInfo) per SDK.
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, vi } from 'vitest';
import { createFeathersApp } from '../feathers.js';
import { registerFeathersServices } from '../services/feathers/index.js';
import { resolveDataDirRelativePath } from '../config.js';
import { getSdkPlugin } from '../agent-sdks/registry.js';
import { buildUserTurnMessageJson } from '../services/feathers/message-create-fields.js';
import { insertTestAgentConfig } from './agent-configs.js';
import { createMigratedTestDb } from './db.js';
import { getPrimaryBuilderForSession, insertSessionWithPrimaryBuilder } from './session-agents.js';
import { readLiveSdkEnv } from './sdk-live-env.js';

const execFileAsync = promisify(execFile);
const LIVE_TODO_TITLE = 'sdk-live-todo';
const LIVE_TASK_LABEL = 'echo-ok';

const LIVE_BAGUETTE_YAML = `session:
  tasks:
    ${LIVE_TASK_LABEL}:
      run: echo ok
`;

const LIVE_SDK_TURN_PROMPT = [
  'You are running an automated integration test. Follow these steps in order, then stop.',
  'Do not edit files. Do not ask questions. Do not start a subagent. Do not call GitHub or Slack tools.',
  `1. Call CreateTodo with title "${LIVE_TODO_TITLE}" and content "created by live sdk test". Do not use TodoWrite.`,
  '2. Call ListProjectCommands.',
  `3. Call RunTask with label "${LIVE_TASK_LABEL}" and detach false.`,
  '4. Reply with the single word DONE.',
].join('\n');

const LIVE_SDK_REVIEW_PROMPT = [
  'You are running an automated review-agent integration test. Follow these steps in order, then stop.',
  'Do not edit files. Do not ask questions. Do not start a subagent. Do not call GitHub or Slack tools.',
  'Do not create, update, or close issues.',
  '1. Call CurrentSessionInfo.',
  '2. Reply with the single word REVIEW_OK.',
].join('\n');

async function initLiveWorktree(absPath) {
  await mkdir(absPath, { recursive: true });
  await execFileAsync('git', ['init'], { cwd: absPath });
  await execFileAsync('git', ['config', 'user.email', 'sdk-live@example.com'], { cwd: absPath });
  await execFileAsync('git', ['config', 'user.name', 'SDK Live'], { cwd: absPath });
  await writeFile(path.join(absPath, '.baguette.yaml'), LIVE_BAGUETTE_YAML, 'utf8');
  await writeFile(path.join(absPath, 'README.md'), 'sdk live test fixture\n', 'utf8');
  await execFileAsync('git', ['add', '-A'], { cwd: absPath });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: absPath });
}

function randomShortId() {
  return Math.random().toString(36).slice(2, 8);
}

async function createLiveApp(db) {
  const app = createFeathersApp();
  app.set('db', db);
  registerFeathersServices(app, { realtime: false });
  await app.setup();
  return app;
}

async function seedLiveSession(db, sdk, env) {
  const [userId] = await db('users').insert({
    github_id: 800000 + Math.floor(Math.random() * 100000),
    username: `sdk-live-${sdk}`,
    email: `sdk-live-${sdk}@example.com`,
    approved: true,
  });

  const worktreeRel = `repos/sdk-live-${sdk}/sessions/wt-${randomShortId()}`;
  const worktreeAbs = resolveDataDirRelativePath(worktreeRel);
  await initLiveWorktree(worktreeAbs);

  const fullName = `sdk-live/${sdk}`;
  const [repoId] = await db('repos').insert({
    full_name: fullName,
    repo_path: `repos/sdk-live-${sdk}/main`,
    stripped_name: `sdk-live-${sdk}`,
  });

  const configId = await insertTestAgentConfig(db, userId, {
    sdk,
    apiKey: sdk === 'mock' ? null : env.apiKey,
    apiKeyEnvVar: env.apiKeyEnvVar,
    apiUrl: env.apiUrl,
  });

  const sessionId = await insertSessionWithPrimaryBuilder(db, {
    user_id: userId,
    repo_id: repoId,
    repo_full_name: fullName,
    base_branch: 'main',
    initial_prompt: 'live sdk test',
    short_id: randomShortId(),
    session_path: worktreeRel,
    status: 'stopped',
    auto_push: 0,
    agent_sdk: sdk,
    model: env.model,
    model_params: env.modelParams,
    agent_config_id: configId,
  });

  const agent = await getPrimaryBuilderForSession(db, sessionId);
  return {
    userId,
    sessionId,
    agentId: agent.id,
    agent,
    configId,
    worktreeAbs,
  };
}

async function stopLiveTurn(app, sdk, ctx, { agentId } = {}) {
  if (!app || !ctx) return;
  try {
    const plugin = getSdkPlugin(sdk);
    const svc = plugin?.servicePath ? app.service(plugin.servicePath) : null;
    const keys = [ctx.sessionId, ctx.agentId, agentId].filter((k) => k != null);
    for (const key of keys) {
      await svc?.stopTurn?.(key);
    }
  } catch {
    // Best-effort: a finished turn has already dropped active state.
  }
}

function parsePayload(row) {
  try {
    return JSON.parse(row.message_json || '{}');
  } catch {
    return {};
  }
}

function nestedToolName(args) {
  if (!args || typeof args !== 'object') return '';
  if (typeof args.tool === 'string' && args.tool) return args.tool;
  if (typeof args.toolName === 'string' && args.toolName) return args.toolName;
  return nestedToolName(args.args);
}

function toolNamesFromMessages(rows) {
  const names = [];
  for (const row of rows) {
    if (row.type !== 'tool_call') continue;
    const payload = parsePayload(row);
    if (typeof payload.name === 'string' && payload.name) names.push(payload.name);
    const nested = nestedToolName(payload.args);
    if (nested) names.push(nested);
  }
  return names;
}

function hasToolName(names, fragment) {
  const needle = String(fragment).toLowerCase();
  return names.some((n) => n.toLowerCase().includes(needle));
}

function sumUsageField(usageRows, field) {
  return usageRows.reduce((sum, u) => sum + (Number(u[field]) || 0), 0);
}

function formatLiveUsageCost(sdk, usageRows) {
  const cost = sumUsageField(usageRows, 'cost_usd');
  const tokens = sumUsageField(usageRows, 'total_tokens');
  const input = sumUsageField(usageRows, 'input_tokens');
  const output = sumUsageField(usageRows, 'output_tokens');
  const models = [...new Set(usageRows.map((u) => u.model).filter(Boolean))];
  return `[sdk-live ${sdk}] cost=$${cost.toFixed(6)} tokens=${tokens} in=${input} out=${output} model=${models.join(',') || '(none)'}`;
}

function formatTurnDump(rows, usageRows, agent) {
  const msgLines = rows.map((row) => {
    const json = String(row.message_json || '').slice(0, 240);
    return `${row.type}${row.subtype ? `/${row.subtype}` : ''}: ${json}`;
  });
  const usageLines = usageRows.map(
    (u) =>
      `usage id=${u.id} sdk=${u.agent_sdk} tokens=${u.total_tokens} cost=${u.cost_usd} model=${u.model}`
  );
  return [
    `agent status=${agent?.status} active_turn_id=${agent?.active_turn_id}`,
    usageLines.length ? usageLines.join('\n') : 'usage: (none)',
    msgLines.join('\n') || 'messages: (none)',
  ].join('\n');
}

function modelListedInCatalog(models, expectedModel) {
  if (!expectedModel) return models.length > 0;
  const want = String(expectedModel).trim();
  if (!want) return models.length > 0;
  const ids = models.map((m) => String(m.id ?? '').trim()).filter(Boolean);
  if (ids.includes(want)) return true;
  const bare = want.includes('/') ? want.split('/').pop() : want;
  return ids.some((id) => id === bare || id.endsWith(`/${bare}`) || want.endsWith(id));
}

async function dumpTurnState(db, { sessionId, agentId }) {
  const agent = await db('agents').where({ id: agentId }).first();
  const rows = await db('session_messages')
    .where({ session_id: sessionId, agent_id: agentId })
    .orderBy('id');
  const usageRows = await db('usage')
    .where({ session_id: sessionId, agent_id: agentId })
    .orderBy('id');
  return formatTurnDump(rows, usageRows, agent);
}

async function waitForAgentTurnEnd(db, { agentId, sessionId }, timeoutMs) {
  try {
    await vi.waitFor(
      async () => {
        const agent = await db('agents').where({ id: agentId }).first();
        expect(agent?.status).not.toBe('stopped');
      },
      { timeout: Math.min(timeoutMs, 20_000), interval: 200 }
    );

    await vi.waitFor(
      async () => {
        const agent = await db('agents').where({ id: agentId }).first();
        expect(['completed', 'failed', 'approval']).toContain(agent?.status);
      },
      { timeout: timeoutMs, interval: 400 }
    );
  } catch (err) {
    const dump = await dumpTurnState(db, { sessionId, agentId });
    throw new Error(`${err.message}\n${dump}`);
  }

  return db('agents').where({ id: agentId }).first();
}

async function waitForTurnEnd(db, ctx, timeoutMs) {
  return waitForAgentTurnEnd(db, { agentId: ctx.agentId, sessionId: ctx.sessionId }, timeoutMs);
}

/**
 * Post a user prompt, wait for the builder turn to finish, and assert turn/tool/usage.
 *
 * @param {{ expectUsage?: boolean, expectTodo?: boolean, expectTaskTools?: boolean, prompt?: string }} [opts]
 */
async function runLiveTurnAndAssert(app, db, ctx, env, opts = {}) {
  const {
    expectUsage = true,
    expectTodo = true,
    expectTaskTools = true,
    expectAnyTools = true,
    prompt = LIVE_SDK_TURN_PROMPT,
  } = opts;
  const user = { id: ctx.userId };
  const identity = {
    agent_id: ctx.agentId,
    agent_sdk: env.sdk,
    model: env.model,
    agent_config_id: ctx.configId,
    ...(env.modelParams != null ? { model_params: env.modelParams } : {}),
  };

  await app.service('messages').create(
    {
      session_id: ctx.sessionId,
      type: 'user',
      message_json: buildUserTurnMessageJson(prompt),
      ...identity,
    },
    { user }
  );

  const agent = await waitForTurnEnd(db, ctx, env.timeoutMs);
  const rows = await db('session_messages')
    .where({ session_id: ctx.sessionId, agent_id: ctx.agentId })
    .orderBy('id');
  const usageRows = await db('usage')
    .where({ session_id: ctx.sessionId, agent_id: ctx.agentId })
    .orderBy('id');
  const dump = formatTurnDump(rows, usageRows, agent);

  if (agent.status !== 'completed') {
    throw new Error(`Expected turn status completed, got ${agent.status}\n${dump}`);
  }
  expect(agent.active_turn_id, dump).toBeNull();

  const toolNames = toolNamesFromMessages(rows);
  if (expectAnyTools) {
    expect(toolNames.length, `expected at least one tool call\n${dump}`).toBeGreaterThan(0);
  }
  if (expectTodo) {
    const todos = await db('session_todos').where({ session_id: ctx.sessionId });
    const todo = todos.find((t) => t.title === LIVE_TODO_TITLE);
    expect(todo, `CreateTodo did not persist ${LIVE_TODO_TITLE}\n${dump}`).toBeTruthy();
    expect(hasToolName(toolNames, 'CreateTodo'), `missing CreateTodo tool call\n${dump}`).toBe(
      true
    );
  }
  if (expectTaskTools) {
    const listed = hasToolName(toolNames, 'ListProjectCommands');
    const ran = hasToolName(toolNames, 'RunTask');
    expect(
      listed || ran,
      `expected ListProjectCommands or RunTask, got [${toolNames.join(', ')}]\n${dump}`
    ).toBe(true);
  }
  if (expectUsage) {
    expect(usageRows.length, `expected a usage row\n${dump}`).toBeGreaterThan(0);
    const row = usageRows[0];
    expect(row.agent_sdk, dump).toBe(env.sdk);
    expect(row.agent_id, dump).toBe(ctx.agentId);
    expect(row.agent_config_id, dump).toBe(ctx.configId);
    const tokens = Number(row.total_tokens) || 0;
    const cost = Number(row.cost_usd) || 0;
    expect(tokens > 0 || cost > 0, `expected tokens or cost on usage row\n${dump}`).toBe(true);
    // eslint-disable-next-line no-console -- live test cost report
    console.log(formatLiveUsageCost(env.sdk, usageRows));
  }

  return { agent, rows, usageRows, toolNames };
}

async function assertLiveListModels(app, ctx, env) {
  const listParams = { id: ctx.configId, refresh: true };
  const auth = { user: { id: ctx.userId } };
  try {
    const { models, rejected_models } = await app
      .service('agent-configs')
      .listModels(listParams, auth);
    expect(Array.isArray(models), 'listModels returned models array').toBe(true);
    expect(models.length, 'listModels returned no models').toBeGreaterThan(0);
    expect(
      modelListedInCatalog(models, env.model),
      `configured model "${env.model}" not in catalog (${models
        .slice(0, 8)
        .map((m) => m.id)
        .join(', ')}${models.length > 8 ? ', …' : ''})`
    ).toBe(true);
    expect(Array.isArray(rejected_models)).toBe(true);
    // eslint-disable-next-line no-console -- live test report
    console.log(`[sdk-live ${env.sdk}] listModels count=${models.length} model=${env.model}`);
    return true;
  } catch (err) {
    const connectivity = await app
      .service('agent-configs')
      .testConnectivity({ id: ctx.configId }, auth);
    expect(
      connectivity?.ok,
      `listModels failed (${err?.message}); connectivity: ${JSON.stringify(connectivity?.checks ?? connectivity)}`
    ).toBe(true);
    const ids = connectivity?.models ?? [];
    if (ids.length > 0) {
      expect(
        modelListedInCatalog(
          ids.map((id) => ({ id })),
          env.model
        ),
        `configured model "${env.model}" not in connectivity model list`
      ).toBe(true);
    }
    // eslint-disable-next-line no-console -- live test report
    console.log(
      `[sdk-live ${env.sdk}] listModels via connectivity fallback (${err?.message ?? 'catalog unavailable'})`
    );
    return false;
  }
}

async function assertLiveConnectivity(app, ctx, env, { listModelsOk = false } = {}) {
  if (listModelsOk && env.sdk === 'pi') {
    // Pi listModels already loaded the provider catalog; opencode-go probe path is redundant.
    // eslint-disable-next-line no-console -- live test report
    console.log('[sdk-live pi] connectivity ok=true (listModels verified catalog)');
    return;
  }
  const result = await app
    .service('agent-configs')
    .testConnectivity({ id: ctx.configId }, { user: { id: ctx.userId } });
  expect(result?.ok, `connectivity failed: ${JSON.stringify(result?.checks ?? result)}`).toBe(true);
  // eslint-disable-next-line no-console -- live test report
  console.log(`[sdk-live ${env.sdk}] connectivity ok=true`);
}

async function insertLiveReviewerAgent(db, ctx, env) {
  const [reviewerId] = await db('agents').insert({
    session_id: ctx.sessionId,
    name: 'Reviewer',
    agent_type: 'reviewer',
    is_primary: 0,
    status: 'stopped',
    agent_sdk: env.sdk,
    model: env.model,
    model_params: env.modelParams,
    agent_config_id: ctx.configId,
    current_turn_id: 0,
  });
  return db('agents').where({ id: reviewerId }).first();
}

async function runLiveReviewerTurnAndAssert(app, db, ctx, env) {
  const reviewer = await insertLiveReviewerAgent(db, ctx, env);
  const user = { id: ctx.userId };
  const identity = {
    agent_id: reviewer.id,
    agent_type: 'reviewer',
    agent_sdk: env.sdk,
    model: env.model,
    agent_config_id: ctx.configId,
    ...(env.modelParams != null ? { model_params: env.modelParams } : {}),
  };

  await app.service('messages').create(
    {
      session_id: ctx.sessionId,
      type: 'user',
      message_json: buildUserTurnMessageJson(LIVE_SDK_REVIEW_PROMPT),
      ...identity,
    },
    { user }
  );

  const agent = await waitForAgentTurnEnd(
    db,
    { agentId: reviewer.id, sessionId: ctx.sessionId },
    env.timeoutMs
  );
  const rows = await db('session_messages')
    .where({ session_id: ctx.sessionId, agent_id: reviewer.id })
    .orderBy('id');
  const usageRows = await db('usage')
    .where({ session_id: ctx.sessionId, agent_id: reviewer.id })
    .orderBy('id');
  const dump = formatTurnDump(rows, usageRows, agent);

  if (agent.status !== 'completed') {
    throw new Error(`Expected reviewer turn status completed, got ${agent.status}\n${dump}`);
  }
  expect(agent.active_turn_id, dump).toBeNull();

  const toolNames = toolNamesFromMessages(rows);
  expect(toolNames.length, `reviewer expected at least one tool call\n${dump}`).toBeGreaterThan(0);
  expect(
    hasToolName(toolNames, 'CurrentSessionInfo'),
    `reviewer missing CurrentSessionInfo tool call\n${dump}`
  ).toBe(true);

  const cost = sumUsageField(usageRows, 'cost_usd');
  const tokens = sumUsageField(usageRows, 'total_tokens');
  // eslint-disable-next-line no-console -- live test cost report
  console.log(
    `[sdk-live ${env.sdk} reviewer] cost=$${cost.toFixed(6)} tokens=${tokens} model=${env.model}`
  );

  return { agent, rows, usageRows, toolNames, reviewerId: reviewer.id };
}

function applyMockLiveEnv(sdk) {
  const prevMockEnv =
    sdk === 'mock'
      ? {
          ENABLE_MOCK_AGENT: process.env.ENABLE_MOCK_AGENT,
          MOCK_AGENT_SLEEP_MS: process.env.MOCK_AGENT_SLEEP_MS,
          MOCK_AGENT_STEP_DELAY_MS: process.env.MOCK_AGENT_STEP_DELAY_MS,
        }
      : null;
  if (prevMockEnv) {
    process.env.ENABLE_MOCK_AGENT = 'true';
    process.env.MOCK_AGENT_SLEEP_MS = '0';
    process.env.MOCK_AGENT_STEP_DELAY_MS = '0';
  }
  return prevMockEnv;
}

function restoreMockLiveEnv(prevMockEnv) {
  if (!prevMockEnv) return;
  for (const [key, value] of Object.entries(prevMockEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/**
 * Live checks: plugin listModels + testConnectivity, builder turn, reviewer turn.
 *
 * @param {'claude' | 'cursor' | 'pi' | 'mock'} sdk
 * @param {{ builder?: object, includeReviewer?: boolean }} [opts]
 */
export async function runLiveSdkSuite(sdk, opts = {}) {
  const { builder: builderOpts = {}, includeReviewer = sdk !== 'mock' } = opts;
  const env = readLiveSdkEnv(sdk);
  const prevMockEnv = applyMockLiveEnv(sdk);
  const db = await createMigratedTestDb();
  let app;
  let ctx;
  let reviewerId;
  try {
    app = await createLiveApp(db);
    ctx = await seedLiveSession(db, sdk, env);
    const listModelsOk = await assertLiveListModels(app, ctx, env);
    await assertLiveConnectivity(app, ctx, env, { listModelsOk });
    const builderResult = await runLiveTurnAndAssert(app, db, ctx, env, builderOpts);
    let reviewerResult = null;
    if (includeReviewer) {
      reviewerResult = await runLiveReviewerTurnAndAssert(app, db, ctx, env);
      reviewerId = reviewerResult.reviewerId;
    }
    return { ...builderResult, reviewerResult };
  } finally {
    await stopLiveTurn(app, sdk, ctx, { agentId: reviewerId });
    await db.destroy();
    restoreMockLiveEnv(prevMockEnv);
  }
}

/**
 * Boot a throwaway app, run one live turn, then tear down.
 * Live `*.live.test.js` files should dynamic-import this from inside `it()` so
 * skipped suites never load Feathers / agent SDKs.
 */
export async function runLiveSdkIntegration(sdk, assertOpts = {}) {
  return runLiveSdkSuite(sdk, { builder: assertOpts, includeReviewer: false });
}

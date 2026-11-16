import { describe, it, expect, beforeEach, vi } from 'vitest';
import { feathers } from 'feathers';
import {
  createTestDb,
  testSessionAgentDefaults,
  insertTestSession,
  testMessageRow,
  getPrimaryBuilderAgentId,
} from '../../test-utils/db.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import { registerAgentObserversService } from '../feathers/agent-observers.service.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerQueuedMessagesService } from '../feathers/queued-messages.service.js';
import { TasksService } from '../feathers/tasks.service.js';
import { buildBaguetteSessionMcpTools } from '../baguette-session-mcp-tools.js';
import { useClaudeAgentStub } from '../../test-utils/agent-sdks.js';

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadBaguetteConfig: vi.fn().mockResolvedValue(null),
  };
});

const db = createTestDb();

function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

function parseOk(result) {
  const out = parseResult(result);
  expect(out.ok).toBe(true);
  return out;
}

describe('baguette session MCP tools', () => {
  let app;
  let userId;
  let sessionId;
  let tools;

  beforeEach(async () => {
    [userId] = await db('users').insert({ github_id: 99, username: 'mcp', status: 'approved' });
    const claudeConfigId = await insertTestAgentConfig(db, userId, { apiKey: 'sk-ant-test' });
    await db('users')
      .where({ id: userId })
      .update({
        agent_default_config_id: claudeConfigId,
        agent_default_model: JSON.stringify({ model: 'sonnet', model_params: null }),
      });
    const [repoId] = await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
    await db('user_repos').insert({ user_id: userId, repo_id: repoId });
    sessionId = await insertTestSession(db, {
      user_id: userId,
      repo_id: repoId,
      repo_full_name: 'o/r',
      short_id: 'abcd',
      label: 'Fix auth bug',
      initial_prompt: 'Please fix login',
      base_branch: 'main',
      local_branch: 'feat/auth',
      status: 'stopped',
      ...testSessionAgentDefaults,
    });
    await db('session_messages').insert([
      await testMessageRow(db, sessionId, {
        type: 'user',
        message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
      }),
      await testMessageRow(db, sessionId, {
        type: 'assistant',
        message_json: JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: 'hello' },
        }),
      }),
    ]);

    app = feathers();
    app.set('db', db);
    app.use('users', {
      async get(id) {
        const row = await db('users').where({ id }).first();
        return row ?? { id };
      },
    });
    registerSessionsService(app);
    registerAgentsService(app);
    registerAgentObserversService(app);
    useClaudeAgentStub(
      app,
      {
        onMessageCreated: vi.fn().mockResolvedValue(undefined),
        syncSessionSettingsFromPatch: vi.fn(),
      },
      ['onMessageCreated', 'syncSessionSettingsFromPatch']
    );
    registerQueuedMessagesService(app);
    registerMessagesService(app);
    const tasksService = new TasksService();
    tasksService.setup(app);
    app.use('tasks', tasksService);
    await app.setup();
    tools = buildBaguetteSessionMcpTools({ id: userId }, app, {
      callerSession: { id: sessionId, is_global: false },
    });
  });

  it('SearchSessions filters by q and base_branch', async () => {
    const search = tools.find((t) => t.name === 'SearchSessions');
    const out = parseOk(await search.handler({ q: 'auth', base_branch: 'main' }));
    expect(out.ok).toBe(true);
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0].id).toBe(sessionId);
  });

  it('SearchSessions filters by remote_branch and returns each local_branch', async () => {
    const repoId = (await db('repos').where({ full_name: 'o/r' }).first()).id;
    const sharedRemote = 'feature/shared-head';
    await insertTestSession(db, {
      user_id: userId,
      repo_id: repoId,
      repo_full_name: 'o/r',
      short_id: 'bbbb',
      label: 'Second on shared head',
      initial_prompt: 'More work',
      base_branch: 'main',
      local_branch: 'feature/shared-head-bbbb',
      remote_branch: sharedRemote,
      status: 'stopped',
      ...testSessionAgentDefaults,
    });
    await db('sessions')
      .where({ id: sessionId })
      .update({ remote_branch: sharedRemote, local_branch: 'feature/shared-head-abcd' });

    const search = tools.find((t) => t.name === 'SearchSessions');
    const out = parseOk(await search.handler({ remote_branch: sharedRemote }));
    expect(out.sessions).toHaveLength(2);
    const locals = out.sessions.map((s) => s.local_branch).sort();
    expect(locals).toEqual(['feature/shared-head-abcd', 'feature/shared-head-bbbb']);
  });

  it('GetSession returns message count and last assistant', async () => {
    const get = tools.find((t) => t.name === 'GetSession');
    const out = parseOk(await get.handler({ session_id: sessionId }));
    expect(out.message_count).toBe(2);
    expect(out.initial_prompt).toBe('Please fix login');
    expect(out.last_assistant_message.message.content).toBe('hello');
    expect(out.session.short_id).toBeUndefined();
  });

  it('GetSessionMessage supports byte ranges', async () => {
    const [msgId] = await db('session_messages')
      .where({ session_id: sessionId, type: 'assistant' })
      .pluck('id');
    const getMsg = tools.find((t) => t.name === 'GetSessionMessage');
    const out = parseOk(await getMsg.handler({ session_id: sessionId, message_id: msgId }));
    expect(out.message_json).toContain('hello');
  });

  it('CreateSessionMessage rejects empty or whitespace-only text', async () => {
    const create = tools.find((t) => t.name === 'CreateSessionMessage');
    for (const text of ['', '   ']) {
      const out = parseResult(await create.handler({ session_id: sessionId, text }));
      expect(out.ok).toBe(false);
    }
    const count = await db('session_messages')
      .where({ session_id: sessionId, type: 'user' })
      .count('id as c')
      .first();
    expect(Number(count.c)).toBe(1);
  });

  it('CreateSessionMessage sends immediately when session is idle', async () => {
    const create = tools.find((t) => t.name === 'CreateSessionMessage');
    const out = parseOk(await create.handler({ session_id: sessionId, text: 'ping' }));
    expect(out.message_id).toBeTruthy();
    const row = await db('session_messages').where({ id: out.message_id }).first();
    const parsed = JSON.parse(row.message_json);
    expect(parsed.content).toBe('ping');
    expect(parsed.source).toBe('mcp');
    expect(row.subtype).toBe('mcp');
    const primary = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    expect(row.model).toBe(primary.model);
  });

  it('CreateSessionMessage uses target agent model without Settings builder defaults', async () => {
    await db('users').where({ id: userId }).update({
      agent_default_config_id: null,
      agent_default_model: null,
    });
    const altConfigId = await insertTestAgentConfig(db, userId, {
      apiKey: 'sk-ant-alt',
      label: 'Alt',
    });
    const [extraAgentId] = await db('agents').insert({
      session_id: sessionId,
      ref: 2,
      name: 'Extra',
      agent_type: 'builder',
      is_primary: 0,
      status: 'stopped',
      agent_config_id: altConfigId,
      agent_sdk: 'claude',
      model: 'opus',
      model_params: null,
      current_turn_id: 0,
    });
    const create = tools.find((t) => t.name === 'CreateSessionMessage');
    const out = parseOk(
      await create.handler({ session_id: sessionId, text: 'follow-up', agent_ref: 2 })
    );
    const row = await db('session_messages').where({ id: out.message_id }).first();
    expect(row.agent_id).toBe(extraAgentId);
    expect(row.model).toBe('opus');
    expect(row.agent_config_id).toBe(altConfigId);
  });

  it('CreateSessionMessage schedules with send_at', async () => {
    const sendAt = new Date(Date.now() + 120_000).toISOString();
    const create = tools.find((t) => t.name === 'CreateSessionMessage');
    const out = parseOk(
      await create.handler({ session_id: sessionId, text: 'later', send_at: sendAt })
    );
    expect(out.scheduled).toBe(true);
    expect(out.queued_message_id).toBeTruthy();
    const queued = await db('queued_messages').where({ id: out.queued_message_id }).first();
    expect(queued.kind).toBe('scheduled');
    expect(JSON.parse(queued.message_json).content).toBe('later');
  });

  it('CreateSessionMessage allows repo agent to post to another owned session', async () => {
    const otherId = await insertTestSession(db, {
      user_id: userId,
      repo_id: (await db('repos').where({ full_name: 'o/r' }).first()).id,
      repo_full_name: 'o/r',
      short_id: 'efgh',
      label: 'Other',
      initial_prompt: 'Other task',
      base_branch: 'main',
      local_branch: 'feat/other',
      status: 'stopped',
      ...testSessionAgentDefaults,
    });
    const create = tools.find((t) => t.name === 'CreateSessionMessage');
    const out = parseOk(await create.handler({ session_id: otherId, text: 'from repo agent' }));
    expect(out.message_id).toBeTruthy();
  });

  it('CreateSessionMessage allows global agent to post to another session', async () => {
    const globalId = await insertTestSession(db, {
      user_id: userId,
      is_global: true,
      repo_full_name: '',
      session_path: 'repos',
      base_branch: '',
      short_id: 'glob01',
      label: 'Global',
      initial_prompt: 'Orchestrate',
      status: 'stopped',
      ...testSessionAgentDefaults,
    });
    const targetId = await insertTestSession(db, {
      user_id: userId,
      repo_id: (await db('repos').where({ full_name: 'o/r' }).first()).id,
      repo_full_name: 'o/r',
      short_id: 'targ01',
      label: 'Target',
      initial_prompt: 'Work',
      base_branch: 'main',
      local_branch: 'feat/target',
      status: 'stopped',
      ...testSessionAgentDefaults,
    });
    const globalTools = buildBaguetteSessionMcpTools({ id: userId }, app, {
      callerSession: { id: globalId, is_global: true },
    });
    const create = globalTools.find((t) => t.name === 'CreateSessionMessage');
    const out = parseOk(await create.handler({ session_id: targetId, text: 'from global' }));
    expect(out.message_id).toBeTruthy();
  });

  it('CreateSessionMessage allows external MCP to post to an owned session', async () => {
    const externalTools = buildBaguetteSessionMcpTools({ id: userId }, app);
    const create = externalTools.find((t) => t.name === 'CreateSessionMessage');
    const out = parseOk(await create.handler({ session_id: sessionId, text: 'from external mcp' }));
    expect(out.message_id).toBeTruthy();
  });

  it('ListRunningTasks returns only running tasks for a session', async () => {
    const tasks = app.service('tasks');
    const running = tasks.createTask({
      sessionId,
      command: 'sleep 9',
      label: 'dev-server',
      taskKey: 'dev-server',
    });
    const exited = tasks.createTask({
      sessionId,
      command: 'false',
      label: 'Run tests',
      taskKey: 'Run tests',
    });
    exited.status = 'exited';

    const list = tools.find((t) => t.name === 'ListRunningTasks');
    const listed = parseOk(await list.handler({ session_id: sessionId }));
    expect(listed.session_id).toBe(sessionId);
    expect(listed.tasks).toHaveLength(1);
    expect(listed.tasks[0].id).toBe(running.id);
    expect(listed.tasks[0].task_key).toBe('dev-server');
  });

  it('PrRead uses caller session when session_id omitted', async () => {
    await db('sessions')
      .where({ id: sessionId })
      .update({ pr_url: 'https://github.com/o/r/pull/1', pr_number: 1 });
    const prRead = tools.find((t) => t.name === 'PrRead');
    const out = parseOk(await prRead.handler({}));
    expect(out.pr_url).toBe('https://github.com/o/r/pull/1');
  });

  it('GetSession includes last_failed_tasks', async () => {
    const tasks = app.service('tasks');
    const task = tasks.createTask({
      sessionId,
      command: 'false',
      label: 'ci',
      taskKey: 'ci',
    });
    task.status = 'exited';
    task.exit_code = 2;

    const get = tools.find((t) => t.name === 'GetSession');
    const out = parseOk(await get.handler({ session_id: sessionId }));
    expect(out.last_failed_tasks).toHaveLength(1);
    expect(out.last_failed_tasks[0].exit_code).toBe(2);
  });

  it('SearchSessions returns builder_status and builder_agent_id per session', async () => {
    await db('agents')
      .where({ session_id: sessionId, is_primary: 1 })
      .update({ status: 'running' });
    const search = tools.find((t) => t.name === 'SearchSessions');
    const out = parseOk(await search.handler({ q: 'auth' }));
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0].builder_status).toBe('running');
    expect(out.sessions[0].builder_agent_id).toBe(await getPrimaryBuilderAgentId(db, sessionId));
  });

  it('GetSessionStatus returns agent, queued, task, and todo rollup', async () => {
    const primaryAgentId = await getPrimaryBuilderAgentId(db, sessionId);
    await db('agents')
      .where({ id: primaryAgentId })
      .update({ status: 'running', active_turn_id: 7 });
    await db('agents').insert({
      session_id: sessionId,
      ref: 2,
      name: 'Helper',
      agent_type: 'subagent',
      is_primary: 0,
      status: 'completed',
      agent_config_id: (await db('agents').where({ id: primaryAgentId }).first()).agent_config_id,
      agent_sdk: 'claude',
      model: 'sonnet',
      model_params: null,
      current_turn_id: 1,
    });
    await db('queued_messages').insert({
      session_id: sessionId,
      user_id: userId,
      agent_id: primaryAgentId,
      kind: 'turn',
      message_json: JSON.stringify({ content: 'queued follow-up' }),
    });
    await db('session_todos').insert([
      { session_id: sessionId, ref: 1, content: 'do a', status: 'pending', sort_order: 0 },
      { session_id: sessionId, ref: 2, content: 'do b', status: 'in_progress', sort_order: 1 },
      { session_id: sessionId, ref: 3, content: 'do c', status: 'completed', sort_order: 2 },
    ]);
    await db('session_plans').insert({ session_id: sessionId, markdown: '# plan', status: 'open' });
    await db('session_messages').where({ session_id: sessionId }).update({ turn_id: 7 });
    const tasks = app.service('tasks');
    const running = tasks.createTask({
      sessionId,
      command: 'sleep 9',
      label: 'dev-server',
      taskKey: 'dev-server',
    });

    const status = tools.find((t) => t.name === 'GetSessionStatus');
    const out = parseOk(await status.handler({ session_id: sessionId }));

    expect(out.session.id).toBe(sessionId);
    expect(out.session.short_id).toBeUndefined();
    expect(out.primary_agent_id).toBe(primaryAgentId);
    expect(out.agents).toHaveLength(2);
    const primary = out.agents.find((a) => a.is_primary);
    expect(primary.status).toBe('running');
    expect(primary.active_turn_id).toBe(7);
    const subagent = out.agents.find((a) => !a.is_primary);
    expect(subagent.agent_type).toBe('subagent');
    expect(subagent.status).toBe('completed');
    expect(out.queued_messages).toEqual({ total: 1, primary_count: 1, scheduled_count: 0 });
    expect(out.last_message.user).toBeTruthy();
    expect(out.last_message.assistant).toBeTruthy();
    expect(out.last_message.assistant.turn_id).toBe(7);
    expect(out.last_message.user.turn_id).toBe(7);
    expect(out.running_tasks).toHaveLength(1);
    expect(out.running_tasks[0].task_id).toBe(running.id);
    expect(out.todos).toEqual({ pending: 1, in_progress: 1, completed: 1 });
    expect(out.plan.status).toBe('open');
  });

  it('GetSessionStatus hides stale deleted-agent queued rows from primary_count', async () => {
    await db('queued_messages').insert({
      session_id: sessionId,
      user_id: userId,
      agent_id: null,
      kind: 'turn',
      message_json: JSON.stringify({ content: 'orphan' }),
    });
    const status = tools.find((t) => t.name === 'GetSessionStatus');
    const out = parseOk(await status.handler({ session_id: sessionId }));
    expect(out.queued_messages.total).toBe(1);
    expect(out.queued_messages.primary_count).toBe(0);
  });

  it('GetSessionStatus rejects another user’s session', async () => {
    const [otherUserId] = await db('users').insert({
      github_id: 1000,
      username: 'other',
      status: 'approved',
    });
    const otherSessionId = await insertTestSession(db, {
      user_id: otherUserId,
      repo_id: (await db('repos').where({ full_name: 'o/r' }).first()).id,
      repo_full_name: 'o/r',
      short_id: 'othr0',
      label: 'Not mine',
      initial_prompt: 'secret',
      base_branch: 'main',
      local_branch: 'feat/not-mine',
      status: 'stopped',
      ...testSessionAgentDefaults,
    });
    const status = tools.find((t) => t.name === 'GetSessionStatus');
    const out = parseResult(await status.handler({ session_id: otherSessionId }));
    expect(out.ok).toBe(false);
  });

  it('AwaitSessionTurn returns immediately when the builder is not running', async () => {
    const tool = tools.find((t) => t.name === 'AwaitSessionTurn');
    const out = parseOk(await tool.handler({ session_id: sessionId }));
    expect(out.status).toBe('stopped');
    expect(out.timed_out).toBe(false);
    expect(out.agent_id).toBe(await getPrimaryBuilderAgentId(db, sessionId));
  });

  it('AwaitSessionTurn waits for a running turn to finish', async () => {
    const primaryAgentId = await getPrimaryBuilderAgentId(db, sessionId);
    await db('agents').where({ id: primaryAgentId }).update({ status: 'running' });
    const tool = tools.find((t) => t.name === 'AwaitSessionTurn');
    const pending = tool.handler({ session_id: sessionId }).then(parseOk);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await db('agents').where({ id: primaryAgentId }).update({ status: 'completed' });
    const out = await pending;
    expect(out.status).toBe('completed');
    expect(out.timed_out).toBe(false);
  });

  it('AwaitSessionTurn reports timed_out without cancelling on wait expiry', async () => {
    vi.useFakeTimers();
    try {
      const primaryAgentId = await getPrimaryBuilderAgentId(db, sessionId);
      await db('agents').where({ id: primaryAgentId }).update({ status: 'running' });
      const tool = tools.find((t) => t.name === 'AwaitSessionTurn');
      const pending = tool.handler({ session_id: sessionId }).then(parseOk);
      await vi.advanceTimersByTimeAsync(31 * 60_000);
      const out = await pending;
      expect(out.timed_out).toBe(true);
      expect(out.status).toBe('running');
      expect((await db('agents').where({ id: primaryAgentId }).first()).status).toBe('running');
    } finally {
      vi.useRealTimers();
    }
  });

  it('AwaitSessionTurn rejects another user’s session', async () => {
    const [otherUserId] = await db('users').insert({
      github_id: 1001,
      username: 'other2',
      status: 'approved',
    });
    const otherSessionId = await insertTestSession(db, {
      user_id: otherUserId,
      repo_id: (await db('repos').where({ full_name: 'o/r' }).first()).id,
      repo_full_name: 'o/r',
      short_id: 'othr2',
      label: 'Not mine either',
      initial_prompt: 'secret',
      base_branch: 'main',
      local_branch: 'feat/not-mine-2',
      status: 'stopped',
      ...testSessionAgentDefaults,
    });
    const tool = tools.find((t) => t.name === 'AwaitSessionTurn');
    const out = parseResult(await tool.handler({ session_id: otherSessionId }));
    expect(out.ok).toBe(false);
  });

  it('StopSession stops the primary builder and the session', async () => {
    const primaryAgentId = await getPrimaryBuilderAgentId(db, sessionId);
    await db('agents').where({ id: primaryAgentId }).update({ status: 'running' });
    const tool = tools.find((t) => t.name === 'StopSession');
    const out = parseOk(await tool.handler({ session_id: sessionId }));
    expect(out.stopped).toBe(true);
    const primary = await db('agents').where({ id: primaryAgentId }).first();
    expect(primary.status).toBe('stopped');
    const session = await db('sessions').where({ id: sessionId }).first();
    expect(session.status).toBe('stopped');
  });

  it('StopSession rejects another user’s session', async () => {
    const [otherUserId] = await db('users').insert({
      github_id: 1002,
      username: 'other3',
      status: 'approved',
    });
    const otherSessionId = await insertTestSession(db, {
      user_id: otherUserId,
      repo_id: (await db('repos').where({ full_name: 'o/r' }).first()).id,
      repo_full_name: 'o/r',
      short_id: 'othr2',
      label: 'Not mine either',
      initial_prompt: 'secret',
      base_branch: 'main',
      local_branch: 'feat/not-mine-2',
      status: 'stopped',
      ...testSessionAgentDefaults,
    });
    const tool = tools.find((t) => t.name === 'StopSession');
    const out = parseResult(await tool.handler({ session_id: otherSessionId }));
    expect(out.ok).toBe(false);
  });

  describe('WatchSession', () => {
    let watchTools;
    let watcherAgentId;

    beforeEach(async () => {
      watcherAgentId = await getPrimaryBuilderAgentId(db, sessionId);
      // The caller agent must exist (observer FK + service check): reuse this
      // session's primary builder as the watcher for a second target session.
      watchTools = buildBaguetteSessionMcpTools({ id: userId }, app, {
        callerSession: { id: sessionId, is_global: false },
        callerAgent: { id: watcherAgentId },
      });
    });

    it('reports the observed agent’s current status alongside the subscription', async () => {
      const targetId = await insertTestSession(db, {
        user_id: userId,
        repo_id: (await db('repos').where({ full_name: 'o/r' }).first()).id,
        repo_full_name: 'o/r',
        short_id: 'wtrg01',
        label: 'Watch target',
        initial_prompt: 'Work',
        base_branch: 'main',
        local_branch: 'feat/watch-target',
        status: 'stopped',
        ...testSessionAgentDefaults,
      });
      await db('session_messages').insert(
        await testMessageRow(db, targetId, {
          type: 'assistant',
          message_json: JSON.stringify({
            type: 'assistant',
            message: { role: 'assistant', content: 'already finished' },
          }),
        })
      );
      const tool = watchTools.find((t) => t.name === 'WatchSession');
      const out = parseOk(await tool.handler({ session_id: targetId }));
      expect(out.observed.status).toBe('stopped');
      expect(out.observed.last_assistant_message.message.content).toBe('already finished');
      expect(out.observed.queued_message_count).toBe(0);
      expect(out.observed_agent_id).toBe(await getPrimaryBuilderAgentId(db, targetId));
      // Subscription landed.
      const count = await db('agent_observers')
        .where({ agent_id: out.observed_agent_id, observer_agent_id: watcherAgentId })
        .count('id as c')
        .first();
      expect(Number(count.c)).toBe(1);
    });

    it('surfaces approval so a pre-existing wait is not silently missed', async () => {
      const targetId = await insertTestSession(db, {
        user_id: userId,
        repo_id: (await db('repos').where({ full_name: 'o/r' }).first()).id,
        repo_full_name: 'o/r',
        short_id: 'wtrg02',
        label: 'Approval target',
        initial_prompt: 'Work',
        base_branch: 'main',
        local_branch: 'feat/approval-target',
        status: 'stopped',
        ...testSessionAgentDefaults,
      });
      await db('agents')
        .where({ session_id: targetId, is_primary: 1 })
        .update({ status: 'approval' });
      const tool = watchTools.find((t) => t.name === 'WatchSession');
      const out = parseOk(await tool.handler({ session_id: targetId }));
      expect(out.observed.status).toBe('approval');
    });

    it('is idempotent per watcher pair', async () => {
      const targetId = await insertTestSession(db, {
        user_id: userId,
        repo_id: (await db('repos').where({ full_name: 'o/r' }).first()).id,
        repo_full_name: 'o/r',
        short_id: 'wtrg03',
        label: 'Idempotent target',
        initial_prompt: 'Work',
        base_branch: 'main',
        local_branch: 'feat/idem-target',
        status: 'stopped',
        ...testSessionAgentDefaults,
      });
      const tool = watchTools.find((t) => t.name === 'WatchSession');
      const first = parseOk(await tool.handler({ session_id: targetId }));
      const second = parseOk(await tool.handler({ session_id: targetId }));
      expect(second.row_id).toBe(first.row_id);
      const count = await db('agent_observers')
        .where({ agent_id: first.observed_agent_id, observer_agent_id: watcherAgentId })
        .count('id as c')
        .first();
      expect(Number(count.c)).toBe(1);
    });

    it('rejects an unowned target session', async () => {
      const [otherUserId] = await db('users').insert({
        github_id: 1003,
        username: 'other4',
        status: 'approved',
      });
      const otherSessionId = await insertTestSession(db, {
        user_id: otherUserId,
        repo_id: (await db('repos').where({ full_name: 'o/r' }).first()).id,
        repo_full_name: 'o/r',
        short_id: 'othr4',
        label: 'Not mine 4',
        initial_prompt: 'secret',
        base_branch: 'main',
        local_branch: 'feat/not-mine-4',
        status: 'stopped',
        ...testSessionAgentDefaults,
      });
      const tool = watchTools.find((t) => t.name === 'WatchSession');
      const out = parseResult(await tool.handler({ session_id: otherSessionId }));
      expect(out.ok).toBe(false);
    });

    it('rejects watching your own session (self-watch would loop)', async () => {
      const tool = watchTools.find((t) => t.name === 'WatchSession');
      const out = parseResult(await tool.handler({ session_id: sessionId }));
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/cannot observe itself/);
      const rows = await db('agent_observers').where({ observer_agent_id: watcherAgentId });
      expect(rows).toHaveLength(0);
    });

    it('rejects a mutual watch that would ping-pong forever', async () => {
      // The watcher (this session's builder) is already observed by the target's builder.
      const targetSessionId = await insertTestSession(db, {
        user_id: userId,
        repo_id: (await db('repos').where({ full_name: 'o/r' }).first()).id,
        repo_full_name: 'o/r',
        short_id: 'cycT01',
        label: 'Mutual target',
        initial_prompt: 'Work',
        base_branch: 'main',
        local_branch: 'feat/mutual-target',
        status: 'stopped',
        ...testSessionAgentDefaults,
      });
      const targetAgentId = await getPrimaryBuilderAgentId(db, targetSessionId);
      await db('agent_observers').insert({
        agent_id: watcherAgentId,
        observer_agent_id: targetAgentId,
        notify_on: 'turn_end',
      });

      const tool = watchTools.find((t) => t.name === 'WatchSession');
      const out = parseResult(await tool.handler({ session_id: targetSessionId }));
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/wake-up loop/);
    });
  });
});

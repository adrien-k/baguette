/**
 * Integration tests for the dev-only mock agent service.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { feathers } from '@feathersjs/feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerQueuedMessagesService } from '../feathers/queued-messages.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import { registerMockAgentService } from '../feathers/mock-agent.service.ts';
import { registerSessionIssuesService } from '../feathers/session-issues.service.js';
import { registerReviewAgentTurn } from '../review-agent-turn.js';
import {
  MOCK_AGENT_SUMMARY_TEXT,
  MOCK_E2E_QUICK_TURN_PROMPT,
  MOCK_E2E_QUICK_TURN_SUMMARY,
  MOCK_E2E_SUBAGENT_NAME,
  MOCK_E2E_SUBAGENT_PROMPT,
  MOCK_E2E_SUBAGENT_SUMMARY,
  MOCK_E2E_CREATE_PLAN_NON_INTERACTIVE_PROMPT,
  MOCK_E2E_CREATE_PLAN_PROMPT,
  MOCK_E2E_PLAN_NON_INTERACTIVE_SUMMARY,
  MOCK_E2E_PLAN_RUN_SUMMARY,
  MOCK_E2E_ASK_QUESTION_PROMPT,
  MOCK_REVIEW_ISSUES,
  MOCK_REVIEWER_SUMMARY_TEXT,
  MOCK_SECONDARY_MODEL_ID,
  MOCK_STANDARD_MODEL_ID,
} from '../../../shared/mock-agent-sdk.js';
import { stringifyAgentDefaultModel } from '../../../shared/agent-default-model.js';
import { SUBAGENT_DEFAULT_CONFIG } from '../../../shared/subagent-default-mode.js';
import { DATA_DIR } from '../../config.js';
import { mountAgentConfigs } from '../../test-utils/agent-sdks.js';
import { ensureTestMockConfig } from '../../test-utils/agent-configs.js';
import { sessionMessageIdentity } from '../feathers/message-create-fields.js';

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadBaguetteConfig: vi.fn().mockResolvedValue(null),
  };
});

const db = createTestDb();

const params = (user) => ({ provider: 'rest', user });

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerSessionsService(app);
  registerReviewAgentTurn(app);
  registerAgentsService(app);
  registerMessagesService(app);
  registerQueuedMessagesService(app);
  registerSessionIssuesService(app);
  mountAgentConfigs(app);
  registerMockAgentService(app);
  return app;
}

let app;
let userId;
let sessionId;
const WORKTREE_REL = 'worktrees/mock-agent-test';

beforeEach(async () => {
  vi.stubEnv('ENABLE_MOCK_AGENT', 'true');
  vi.stubEnv('MOCK_AGENT_SLEEP_MS', '0');
  vi.stubEnv('MOCK_AGENT_STEP_DELAY_MS', '0');

  await db('users').insert({ github_id: 901, username: 'mock-tester', approved: true });
  const user = await db('users').where({ username: 'mock-tester' }).first();
  userId = user.id;

  await mkdir(join(DATA_DIR, WORKTREE_REL), { recursive: true });

  await db('repos').insert({ full_name: 'local/mock-repo', repo_path: '/tmp/unused' });
  const repo = await db('repos').where({ full_name: 'local/mock-repo' }).first();

  const mockConfigId = await ensureTestMockConfig(db, userId);
  sessionId = await insertTestSession(db, {
    user_id: userId,
    repo_id: repo.id,
    repo_full_name: 'local/mock-repo',
    base_branch: 'main',
    short_id: 'mock01',
    initial_prompt: 'Test mock turn',
    status: 'stopped',
    agent_config_id: mockConfigId,
    agent_sdk: 'mock',
    model: MOCK_STANDARD_MODEL_ID,
    session_path: WORKTREE_REL,
  });

  app = makeApp(db);
  await app.setup();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('MockAgentService', () => {
  it('generateSessionMetadata returns empty label and default branch', async () => {
    const result = await app.service('mock-agent').generateSessionMetadata('Fix bugs', 'abc12');
    expect(result).toEqual({ label: '', branchName: 'task-abc12' });
  });

  it('isInterruptedSessionResumable is always false', async () => {
    expect(await app.service('mock-agent').isInterruptedSessionResumable({ id: 1 })).toBe(false);
  });

  it('runs a simulated turn when a user message is created', async () => {
    const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'Hello mock agent' },
        }),
        ...sessionMessageIdentity(builder),
      },
      params({ id: userId })
    );

    await vi.waitFor(
      async () => {
        const builderRow = await db('agents')
          .where({ session_id: sessionId, is_primary: 1 })
          .first();
        expect(builderRow.status).toBe('completed');

        const rows = await db('session_messages').where({ session_id: sessionId }).orderBy('id');
        const assistant = rows.find((r) => {
          try {
            const p = JSON.parse(r.message_json);
            return p.type === 'assistant' && p.blocks?.[0]?.text?.includes(MOCK_AGENT_SUMMARY_TEXT);
          } catch {
            return false;
          }
        });
        expect(assistant).toBeTruthy();
        expect(assistant.agent_config_id).toBe(builder.agent_config_id);
        const turnRows = rows.filter((r) => r.type !== 'user');
        expect(turnRows.every((r) => r.agent_config_id === builder.agent_config_id)).toBe(true);
      },
      { timeout: 10_000 }
    );

    const rows = await db('session_messages').where({ session_id: sessionId }).orderBy('id');
    const toolRows = rows.filter((r) => r.type === 'tool_call');
    expect(toolRows.length).toBeGreaterThanOrEqual(12);

    const toolKinds = new Set(
      toolRows.map((r) => {
        const p = JSON.parse(r.message_json);
        return p.kind;
      })
    );
    expect(toolKinds).toEqual(
      new Set([
        'todo',
        'write',
        'read',
        'edit',
        'glob',
        'grep',
        'delete',
        'bash',
        'task',
        'mcp',
        'generic',
      ])
    );

    expect(rows.some((r) => r.type === 'plan')).toBe(false);

    const thinkingRow = rows.find((r) => {
      if (r.type !== 'assistant') return false;
      const p = JSON.parse(r.message_json);
      return p.blocks?.some((b) => b.type === 'thinking');
    });
    expect(thinkingRow).toBeTruthy();
  });

  it('ends on approval after CreatePlan e2e prompt', async () => {
    const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: MOCK_E2E_CREATE_PLAN_PROMPT },
        }),
        ...sessionMessageIdentity(builder),
      },
      params({ id: userId })
    );

    await vi.waitFor(
      async () => {
        const builderRow = await db('agents')
          .where({ session_id: sessionId, is_primary: 1 })
          .first();
        expect(builderRow.status).toBe('approval');
      },
      { timeout: 10_000 }
    );

    const rows = await db('session_messages').where({ session_id: sessionId }).orderBy('id');
    const createPlan = rows.find((r) => {
      if (r.type !== 'tool_call') return false;
      const p = JSON.parse(r.message_json);
      return p.kind === 'mcp' && p.args?.tool === 'CreatePlan';
    });
    expect(createPlan).toBeTruthy();
    expect(JSON.parse(createPlan.message_json).args.markdown).toContain('E2E mock plan');
  });

  it('completes turn after non-interactive CreatePlan e2e prompt', async () => {
    const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: MOCK_E2E_CREATE_PLAN_NON_INTERACTIVE_PROMPT },
        }),
        ...sessionMessageIdentity(builder),
      },
      params({ id: userId })
    );

    await vi.waitFor(
      async () => {
        const builderRow = await db('agents')
          .where({ session_id: sessionId, is_primary: 1 })
          .first();
        expect(builderRow.status).toBe('completed');
        const rows = await db('session_messages').where({ session_id: sessionId }).orderBy('id');
        const createPlan = rows.find((r) => {
          if (r.type !== 'tool_call') return false;
          const p = JSON.parse(r.message_json);
          return p.kind === 'mcp' && p.args?.tool === 'CreatePlan';
        });
        expect(createPlan).toBeTruthy();
        const planArgs = JSON.parse(createPlan.message_json).args;
        expect(planArgs.interactive).toBe(false);
        const assistant = rows.find((r) => {
          try {
            const p = JSON.parse(r.message_json);
            return (
              p.type === 'assistant' &&
              p.blocks?.[0]?.text?.includes(MOCK_E2E_PLAN_NON_INTERACTIVE_SUMMARY)
            );
          } catch {
            return false;
          }
        });
        expect(assistant).toBeTruthy();
      },
      { timeout: 10_000 }
    );
  });

  it('completes plan-run follow-up after Proceed with the plan', async () => {
    const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'Proceed with the plan.' },
        }),
        ...sessionMessageIdentity(builder),
      },
      params({ id: userId })
    );

    await vi.waitFor(
      async () => {
        const builderRow = await db('agents')
          .where({ session_id: sessionId, is_primary: 1 })
          .first();
        expect(builderRow.status).toBe('completed');
        const rows = await db('session_messages').where({ session_id: sessionId }).orderBy('id');
        const assistant = rows.find((r) => {
          try {
            const p = JSON.parse(r.message_json);
            return (
              p.type === 'assistant' && p.blocks?.[0]?.text?.includes(MOCK_E2E_PLAN_RUN_SUMMARY)
            );
          } catch {
            return false;
          }
        });
        expect(assistant).toBeTruthy();
      },
      { timeout: 10_000 }
    );
  });

  it('ends on approval after AskUserQuestions e2e prompt', async () => {
    const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: MOCK_E2E_ASK_QUESTION_PROMPT },
        }),
        ...sessionMessageIdentity(builder),
      },
      params({ id: userId })
    );

    await vi.waitFor(
      async () => {
        const builderRow = await db('agents')
          .where({ session_id: sessionId, is_primary: 1 })
          .first();
        expect(builderRow.status).toBe('approval');
      },
      { timeout: 10_000 }
    );

    const rows = await db('session_messages').where({ session_id: sessionId }).orderBy('id');
    const askUser = rows.find((r) => {
      if (r.type !== 'tool_call') return false;
      const p = JSON.parse(r.message_json);
      return p.kind === 'ask_user';
    });
    expect(askUser).toBeTruthy();
  });

  it('runs a mock reviewer turn and creates session issues', async () => {
    const [reviewerId] = await db('agents').insert({
      session_id: sessionId,
      name: 'Reviewer',
      agent_type: 'reviewer',
      is_primary: 0,
      status: 'stopped',
      agent_sdk: 'mock',
      model: MOCK_STANDARD_MODEL_ID,
      agent_config_id: (await db('agents').where({ session_id: sessionId, is_primary: 1 }).first())
        .agent_config_id,
      current_turn_id: 0,
    });

    await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'Review this session' },
        }),
        agent_id: reviewerId,
        agent_type: 'reviewer',
        agent_sdk: 'mock',
        model: MOCK_STANDARD_MODEL_ID,
      },
      { provider: undefined, user: { id: userId } }
    );

    await vi.waitFor(
      async () => {
        const reviewer = await db('agents').where({ id: reviewerId }).first();
        expect(reviewer.status).toBe('completed');

        const issues = await db('session_issues').where({ session_id: sessionId });
        expect(issues).toHaveLength(MOCK_REVIEW_ISSUES.length);
        const titles = issues.map((i) => i.title).sort();
        expect(titles).toEqual(MOCK_REVIEW_ISSUES.map((i) => i.title).sort());
      },
      { timeout: 10_000 }
    );

    const reviewMessages = await db('session_messages')
      .where({ session_id: sessionId, agent_id: reviewerId })
      .orderBy('id');
    const summary = reviewMessages.find((r) => {
      try {
        const p = JSON.parse(r.message_json);
        return p.type === 'assistant' && p.blocks?.[0]?.text?.includes(MOCK_REVIEWER_SUMMARY_TEXT);
      } catch {
        return false;
      }
    });
    expect(summary).toBeTruthy();
  }, 15_000);

  it('startSubagent runs a turn and returns the last assistant message', async () => {
    const primary = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    await db('users')
      .where({ id: userId })
      .update({
        agent_default_config_id: primary.agent_config_id,
        agent_default_model: JSON.stringify({ model: MOCK_STANDARD_MODEL_ID, model_params: null }),
      });

    const result = await app.service('agents').startSubagent(
      {
        session_id: sessionId,
        name: 'MCP helper',
        initial_prompt: 'Run via startSubagent',
        wait_for_completion: true,
      },
      params({ id: userId })
    );

    expect(result.status).toBe('completed');
    expect(result.ref).toBeGreaterThan(0);
    expect(result.last_assistant_message).toBeTruthy();
  }, 20_000);

  it('startSubagent queues the initial prompt while the session is provisioning', async () => {
    await db('sessions').where({ id: sessionId }).update({
      status: 'provisioning',
      session_path: null,
    });
    const primary = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    await db('users')
      .where({ id: userId })
      .update({
        agent_default_config_id: primary.agent_config_id,
        agent_default_model: JSON.stringify({ model: MOCK_STANDARD_MODEL_ID, model_params: null }),
      });

    const result = await app.service('agents').startSubagent(
      {
        session_id: sessionId,
        name: 'Provision subagent',
        initial_prompt: 'Start during provisioning',
        wait_for_completion: false,
      },
      params({ id: userId })
    );

    const userMsgs = await db('session_messages').where({
      session_id: sessionId,
      agent_id: result.agent_id,
      type: 'user',
    });
    expect(userMsgs).toHaveLength(0);
    const queued = await db('queued_messages').where({
      session_id: sessionId,
      agent_id: result.agent_id,
      kind: 'turn',
    });
    expect(queued).toHaveLength(1);
    const parsed = JSON.parse(queued[0].message_json);
    expect(parsed.subtype).toBe('mcp');
  }, 20_000);

  it('startSubagent subagent blocks Baguette UI messages', async () => {
    const primary = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    await db('users')
      .where({ id: userId })
      .update({
        agent_default_config_id: primary.agent_config_id,
        agent_default_model: JSON.stringify({ model: MOCK_STANDARD_MODEL_ID, model_params: null }),
      });

    const result = await app.service('agents').startSubagent(
      {
        session_id: sessionId,
        name: 'MCP-only',
        initial_prompt: 'Readonly builder',
        wait_for_completion: false,
      },
      params({ id: userId })
    );

    const row = await db('agents').where({ id: result.agent_id }).first();
    expect(row.agent_type).toBe('subagent');

    await expect(
      app.service('messages').create(
        {
          session_id: sessionId,
          type: 'user',
          message_json: JSON.stringify({
            type: 'user',
            message: { role: 'user', content: 'blocked' },
          }),
          ...sessionMessageIdentity(row),
        },
        { provider: 'rest', user: { id: userId } }
      )
    ).rejects.toThrow(/MCP/i);
  }, 20_000);

  it('runs a quick turn for the e2e prompt phrase', async () => {
    const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: MOCK_E2E_QUICK_TURN_PROMPT },
        }),
        ...sessionMessageIdentity(builder),
      },
      params({ id: userId })
    );

    await vi.waitFor(
      async () => {
        const row = await db('agents').where({ id: builder.id }).first();
        expect(row.status).toBe('completed');
        const msgs = await db('session_messages').where({ agent_id: builder.id });
        const hit = msgs.some((r) => {
          try {
            const p = JSON.parse(r.message_json);
            return p.blocks?.some(
              (b) => b.type === 'text' && b.text?.includes(MOCK_E2E_QUICK_TURN_SUMMARY)
            );
          } catch {
            return false;
          }
        });
        expect(hit).toBe(true);
      },
      { timeout: 10_000 }
    );
  }, 15_000);

  it('starts a read-only MCP subagent when prompted with the e2e phrase', async () => {
    const primary = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();

    await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: MOCK_E2E_SUBAGENT_PROMPT },
        }),
        ...sessionMessageIdentity(primary),
      },
      params({ id: userId })
    );

    await vi.waitFor(
      async () => {
        const primaryRow = await db('agents').where({ id: primary.id }).first();
        expect(primaryRow.status).toBe('completed');
        const sub = await db('agents')
          .where({ session_id: sessionId, agent_type: 'subagent' })
          .first();
        expect(sub).toBeTruthy();
        expect(sub.status).toBe('completed');
        expect(sub.model).toBe(primary.model);
        const primaryMsgs = await db('session_messages').where({ agent_id: primary.id });
        const summary = primaryMsgs.some((r) => {
          try {
            const p = JSON.parse(r.message_json);
            return p.blocks?.[0]?.text?.includes(MOCK_E2E_SUBAGENT_SUMMARY);
          } catch {
            return false;
          }
        });
        expect(summary).toBe(true);
      },
      { timeout: 15_000 }
    );
  }, 20_000);

  it('startSubagent can be called twice with the same name after delete', async () => {
    const start = () =>
      app.service('agents').startSubagent(
        {
          session_id: sessionId,
          name: MOCK_E2E_SUBAGENT_NAME,
          initial_prompt: MOCK_E2E_QUICK_TURN_PROMPT,
          wait_for_completion: true,
        },
        params({ id: userId })
      );

    const first = await start();
    await app.service('agents').remove(first.agent_id, params({ id: userId }));
    const second = await start();
    const row = await db('agents').where({ id: second.agent_id }).first();
    expect(row.status).toBe('completed');
  }, 20_000);

  it('starts a second MCP subagent after delete when subagent default is config', async () => {
    const primary = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    await db('users')
      .where({ id: userId })
      .update({
        subagent_default_mode: SUBAGENT_DEFAULT_CONFIG,
        subagent_default_config_id: primary.agent_config_id,
        subagent_default_model: stringifyAgentDefaultModel({
          model: MOCK_SECONDARY_MODEL_ID,
          model_params: null,
        }),
      });

    const sendSubagentPrompt = () =>
      app.service('messages').create(
        {
          session_id: sessionId,
          type: 'user',
          message_json: JSON.stringify({
            type: 'user',
            message: { role: 'user', content: MOCK_E2E_SUBAGENT_PROMPT },
          }),
          ...sessionMessageIdentity(primary),
        },
        params({ id: userId })
      );

    await sendSubagentPrompt();
    await vi.waitFor(
      async () => {
        const primaryRow = await db('agents').where({ id: primary.id }).first();
        expect(primaryRow.status).toBe('completed');
        const sub = await db('agents')
          .where({ session_id: sessionId, agent_type: 'subagent' })
          .first();
        expect(sub).toBeTruthy();
        expect(sub.status).toBe('completed');
      },
      { timeout: 15_000 }
    );
    const first = await db('agents')
      .where({ session_id: sessionId, agent_type: 'subagent' })
      .first();
    await app.service('agents').remove(first.id, params({ id: userId }));

    await vi.waitFor(
      async () => {
        const row = await db('agents').where({ id: primary.id }).first();
        expect(row.status).toBe('completed');
      },
      { timeout: 15_000 }
    );

    await sendSubagentPrompt();
    await vi.waitFor(
      async () => {
        const sub = await db('agents')
          .where({ session_id: sessionId, agent_type: 'subagent' })
          .first();
        expect(sub).toBeTruthy();
        expect(sub.status).toBe('completed');
        expect(sub.model).toBe(MOCK_SECONDARY_MODEL_ID);
      },
      { timeout: 15_000 }
    );
  }, 25_000);

  it('creates extra builder with primary session config when only name is provided', async () => {
    const primary = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    const extra = await app.service('agents').create(
      {
        session_id: sessionId,
        agent_type: 'builder',
        name: 'Helper',
      },
      params({ id: userId })
    );
    expect(extra.is_primary).toBe(0);
    expect(extra.agent_config_id).toBe(primary.agent_config_id);
    expect(extra.model).toBe(primary.model);
  });

  it('runs a turn on an additional builder without disturbing the primary', async () => {
    const primary = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    const extra = await app.service('agents').create(
      {
        session_id: sessionId,
        agent_type: 'builder',
        agent_config_id: primary.agent_config_id,
        model: MOCK_STANDARD_MODEL_ID,
        name: 'Helper',
      },
      params({ id: userId })
    );

    await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'Secondary builder turn' },
        }),
        ...sessionMessageIdentity(extra),
      },
      params({ id: userId })
    );

    await vi.waitFor(
      async () => {
        const extraRow = await db('agents').where({ id: extra.id }).first();
        expect(extraRow.status).toBe('completed');
        const primaryRow = await db('agents').where({ id: primary.id }).first();
        expect(primaryRow.status).not.toBe('running');
      },
      { timeout: 10_000 }
    );

    const extraMessages = await db('session_messages').where({ agent_id: extra.id });
    expect(extraMessages.some((r) => r.type === 'assistant')).toBe(true);
  }, 15_000);
});

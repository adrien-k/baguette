/**
 * Integration tests for the dev-only mock agent service.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { feathers } from '@feathersjs/feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import { registerMockAgentService } from '../feathers/mock-agent.service.ts';
import { registerSessionIssuesService } from '../feathers/session-issues.service.js';
import { registerReviewAgentTurn } from '../review-agent-turn.js';
import {
  MOCK_AGENT_SUMMARY_TEXT,
  MOCK_REVIEW_ISSUES,
  MOCK_REVIEWER_SUMMARY_TEXT,
  MOCK_STANDARD_MODEL_ID,
} from '../../../shared/mock-agent-sdk.js';
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
        'ask_user',
        'mcp',
        'generic',
      ])
    );

    const planRow = rows.find((r) => r.type === 'plan');
    expect(planRow).toBeTruthy();
    expect(JSON.parse(planRow.message_json).markdown).toContain('Mock agent plan');

    const thinkingRow = rows.find((r) => {
      if (r.type !== 'assistant') return false;
      const p = JSON.parse(r.message_json);
      return p.blocks?.some((b) => b.type === 'thinking');
    });
    expect(thinkingRow).toBeTruthy();
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
});

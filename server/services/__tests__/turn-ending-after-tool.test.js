import { describe, expect, it, vi, beforeEach } from 'vitest';

import { createTestDb } from '../../test-utils/db.js';
import { CursorAgentService } from '../feathers/cursor-agent.service.ts';
import { PiAgentService } from '../feathers/pi-agent.service.ts';

describe('turn end after CreatePlan / AskUserQuestions', () => {
  describe('CursorAgentService._runTurn', () => {
    const db = createTestDb();
    let recordCursorUsage;
    let sessionPatch;
    let app;

    beforeEach(async () => {
      vi.clearAllMocks();
      await db('users').insert({ id: 1, github_id: 1, username: 't' });
      await db('agent_configs').insert({
        id: 5,
        user_id: 1,
        label: 'Cursor',
        sdk: 'cursor',
        api_key_encrypted: null,
        api_key_env_var: null,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      await db('sessions').insert({
        id: 1,
        user_id: 1,
        short_id: 'te001',
        repo_full_name: 'o/r',
        base_branch: 'main',
        initial_prompt: 't',
        status: 'running',
        agent_sdk: 'cursor',
        agent_config_id: 5,
        model: 'composer-2.5',
        model_params: JSON.stringify([]),
        session_path: 'sessions/wt',
      });

      recordCursorUsage = vi.fn().mockResolvedValue(undefined);
      sessionPatch = vi.fn().mockResolvedValue({});
      app = {
        get: (key) => (key === 'db' ? db : undefined),
        service: (name) => {
          if (name === 'sessions') {
            return {
              patch: sessionPatch,
              onTurnStart: async () => {},
              onTurnComplete: async () => {},
              recordCursorUsage,
            };
          }
          if (name === 'session-review') {
            return {
              peekTurnExtras: () => null,
              onAgentTurnComplete: vi.fn(),
              _persistStatus: vi.fn(),
            };
          }
          return {};
        },
        emit: vi.fn(),
      };
    });

    it('records usage and skips completed patch when awaiting user', async () => {
      const service = new CursorAgentService();
      service.setup(app);

      vi.spyOn(service, '_sessionAgentOptions').mockResolvedValue({});
      vi.spyOn(service, 'createOrResumeAgent').mockResolvedValue({});
      vi.spyOn(service, '_sendWithBusyRetry').mockResolvedValue({});
      vi.spyOn(service, '_streamRunChainWithFollowUps').mockImplementation(async () => {
        const state = service._activeSessions.get(1);
        if (state) state.endTurnAwaitingUser = true;
        return { allFinishedOk: true };
      });

      const session = await db('sessions').where({ id: 1 }).first();
      const row = {
        model: 'composer-2.5',
        model_params: JSON.stringify([]),
        agent_config_id: 5,
      };

      await service._runTurn(
        session,
        { type: 'user', message: { role: 'user', content: 'hi' } },
        row,
        {
          turnId: 10,
          channel: 'chat',
        }
      );

      expect(recordCursorUsage).toHaveBeenCalled();
      const completedPatch = sessionPatch.mock.calls.find(
        ([, data]) => data?.status === 'completed'
      );
      expect(completedPatch).toBeUndefined();
    });
  });

  describe('PiAgentService._runTurn', () => {
    const piDb = createTestDb();
    let recordPiUsage;
    let sessionPatch;
    let app;

    beforeEach(async () => {
      vi.clearAllMocks();
      recordPiUsage = vi.fn().mockResolvedValue(0);
      sessionPatch = vi.fn().mockResolvedValue({});
      await piDb('users').insert({ id: 2, github_id: 2, username: 'p' });
      await piDb('agent_configs').insert({
        id: 8,
        user_id: 2,
        label: 'Pi',
        sdk: 'pi',
        api_key_encrypted: null,
        api_key_env_var: null,
        created_at: piDb.fn.now(),
        updated_at: piDb.fn.now(),
      });
      await piDb('sessions').insert({
        id: 3,
        user_id: 2,
        short_id: 'pi001',
        repo_full_name: 'o/r',
        base_branch: 'main',
        initial_prompt: 't',
        status: 'running',
        agent_sdk: 'pi',
        agent_config_id: 8,
        model: 'claude-haiku-4-5',
        session_path: 'sessions/wt',
      });
      app = makePiApp(piDb);
    });

    function makePiApp(db) {
      return {
        get: (key) => (key === 'db' ? db : undefined),
        service: (name) => {
          if (name === 'sessions') {
            return {
              patch: sessionPatch,
              onTurnStart: async () => {},
              onTurnComplete: async () => {},
              recordPiUsage,
              emit: vi.fn(),
            };
          }
          if (name === 'users') {
            return { get: vi.fn().mockResolvedValue({ id: 2, pi_api_key: 'key' }) };
          }
          if (name === 'user-repos') {
            return { find: vi.fn().mockResolvedValue([]) };
          }
          if (name === 'session-review') {
            return {
              onAgentTurnComplete: vi.fn(),
              _persistStatus: vi.fn(),
            };
          }
          if (name === 'messages') {
            return { on: vi.fn(), create: vi.fn() };
          }
          return {};
        },
        emit: vi.fn(),
      };
    }

    it('records usage and skips completed patch when awaiting user', async () => {
      const service = new PiAgentService();
      service.app = app;
      service.setup(service.app);

      vi.spyOn(service, 'buildAgentOptions').mockResolvedValue({
        cwd: '/tmp',
        modelRuntime: {},
        customTools: [],
      });
      vi.spyOn(service, 'runTurn').mockImplementation(async ({ activeSessionState }) => {
        if (activeSessionState) activeSessionState.endTurnAwaitingUser = true;
        return {
          outcome: 'completed',
          turnUsage: {
            input_tokens: 1,
            output_tokens: 2,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            reasoning_tokens: 0,
            total_tokens: 3,
            model: 'claude-haiku-4-5',
          },
        };
      });

      const session = await piDb('sessions').where({ id: 3 }).first();
      const row = {
        model: 'claude-haiku-4-5',
        agent_config_id: 8,
      };

      await service._runTurn(
        session,
        { type: 'user', message: { role: 'user', content: 'hi' } },
        row,
        { turnId: 11, channel: 'chat' }
      );

      expect(recordPiUsage).toHaveBeenCalled();
      const completedPatch = sessionPatch.mock.calls.find(
        ([, data]) => data?.status === 'completed'
      );
      expect(completedPatch).toBeUndefined();
    });
  });
});

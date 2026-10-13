import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { ensureReviewerAgentRow } from '../agents-db.js';
import { CursorAgentService } from '../feathers/cursor-agent.service.ts';

/**
 * Required turn context on Cursor: the model snapshot and credentials must come
 * from the message row (model, model_params, agent_config_id). A row missing
 * them must fail the turn through the service's visible error path.
 */
describe('CursorAgentService turn context', () => {
  const db = createTestDb();
  let agentPatch;
  let app;
  let builderAgentId;

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
    await insertTestSession(db, {
      id: 1,
      user_id: 1,
      short_id: 'ctx01',
      repo_full_name: 'o/r',
      base_branch: 'main',
      initial_prompt: 't',
      status: 'stopped',
      agent_sdk: 'cursor',
      agent_config_id: 5,
      model: 'composer-2.5',
      model_params: null,
      session_path: 'sessions/wt',
    });
    agentPatch = vi.fn().mockResolvedValue({});
    const sessionEmit = vi.fn();
    const reviewAgentTurn = {
      _active: new Map(),
      peekTurnExtras: () => null,
      onAgentTurnComplete: vi.fn().mockResolvedValue(undefined),
      _persistStatus: vi.fn().mockResolvedValue(undefined),
      buildCursorReviewAgentOptions: vi.fn().mockResolvedValue({}),
    };
    app = {
      get: (key) => {
        if (key === 'db') return db;
        if (key === 'reviewAgentTurn') return reviewAgentTurn;
        return undefined;
      },
      service: (name) => {
        if (name === 'sessions')
          return {
            patch: vi.fn().mockResolvedValue({}),
            emit: sessionEmit,
            onTurnStart: async () => {},
            onTurnComplete: async () => {},
            recordCursorUsage: async () => {},
          };
        if (name === 'agents') return { patch: agentPatch };
        if (name === 'users') return { get: vi.fn().mockResolvedValue({ id: 1 }) };
        return { create: vi.fn().mockResolvedValue({ id: 1 }), patch: vi.fn() };
      },
      emit: vi.fn(),
    };
    builderAgentId = (await db('agents').where({ session_id: 1, is_primary: 1 }).first()).id;
  });

  it('marks the chat turn failed when the message has no model_params', async () => {
    const service = new CursorAgentService();
    service.setup(app);

    await service.handleMessageCreated({
      session_id: 1,
      agent_id: builderAgentId,
      type: 'user',
      model: 'composer-2.5',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    });

    await expect(
      vi.waitFor(() => {
        expect(agentPatch).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ status: 'failed' }),
          expect.anything()
        );
      })
    ).resolves.toBeUndefined();
    expect(agentPatch).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'running' }),
      expect.anything()
    );
  });

  it('runs the turn when model_params is snapshotted on the row', async () => {
    const service = new CursorAgentService();
    service.setup(app);
    const runSpy = vi.spyOn(service, '_runTurn').mockResolvedValue(undefined);

    await service.handleMessageCreated({
      session_id: 1,
      agent_id: builderAgentId,
      type: 'user',
      agent_config_id: 5,
      agent_sdk: 'cursor',
      model: 'composer-2.5',
      model_params: '[{"id":"thinking","value":"low"}]',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    });

    await vi.waitFor(() => {
      expect(runSpy).toHaveBeenCalled();
    });
  });

  it('marks the chat turn failed when the message has no agent config', async () => {
    const service = new CursorAgentService();
    service.setup(app);

    await service.handleMessageCreated({
      session_id: 1,
      agent_id: builderAgentId,
      type: 'user',
      model: 'composer-2.5',
      model_params: '[{"id":"thinking","value":"low"}]',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    });

    await expect(
      vi.waitFor(() => {
        expect(agentPatch).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ status: 'failed' }),
          expect.anything()
        );
      })
    ).resolves.toBeUndefined();
  });

  it('resolves credentials from the message row agent_config_id', async () => {
    await db('agent_configs').insert({
      id: 6,
      user_id: 1,
      label: 'Row config',
      sdk: 'cursor',
      api_key_encrypted: null,
      api_key_env_var: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    const service = new CursorAgentService();
    service.setup(app);
    const optionsSpy = vi
      .spyOn(service, '_sessionAgentOptions')
      .mockRejectedValue(new Error('stop after config'));

    await service.handleMessageCreated({
      session_id: 1,
      agent_id: builderAgentId,
      type: 'user',
      agent_sdk: 'cursor',
      model: 'composer-2.5',
      model_params: '[{"id":"thinking","value":"low"}]',
      agent_config_id: 6,
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    });

    await vi.waitFor(() => {
      expect(optionsSpy).toHaveBeenCalled();
    });
    expect(optionsSpy.mock.calls[0][2]).toBe(6);
  });

  it('fails the review turn when the reviewer message has no model_params', async () => {
    await ensureReviewerAgentRow(db, 1, {
      agent_config_id: 5,
      agent_sdk: 'cursor',
      model: 'composer-2.5',
      status: 'stopped',
    });
    const service = new CursorAgentService();
    service.setup(app);

    const reviewer = await db('agents').where({ session_id: 1, agent_type: 'reviewer' }).first();
    await service.handleMessageCreated({
      session_id: 1,
      agent_id: reviewer.id,
      type: 'user',
      agent_sdk: 'cursor',
      model: 'composer-2.5',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'review' } }),
    });

    await vi.waitFor(() => {
      expect(app.get('reviewAgentTurn').onAgentTurnComplete).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'failed',
        { sdk: 'cursor' }
      );
    });
  });
});

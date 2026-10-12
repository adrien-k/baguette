import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTestDb } from '../../test-utils/db.js';
import { CursorAgentService } from '../feathers/cursor-agent.service.ts';

/**
 * Required turn context on Cursor: the model snapshot must come from the message row
 * (model + model_params) and credentials from the session's agent config. A row
 * missing them must fail the turn through the service's visible error path.
 */
describe('CursorAgentService turn context', () => {
  const db = createTestDb();
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
    sessionPatch = vi.fn().mockResolvedValue({});
    const sessionEmit = vi.fn();
    app = {
      get: (key) => (key === 'db' ? db : undefined),
      service: (name) => {
        if (name === 'sessions')
          return {
            patch: sessionPatch,
            emit: sessionEmit,
            onTurnStart: async () => {},
            onTurnComplete: async () => {},
          };
        if (name === 'session-review') return app.services['session-review'];
        if (name === 'users') return { get: vi.fn().mockResolvedValue({ id: 1 }) };
        return { create: vi.fn().mockResolvedValue({ id: 1 }), patch: vi.fn() };
      },
      services: {
        'session-review': {
          _active: new Map(),
          peekTurnExtras: () => null,
          onAgentTurnComplete: vi.fn().mockResolvedValue(undefined),
          _persistStatus: vi.fn().mockResolvedValue(undefined),
        },
      },
      emit: vi.fn(),
    };
  });

  it('marks the chat turn failed when the message has no model_params', async () => {
    const service = new CursorAgentService();
    service.setup(app);

    await service.handleMessageCreated({
      session_id: 1,
      type: 'user',
      model: 'composer-2.5',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    });

    await expect(
      vi.waitFor(() => {
        expect(sessionPatch).toHaveBeenCalledWith(1, { status: 'failed' }, { user: { id: 1 } });
      })
    ).resolves.toBeUndefined();
    expect(sessionPatch).not.toHaveBeenCalledWith(1, { status: 'running' }, { user: { id: 1 } });
  });

  it('runs the turn when model_params is snapshotted on the row', async () => {
    const service = new CursorAgentService();
    service.setup(app);

    await service.handleMessageCreated({
      session_id: 1,
      type: 'user',
      model: 'composer-2.5',
      model_params: '[{"id":"thinking","value":"low"}]',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    });

    // Gets past validation (patches running before the SDK touches anything).
    await expect(
      vi.waitFor(() => {
        expect(sessionPatch).toHaveBeenCalledWith(1, { status: 'running' }, { user: { id: 1 } });
      })
    ).resolves.toBeUndefined();
  });

  it('marks the chat turn failed when the session has no agent config', async () => {
    await db('sessions').where({ id: 1 }).update({ agent_config_id: null });
    const service = new CursorAgentService();
    service.setup(app);

    await service.handleMessageCreated({
      session_id: 1,
      type: 'user',
      model: 'composer-2.5',
      model_params: '[{"id":"thinking","value":"low"}]',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    });

    await expect(
      vi.waitFor(() => {
        expect(sessionPatch).toHaveBeenCalledWith(1, { status: 'failed' }, { user: { id: 1 } });
      })
    ).resolves.toBeUndefined();
  });

  it('resolves credentials from the message row config over the session config', async () => {
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
    const resolveSpy = vi.spyOn(service, 'resolveApiKey');

    await service.handleMessageCreated({
      session_id: 1,
      type: 'user',
      model: 'composer-2.5',
      model_params: '[{"id":"thinking","value":"low"}]',
      agent_config_id: 6,
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    });

    await vi.waitFor(() => {
      expect(resolveSpy).toHaveBeenCalled();
    });
    expect(resolveSpy.mock.calls[0][2]).toBe(6);
  });

  it('fails the review turn when the reviewer message has no model_params', async () => {
    const service = new CursorAgentService();
    service.setup(app);

    await service.handleMessageCreated({
      session_id: 1,
      type: 'user',
      agent_type: 'reviewer',
      agent_sdk: 'cursor',
      model: 'composer-2.5',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'review' } }),
    });

    await vi.waitFor(() => {
      expect(app.services['session-review'].onAgentTurnComplete).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'failed',
        { sdk: 'cursor' }
      );
    });
  });
});

/**
 * Terminal Cursor run failures must bubble up to the user.
 *
 * Session 922 regression: Cursor's backend failed mid-run ("Service unavailable" on
 * Cursor's side) and the SDK stream delivered only a bare `status: CANCELLED` with no
 * message. The old handler persisted a quiet status line and never emitted `app:error`,
 * so the user saw no reply, no toast, and no error banner. These tests pin the new
 * behavior in `CursorAgentService._streamOneRun`:
 *   - real failures (ERROR/EXPIRED, remote CANCELLED, silent stream ends) emit
 *     `app:error`, persist a turn-bound status row, and mark the agent failed;
 *   - a deliberate user stop stays quiet and does not mark the agent failed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnsupportedRunOperationError } from '@cursor/sdk';

import { createTestDb, insertTestSession, getPrimaryBuilderAgentId } from '../../test-utils/db.js';
import { MessageStreamWriter } from '../../../shared/message-stream-writer.ts';
import { CursorAgentService } from '../feathers/cursor-agent.service.ts';
import { cursorBuildToolCallStart, cursorBuildToolCallComplete } from '../cursor/cursor-mapping.ts';

const cursorBuilders = {
  buildToolCallStart: cursorBuildToolCallStart,
  buildToolCallComplete: cursorBuildToolCallComplete,
};

function mockWriter() {
  const rows = [];
  const writer = new MessageStreamWriter({
    sessionId: 1,
    turnId: 7,
    createRow: async (row) => {
      const payload = JSON.parse(row.message_json);
      rows.push({ row, payload });
      return { id: rows.length };
    },
    patchRow: async (id, patch) => {
      rows[id - 1].row = { ...rows[id - 1].row, ...patch };
    },
    builders: cursorBuilders,
  });
  return { writer, rows };
}

function mockRun(events, { result, error, supports, wait } = {}) {
  const run = {
    id: 'run-test',
    stream: async function* () {
      for (const e of events) yield e;
    },
  };
  if (result) {
    run.wait = async () => {
      if (error) throw error;
      return result;
    };
  }
  if (wait) run.wait = wait;
  if (supports !== undefined) run.supports = supports;
  return run;
}

describe('CursorAgentService terminal status surfacing', () => {
  const db = createTestDb();
  let agentPatch;
  let reviewAgentTurnStub;
  let sessionEmit;
  let messagesCreate;
  let app;
  let builderAgentId;
  let sessionRow;

  const setupTurnState = (extra = {}) => {
    const service = new CursorAgentService();
    service.setup(app);
    service._activeSessions.set('turn-key', {
      isProcessing: true,
      userId: 1,
      agentId: builderAgentId,
      currentRun: null,
      writer: null,
      turnId: 7,
      channel: 'chat',
      turnAgentConfigId: 5,
      ...extra,
    });
    return service;
  };

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
      short_id: 'tc01',
      repo_full_name: 'o/r',
      base_branch: 'main',
      initial_prompt: 't',
      status: 'running',
      agent_sdk: 'cursor',
      agent_config_id: 5,
      model: 'composer-2.5',
      model_params: null,
      session_path: 'sessions/wt',
    });
    builderAgentId = await getPrimaryBuilderAgentId(db, 1);
    sessionRow = await db('sessions').where({ id: 1 }).first();

    agentPatch = vi.fn().mockResolvedValue({});
    sessionEmit = vi.fn();
    messagesCreate = vi.fn().mockResolvedValue({ id: 1 });
    reviewAgentTurnStub = {
      onAgentTurnComplete: vi.fn().mockResolvedValue(undefined),
      _persistStatus: vi.fn().mockResolvedValue(undefined),
    };
    app = {
      get: (key) => {
        if (key === 'db') return db;
        if (key === 'reviewAgentTurn') return reviewAgentTurnStub;
        return undefined;
      },
      service: (name) => {
        if (name === 'sessions') return { emit: sessionEmit };
        if (name === 'agents') return { patch: agentPatch };
        if (name === 'messages') return { create: messagesCreate, patch: vi.fn() };
        return { create: vi.fn(), patch: vi.fn() };
      },
      emit: vi.fn(),
    };
  });

  it('bubbles a remote CANCELLED without a reason as app:error (session 922 case)', async () => {
    const service = setupTurnState();
    const { writer } = mockWriter();
    const run = mockRun([
      { type: 'status', status: 'RUNNING', agent_id: 'a', run_id: 'r' },
      { type: 'status', status: 'CANCELLED', agent_id: 'a', run_id: 'r' },
    ]);

    const result = await service._streamOneRun(
      sessionRow,
      run,
      undefined,
      {},
      {
        activeKey: 'turn-key',
        channel: 'chat',
        writer,
      }
    );

    expect(result.finishedOk).toBe(false);
    expect(sessionEmit).toHaveBeenCalledWith(
      'app:error',
      expect.objectContaining({ sessionId: 1, user_id: 1 })
    );
    const errPayload = sessionEmit.mock.calls[0][1];
    expect(errPayload.message).toContain('stopped unexpectedly');
    expect(agentPatch).toHaveBeenCalledWith(
      builderAgentId,
      expect.objectContaining({ status: 'failed' }),
      expect.anything()
    );
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 1,
        turn_id: 7,
        type: 'system',
        subtype: 'status',
      }),
      expect.anything()
    );
    const statusData = messagesCreate.mock.calls[0][0];
    const payload = JSON.parse(statusData.message_json);
    expect(payload.status).toContain('Cursor did not report a reason');
  });

  it('marks ERROR with Cursor’s detail as app:error carrying the detail', async () => {
    const service = setupTurnState();
    const { writer } = mockWriter();
    const run = mockRun([
      {
        type: 'status',
        status: 'ERROR',
        message: 'HTTP 503 Service unavailable',
        agent_id: 'a',
        run_id: 'r',
      },
    ]);

    await service._streamOneRun(
      sessionRow,
      run,
      undefined,
      {},
      {
        activeKey: 'turn-key',
        channel: 'chat',
        writer,
      }
    );

    expect(sessionEmit).toHaveBeenCalledWith(
      'app:error',
      expect.objectContaining({ sessionId: 1, user_id: 1 })
    );
    expect(sessionEmit.mock.calls[0][1].message).toContain('Service unavailable');
    expect(agentPatch).toHaveBeenCalledWith(
      builderAgentId,
      expect.objectContaining({ status: 'failed' }),
      expect.anything()
    );
  });

  it('keeps a deliberate user stop quiet (no app:error, no failed patch, no run drain)', async () => {
    const service = setupTurnState({ stopRequested: true });
    const { writer } = mockWriter();
    const wait = vi.fn();
    const run = mockRun(
      [
        { type: 'status', status: 'RUNNING', agent_id: 'a', run_id: 'r' },
        { type: 'status', status: 'CANCELLED', agent_id: 'a', run_id: 'r' },
      ],
      { wait }
    );

    const result = await service._streamOneRun(
      sessionRow,
      run,
      undefined,
      {},
      {
        activeKey: 'turn-key',
        channel: 'chat',
        writer,
      }
    );

    expect(result.finishedOk).toBe(false);
    expect(wait).not.toHaveBeenCalled();
    expect(sessionEmit).not.toHaveBeenCalledWith('app:error', expect.anything());
    expect(agentPatch).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'failed' }),
      expect.anything()
    );
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ turn_id: 7, type: 'system', subtype: 'status' }),
      expect.anything()
    );
    const statusData = messagesCreate.mock.calls[0][0];
    expect(JSON.parse(statusData.message_json).status).toBe('Cursor agent was cancelled.');
  });

  it('surfaces a silent stream end (no terminal status) as a failure', async () => {
    const service = setupTurnState();
    const { writer } = mockWriter();
    const run = mockRun([]);

    const result = await service._streamOneRun(
      sessionRow,
      run,
      undefined,
      {},
      {
        activeKey: 'turn-key',
        channel: 'chat',
        writer,
      }
    );

    expect(result.finishedOk).toBe(false);
    expect(sessionEmit).toHaveBeenCalledWith(
      'app:error',
      expect.objectContaining({ sessionId: 1, user_id: 1 })
    );
    expect(sessionEmit.mock.calls[0][1].message).toContain('ended the run without completing');
    expect(agentPatch).toHaveBeenCalledWith(
      builderAgentId,
      expect.objectContaining({ status: 'failed' }),
      expect.anything()
    );
  });

  it('enriches a silent end with the run result error detail', async () => {
    const service = setupTurnState();
    const { writer } = mockWriter();
    const run = mockRun([], {
      result: { id: 'run-test', status: 'error', error: { message: 'Service unavailable' } },
    });

    await service._streamOneRun(
      sessionRow,
      run,
      undefined,
      {},
      {
        activeKey: 'turn-key',
        channel: 'chat',
        writer,
      }
    );

    expect(sessionEmit.mock.calls[0][1].message).toContain('Service unavailable');
  });

  it('keeps the silent-end copy clean when wait() is unsupported (running run)', async () => {
    // SDK shape: every Run has wait on the prototype, but supports('wait') is false while
    // the run is still running — precisely the silent-end state. Throwing the SDK error
    // must not leak its own message ("Run operation \"wait\" is not supported") into copy.
    const service = setupTurnState();
    const { writer } = mockWriter();
    const run = mockRun([], {
      wait: vi.fn(async () => {
        throw new UnsupportedRunOperationError('wait');
      }),
    });

    await service._streamOneRun(
      sessionRow,
      run,
      undefined,
      {},
      {
        activeKey: 'turn-key',
        channel: 'chat',
        writer,
      }
    );

    expect(sessionEmit).toHaveBeenCalledWith(
      'app:error',
      expect.objectContaining({ sessionId: 1, user_id: 1 })
    );
    const message = sessionEmit.mock.calls[0][1].message;
    expect(message).toContain('ended the run without completing');
    expect(message).not.toContain('not supported');
  });

  it('does not call wait() when supports("wait") is false', async () => {
    const service = setupTurnState();
    const { writer } = mockWriter();
    const wait = vi.fn();
    const run = mockRun([], { supports: () => false, wait });

    await service._streamOneRun(
      sessionRow,
      run,
      undefined,
      {},
      {
        activeKey: 'turn-key',
        channel: 'chat',
        writer,
      }
    );

    expect(wait).not.toHaveBeenCalled();
    expect(sessionEmit.mock.calls[0][1].message).toContain('ended the run without completing');
  });

  it('uses the synchronous run.error handle detail without calling wait()', async () => {
    const service = setupTurnState();
    const { writer } = mockWriter();
    const wait = vi.fn();
    const run = mockRun([], { wait });
    run.error = { message: 'backend stream died' };

    await service._streamOneRun(
      sessionRow,
      run,
      undefined,
      {},
      {
        activeKey: 'turn-key',
        channel: 'chat',
        writer,
      }
    );

    expect(wait).not.toHaveBeenCalled();
    expect(sessionEmit.mock.calls[0][1].message).toContain('backend stream died');
  });

  it('(session 922) recovers the run handle detail for a bare CANCELLED', async () => {
    // The reported regression: Cursor's backend failed the run ("Service unavailable") and
    // the status event arrived with no message. The run handle still knew why.
    const service = setupTurnState();
    const { writer } = mockWriter();
    const run = mockRun(
      [
        { type: 'status', status: 'RUNNING', agent_id: 'a', run_id: 'r' },
        { type: 'status', status: 'CANCELLED', agent_id: 'a', run_id: 'r' },
      ],
      {
        supports: (op) => op === 'wait',
        result: { id: 'run-test', status: 'error', error: { message: 'Service unavailable' } },
      }
    );

    await service._streamOneRun(
      sessionRow,
      run,
      undefined,
      {},
      {
        activeKey: 'turn-key',
        channel: 'chat',
        writer,
      }
    );

    expect(sessionEmit).toHaveBeenCalledWith(
      'app:error',
      expect.objectContaining({ sessionId: 1, user_id: 1 })
    );
    expect(sessionEmit.mock.calls[0][1].message).toContain('Cursor reported: Service unavailable.');
  });

  it('marks the review turn failed for a remote CANCELLED', async () => {
    const service = setupTurnState({ channel: 'review' });
    const { writer } = mockWriter();
    const run = mockRun([{ type: 'status', status: 'CANCELLED', agent_id: 'a', run_id: 'r' }]);

    await service._streamOneRun(
      sessionRow,
      run,
      undefined,
      {},
      {
        activeKey: 'review-key',
        channel: 'review',
        writer,
      }
    );

    const reviewAgentTurn = reviewAgentTurnStub;
    expect(reviewAgentTurn._persistStatus).toHaveBeenCalledWith(
      sessionRow,
      expect.stringContaining('stopped unexpectedly')
    );
    expect(reviewAgentTurn.onAgentTurnComplete).toHaveBeenCalledWith(sessionRow, 'failed', {
      sdk: 'cursor',
    });
    expect(sessionEmit).toHaveBeenCalledWith(
      'app:error',
      expect.objectContaining({ sessionId: 1 })
    );
  });

  it('keeps a user-stopped silent end quiet (no app:error, status row, or failed patch)', async () => {
    const service = setupTurnState({ stopRequested: true });
    const { writer } = mockWriter();
    const run = mockRun([{ type: 'status', status: 'RUNNING', agent_id: 'a', run_id: 'r' }]);

    const result = await service._streamOneRun(
      sessionRow,
      run,
      undefined,
      {},
      {
        activeKey: 'turn-key',
        channel: 'chat',
        writer,
      }
    );

    expect(result.finishedOk).toBe(false);
    expect(sessionEmit).not.toHaveBeenCalledWith('app:error', expect.anything());
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(agentPatch).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'failed' }),
      expect.anything()
    );
  });
});

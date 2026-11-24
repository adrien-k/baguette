import { describe, expect, it, vi } from 'vitest';
import {
  findGitPushToolMessageRow,
  loadGitPushToolCallRowsForRequest,
  persistGitPushApprovalOutcome,
} from '../git-push-approval-persistence.js';

const REQUEST_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function gitPushOkEnvelopeMessageJson(requestId) {
  const inner = {
    ok: true,
    approval_requested: true,
    request_id: requestId,
    target_branch: 'development',
  };
  const text = JSON.stringify(inner, null, 2);
  return JSON.stringify({
    type: 'tool_call',
    kind: 'mcp',
    name: 'mcp__baguette__GitPush',
    args: { tool: 'GitPush', branch: 'development' },
    result: {
      status: 'ok',
      content: text,
      data: { content: [{ type: 'text', text }] },
    },
  });
}

function gitPushMessageJson(requestId) {
  const data = {
    ok: true,
    approval_requested: true,
    request_id: requestId,
    target_branch: 'development',
  };
  return JSON.stringify({
    type: 'tool_call',
    kind: 'mcp',
    name: 'mcp__baguette__GitPush',
    args: { tool: 'GitPush', branch: 'development' },
    result: {
      status: 'ok',
      content: JSON.stringify(data, null, 2),
      data,
    },
  });
}

describe('git-push-approval-persistence', () => {
  it('findGitPushToolMessageRow matches request_id', () => {
    const rows = [
      { id: 1, message_json: gitPushMessageJson('other') },
      { id: 2, message_json: gitPushMessageJson(REQUEST_ID) },
    ];
    const match = findGitPushToolMessageRow(rows, REQUEST_ID);
    expect(match?.row.id).toBe(2);
  });

  it('findGitPushToolMessageRow matches request_id inside ok() envelope data', () => {
    const rows = [{ id: 3, message_json: gitPushOkEnvelopeMessageJson(REQUEST_ID) }];
    const match = findGitPushToolMessageRow(rows, REQUEST_ID);
    expect(match?.row.id).toBe(3);
  });

  it('persistGitPushApprovalOutcome patches ok() envelope tool_call rows and unwraps metadata for agent notification', async () => {
    const row = { id: 100, agent_id: 9, message_json: gitPushOkEnvelopeMessageJson(REQUEST_ID) };
    const patch = vi.fn().mockResolvedValue({ id: 100 });
    const create = vi.fn().mockResolvedValue({ id: 502 });
    const orderBy = vi.fn().mockResolvedValue([row]);
    const agent = {
      id: 9,
      session_id: 7,
      agent_sdk: 'mock',
      agent_type: 'builder',
      model: 'mock',
      agent_config_id: null,
    };
    const db = (table) => {
      if (table === 'agents') {
        return { where: () => ({ first: async () => agent }) };
      }
      return {
        where: vi.fn().mockReturnThis(),
        whereRaw: vi.fn().mockReturnThis(),
        orderBy,
      };
    };
    const app = {
      get: (key) => (key === 'db' ? db : undefined),
      service: () => ({ patch, create }),
    };

    const result = await persistGitPushApprovalOutcome(
      app,
      { id: 7, user_id: 3 },
      {
        requestId: REQUEST_ID,
        outcome: 'canceled',
      }
    );

    expect(result.patched).toBe(true);
    expect(result.agent_notify).toEqual({ delivered: true });
    const payload = JSON.parse(patch.mock.calls[0][1].message_json);
    expect(payload.result.data.approval_outcome).toBe('canceled');
    expect(payload.result.data.approval_requested).toBe(false);
    expect(create).toHaveBeenCalledOnce();
    const notified = JSON.parse(create.mock.calls[0][0].message_json);
    expect(notified.request_id).toBe(REQUEST_ID);
    expect(notified.target_branch).toBe('development');
    expect(notified.content).toContain(`request_id: ${REQUEST_ID}`);
    expect(notified.content).toContain('Target: origin/development');
  });

  it('loadGitPushToolCallRowsForRequest queries by request_id substring', async () => {
    const targetRow = { id: 500, message_json: gitPushMessageJson(REQUEST_ID) };
    const whereRaw = vi.fn().mockReturnThis();
    const orderBy = vi.fn().mockResolvedValue([targetRow]);
    const chain = {
      where: vi.fn().mockReturnThis(),
      whereRaw,
      orderBy,
    };
    const db = vi.fn(() => chain);

    const rows = await loadGitPushToolCallRowsForRequest(db, 7, REQUEST_ID);

    expect(db).toHaveBeenCalledWith('session_messages');
    expect(chain.where).toHaveBeenCalledWith({ session_id: 7, type: 'tool_call' });
    expect(whereRaw).toHaveBeenCalledWith('message_json LIKE ?', [`%${REQUEST_ID}%`]);
    expect(rows).toEqual([targetRow]);
  });

  it('persistGitPushApprovalOutcome patches the tool_call message', async () => {
    const row = { id: 99, agent_id: 9, message_json: gitPushMessageJson(REQUEST_ID) };
    const patch = vi.fn().mockResolvedValue({ id: 99 });
    const create = vi.fn().mockResolvedValue({ id: 500 });
    const orderBy = vi.fn().mockResolvedValue([row]);
    const messageChain = {
      where: vi.fn().mockReturnThis(),
      whereRaw: vi.fn().mockReturnThis(),
      orderBy,
    };
    const agent = {
      id: 9,
      session_id: 7,
      agent_sdk: 'mock',
      agent_type: 'builder',
      model: 'mock',
      agent_config_id: null,
    };
    const db = (table) => {
      if (table === 'agents') {
        return {
          where: () => ({
            first: async () => agent,
          }),
        };
      }
      return messageChain;
    };
    const app = {
      get: (key) => (key === 'db' ? db : undefined),
      service: (name) => {
        if (name === 'messages') return { patch, create };
        return { patch };
      },
    };

    const session = { id: 7, user_id: 3 };

    const result = await persistGitPushApprovalOutcome(app, session, {
      requestId: REQUEST_ID,
      outcome: 'canceled',
    });

    expect(result.patched).toBe(true);
    expect(result.agent_notify?.delivered).toBe(true);
    expect(patch).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    const patchBody = patch.mock.calls[0][1];
    const payload = JSON.parse(patchBody.message_json);
    expect(payload.result.data.approval_requested).toBe(false);
    expect(payload.result.data.approval_outcome).toBe('canceled');
    const fromContent = JSON.parse(payload.result.content);
    expect(fromContent.approval_outcome).toBe('canceled');
  });

  it('persistGitPushApprovalOutcome finds GitPush outside a recent-tool-call window', async () => {
    const target = { id: 1, message_json: gitPushMessageJson(REQUEST_ID) };
    const decoys = Array.from({ length: 100 }, (_, i) => ({
      id: 1000 + i,
      message_json: JSON.stringify({
        type: 'tool_call',
        kind: 'mcp',
        name: 'mcp__baguette__Read',
        args: { tool: 'Read' },
        result: { status: 'ok', content: '{}', data: {} },
      }),
    }));
    const patch = vi.fn().mockResolvedValue({ id: 1 });
    const orderBy = vi.fn().mockResolvedValue([target, ...decoys]);
    const db = () => ({
      where: vi.fn().mockReturnThis(),
      whereRaw: vi.fn().mockReturnThis(),
      orderBy,
    });
    const app = {
      get: (key) => (key === 'db' ? db : undefined),
      service: () => ({ patch }),
    };

    const result = await persistGitPushApprovalOutcome(
      app,
      { id: 7, user_id: 3 },
      {
        requestId: REQUEST_ID,
        outcome: 'pushed',
      }
    );

    expect(result.patched).toBe(true);
    expect(patch).toHaveBeenCalledOnce();
  });
});

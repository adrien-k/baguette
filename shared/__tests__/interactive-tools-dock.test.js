import { describe, it, expect } from 'vitest';
import { ok } from '../../server/services/baguette-mcp-tool-result.js';
import {
  acpBuildToolCallComplete,
  acpBuildToolCallStart,
} from '../../server/agent-sdks/acp-mapping.ts';
import {
  collectInteractiveToolsForDock,
  gitPushAwaitingApproval,
} from '../interactive-tools-dock.js';

function mcpCall(id, tool, args = {}, result = { ok: true, markdown: '# Plan' }) {
  return {
    type: 'tool_call',
    id: 10,
    call_id: id,
    name: `mcp__baguette__${tool}`,
    kind: 'mcp',
    args: { tool, ...args },
    result,
    tool_status: 'completed',
    status: 'completed',
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function askCall(id, questions) {
  return {
    type: 'tool_call',
    id: 11,
    call_id: id,
    name: 'AskUserQuestions',
    kind: 'ask_user',
    args: { questions },
    result: { status: 'awaiting_user_answer' },
    tool_status: 'completed',
    status: 'completed',
    created_at: '2026-01-01T00:01:00.000Z',
  };
}

describe('collectInteractiveToolsForDock', () => {
  it('pins only the latest interactive CreatePlan or EditPlan in the turn', () => {
    const messages = [
      { type: 'user', content: 'go' },
      mcpCall('plan1', 'CreatePlan', { markdown: '# First' }),
      mcpCall('plan2', 'EditPlan', { patches: [] }, { ok: true, markdown: '# Updated' }),
    ];
    const dock = collectInteractiveToolsForDock(messages);
    expect(dock).toHaveLength(1);
    expect(dock[0].id).toBe('plan2');
  });

  it('skips non-interactive plans', () => {
    const messages = [
      { type: 'user', content: 'go' },
      mcpCall('plan1', 'CreatePlan', { markdown: '# x', interactive: false }),
    ];
    expect(collectInteractiveToolsForDock(messages)).toEqual([]);
  });

  it('unpins plan after a human user reply', () => {
    const messages = [
      { type: 'user', content: 'go' },
      mcpCall('plan1', 'CreatePlan'),
      { type: 'user', content: 'Proceed with the plan.' },
    ];
    expect(collectInteractiveToolsForDock(messages)).toEqual([]);
  });

  it('pins only the latest unanswered AskUserQuestions in the turn', () => {
    const messages = [
      { type: 'user', content: 'go' },
      askCall('ask1', [{ question: 'First?' }]),
      askCall('ask2', [{ question: 'Second?' }]),
    ];
    const dock = collectInteractiveToolsForDock(messages);
    expect(dock).toHaveLength(1);
    expect(dock[0].id).toBe('ask2');
  });

  it('pins GitPush while approval is requested', () => {
    const messages = [
      { type: 'user', content: 'push' },
      mcpCall(
        'push1',
        'GitPush',
        { reason: 'ship' },
        { ok: true, approval_requested: true, message: 'approval' }
      ),
    ];
    const dock = collectInteractiveToolsForDock(messages);
    expect(dock).toHaveLength(1);
    expect(dock[0].id).toBe('push1');
  });

  it('does not pin GitPush after canceled on ok() envelope shape', () => {
    const inner = JSON.stringify({
      ok: true,
      approval_requested: true,
      request_id: 'req-3',
    });
    const messages = [
      { type: 'user', content: 'push' },
      mcpCall(
        'push-envelope-canceled',
        'GitPush',
        {},
        {
          status: 'ok',
          content: inner,
          data: {
            content: [{ type: 'text', text: inner }],
            approval_requested: false,
            approval_outcome: 'canceled',
          },
        }
      ),
    ];
    expect(collectInteractiveToolsForDock(messages)).toEqual([]);
  });

  it('does not pin GitPush after approval outcome is stored', () => {
    const messages = [
      { type: 'user', content: 'push' },
      mcpCall(
        'push1',
        'GitPush',
        {},
        { ok: true, approval_requested: false, approval_outcome: 'canceled' }
      ),
    ];
    expect(collectInteractiveToolsForDock(messages)).toEqual([]);
  });

  it('ignores interactive tools from a previous turn', () => {
    const messages = [
      { type: 'user', content: 'first' },
      mcpCall('old-plan', 'CreatePlan'),
      { type: 'user', content: 'second' },
      { type: 'assistant', blocks: [{ type: 'text', text: 'ok' }] },
    ];
    expect(collectInteractiveToolsForDock(messages)).toEqual([]);
  });

  it('pins GitPush persisted through acpBuildToolCallComplete on ok() envelope', () => {
    const start = acpBuildToolCallStart('push-envelope', 'mcp__baguette__GitPush', {
      tool: 'GitPush',
      reason: 'ship',
    });
    const done = acpBuildToolCallComplete(start, {
      rawResult: ok({ approval_requested: true, request_id: 'req-1' }),
    });
    const msg = {
      type: 'tool_call',
      id: 20,
      call_id: 'push-envelope',
      name: 'mcp__baguette__GitPush',
      kind: 'mcp',
      args: { tool: 'GitPush' },
      result: done.result,
      tool_status: 'completed',
      status: 'completed',
      created_at: '2026-01-01T00:00:00.000Z',
    };
    expect(gitPushAwaitingApproval(msg)).toBe(true);
    const dock = collectInteractiveToolsForDock([{ type: 'user', content: 'push' }, msg]);
    expect(dock).toHaveLength(1);
    expect(dock[0].id).toBe('push-envelope');
  });

  it('keeps pending GitPush pinned after a later turn starts', () => {
    const push = mcpCall(
      'push1',
      'GitPush',
      {},
      { ok: true, approval_requested: true, request_id: 'req-2' }
    );
    const messages = [
      { type: 'user', content: 'push' },
      push,
      { type: 'user', content: 'also update the PR title' },
    ];
    const dock = collectInteractiveToolsForDock(messages);
    expect(dock).toHaveLength(1);
    expect(dock[0].id).toBe('push1');
  });
});
